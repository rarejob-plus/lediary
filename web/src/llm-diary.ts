// Diary 固有の LLM 呼び出し (expand / correct-answer / flow-check / lesson-sheet)。
// サーバ実装 (lediary/functions/src/index.ts) と1:1 対応。プロンプトはサーバ版を移植。

import { callLLM } from './llm';

// ─── 共通ユーティリティ ───

const CASUAL_TONE_RULE = 'Tone: casual, like a friend. Avoid stiff/formal English unless the Japanese is clearly formal.';

function stripFences(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
}

function parseJsonObject<T>(content: string): T {
  const cleaned = stripFences(content);
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object found in LLM response');
  try {
    return JSON.parse(match[0]);
  } catch (firstErr) {
    const fixed = match[0]
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'");
    try {
      return JSON.parse(fixed);
    } catch (secondErr) {
      // デバッグ用: position 周辺を切り出してエラーに添える
      const posMatch = /position (\d+)/.exec(String((firstErr as Error)?.message ?? ''));
      const pos = posMatch ? Number(posMatch[1]) : -1;
      const src = match[0];
      const snippet = pos >= 0
        ? `…${src.slice(Math.max(0, pos - 60), pos)}⟪HERE⟫${src.slice(pos, pos + 60)}…`
        : src.slice(0, 200);
      const err = new Error(
        `parseJsonObject failed: ${(firstErr as Error)?.message}\n  context: ${snippet}`,
      );
      (err as Error & { raw?: string }).raw = src;
      throw err;
    }
  }
}

// LLM が壊れた JSON を返すことが偶発的にあるので、2 回までリトライする汎用ラッパ。
async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      console.warn(`[${label}] attempt ${attempt + 1} failed:`, err);
    }
  }
  throw lastErr;
}

function splitIntoSentences(text: string): string[] {
  return text
    .trim()
    .split(/(?<=[.!?])\s+(?=\S)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function stripSentenceIndexRefs(text: string | undefined): string {
  if (!text) return '';
  const JP_PARTICLE = '(?:を|に|が|は|の|で|と|から|まで|へ|も|や|か|ね|について|では|でも)';
  return text
    .replace(new RegExp(`\\s*\\[\\d+\\]\\s*${JP_PARTICLE}?\\s*`, 'g'), '')
    .replace(new RegExp(`sentenceIndex\\s*\\d+\\s*(?:の文)?\\s*${JP_PARTICLE}?\\s*`, 'gi'), '')
    .replace(/\bsentence\s*#?\d+\b/gi, '')
    .replace(new RegExp(`文番号\\s*\\d+\\s*${JP_PARTICLE}?\\s*`, 'g'), '')
    .replace(new RegExp(`文\\s*\\d+\\s*(?:番目|つ目|番|目)?\\s*${JP_PARTICLE}?\\s*`, 'g'), '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([、。,.])/g, '$1')
    .replace(/(?:^|\s)[—–-]\s*[、。]/g, '$1')
    .trim();
}

// ─── 型 ───

export interface FeedbackItem {
  original: string;
  corrected: string;
  explanation: string;
}

export interface VocabItem {
  word: string;
  definition: string;
  example: string;
}

export interface SentencePair {
  jp: string;
  en: string;
}

export interface DiaryAnalysis {
  feedback: FeedbackItem[];
  vocabulary: VocabItem[];
  expansionQuestions: ExpansionQuestion[];
  sentencePairs?: SentencePair[];
  mood?: string;
  coverKeyword?: string;
}

export interface ExpansionQuestion {
  question: string;
  hintPhrases: string[];
  afterSentence: string;
  // 挿入先の直後の文 (= afterSentence の次に並ぶ文)。最終文末への挿入では空文字。
  // LLM がこの 2 文に挟まれた状態を想定して質問と hintPhrases を作る。
  beforeNext?: string;
}

export interface FlowSuggestion {
  between: string;
  suggestion: string;
  revised: string;
  reason: string;
}

export interface FlowCheckResult {
  suggestions: FlowSuggestion[];
  overall: string;
}

export interface CorrectAnswerResult {
  corrected: string;
  explanation: string;
}

// ─── expand ───

export async function generateExpansionQuestions(
  contentJp: string,
  userTranslation: string,
): Promise<ExpansionQuestion[]> {
  // 各文を番号付きで渡し、LLM に「どの文の直後に挿入するか」を index で決めさせる。
  // 同時に直前/直後の文を意識して、挿入時に前後と自然に繋がる質問を作らせる。
  const sentences = splitIntoSentences(userTranslation || '');
  const numbered = sentences.length > 0
    ? sentences.map((s, i) => `[${i + 1}] ${s}`).join('\n')
    : '(no English sentences yet)';

  const systemPrompt = `Generate exactly 3 5W1H follow-up questions to expand a Japanese learner's English diary.

The numbered sentences below are how the diary currently flows. For each question, pick a slot to INSERT the learner's answer — the slot is "right after sentence [N]". The answer will be sandwiched between sentence [N] and sentence [N+1] (or just appended if [N] is the last). Design the question and hintPhrases so the answer flows naturally with BOTH neighbors — not just the preceding sentence.

CRITICAL — no redundant questions:
- Do NOT ask about something the diary already explains. If sentence [N+1] (or any other sentence) already answers "why" / "what" / "how", don't ask that question.
- Aim for genuinely NEW depth: an unstated reason, a feeling not yet voiced, a concrete example/anecdote, a consequence the writer hasn't mentioned, a contrast, sensory detail, or context outside the timeline.
- Before finalizing each question, re-read the surrounding sentences and confirm the answer is NOT already in the diary.

Return JSON:
{"expansionQuestions":[{"question":"...","hintPhrases":["...","..."],"afterSentenceIndex":N,"afterSentence":"exact text of sentence [N]","beforeNext":"exact text of sentence [N+1] or empty if appended"}]}

- Pick 3 distinct slots when possible (different afterSentenceIndex each).
- afterSentenceIndex MUST be 1..N from the numbered list. afterSentence MUST be the verbatim text of that sentence.
- beforeNext is sentence [N+1] verbatim, or "" if you chose the last sentence.
- hintPhrases: 2-3 casual English phrases that work as the OPENING of the answer and don't clash with what follows.
- ${CASUAL_TONE_RULE}

Return ONLY JSON.`;

  const userMessage = `Japanese diary:\n${contentJp || ''}\n\nUser's English sentences (numbered):\n${numbered}`;
  const raw = await withRetry('generateExpansionQuestions', async () => {
    const response = await callLLM(systemPrompt, userMessage);
    return parseJsonObject<{
      expansionQuestions?: Array<{
        question: string;
        hintPhrases?: string[];
        afterSentenceIndex?: number;
        afterSentence?: string;
        beforeNext?: string;
      }>;
    }>(response);
  });

  return (raw.expansionQuestions || []).map((q) => {
    // index 経由で sentences から再解決 (LLM が afterSentence を微妙に書き換えた場合の保険)
    let after = q.afterSentence || '';
    let next = q.beforeNext ?? '';
    if (typeof q.afterSentenceIndex === 'number'
        && Number.isInteger(q.afterSentenceIndex)
        && q.afterSentenceIndex >= 1
        && q.afterSentenceIndex <= sentences.length) {
      after = sentences[q.afterSentenceIndex - 1]!;
      next = q.afterSentenceIndex < sentences.length ? sentences[q.afterSentenceIndex]! : '';
    }
    return {
      question: q.question,
      hintPhrases: q.hintPhrases || [],
      afterSentence: after,
      beforeNext: next,
    } as ExpansionQuestion;
  });
}

// ─── correct-answer ───

export async function correctExpansionAnswer(
  question: string,
  answer: string,
  diaryContext: string,
  afterSentence: string,
  beforeNext: string = '',
): Promise<CorrectAnswerResult> {
  const slotDesc = beforeNext
    ? `The answer will be INSERTED between two existing sentences:\nPREVIOUS: "${afterSentence || '(none)'}"\nNEXT:     "${beforeNext}"`
    : `The answer will be APPENDED at the end of the diary, right after:\n"${afterSentence || '(none)'}"`;

  const systemPrompt = `Correct the user's answer so it slots naturally into the diary.

${slotDesc}

Goal: natural casual spoken English, keep the user's meaning. Make it flow with BOTH neighbors (if NEXT exists). Add a light casual connector (Actually / Plus / Honestly / The thing is / On top of that / Because / And) ONLY when the answer would feel abrupt; if it already flows (e.g. starts with It/We/That referencing context), leave the start alone. No formal connectors (Furthermore / Moreover / Therefore). If the NEXT sentence starts with a connector that would now clash (e.g. NEXT starts with "Anyway,"), you may end the corrected answer in a way that doesn't fight it — but don't rewrite NEXT.

Return JSON: {"corrected":"...","explanation":"日本語で簡潔に。修正なし→空文字。接続詞追加→その意図も書く"}

${CASUAL_TONE_RULE}
Return ONLY JSON.`;

  const userMessage = `Question that prompted the answer: ${question || ''}\n\nFull diary context:\n${diaryContext || ''}\n\nUser's answer: ${answer}`;
  return withRetry('correctExpansionAnswer', async () => {
    const response = await callLLM(systemPrompt, userMessage);
    return parseJsonObject<CorrectAnswerResult>(response);
  });
}

// ─── flow-check ───

export async function flowCheck(text: string): Promise<FlowCheckResult> {
  const sentences = splitIntoSentences(text);

  const systemPrompt = `Check the flow between numbered English sentences. Suggest transition fixes only — not grammar/vocab.

Return JSON:
{"suggestions":[{"sentenceIndex":N,"suggestion":"日本語で『何をどうするか』(例:『Anyway を Since に置き換える』)","revised":"that sentence rewritten, ≤1.5× length","reason":"日本語でなぜ"}],"overall":"日本語で全体の流れコメント"}

- 0-3 suggestions. Flows well → empty array + positive overall.
- sentenceIndex = 1-based from the list. Invalid → skip.
- revised rewrites THAT ONE sentence only, no neighbors pulled in.
- Don't write "[N]"/"sentenceIndex"/"the second sentence" in any Japanese field.
- ${CASUAL_TONE_RULE}
Return ONLY JSON.`;

  const userMessage = sentences.length > 0
    ? `User's English sentences (numbered — refer to these by sentenceIndex):\n${sentences.map((s, i) => `[${i + 1}] ${s}`).join('\n')}`
    : `Diary entry:\n${text}`;

  const raw = await withRetry('flowCheck', async () => {
    const response = await callLLM(systemPrompt, userMessage);
    return parseJsonObject<{
      suggestions?: Array<{ sentenceIndex?: number; between?: string; suggestion: string; revised: string; reason: string }>;
      overall?: string;
    }>(response);
  });

  const sentenceCount = (s: string): number => (s.match(/[.!?]+/g) || []).length || 1;
  const suggestions = (raw.suggestions || [])
    .map((s): FlowSuggestion | null => {
      let between = '';
      if (typeof s.sentenceIndex === 'number' && Number.isInteger(s.sentenceIndex)
          && s.sentenceIndex >= 1 && s.sentenceIndex <= sentences.length) {
        between = sentences[s.sentenceIndex - 1]!;
      } else if (typeof s.between === 'string' && s.between.length > 0) {
        between = s.between;
      } else {
        return null;
      }
      return {
        between,
        suggestion: stripSentenceIndexRefs(s.suggestion),
        revised: s.revised,
        reason: stripSentenceIndexRefs(s.reason),
      };
    })
    .filter((s): s is FlowSuggestion => s !== null)
    .filter((s) => {
      if (!s.revised || !s.between) return false;
      if (s.revised.length > s.between.length * 2.5 + 20) return false;
      if (sentenceCount(s.revised) > sentenceCount(s.between) + 1) return false;
      return true;
    });

  return { suggestions, overall: stripSentenceIndexRefs(raw.overall) };
}

// ─── analyzeDiary: 添削 / vocab / expansion / mood / coverKeyword を1発で生成 ───

export interface AnalyzeOptions {
  previousFeedback?: FeedbackItem[];
  attemptCount?: number;
  // contentJp が変わってない & 既に mood/coverKeyword 両方ある時に true。
  // プロンプトから mood / coverKeyword を外してコスト/レイテンシ節約。
  skipMoodAndCover?: boolean;
  /** 既知 (= 過去 entry に登場した / dismiss された) phrase。新 vocab 出力時に除外させる。 */
  excludeVocab?: string[];
  /** モード文脈。morning = 朝に書く今日の予定 / 未来形主体、diary = 過去の出来事 等。 */
  mode?: 'morning' | 'lesson' | 'diary' | 'story';
}

/** モードごとの添削方針 (= 未来形 / 過去形 等の期待) を prompt に注入する。 */
function modeGuidance(mode: AnalyzeOptions['mode']): string {
  switch (mode) {
    case 'morning':
      return `[Mode: Morning intent / plans for today]
- The writer is journaling at the START of the day. Expect future / near-future content: plans, intentions, hopes.
- DO NOT "correct" present-perfect / future tense ("I will…", "I'm going to…", "I'm planning to…", "Today I want to…") into past tense. That breaks the writer's intent.
- Suggest natural near-future expressions when awkward: "I'll", "I'm gonna" (casual), "I plan to", "Hoping to…".
- If the writer mixes "what I'll do today" with "how I'm feeling this morning", both are valid — don't force tense unification.`;
    case 'lesson':
      return `[Mode: Lesson reflection (post-class)]
- The writer is reflecting on an English lesson that just happened. Expect a mix of past tense (what we talked about) and present tense (what I learned, what I think now).
- Pay attention to learning-related vocabulary; if they used a clumsy expression, suggest a phrase a teacher would have taught.`;
    case 'diary':
      return `[Mode: Evening diary of today's events]
- The writer is recounting what happened today. Past tense is the default.
- If they slip into future or unclear tense, gently fix to past where it makes sense for events that already happened.`;
    case 'story':
      return `[Mode: Short story / anecdote]
- The writer is telling a small story or anecdote. Tense can be past (recall) or present (vivid retelling).
- Preserve the chosen tense — don't unify to past if they've chosen present-tense storytelling.`;
    default:
      return '';
  }
}

export async function analyzeDiary(
  contentJp: string,
  userTranslation: string,
  opts: AnalyzeOptions = {},
): Promise<DiaryAnalysis> {
  const previousFeedback = opts.previousFeedback || [];
  const attemptCount = opts.attemptCount ?? 1;
  const skipMoodAndCover = opts.skipMoodAndCover ?? false;
  const excludeVocab = opts.excludeVocab || [];

  // 添削レベル — Basic は文法/不自然さ重視、Intermediate は自然さ、Advanced は仕上げ。
  const levelMap: Record<number, string> = {
    1: 'Level: Basic. Fix clear grammar/article/preposition errors and unnatural phrasing. Also add transitions ("Anyway,", "On a different note,") when topics jump abruptly.',
    2: 'Level: Intermediate. Polish phrasing and word choice; sound conversational, not textbook.',
    3: 'Level: Advanced. Native-level polish — rhythm, precise vocab, stylistic flourish.',
  };
  const levelInstruction = levelMap[Math.min(Math.max(attemptCount, 1), 3)]!;

  const modeBlock = modeGuidance(opts.mode);

  const systemPrompt = `You are an English coach for a Japanese learner. Analyze their Japanese diary + English translation.

${levelInstruction}
${modeBlock ? modeBlock + '\n' : ''}Tone: casual English like a friend texting (no textbook/formal). Japanese fields use polite ですます調.

Return JSON:
{
  "feedback": [{"sentenceIndex": N, "corrected": "...", "explanation": "日本語でニュアンス差を簡潔に"}],
  "vocabulary": [{"word": "...", "definition": "日本語", "example": "(日記 or corrected 文から該当語を含む 1 文をそのまま抜き出す)"}],
  "sentencePairs": [{"jp": "JP 1 文", "en": "対応する EN 1 文 (添削後があればそちらを優先)"}]${skipMoodAndCover ? '' : `,
  "mood": "ONE lowercase English word (calm/excited/cozy/buoyant/restless/focused 等)",
  "coverKeyword": "1-3 English words for a stock photo. Pick the MOST CONCRETE subject from the diary (food, place, activity, object). Examples: 'bbq grill', 'morning coffee', 'tokyo station', 'wet umbrella', 'office desk'. Only bias toward Japan-themed words (sakura/izakaya/ramen 等) if the diary explicitly references Japanese context. Otherwise pick whatever the diary is literally about. Bright, not dark."`}
}

Rules:
- feedback.sentenceIndex = 1-based index from the numbered list below. Invalid index → drop.
- corrected rewrites THAT ONE sentence only, ≤1.5× source length. Don't quote-back the source unchanged.
- If a sentence is already natural, omit it. Empty array is fine. One feedback per index; combine multiple fixes.
- Don't reference "[N]"/"sentenceIndex"/"the second sentence" inside explanation.
- vocabulary: 3-5 items. word MUST appear (substring, case-insensitive) in EITHER the user's original English text OR one of your corrected sentences. Do NOT invent generic morning/lesson/diary related vocabulary that the diary didn't actually use. example MUST be a sentence quoted verbatim from the diary (user's original or your corrected version) that contains the word. Do not synthesize fresh example sentences. DO NOT repeat any item from the "Known vocabulary" list below — the learner already saw those.
- sentencePairs: align Japanese diary sentences with their English counterparts. Use corrected English when applicable. Skip JP sentences that have no real English counterpart (don't invent). Skip if no userTranslation. Keep order matching JP sequence.

Return ONLY the JSON object.`;

  const sentences = userTranslation ? splitIntoSentences(userTranslation) : [];

  let userMessage = `Japanese diary:\n${contentJp}`;
  if (sentences.length > 0) {
    userMessage += `\n\nUser's English sentences (numbered — refer to these by sentenceIndex):\n`;
    userMessage += sentences.map((s, i) => `[${i + 1}] ${s}`).join('\n');
  } else {
    userMessage += '\n\n(No translation attempt provided)';
  }
  if (previousFeedback.length > 0) {
    userMessage += '\n\nPreviously suggested corrections (DO NOT contradict these — the user applied your fixes):\n';
    for (const fb of previousFeedback) {
      userMessage += `- "${fb.original}" → "${fb.corrected}"\n`;
    }
  }
  if (excludeVocab.length > 0) {
    // 多すぎると prompt が膨らむので 80 件まで (新しい順想定)
    const trimmed = excludeVocab.slice(0, 80);
    userMessage += `\n\nKnown vocabulary (already shown to learner — exclude these):\n${trimmed.map((v) => `- ${v}`).join('\n')}`;
  }

  const analysis = await withRetry('analyzeDiary', async () => {
    const response = await callLLM(systemPrompt, userMessage);
    return parseJsonObject<DiaryAnalysis & { feedback: Array<FeedbackItem & { sentenceIndex?: number }> }>(response);
  });

  if (!userTranslation) analysis.feedback = [];
  if (!analysis.feedback) analysis.feedback = [];
  if (!analysis.vocabulary) analysis.vocabulary = [];
  if (!analysis.expansionQuestions) analysis.expansionQuestions = [];

  // sentenceIndex → original を解決。範囲外/欠落は drop。LLM が稀に index ではなく
  // original を返す古い動作も後方互換で拾う。
  analysis.feedback = analysis.feedback
    .map((fb): FeedbackItem | null => {
      const explanation = stripSentenceIndexRefs(fb.explanation);
      const idx = (fb as { sentenceIndex?: number }).sentenceIndex;
      if (typeof idx === 'number' && Number.isInteger(idx) && idx >= 1 && idx <= sentences.length) {
        return { original: sentences[idx - 1]!, corrected: fb.corrected, explanation };
      }
      if (typeof fb.original === 'string' && fb.original.length > 0) {
        return { original: fb.original, corrected: fb.corrected, explanation };
      }
      return null;
    })
    .filter((fb): fb is FeedbackItem => fb !== null);

  // No-op フィルタ: original と corrected が同じ (空白/句読点/大小文字差のみ) は捨てる
  const norm = (s: string) => s.toLowerCase().replace(/[\s.,!?;:'"`]+/g, ' ').trim();
  analysis.feedback = analysis.feedback.filter((fb) =>
    fb.original && fb.corrected && norm(fb.original) !== norm(fb.corrected),
  );

  // Scope バックストップ: corrected が original より大幅に長い/文数が増えてるアイテムは
  // 「LLM が周辺の文まで巻き込んで書き換えた」サインなので捨てる
  const sentenceCount = (s: string): number => (s.match(/[.!?]+/g) || []).length || 1;
  analysis.feedback = analysis.feedback.filter((fb) => {
    const oLen = fb.original.length;
    const cLen = fb.corrected.length;
    const oS = sentenceCount(fb.original);
    const cS = sentenceCount(fb.corrected);
    if (cLen > oLen * 2.5 + 20) return false;
    if (cS > oS + 1) return false;
    return true;
  });

  // 検証: original が userTranslation の中に substring として実在するか
  if (userTranslation) {
    const haystack = norm(userTranslation);
    analysis.feedback = analysis.feedback.filter((fb) => haystack.includes(norm(fb.original)));
  }

  // Backstop: original が既出 feedback の範囲とかぶってたら drop。
  // 最終本文への replace() が競合しないようにする保険。
  const kept: FeedbackItem[] = [];
  for (const fb of analysis.feedback) {
    if (!fb.original) continue;
    const overlap = kept.some(
      (k) => k.original.includes(fb.original) || fb.original.includes(k.original),
    );
    if (!overlap) kept.push(fb);
  }
  analysis.feedback = kept;

  // 語彙の検証: word が本文 (userTranslation + corrected) に substring として存在しないものは drop。
  // LLM が「日記内容に関係ない一般語彙」を返してくる事故を防ぐ。
  // 加えて example も実本文の該当文に置き換える (LLM 例文の捏造を排除)。
  analysis.vocabulary = sanitizeVocabAgainstText(analysis.vocabulary, userTranslation, analysis.feedback);

  return analysis;
}

/** vocab を実本文 (userTranslation + 各 feedback.corrected) に照らして検証 + example 差し替え。
 *  - word が本文に出てこないものは drop
 *  - example は word を含む実本文の文に置き換え (見つからなければ LLM の example をそのまま) */
function sanitizeVocabAgainstText(
  vocabulary: VocabItem[] | undefined,
  userTranslation: string,
  feedback: FeedbackItem[],
): VocabItem[] {
  if (!Array.isArray(vocabulary) || vocabulary.length === 0) return [];
  const sources: string[] = [];
  if (userTranslation) sources.push(userTranslation);
  for (const fb of feedback) {
    if (fb?.corrected) sources.push(fb.corrected);
  }
  if (sources.length === 0) return vocabulary;
  const haystack = sources.join(' \n ').toLowerCase();
  const allSentences = sources.flatMap((s) => splitIntoSentences(s));
  return vocabulary
    .filter((v) => {
      if (!v?.word) return false;
      const w = v.word.toLowerCase().trim();
      if (!w) return false;
      return haystack.includes(w);
    })
    .map((v) => {
      const w = v.word.toLowerCase();
      const realExample = allSentences.find((s) => s.toLowerCase().includes(w));
      return realExample ? { ...v, example: realExample } : v;
    });
}

// ─── extractVocabulary: 既存 text から新規 vocab だけ抜き出す軽量呼び出し ───
// 用途: 「日記を膨らませる」で挿入された追記文を分析、既存 vocab に追加する。
// 添削 (analyzeDiary) フルランは重いので、vocab だけ生成する小さなプロンプトに分離。

// ─── alignSentences: 既存 entry の JP↔EN 文ペアをオンデマンドで生成 ───
// 用途: クイズ機能で過去 entry の文ペアが未保存の場合に 1 回だけ呼んで Firestore に焼き込む。

export async function alignSentences(
  contentJp: string,
  userTranslation: string,
): Promise<SentencePair[]> {
  if (!contentJp.trim() || !userTranslation.trim()) return [];
  const systemPrompt = `Align a Japanese diary with its English translation into sentence pairs.

Output JSON: {"pairs":[{"jp":"JP 1 文","en":"対応する EN 1 文"}]}

Rules:
- One JP sentence per item; do not merge multiple JP sentences into one entry.
- If a JP sentence has no real English counterpart (omitted from translation), skip it.
- Do not invent EN content that isn't in the user's translation.
- Keep order matching the JP sequence.
- Trim leading/trailing whitespace, do not include trailing 。 or punctuation if natural.

Return ONLY the JSON object.`;
  const userMessage = `JP diary:\n${contentJp}\n\nEN translation:\n${userTranslation}`;
  try {
    const response = await callLLM(systemPrompt, userMessage);
    const parsed = parseJsonObject<{ pairs?: SentencePair[] }>(response);
    return Array.isArray(parsed.pairs)
      ? parsed.pairs.filter((p) => p && typeof p.jp === 'string' && typeof p.en === 'string' && p.jp.trim() && p.en.trim())
      : [];
  } catch (e) {
    console.warn('[alignSentences] failed', e);
    return [];
  }
}

export async function extractVocabulary(
  text: string,
  excludeVocab: string[] = [],
): Promise<VocabItem[]> {
  if (!text.trim()) return [];
  const trimmedExclude = excludeVocab.slice(0, 80);
  const systemPrompt = `You are an English coach for a Japanese learner. From the English text below, pick 2-4 useful collocations/phrases worth saving as flashcards.

Return JSON: {"vocabulary":[{"word":"...","definition":"日本語","example":"(text から該当語を含む 1 文をそのまま抜き出す)"}]}

Rules:
- Pick natural, real-world collocations a learner can reuse. Avoid single function words.
- "word" MUST literally appear (substring, case-insensitive) in the text below. Do not invent generic vocabulary that the text didn't actually use.
- "example" MUST be a sentence quoted verbatim from the text that contains the word. Do not synthesize fresh example sentences.
- "definition" is short Japanese.
- DO NOT repeat any item in the "Known vocabulary" list — the learner already saw those.
- 2-4 items only. If nothing new is worth picking, return an empty array.

Return ONLY the JSON object.`;
  let userMessage = `English text:\n${text}`;
  if (trimmedExclude.length > 0) {
    userMessage += `\n\nKnown vocabulary (exclude — already shown):\n${trimmedExclude.map((v) => `- ${v}`).join('\n')}`;
  }
  try {
    const response = await callLLM(systemPrompt, userMessage);
    const parsed = parseJsonObject<{ vocabulary?: VocabItem[] }>(response);
    const raw = Array.isArray(parsed.vocabulary) ? parsed.vocabulary.filter((v) => v?.word) : [];
    return sanitizeVocabAgainstText(raw, text, []);
  } catch (e) {
    console.warn('[extractVocabulary] failed', e);
    return [];
  }
}

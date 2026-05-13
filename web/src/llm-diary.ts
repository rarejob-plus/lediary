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

export function generateShareId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let result = '';
  for (const b of bytes) result += chars[b % chars.length];
  return result;
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

export interface DiaryAnalysis {
  feedback: FeedbackItem[];
  vocabulary: VocabItem[];
  expansionQuestions: ExpansionQuestion[];
  mood?: string;
  coverKeyword?: string;
}

export interface ExpansionQuestion {
  question: string;
  hintPhrases: string[];
  afterSentence: string;
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

export interface LessonSheetVocab {
  word: string;
  definition: string;
  example: string;
}
export interface LessonSheetDiscussion {
  topic: string;
  questions: string[];
}
export interface LessonSheet {
  title: string;
  vocabulary: LessonSheetVocab[];
  discussionTopics: LessonSheetDiscussion[];
}

// ─── expand ───

export async function generateExpansionQuestions(
  contentJp: string,
  userTranslation: string,
): Promise<ExpansionQuestion[]> {
  const systemPrompt = `Generate exactly 3 5W1H follow-up questions to expand a Japanese learner's English diary.

Return JSON:
{"expansionQuestions":[{"question":"...","hintPhrases":["...","..."],"afterSentence":"exact match from user's English"}]}

- Each question targets a specific sentence worth expanding.
- afterSentence must exactly match one of the user's English sentences.
- hintPhrases: 2-3 casual English phrases the learner can use.
- ${CASUAL_TONE_RULE}

Return ONLY JSON.`;

  const userMessage = `Japanese diary:\n${contentJp || ''}\n\nUser's English translation:\n${userTranslation}`;
  return withRetry('generateExpansionQuestions', async () => {
    const response = await callLLM(systemPrompt, userMessage);
    const parsed = parseJsonObject<{ expansionQuestions: ExpansionQuestion[] }>(response);
    return parsed.expansionQuestions || [];
  });
}

// ─── correct-answer ───

export async function correctExpansionAnswer(
  question: string,
  answer: string,
  diaryContext: string,
  afterSentence: string,
): Promise<CorrectAnswerResult> {
  const systemPrompt = `Correct the user's answer so it slots naturally after "${afterSentence || '(unknown)'}" in their diary.

Goal: natural casual spoken English, keep the user's meaning. Add a light casual connector (Actually / Plus / Honestly / The thing is / On top of that / Because / And) ONLY when the answer would feel abrupt; if it already flows (e.g. starts with It/We/That referencing context), leave the start alone. No formal connectors (Furthermore / Moreover / Therefore).

Return JSON: {"corrected":"...","explanation":"日本語で簡潔に。修正なし→空文字。接続詞追加→その意図も書く"}

${CASUAL_TONE_RULE}
Return ONLY JSON.`;

  const userMessage = `Preceding sentence (the answer will go right after this):\n${afterSentence || '(no preceding sentence)'}\n\nFull diary context: ${diaryContext || ''}\n\nQuestion that prompted the answer: ${question || ''}\n\nUser's answer: ${answer}`;
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

// ─── lesson-sheet 生成 ───

export async function generateLessonSheetContent(
  contentJp: string,
  correctedText: string,
  vocabulary: LessonSheetVocab[],
): Promise<LessonSheet> {
  const systemPrompt = `Make RareJob WNA-style lesson material from a student's diary (JP + corrected EN) for a 25-min English conversation lesson.

Return JSON:
{"title":"catchy article-style headline","vocabulary":[{"word":"...","definition":"simple English def","example":"natural sentence"}],"discussionTopics":[{"topic":"heading","questions":["...","..."]}]}

- title: article headline, English.
- vocabulary: 4-6 useful items from the diary/corrections. English everywhere (tutor doesn't read Japanese).
- discussionTopics: exactly 2 groups × 2-3 questions, easier→harder. Use diary as a springboard for opinion/theme questions; do NOT ask factual questions whose answers are already in the diary.
- Do NOT include the diary text itself (it's shown elsewhere as the "Article" section).
Return ONLY JSON.`;

  const userMessage = `Student's diary (Japanese):\n${contentJp}\n\nStudent's English text (corrected):\n${correctedText}\n\nVocabulary learned:\n${vocabulary.map((v) => `${v.word}: ${v.definition}`).join('\n')}`;
  return withRetry('generateLessonSheetContent', async () => {
    const response = await callLLM(systemPrompt, userMessage);
    return parseJsonObject<LessonSheet>(response);
  });
}

// ─── analyzeDiary: 添削 / vocab / expansion / mood / coverKeyword を1発で生成 ───

export interface AnalyzeOptions {
  previousFeedback?: FeedbackItem[];
  attemptCount?: number;
  // contentJp が変わってない & 既に mood/coverKeyword 両方ある時に true。
  // プロンプトから mood / coverKeyword を外してコスト/レイテンシ節約。
  skipMoodAndCover?: boolean;
}

export async function analyzeDiary(
  contentJp: string,
  userTranslation: string,
  opts: AnalyzeOptions = {},
): Promise<DiaryAnalysis> {
  const previousFeedback = opts.previousFeedback || [];
  const attemptCount = opts.attemptCount ?? 1;
  const skipMoodAndCover = opts.skipMoodAndCover ?? false;

  // 添削レベル — Basic は文法/不自然さ重視、Intermediate は自然さ、Advanced は仕上げ。
  const levelMap: Record<number, string> = {
    1: 'Level: Basic. Fix clear grammar/article/preposition errors and unnatural phrasing. Also add transitions ("Anyway,", "On a different note,") when topics jump abruptly.',
    2: 'Level: Intermediate. Polish phrasing and word choice; sound conversational, not textbook.',
    3: 'Level: Advanced. Native-level polish — rhythm, precise vocab, stylistic flourish.',
  };
  const levelInstruction = levelMap[Math.min(Math.max(attemptCount, 1), 3)]!;

  const systemPrompt = `You are an English coach for a Japanese learner. Analyze their Japanese diary + English translation.

${levelInstruction}
Tone: casual English like a friend texting (no textbook/formal). Japanese fields use polite ですます調.

Return JSON:
{
  "feedback": [{"sentenceIndex": N, "corrected": "...", "explanation": "日本語でニュアンス差を簡潔に"}],
  "vocabulary": [{"word": "...", "definition": "日本語", "example": "..."}]${skipMoodAndCover ? '' : `,
  "mood": "ONE lowercase English word (calm/excited/cozy/buoyant/restless/focused 等)",
  "coverKeyword": "1-3 English words for a stock photo. Bias toward Japan (japanese/tokyo/ramen/sakura/konbini/izakaya 等). Concrete subjects, bright not dark."`}
}

Rules:
- feedback.sentenceIndex = 1-based index from the numbered list below. Invalid index → drop.
- corrected rewrites THAT ONE sentence only, ≤1.5× source length. Don't quote-back the source unchanged.
- If a sentence is already natural, omit it. Empty array is fine. One feedback per index; combine multiple fixes.
- Don't reference "[N]"/"sentenceIndex"/"the second sentence" inside explanation.
- vocabulary: 3-5 items, each must appear in your corrected text.

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

  return analysis;
}

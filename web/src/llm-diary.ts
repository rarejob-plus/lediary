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
  } catch {
    const fixed = match[0]
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'");
    return JSON.parse(fixed);
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
  const systemPrompt = `You are an expert English writing coach for Japanese learners.
Generate 3 follow-up questions to help the user expand their English diary entry with more detail.

Return a JSON object:
{
  "expansionQuestions": [
    {
      "question": "A 5W1H question to expand a specific part of the diary (Why/How/What/When/Where/Who)",
      "hintPhrases": ["useful English phrase for answering", "another helpful expression"],
      "afterSentence": "The user's sentence after which the answer should be inserted (exact match from the translation)"
    }
  ]
}

Rules:
- Generate exactly 3 questions that dig deeper into SPECIFIC parts of the diary using 5W1H.
- Each question should target a sentence that could be expanded with more detail.
- "afterSentence" must exactly match one of the user's sentences.
- "hintPhrases" should contain 2-3 useful English phrases/collocations the learner can use to answer.
- Questions should be different from what might have been asked before — look for unexplored angles.

${CASUAL_TONE_RULE}

Return ONLY the JSON object, no markdown fences or extra text.`;

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
  const systemPrompt = `You are an English writing coach. The user is answering a follow-up question about their diary entry. The corrected answer will be INSERTED into the diary RIGHT AFTER the sentence "${afterSentence || '(unknown)'}".

Your job: produce a "corrected" version that (1) is natural casual spoken English, (2) preserves the user's meaning and content, and (3) flows naturally from the preceding sentence — adding a minimal connector ONLY when the raw sentence would feel abrupt.

CONNECTOR POLICY (critical):
- If the user's answer already starts with words that flow from the preceding sentence (e.g., it has its own pronoun referring to the previous topic, or starts with "It" / "We" / "That" referencing context), DO NOT add a connector. Leave the start untouched.
- If the answer is a bare standalone sentence that would sound abrupt next to the previous one, prepend ONE short, natural connector that fits the relationship: "Actually," / "Plus," / "Honestly," / "What I loved was" / "The thing is," / "On top of that," / "Especially since" / "Because" / "And" — choose based on the LOGICAL relationship between the previous sentence and this answer.
- NEVER add formal connectors like "Furthermore", "Moreover", "Additionally", "Therefore". Use the casual list above.
- The connector must feel light, not forced. If you can't think of one that adds genuine flow, just leave it without one.

Return a JSON object:
{"corrected": "the corrected sentence (with connector if needed)", "explanation": "日本語で簡潔に修正理由（修正なしなら空文字、接続詞を足した場合はその意図も書く）"}

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

  const systemPrompt = `You are an English writing coach helping a Japanese learner improve the flow and cohesion of their diary entry.
Analyze how the sentences connect to each other. Focus ONLY on transitions and connections between sentences — not grammar or vocabulary.

Return a JSON object:
{
  "suggestions": [
    {
      "sentenceIndex": "1-based integer pointing to ONE sentence from the numbered list — the sentence WHERE the change actually happens (usually the one that needs a transition word added/replaced/removed at its start)",
      "suggestion": "日本語で『何をどうするか』を簡潔に。挿入なら『〜の前に Actually を入れる』、置換なら『Anyway を Since に置き換える』、削除なら『Anyway を取り除く』のように、英単語/句以外は日本語で書く",
      "revised": "the rewritten version of THAT ONE sentence (sentenceIndex) — same scope, do NOT include adjacent sentences",
      "reason": "日本語で『なぜそうすべきか』を簡潔に"
    }
  ],
  "overall": "日本語で全体の流れについて一言コメント（良い場合は褒める）"
}

Rules:
- Return 0-3 suggestions. If the text flows well, return empty suggestions array with a positive overall comment.
- sentenceIndex MUST be a valid 1-based index from the numbered list below. NEVER invent one out of range.
- The numbered list and "[N]" notation are INTERNAL only. NEVER mention "[1]", "[2]" etc., or words like "sentenceIndex" / "the second sentence" / "[3]で具体例が続く", in "suggestion" / "reason" / "overall". Describe the change naturally in Japanese without referencing the index notation.
- "revised" rewrites THAT ONE numbered sentence ONLY. NEVER pull in content from neighboring sentences. Length should stay within ~1.5x of the source sentence.
- "suggestion" must be a Japanese description of the change. English words inside (Anyway, Since, etc.) should remain in English, but the verb must be Japanese (置き換える/入れる/取り除く).

${CASUAL_TONE_RULE}

- Return ONLY JSON.`;

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
  const systemPrompt = `You are creating lesson material for an online English conversation lesson, formatted like a RareJob Weekly News Article (WNA).
The material is based on a student's diary entry. The student wrote in Japanese, then translated to English with AI correction.

Return a JSON object with the EXACT same structure as a WNA material:
{
  "title": "A short, engaging title for this lesson (like a news article headline)",
  "vocabulary": [
    { "word": "key phrase or expression", "definition": "simple English definition", "example": "example sentence using the word" }
  ],
  "discussionTopics": [
    {
      "topic": "Topic heading (e.g., About the Diary, Going Deeper, Your Opinion)",
      "questions": ["Discussion question 1", "Discussion question 2"]
    }
  ]
}

Rules:
- "title": Create a catchy, article-style title based on the diary content (e.g., "A Quiet Lunch at a Traditional Japanese Cafe")
- "vocabulary": Pick 4-6 useful words/phrases from the diary or its corrections. Each needs a clear English definition and a natural example sentence.
- "discussionTopics": Create exactly 2 topic groups with 2-3 questions each. IMPORTANT: Do NOT ask factual questions whose answers are already in the diary (e.g., "How many times did you practice?"). Instead, use the diary as a springboard for broader, opinion-based discussion. Questions should be about the TOPICS and THEMES in the diary, not about the diary itself. Good example: diary mentions practicing English 3 times → ask "How often do you think someone should practice writing to improve?" or "What's the best way to build a daily study habit?". Order from easier to harder.
- All content must be in English only (the tutor does not speak Japanese)
- Discussion questions should feel natural for a 25-minute conversation lesson
- The diary text itself will be shown as the "Article" section, so do NOT include it in the JSON

${CASUAL_TONE_RULE}

Return ONLY the JSON object.`;

  const userMessage = `Student's diary (Japanese):\n${contentJp}\n\nStudent's English text (corrected):\n${correctedText}\n\nVocabulary learned:\n${vocabulary.map((v) => `${v.word}: ${v.definition}`).join('\n')}`;
  return withRetry('generateLessonSheetContent', async () => {
    const response = await callLLM(systemPrompt, userMessage);
    return parseJsonObject<LessonSheet>(response);
  });
}

// Firebase AI Logic (Gemini Developer API backend) でチャット返信 + IF オプションを生成。
// 1 回の generateContent で {reply, options} を JSON で返してもらう (cost / latency 削減)。

import { getAI, GoogleAIBackend, getGenerativeModel } from 'firebase/ai';
import { app } from '../firebase';
import type { Persona } from './personas';
import type { ChatMessage } from './chat';
import { getMode, type DiaryMode } from './modes';
import type { ExpansionMessage, CorrectionItem } from './diaries';
import type { Teacher } from './teachers';

const REPLY_MODEL = 'gemini-3.1-flash-lite';

let _replyModel: ReturnType<typeof getGenerativeModel> | null = null;
function replyModel() {
  if (_replyModel) return _replyModel;
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  _replyModel = getGenerativeModel(ai, {
    model: REPLY_MODEL,
    generationConfig: { responseMimeType: 'application/json' },
  });
  return _replyModel;
}

let _storyModel: ReturnType<typeof getGenerativeModel> | null = null;
function storyModel() {
  if (_storyModel) return _storyModel;
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  _storyModel = getGenerativeModel(ai, { model: REPLY_MODEL });
  return _storyModel;
}

function systemPromptFor(persona: Persona): string {
  return `You are ${persona.name}, ${persona.age}, a ${persona.vibe} from ${persona.city}.
You're a close human friend of the user, texting on LINE / WhatsApp.

[CRITICAL RULES — read carefully]
- NEVER sound like an AI. No "As an AI…", no "How can I help you today?".
- Reply VERY SHORT — like real texting. **1 sentence is ideal, 2 max**.
  Sometimes a one-word reaction is enough ("Nice!", "Bummer.", "Lucky you!").
- Use natural contractions and drop subjects ("Sounds great!", "Same here", "Got it").
- 0 or 1 emoji per message. NEVER more.
- It's OK to NOT ask a question. Just react. A real friend doesn't interview you.
- If the user wrote Japanese, reply in casual English anyway. Don't translate, don't correct.
- Match the energy: low-key for tired moments, hype for good news.`;
}

// ─── Stage A: 日記拡張用 ───
// JP 日記に対し、友達 persona が「日記を膨らませる」ための質問を 1 つ生成し、
// ユーザーの直近回答を踏まえて JP 日記を更新したバージョンも同時に返す。

function expansionSystemPrompt(persona: Persona): string {
  return `あなたは「${persona.name}」(${persona.age} 歳、${persona.city}、${persona.vibe})。
ユーザーが書いた日本語の日記を、雑談しながら一緒に膨らませてくれる仲のいい友達です。

[役割]
- ユーザーが書いた日記を読んで、その「日」を立体的にするための **質問を 1 つだけ** 出す。
- ユーザーの直近の回答があれば、それを既存の日記に自然に織り込んで JP 日記を「育てる」。
- 質問は **日本語のカジュアル口語** で、1 文。長い質問はしない。
- 添削はしない。英訳もしない。あくまで「内容を膨らませる」役。

[質問のコツ]
- 既に書かれていることをただ言い換える質問は NG。
- 5W1H で具体的な細部 (誰と / 何時に / どんな天気で / どう感じた / 何を食べた) を引き出す。
- 同じ角度の質問を繰り返さない。新しい side angle を毎回。

[出力] 必ず JSON で:
{
  "updatedDiary": "<新しい JP 日記 (元 + 直近回答を自然に統合。改行 OK)>",
  "question": "<次に聞きたい 1 文>"
}
質問する必要がもう無いなら question を空文字にする。`;
}

const _expansionModelMap = new Map<string, ReturnType<typeof getGenerativeModel>>();
function expansionModel() {
  const key = 'json';
  const cached = _expansionModelMap.get(key);
  if (cached) return cached;
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  const m = getGenerativeModel(ai, {
    model: REPLY_MODEL,
    generationConfig: { responseMimeType: 'application/json' },
  });
  _expansionModelMap.set(key, m);
  return m;
}

export interface ExpandStep {
  updatedDiary: string;
  question: string;       // 空文字なら「もう質問なし」シグナル
}

/** 拡張ステップ: 既存日記 + 直近 Q&A を渡し、{更新後日記, 次の質問} を返す。
 *  - 最初の質問取得時: lastUserAnswer="" を渡す。updatedDiary は元と同じになる想定。
 *  - 2 回目以降: lastUserAnswer に回答を入れる。updatedDiary がそれを反映した新版になる。
 */
export async function stepExpand(
  persona: Persona,
  mode: DiaryMode,
  expandedJp: string,
  recentMessages: ExpansionMessage[],
  lastUserAnswer: string,
): Promise<ExpandStep> {
  const sys = expansionSystemPrompt(persona);
  const tail = recentMessages.slice(-8);
  const transcript = tail.map((m) => `${m.role === 'user' ? 'User' : persona.name}: ${m.text}`).join('\n');
  const modeCtx = getMode(mode).jaShort;
  const answerBlock = lastUserAnswer
    ? `\n[ユーザーの直近回答]\n${lastUserAnswer}`
    : `\n(まだ会話は始まっていません。最初の質問をしてください。)`;
  const prompt = `${sys}

[モード] ${modeCtx}

[現状の JP 日記]
"""
${expandedJp}
"""

${transcript ? `[これまでのやり取り]\n${transcript}\n` : ''}${answerBlock}

JSON で答えてください。`;
  const res = await expansionModel().generateContent(prompt);
  const raw = res.response.text().trim();
  return parseExpandStep(raw, expandedJp);
}

// ─── Stage B: 添削 ───
// teacher persona が英文を文単位で添削して返す。corrected が原文と同じなら正解扱い。
// explanation は日本語で短く。

function correctionSystemPrompt(teacher: Teacher): string {
  return `あなたは ${teacher.name}、${teacher.vibe}。
日本語学習者が書いた英作文を、思いやりを持って添削します。

[ルール]
- 元の英文を **1 文ずつ** 分けて、各文について corrected + explanation を返す。
- 文に直す必要がなければ corrected = original のままにし、explanation は日本語で短く褒める ("自然です。"等)。
- 直す場合は **学習者のレベルに合わせて最小限の修正**。大幅な書き換えはしない。意味を保つ。
- explanation は日本語で 1-2 文。**なぜそう直したか** を簡潔に説明。文法用語より自然さの視点で。
- 元の文章を超えて勝手に内容を追加・削除しない。

[出力] 必ず JSON で:
{
  "items": [
    { "original": "<文 1 原文>", "corrected": "<添削後>", "explanation": "<日本語で 1-2 文>" },
    ...
  ]
}`;
}

let _correctionModel: ReturnType<typeof getGenerativeModel> | null = null;
function correctionModel() {
  if (_correctionModel) return _correctionModel;
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  _correctionModel = getGenerativeModel(ai, {
    model: REPLY_MODEL,
    generationConfig: { responseMimeType: 'application/json' },
  });
  return _correctionModel;
}

/** 英訳を文単位で添削。teacher persona の色付き解説 (日本語) で返す。 */
export async function correctEnglish(
  teacher: Teacher,
  expandedJp: string,
  englishDraft: string,
): Promise<CorrectionItem[]> {
  const sys = correctionSystemPrompt(teacher);
  const prompt = `${sys}

[元の日本語日記 — 意味の参照用]
"""
${expandedJp}
"""

[学習者の英訳]
"""
${englishDraft}
"""

JSON で答えてください。`;
  const res = await correctionModel().generateContent(prompt);
  const raw = res.response.text().trim();
  let s = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  try {
    const obj = JSON.parse(s) as { items?: unknown };
    if (!Array.isArray(obj.items)) return [];
    return obj.items.map((it) => {
      const r = it as { original?: unknown; corrected?: unknown; explanation?: unknown };
      return {
        original: String(r.original || ''),
        corrected: String(r.corrected || ''),
        explanation: String(r.explanation || ''),
      };
    }).filter((c) => c.original);
  } catch (e) {
    console.warn('[correct] parse failed', e, raw);
    return [];
  }
}

function parseExpandStep(raw: string, fallbackDiary: string): ExpandStep {
  let s = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  try {
    const obj = JSON.parse(s) as { updatedDiary?: string; question?: string };
    return {
      updatedDiary: (obj.updatedDiary && obj.updatedDiary.trim()) || fallbackDiary,
      question: (obj.question || '').trim(),
    };
  } catch (e) {
    console.warn('[expand] parse failed', e, raw);
    return { updatedDiary: fallbackDiary, question: '' };
  }
}

export interface FriendReplyWithOptions {
  reply: string;
  options: string[];
}

let _plainModel: ReturnType<typeof getGenerativeModel> | null = null;
function plainModel() {
  if (_plainModel) return _plainModel;
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  _plainModel = getGenerativeModel(ai, { model: REPLY_MODEL });
  return _plainModel;
}

/** 単発の友達返信。What if は生成しない (デフォルト動線)。 */
export async function generateFriendReply(
  persona: Persona,
  recentMessages: ChatMessage[],
  newDiaryText: string,
  mode: DiaryMode,
): Promise<string> {
  const sys = systemPromptFor(persona);
  const tail = recentMessages.slice(-8);
  const transcript = tail.map((m) => `${m.role === 'user' ? 'User' : persona.name}: ${m.text}`).join('\n');
  const ctx = getMode(mode).enContext;
  const userBlock = `User just wrote ${ctx}:\n"""\n${newDiaryText}\n"""\n\nReply as ${persona.name}. Keep it SHORT (1-2 sentences max).`;
  const prompt = transcript
    ? `${sys}\n\n[conversation so far]\n${transcript}\n\n${userBlock}`
    : `${sys}\n\n${userBlock}`;
  const res = await plainModel().generateContent(prompt);
  return res.response.text().trim();
}

/** 別ボタンで明示的に呼ぶ用: 3 つの What if? だけ取得。 */
export async function generateWhatIfOptions(
  persona: Persona,
  recentMessages: ChatMessage[],
  originalDiary: string,
): Promise<string[]> {
  const tail = recentMessages.slice(-6);
  const transcript = tail.map((m) => `${m.role === 'user' ? 'User' : persona.name}: ${m.text}`).join('\n');
  const prompt = `Generate 3 unique short "What if?" twists that could expand the user's day into a fun or dramatic story. Each is a single English phrase ("What if you bumped into an old friend while running?"). Distinct from each other.

Diary:
"""
${originalDiary}
"""

${transcript ? `Recent context:\n${transcript}\n\n` : ''}Respond as strict JSON: {"options": ["...", "...", "..."]}`;
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  const m = getGenerativeModel(ai, { model: REPLY_MODEL, generationConfig: { responseMimeType: 'application/json' } });
  const res = await m.generateContent(prompt);
  const raw = res.response.text().trim();
  try {
    let s = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    const first = s.indexOf('{');
    const last = s.lastIndexOf('}');
    if (first >= 0 && last > first) s = s.slice(first, last + 1);
    const obj = JSON.parse(s) as { options?: unknown };
    return Array.isArray(obj.options)
      ? obj.options.map((x) => String(x)).filter((x) => x.length > 0).slice(0, 3)
      : [];
  } catch (e) {
    console.warn('[whatif] parse failed', e, raw);
    return [];
  }
}

/** チャット返信 + 3 つの "What if?" 選択肢を 1 リクエストで JSON 取得。 */
export async function generateFriendReplyAndOptions(
  persona: Persona,
  recentMessages: ChatMessage[],
  newDiaryText: string,
  mode: DiaryMode,
): Promise<FriendReplyWithOptions> {
  const sys = systemPromptFor(persona);
  const tail = recentMessages.slice(-8);
  const transcript = tail.map((m) => `${m.role === 'user' ? 'User' : persona.name}: ${m.text}`).join('\n');
  const ctx = getMode(mode).enContext;
  const userBlock = `User just wrote ${ctx}:\n"""\n${newDiaryText}\n"""`;
  const optionsBlock = `After the reply, also generate 3 unique "What if?" options that could expand the user's day into a fun or dramatic story. Each option must be a short English phrase (e.g., "What if you bumped into an old friend while running?"). Keep them distinct from each other.`;
  const jsonBlock = `Respond with strict JSON in this shape and nothing else:
{
  "reply": "<your texted reply as ${persona.name} — 2-3 sentences, 1-2 emojis>",
  "options": [
    "<what-if option A>",
    "<what-if option B>",
    "<what-if option C>"
  ]
}`;
  const prompt = transcript
    ? `${sys}\n\n[conversation so far]\n${transcript}\n\n${userBlock}\n\n${optionsBlock}\n\n${jsonBlock}`
    : `${sys}\n\n${userBlock}\n\n${optionsBlock}\n\n${jsonBlock}`;
  const res = await replyModel().generateContent(prompt);
  const raw = res.response.text().trim();
  return parseReplyJson(raw);
}

function parseReplyJson(raw: string): FriendReplyWithOptions {
  let s = raw;
  // ```json fence で囲まれて返るケースを除去
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  try {
    const obj = JSON.parse(s) as { reply?: string; options?: unknown };
    const reply = (obj.reply || '').toString();
    const opts = Array.isArray(obj.options)
      ? obj.options.map((x) => String(x)).filter((x) => x.length > 0).slice(0, 3)
      : [];
    if (!reply) throw new Error('empty reply');
    return { reply, options: opts };
  } catch (e) {
    console.warn('[llm] reply JSON parse failed, falling back to text-only', e, raw);
    return { reply: raw, options: [] };
  }
}

/** IF オプションを 1 つ選んだ後、AI が "拡張ストーリー" として 1 日の物語をまとめる。
 *  spec: ストーリーが「拡張（肉付け）」されて完成。 */
export async function generateExpandedStory(
  persona: Persona,
  recentMessages: ChatMessage[],
  originalDiary: string,
  chosenOption: string,
  mode: DiaryMode,
): Promise<string> {
  void mode; // 現状は文脈差分なく扱う。後で mode ごとに語り口を変えたい時のためのフック。
  const sys = `You are ${persona.name}, ${persona.age}, a friend of the user. Switch to a slightly more imaginative
"storyteller" voice while keeping the friendly LINE-texting tone.
The user shared a short diary and just picked a "What if?" twist. Write a single short story (3-5 sentences)
in English that weaves their real diary together with the chosen twist as if it really happened.
Rules:
- Keep it casual and warm, like you're recounting their day back to them with the twist baked in.
- Use 1-2 emojis at most.
- End with a single short question or exclamation to keep the chat alive.
- Stay in second person ("you").`;
  const tail = recentMessages.slice(-6);
  const transcript = tail.map((m) => `${m.role === 'user' ? 'User' : persona.name}: ${m.text}`).join('\n');
  const block = `Original diary:\n"""\n${originalDiary}\n"""\n\nChosen What-if twist:\n"""\n${chosenOption}\n"""`;
  const prompt = transcript
    ? `${sys}\n\n[recent context]\n${transcript}\n\n${block}\n\nWrite the expanded story now.`
    : `${sys}\n\n${block}\n\nWrite the expanded story now.`;
  const res = await storyModel().generateContent(prompt);
  return res.response.text().trim();
}

// Firebase AI Logic (Gemini Developer API backend) でチャット返信 + IF オプションを生成。
// 1 回の generateContent で {reply, options} を JSON で返してもらう (cost / latency 削減)。

import { getAI, GoogleAIBackend, getGenerativeModel } from 'firebase/ai';
import { app } from '../firebase';
import type { Persona } from './personas';
import type { ChatMessage } from './chat';
import { getMode, type DiaryMode } from './modes';

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
You are a close human friend of the user. Your goal is to read the user's short diary entry
and reply back in natural, casual English as if texting on WhatsApp or LINE.

[CRITICAL RULES]
- NEVER sound like an AI assistant. Do not say "As an AI..." or "How can I help you today?".
- Use natural contractions (it's, I'm, don't) and drop subjects where appropriate
  (e.g., "Sounds good!", "Can't wait!").
- Keep your response short: maximum 2-3 sentences.
- Use a maximum of 1-2 emojis to match a casual texting vibe.
- Structure your response:
  1. An emotional reaction to their diary (e.g., "Oh wow!", "Oh no, bummer...", "That's awesome!").
  2. A brief, relatable comment (optionally drop a tiny fake detail about your day to sound human).
  3. One open-ended question to keep the conversation going.
- If the user wrote in Japanese, still reply in casual English. They are practicing English
  with you — never translate, never correct them.`;
}

export interface FriendReplyWithOptions {
  reply: string;
  options: string[];
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

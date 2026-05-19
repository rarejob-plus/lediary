// Firebase AI Logic (Gemini Developer API backend) でチャット返信を生成。
// v1 と同じ free-tier 対象モデル。クライアント直叩きでサーバ不要。

import { getAI, GoogleAIBackend, getGenerativeModel } from 'firebase/ai';
import { app } from '../firebase';
import type { Persona } from './personas';
import type { ChatMessage } from './chat';

const REPLY_MODEL = 'gemini-3.1-flash-lite';

let _replyModel: ReturnType<typeof getGenerativeModel> | null = null;
function replyModel() {
  if (_replyModel) return _replyModel;
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  _replyModel = getGenerativeModel(ai, { model: REPLY_MODEL });
  return _replyModel;
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
- If the user wrote in Japanese, still reply in casual English.
  They are practicing English with you — never translate, never correct them.`;
}

/** 直近のメッセージを transcript として組み立て、Gemini に投げて 1 通の返信を生成。 */
export async function generateFriendReply(
  persona: Persona,
  recentMessages: ChatMessage[],
  newDiaryText: string,
): Promise<string> {
  const sys = systemPromptFor(persona);
  // 直近 8 メッセージを LINE 形式で書き起こし、最後にユーザーの新規日記を続ける。
  const tail = recentMessages.slice(-8);
  const transcript = tail.map((m) => `${m.role === 'user' ? 'User' : persona.name}: ${m.text}`).join('\n');
  const userBlock = `User just wrote this short diary:\n"""\n${newDiaryText}\n"""\n\nReply as ${persona.name}.`;
  const prompt = transcript ? `${sys}\n\n[conversation so far]\n${transcript}\n\n${userBlock}` : `${sys}\n\n${userBlock}`;
  const res = await replyModel().generateContent(prompt);
  return res.response.text().trim();
}

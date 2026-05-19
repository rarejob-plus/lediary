// チャットスレッドの Firestore モデル。
// 1 ユーザー = 1 スレッド (LINE の DM 風)。messages 配列に追記していく。
// 後で per-day chat に分割する場合も schema は messages 配列のまま流用可。

import { doc, onSnapshot, setDoc, getDoc } from 'firebase/firestore';
import { db, V2_COLLECTIONS } from '../firebase';

export type MessageRole = 'user' | 'ai';
export type MessageType =
  | 'diary'           // user の 3 行日記投稿
  | 'reply'           // AI の通常返信
  | 'option-prompt'   // AI が提示する 3 つの IF オプション
  | 'option-pick'     // user が選んだ IF オプション
  | 'expanded-story'; // AI による IF 拡張ストーリーまとめ

export interface ChatMessage {
  id: string;
  role: MessageRole;
  text: string;
  type: MessageType;
  /** option-prompt 時の 3 つの候補文。 */
  options?: string[];
  createdAt: number;
}

export interface ChatThread {
  messages: ChatMessage[];
  updatedAt: number;
  createdAt: number;
}

function chatRef(userId: string) {
  return doc(db, V2_COLLECTIONS.chats, userId);
}

export function subscribeChat(userId: string, cb: (thread: ChatThread | null) => void): () => void {
  return onSnapshot(chatRef(userId), (snap) => {
    if (!snap.exists()) { cb(null); return; }
    cb(snap.data() as ChatThread);
  });
}

export async function appendMessages(userId: string, newMessages: ChatMessage[]): Promise<void> {
  const ref = chatRef(userId);
  const snap = await getDoc(ref);
  const now = Date.now();
  const existing = snap.exists() ? (snap.data() as ChatThread) : null;
  const merged: ChatThread = {
    messages: [...(existing?.messages || []), ...newMessages],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await setDoc(ref, merged);
}

export function newMessageId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto as Crypto).randomUUID();
  }
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

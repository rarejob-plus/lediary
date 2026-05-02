// データレイヤー: 認証時は /api/diary/posts、未認証時は mock を返す。
// 本実装が完了したら mock fallback を削除する想定。

import { api } from '../api/client';
import { getCurrentUser } from '../auth';
import { MOCK_ENTRIES, type DiaryEntry, type Mode } from './mock';

interface RawPost {
  id: string;
  userId: string;
  date: string;
  mode: Mode;
  contentJp: string;
  userTranslation?: string;
  feedback?: DiaryEntry['feedback'];
  vocabulary?: DiaryEntry['vocabulary'];
  expansionQuestions?: DiaryEntry['expansionQuestions'];
  hints?: unknown[];
  createdAt?: number | { _seconds: number };
  updatedAt?: number | { _seconds: number };
  mood?: string;
}

function timeFromCreatedAt(c?: RawPost['createdAt']): string {
  if (!c) return '00:00';
  const ms = typeof c === 'number' ? c : c._seconds * 1000;
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function toEntry(raw: RawPost): DiaryEntry {
  const ms = typeof raw.createdAt === 'number'
    ? raw.createdAt
    : raw.createdAt?._seconds ? raw.createdAt._seconds * 1000 : Date.now();
  const validModes: Mode[] = ['morning', 'lesson', 'diary'];
  const mode: Mode = validModes.includes(raw.mode) ? raw.mode : 'diary';
  return {
    id: raw.id,
    date: raw.date,
    time: timeFromCreatedAt(raw.createdAt),
    mode,
    contentJp: raw.contentJp || '',
    userTranslation: raw.userTranslation || '',
    feedback: raw.feedback || [],
    vocabulary: raw.vocabulary || [],
    expansionQuestions: raw.expansionQuestions || [],
    mood: raw.mood,
    createdAt: ms,
  };
}

export async function fetchEntries(): Promise<DiaryEntry[]> {
  if (!getCurrentUser()) return MOCK_ENTRIES;
  const raws = await api.get<RawPost[]>('/diary/posts');
  return raws
    .filter((r) => typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date))
    .map(toEntry);
}

export async function fetchEntry(id: string): Promise<DiaryEntry | undefined> {
  if (!getCurrentUser()) return MOCK_ENTRIES.find((e) => e.id === id);
  try {
    const raw = await api.get<RawPost>(`/diary/posts/${id}`);
    return toEntry(raw);
  } catch {
    return undefined;
  }
}

// データレイヤー: 認証時は Firestore SDK 直接、未認証時は mock を返す。
// 本実装が完了したら mock fallback を削除する想定。

import { collection, query, where, orderBy, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
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
  lessonSheetId?: string;
  coverImageUrl?: string;
  coverPhotographer?: string;
  coverPhotographerUrl?: string;
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
  const validModes: Mode[] = ['morning', 'lesson', 'diary', 'story'];
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
    lessonSheetId: raw.lessonSheetId,
    coverImageUrl: raw.coverImageUrl,
    coverPhotographer: raw.coverPhotographer,
    coverPhotographerUrl: raw.coverPhotographerUrl,
    createdAt: ms,
  };
}

// セッション内一覧キャッシュ（個別 GET の 404 ノイズ回避 + 体感高速化）
let cache: { fetchedAt: number; entries: DiaryEntry[] } | null = null;
const CACHE_TTL_MS = 30_000;

export function invalidateEntriesCache(): void {
  cache = null;
}

export async function fetchEntries(force = false): Promise<DiaryEntry[]> {
  const user = getCurrentUser();
  if (!user) return MOCK_ENTRIES;
  if (!force && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.entries;
  }
  const q = query(
    collection(db, 'lediary-posts'),
    where('userId', '==', user.uid),
    orderBy('createdAt', 'desc'),
  );
  const snap = await getDocs(q);
  const entries = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<RawPost, 'id'>) }))
    .filter((r) => typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date))
    .map(toEntry);
  cache = { fetchedAt: Date.now(), entries };
  return entries;
}

export async function fetchEntry(id: string): Promise<DiaryEntry | undefined> {
  if (!getCurrentUser()) return MOCK_ENTRIES.find((e) => e.id === id);
  // 一覧から探すことで個別 GET の 404 を避ける
  const entries = await fetchEntries();
  return entries.find((e) => e.id === id);
}

// エントリ詳細から editor に遷移する際のハンドオフ用バッファ。
// 詳細ページが持っている最新テキストを editor が即時利用できるようにする。
const HANDOFF_KEY = 'lediary_v2_editor_handoff';

export function stashForEditor(entry: DiaryEntry): void {
  sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(entry));
}

export function takeStashedEntry(): DiaryEntry | null {
  const raw = sessionStorage.getItem(HANDOFF_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(HANDOFF_KEY);
  try {
    return JSON.parse(raw) as DiaryEntry;
  } catch {
    return null;
  }
}

// データレイヤー: 認証時は Firestore SDK 直接。未認証時は空配列を返す。

import {
  collection,
  doc,
  query,
  where,
  orderBy,
  getDocs,
  getDoc,
  deleteDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import { getCurrentUser } from '../auth';
import type { DiaryEntry, Mode } from './mock';

interface RawPost {
  id: string;
  userId: string;
  date: string;
  mode: Mode;
  contentJp: string;
  plainJp?: string;
  userTranslation?: string;
  feedback?: DiaryEntry['feedback'];
  vocabulary?: DiaryEntry['vocabulary'];
  expansionQuestions?: DiaryEntry['expansionQuestions'];
  picks?: DiaryEntry['picks'];
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
    plainJp: raw.plainJp,
    userTranslation: raw.userTranslation || '',
    feedback: raw.feedback || [],
    vocabulary: raw.vocabulary || [],
    expansionQuestions: raw.expansionQuestions || [],
    picks: raw.picks || [],
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
  if (!user) return [];
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
  if (!getCurrentUser()) return undefined;
  // 一覧から探すことで個別 GET の 404 を避ける
  const entries = await fetchEntries();
  return entries.find((e) => e.id === id);
}

export async function deleteEntry(id: string): Promise<void> {
  const user = getCurrentUser();
  if (!user) throw new Error('not authenticated');
  await deleteDoc(doc(db, 'lediary-posts', id));
  invalidateEntriesCache();
}

// mode 変更は doc ID が mode を含むので copy + delete。content が既にある target には移せない。
export async function moveEntryMode(fromId: string, toMode: Mode): Promise<{ id: string }> {
  const user = getCurrentUser();
  if (!user) throw new Error('not authenticated');
  if (!['morning', 'lesson', 'diary', 'story'].includes(toMode)) {
    throw new Error('invalid toMode');
  }
  const fromRef = doc(db, 'lediary-posts', fromId);
  const fromSnap = await getDoc(fromRef);
  if (!fromSnap.exists()) throw new Error('source not found');
  const fromData = fromSnap.data() as RawPost;
  const newId = `${user.uid}_${fromData.date}_${toMode}`;
  if (newId === fromId) return { id: fromId };
  const targetRef = doc(db, 'lediary-posts', newId);
  const targetSnap = await getDoc(targetRef);
  if (targetSnap.exists()) {
    const t = targetSnap.data() as RawPost;
    if (t.contentJp || t.userTranslation) throw new Error('target already has content');
  }
  const batch = writeBatch(db);
  batch.set(targetRef, { ...fromData, mode: toMode, updatedAt: Date.now() });
  batch.delete(fromRef);
  await batch.commit();
  invalidateEntriesCache();
  return { id: newId };
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

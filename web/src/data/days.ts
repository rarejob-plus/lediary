// 充実度スコア (1-10) + ひとことメモのデータ層。
// Firestore の lediary-days/{userId}_{date} と対応。

import { collection, doc, query, where, getDocs, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { getCurrentUser } from '../auth';

export interface DayRating {
  date: string;        // YYYY-MM-DD
  score: number;       // 1-10
  note?: string;
  updatedAt?: number;
}

interface RawDay {
  id: string;
  userId: string;
  date: string;
  score: number;
  note?: string;
  createdAt?: number;
  updatedAt?: number;
}

let cache: { fetchedAt: number; days: Map<string, DayRating> } | null = null;
const CACHE_TTL_MS = 30_000;

export function invalidateDaysCache(): void {
  cache = null;
}

export async function fetchDays(force = false): Promise<Map<string, DayRating>> {
  const user = getCurrentUser();
  if (!user) return new Map();
  if (!force && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.days;
  }
  const q = query(collection(db, 'lediary-days'), where('userId', '==', user.uid));
  const snap = await getDocs(q);
  const days = new Map<string, DayRating>();
  for (const doc of snap.docs) {
    const r = doc.data() as RawDay;
    if (typeof r.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) continue;
    days.set(r.date, { date: r.date, score: r.score, note: r.note, updatedAt: r.updatedAt });
  }
  cache = { fetchedAt: Date.now(), days };
  return days;
}

export async function saveDayRating(date: string, score: number, note?: string): Promise<DayRating> {
  const user = getCurrentUser();
  if (!user) throw new Error('not authenticated');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('invalid date');
  if (!Number.isInteger(score) || score < 1 || score > 10) throw new Error('score must be 1-10');

  const docId = `${user.uid}_${date}`;
  const ref = doc(db, 'lediary-days', docId);
  const existing = await getDoc(ref);
  const now = Date.now();
  const existingData = existing.exists() ? (existing.data() as RawDay) : null;
  const data: RawDay = {
    id: docId,
    userId: user.uid,
    date,
    score,
    note: typeof note === 'string' ? note : (existingData?.note ?? ''),
    updatedAt: now,
    createdAt: existingData?.createdAt ?? now,
  };
  await setDoc(ref, data);
  invalidateDaysCache();
  return { date: data.date, score: data.score, note: data.note, updatedAt: data.updatedAt };
}

export async function deleteDayRating(date: string): Promise<void> {
  const user = getCurrentUser();
  if (!user) throw new Error('not authenticated');
  await deleteDoc(doc(db, 'lediary-days', `${user.uid}_${date}`));
  invalidateDaysCache();
}

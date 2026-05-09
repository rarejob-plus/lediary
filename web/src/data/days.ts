// 充実度スコア (1-10) + ひとことメモのデータ層。
// Firestore の lediary-days/{userId}_{date} と対応。

import { api } from '../api/client';
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
  if (!getCurrentUser()) return new Map();
  if (!force && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.days;
  }
  const raws = await api.get<RawDay[]>('/diary/days');
  const days = new Map<string, DayRating>();
  for (const r of raws) {
    if (typeof r.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) continue;
    days.set(r.date, { date: r.date, score: r.score, note: r.note, updatedAt: r.updatedAt });
  }
  cache = { fetchedAt: Date.now(), days };
  return days;
}

export async function saveDayRating(date: string, score: number, note?: string): Promise<DayRating> {
  const body: Record<string, unknown> = { date, score };
  if (typeof note === 'string') body.note = note;
  const r = await api.post<RawDay>('/diary/days', body);
  invalidateDaysCache();
  return { date: r.date, score: r.score, note: r.note, updatedAt: r.updatedAt };
}

export async function deleteDayRating(date: string): Promise<void> {
  await api.delete(`/diary/days/${date}`);
  invalidateDaysCache();
}

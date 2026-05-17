// グローバルな「私のフレーズ集」用 helper。
// 全 entry を fetch し、各 entry の picks[] を flat 化して 1 リストとして返す。
// SRS は単純な Anki-lite: shadowingCount に応じて interval が伸びる。

import { fetchEntries } from './entries';
import type { DiaryEntry, PickedPhrase } from './mock';

export interface PickWithContext extends PickedPhrase {
  entryId: string;
  entryDate: string;
  entryMode: DiaryEntry['mode'];
}

/** 全エントリの picks を flat 化して 1 配列にする。新しい順。 */
export async function fetchAllPicks(): Promise<PickWithContext[]> {
  const entries = await fetchEntries();
  const out: PickWithContext[] = [];
  for (const e of entries) {
    if (!Array.isArray(e.picks)) continue;
    for (const p of e.picks) {
      out.push({ ...p, entryId: e.id, entryDate: e.date, entryMode: e.mode });
    }
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out;
}

/** SRS 間隔（ms）。Anki 風だが軽量。
 *  0回 シャドーイング → 即 due
 *  1-2回             → 1 日後
 *  3-4回             → 3 日後
 *  5-9回             → 7 日後
 *  10回 以上          → 21 日後 (= 習得寄り、薄表示扱い)
 */
function srsIntervalMs(shadowingCount: number): number {
  if (shadowingCount <= 0) return 0;
  if (shadowingCount <= 2) return 1 * 86400_000;
  if (shadowingCount <= 4) return 3 * 86400_000;
  if (shadowingCount <= 9) return 7 * 86400_000;
  return 21 * 86400_000;
}

/** pick の SRS ステータス。 */
export type PickStatus = 'due' | 'upcoming' | 'mastered';

export function pickStatus(p: PickWithContext, now = Date.now()): PickStatus {
  const count = p.shadowingCount || 0;
  const last = p.lastShadowedAt || p.createdAt;
  const nextDueAt = last + srsIntervalMs(count);
  if (count >= 10 && nextDueAt > now) return 'mastered';
  if (nextDueAt <= now) return 'due';
  return 'upcoming';
}

/** SRS 順に並び替え: due (古いほど上) → upcoming (due が近い順) → mastered。 */
export function sortBySrs(picks: PickWithContext[], now = Date.now()): PickWithContext[] {
  return [...picks].sort((a, b) => {
    const sa = pickStatus(a, now);
    const sb = pickStatus(b, now);
    const order: Record<PickStatus, number> = { due: 0, upcoming: 1, mastered: 2 };
    if (sa !== sb) return order[sa] - order[sb];
    const dueA = (a.lastShadowedAt || a.createdAt) + srsIntervalMs(a.shadowingCount || 0);
    const dueB = (b.lastShadowedAt || b.createdAt) + srsIntervalMs(b.shadowingCount || 0);
    return dueA - dueB;
  });
}

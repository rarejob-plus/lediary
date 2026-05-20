// 4 種類の日記モード。Lucide アイコン + 短い日本語ラベル。

import type { IconName } from '../components/icons';

export type DiaryMode = 'morning' | 'lesson' | 'diary' | 'story';

export interface ModeMeta {
  id: DiaryMode;
  label: string;
  icon: IconName;
  jaShort: string;
  enContext: string;
}

export const MODES: ModeMeta[] = [
  { id: 'morning', label: 'Morning', icon: 'sun',        jaShort: '朝の予定',
    enContext: 'a morning intention or plan for the day' },
  { id: 'lesson',  label: 'Lesson',  icon: 'graduation', jaShort: 'レッスン報告',
    enContext: 'a quick reflection after an English lesson' },
  { id: 'diary',   label: 'Diary',   icon: 'moon',       jaShort: '夜の日記',
    enContext: "a short evening diary of today's events" },
  { id: 'story',   label: 'Story',   icon: 'bookOpen',   jaShort: '小話',
    enContext: 'a small anecdote or short story they want to tell' },
];

export function getMode(id: string): ModeMeta {
  return MODES.find((m) => m.id === id) || MODES[2]!;
}

export function defaultModeForNow(now = new Date()): DiaryMode {
  const h = now.getHours();
  if (h < 11) return 'morning';
  if (h < 18) return 'lesson';
  return 'diary';
}

export function todayStr(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

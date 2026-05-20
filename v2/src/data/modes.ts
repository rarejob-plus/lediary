// 1 日のうちで書ける 4 種類の日記モード。v1 lediary と同じ概念。
// chat 上は messages の各 diary に mode を持たせ、日付 × モード単位で artifact 化する。

export type DiaryMode = 'morning' | 'lesson' | 'diary' | 'story';

export interface ModeMeta {
  id: DiaryMode;
  label: string;
  emoji: string;
  jaShort: string;     // chip 用の超短い説明 (朝の予定 等)
  jaPrompt: string;    // input の placeholder
  enContext: string;   // AI へ渡すコンテキスト
}

export const MODES: ModeMeta[] = [
  { id: 'morning', label: 'Morning', emoji: '☀️', jaShort: '朝の予定',
    jaPrompt: '今日の予定や気分を 1-2 文で…',
    enContext: 'a morning intention or plan for the day' },
  { id: 'lesson',  label: 'Lesson',  emoji: '🎓', jaShort: 'レッスン報告',
    jaPrompt: '今日の英会話レッスンの感想を 1-2 文で…',
    enContext: 'a quick reflection after an English lesson' },
  { id: 'diary',   label: 'Diary',   emoji: '🌙', jaShort: '夜の日記',
    jaPrompt: '今日あったことを 1-2 文で…',
    enContext: "a short evening diary of today's events" },
  { id: 'story',   label: 'Story',   emoji: '📖', jaShort: '小話',
    jaPrompt: 'ふと思い出した小話・エピソードを 1-2 文で…',
    enContext: 'a small anecdote or short story they want to tell' },
];

export function getMode(id: string): ModeMeta {
  return MODES.find((m) => m.id === id) || MODES[2]!; // default = diary
}

/** 時刻からデフォルト選択モードを推定。 */
export function defaultModeForNow(now = new Date()): DiaryMode {
  const h = now.getHours();
  if (h < 11) return 'morning';
  if (h < 18) return 'lesson';
  return 'diary';
}

/** YYYY-MM-DD (ローカルタイム)。 */
export function todayStr(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

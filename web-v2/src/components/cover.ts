import type { Mode } from '../data/mock';

// Mode は色相の基調。Morning は暖色、Lesson は青、Diary は深い藍。
const HUE_BY_MODE: Record<Mode, number> = {
  morning: 28,
  lesson: 215,
  diary: 250,
};

// 時間帯で明度・彩度を変えてその日の "空気" をゆるく可視化する。
function bandForHour(hour: number): { l1: number; l2: number; s: number } {
  if (hour < 6) return { l1: 28, l2: 14, s: 48 };   // 深夜
  if (hour < 9) return { l1: 70, l2: 50, s: 70 };   // 朝
  if (hour < 12) return { l1: 72, l2: 52, s: 62 };  // 午前
  if (hour < 17) return { l1: 60, l2: 40, s: 58 };  // 午後
  if (hour < 21) return { l1: 48, l2: 28, s: 60 };  // 夕方〜宵
  return { l1: 30, l2: 16, s: 50 };                 // 夜
}

export function coverFor(mode: Mode, time: string): string {
  const hour = parseInt(time.split(':')[0] ?? '12', 10);
  const hue = HUE_BY_MODE[mode];
  const { l1, l2, s } = bandForHour(isNaN(hour) ? 12 : hour);
  return `linear-gradient(135deg, hsl(${hue} ${s}% ${l1}%) 0%, hsl(${hue} ${s}% ${l2}%) 100%)`;
}

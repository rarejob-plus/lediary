// 二十四節気（簡易・年により ±1 日ズレ得るが視覚用には十分）
// 月と日のしきい値を超えた直近の節気を返す。
const SEKKI: { m: number; d: number; name: string }[] = [
  { m: 1, d: 5, name: '小寒' },
  { m: 1, d: 20, name: '大寒' },
  { m: 2, d: 4, name: '立春' },
  { m: 2, d: 19, name: '雨水' },
  { m: 3, d: 6, name: '啓蟄' },
  { m: 3, d: 21, name: '春分' },
  { m: 4, d: 5, name: '清明' },
  { m: 4, d: 20, name: '穀雨' },
  { m: 5, d: 6, name: '立夏' },
  { m: 5, d: 21, name: '小満' },
  { m: 6, d: 6, name: '芒種' },
  { m: 6, d: 21, name: '夏至' },
  { m: 7, d: 7, name: '小暑' },
  { m: 7, d: 23, name: '大暑' },
  { m: 8, d: 8, name: '立秋' },
  { m: 8, d: 23, name: '処暑' },
  { m: 9, d: 8, name: '白露' },
  { m: 9, d: 23, name: '秋分' },
  { m: 10, d: 8, name: '寒露' },
  { m: 10, d: 23, name: '霜降' },
  { m: 11, d: 7, name: '立冬' },
  { m: 11, d: 22, name: '小雪' },
  { m: 12, d: 7, name: '大雪' },
  { m: 12, d: 22, name: '冬至' },
];

export function solarTerm(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const m = d.getMonth() + 1;
  const day = d.getDate();
  // 直近の節気（その年で当該日付以前の最新）
  let last = SEKKI[SEKKI.length - 1]!.name; // default = 冬至
  for (const s of SEKKI) {
    if (s.m < m || (s.m === m && s.d <= day)) {
      last = s.name;
    } else {
      break;
    }
  }
  return last;
}

export function dayOfYear(dateStr: string): number {
  const d = new Date(dateStr + 'T00:00:00');
  const start = new Date(d.getFullYear(), 0, 1);
  const diff = d.getTime() - start.getTime();
  return Math.floor(diff / 86400000) + 1;
}

export function daysInYear(dateStr: string): number {
  const y = new Date(dateStr + 'T00:00:00').getFullYear();
  return ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) ? 366 : 365;
}

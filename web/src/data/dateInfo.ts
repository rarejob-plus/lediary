// 二十四節気（簡易・年により ±1 日ズレ得るが視覚用には十分）
// 出典: ja.wikipedia.org/wiki/二十四節気
type Season = '春' | '夏' | '秋' | '冬';
type SekkiEntry = { m: number; d: number; name: string; season: Season; description: string };

const SEKKI: SekkiEntry[] = [
  { m: 1, d: 5, name: '小寒', season: '冬', description: '寒の入り。寒さがいよいよ厳しくなる頃。' },
  { m: 1, d: 20, name: '大寒', season: '冬', description: '一年で最も寒さが厳しくなる時期。' },
  { m: 2, d: 4, name: '立春', season: '春', description: '暦の上で春が始まる日。冬と春の分かれ目。' },
  { m: 2, d: 19, name: '雨水', season: '春', description: '雪が雨に変わり、氷が解けて水になる頃。' },
  { m: 3, d: 6, name: '啓蟄', season: '春', description: '冬眠していた虫が土の中から出てくる頃。' },
  { m: 3, d: 21, name: '春分', season: '春', description: '昼と夜の長さがほぼ同じになる日。' },
  { m: 4, d: 5, name: '清明', season: '春', description: '万物が清らかで生き生きとし、花が咲き始める頃。' },
  { m: 4, d: 20, name: '穀雨', season: '春', description: '春の柔らかな雨が穀物を潤し、芽吹きを促す頃。' },
  { m: 5, d: 6, name: '立夏', season: '夏', description: '暦の上で夏が始まる日。新緑が眩しくなる頃。' },
  { m: 5, d: 21, name: '小満', season: '夏', description: '万物が次第に成長し、気が満ち始める頃。' },
  { m: 6, d: 6, name: '芒種', season: '夏', description: '稲などの穀物の種をまく頃。梅雨入り前後。' },
  { m: 6, d: 21, name: '夏至', season: '夏', description: '一年で昼が最も長く、夜が最も短い日。' },
  { m: 7, d: 7, name: '小暑', season: '夏', description: '梅雨が明け、本格的な暑さが始まる頃。' },
  { m: 7, d: 23, name: '大暑', season: '夏', description: '一年で最も暑さが厳しくなる時期。' },
  { m: 8, d: 8, name: '立秋', season: '秋', description: '暦の上で秋が始まる日。残暑の中にも涼風が。' },
  { m: 8, d: 23, name: '処暑', season: '秋', description: '暑さが峠を越え、和らぎ始める頃。' },
  { m: 9, d: 8, name: '白露', season: '秋', description: '朝夕の冷え込みで草に白い露が降りる頃。' },
  { m: 9, d: 23, name: '秋分', season: '秋', description: '昼と夜の長さがほぼ同じになる日。' },
  { m: 10, d: 8, name: '寒露', season: '秋', description: '冷たい露が草木に降り、秋が深まる頃。' },
  { m: 10, d: 23, name: '霜降', season: '秋', description: '霜が降り始め、紅葉が進む頃。' },
  { m: 11, d: 7, name: '立冬', season: '冬', description: '暦の上で冬が始まる日。木枯らしが吹き始める。' },
  { m: 11, d: 22, name: '小雪', season: '冬', description: 'わずかながら雪が降り始める頃。' },
  { m: 12, d: 7, name: '大雪', season: '冬', description: '本格的に雪が降る季節に入る頃。' },
  { m: 12, d: 22, name: '冬至', season: '冬', description: '一年で昼が最も短く、夜が最も長い日。' },
];

function findSekkiIndex(dateStr: string): number {
  const d = new Date(dateStr + 'T00:00:00');
  const m = d.getMonth() + 1;
  const day = d.getDate();
  let lastIdx = SEKKI.length - 1; // default = 冬至（年初の小寒前は前年末の冬至期間）
  for (let i = 0; i < SEKKI.length; i += 1) {
    const s = SEKKI[i]!;
    if (s.m < m || (s.m === m && s.d <= day)) {
      lastIdx = i;
    } else {
      break;
    }
  }
  return lastIdx;
}

export function solarTerm(dateStr: string): string {
  return SEKKI[findSekkiIndex(dateStr)]!.name;
}

export type SolarTermInfo = {
  name: string;
  season: Season;
  period: string; // e.g. "4月20日 - 5月5日頃"
  description: string;
};

export function solarTermInfo(dateStr: string): SolarTermInfo {
  const idx = findSekkiIndex(dateStr);
  const cur = SEKKI[idx]!;
  // 期間は次の節気の前日まで
  const next = SEKKI[(idx + 1) % SEKKI.length]!;
  const endMonth = next.m;
  const endDay = next.d - 1;
  // 翌節気が翌月 1 日なら前月末日まで（簡易）
  const period = endDay <= 0
    ? `${cur.m}月${cur.d}日 - ${endMonth}月頃`
    : `${cur.m}月${cur.d}日 - ${endMonth}月${endDay}日頃`;
  return {
    name: cur.name,
    season: cur.season,
    period,
    description: cur.description,
  };
}

/** ツールチップ付きの節気ピル HTML を返す（hover で季節・期間・特徴を表示）。 */
export function renderSekkiPill(dateStr: string, pillClass: string): string {
  const info = solarTermInfo(dateStr);
  return `
    <span class="sekki-pill-wrap">
      <span class="${pillClass}">${info.name}</span>
      <span class="sekki-tooltip" role="tooltip">
        <span class="sekki-tooltip-head">${info.name}<span class="sekki-tooltip-season">${info.season}</span></span>
        <span class="sekki-tooltip-period">${info.period}</span>
        <span class="sekki-tooltip-desc">${info.description}</span>
      </span>
    </span>
  `;
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

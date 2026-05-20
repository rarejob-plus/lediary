// ギフトカタログ。現状はクライアント側に静的データ。将来 admin 投入する場合は
// V2_COLLECTIONS.gifts を読みに行く実装に差し替える。

export interface Gift {
  id: string;
  emoji: string;
  name: string;
  description: string;
  costMp: number;
  /** 装飾系 (バッジ等) はアプリ内表示のみ。"theme" など実機能あればここで分岐したい。 */
  kind: 'badge' | 'theme';
}

export const GIFTS: Gift[] = [
  { id: 'sprout',   emoji: '🌱', name: 'Sprout',         description: '最初の一歩を踏み出した記念バッジ。',     costMp: 100,  kind: 'badge' },
  { id: 'cloud',    emoji: '☁️', name: 'Cloud',         description: '気軽に書く習慣ができた人へ。',           costMp: 300,  kind: 'badge' },
  { id: 'cafe',     emoji: '🎨', name: 'Cafe Theme',     description: 'チャット背景がカフェ調に変わる。',       costMp: 500,  kind: 'theme' },
  { id: 'starlight',emoji: '✨', name: 'Starlight',      description: '夜空のテーマ。落ち着いたダーク基調。',   costMp: 800,  kind: 'theme' },
  { id: 'champion', emoji: '🏆', name: 'Champion',       description: '長く続けた証。限定バッジ。',             costMp: 1000, kind: 'badge' },
  { id: 'lantern',  emoji: '🏮', name: 'Lantern',        description: '節気を彩る期間限定の装飾。',             costMp: 1500, kind: 'badge' },
];

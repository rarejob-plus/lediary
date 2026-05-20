// ギフトカタログ。
import type { IconName } from '../components/icons';

export interface Gift {
  id: string;
  icon: IconName;
  color: string;       // アイコン背景色
  name: string;
  description: string;
  costMp: number;
  kind: 'badge' | 'theme';
}

export const GIFTS: Gift[] = [
  { id: 'sprout',    icon: 'sprout',    color: '#4ade80', name: 'Sprout',    description: '最初の一歩を踏み出した記念バッジ。',     costMp: 100,  kind: 'badge' },
  { id: 'cloud',     icon: 'cloud',     color: '#60a5fa', name: 'Cloud',     description: '気軽に書く習慣ができた人へ。',           costMp: 300,  kind: 'badge' },
  { id: 'cafe',      icon: 'palette',   color: '#b45309', name: 'Cafe Theme',description: 'チャット背景がカフェ調に変わる。',       costMp: 500,  kind: 'theme' },
  { id: 'starlight', icon: 'sparkles',  color: '#7c3aed', name: 'Starlight', description: '夜空のテーマ。落ち着いたダーク基調。',   costMp: 800,  kind: 'theme' },
  { id: 'champion',  icon: 'trophy',    color: '#eab308', name: 'Champion',  description: '長く続けた証。限定バッジ。',             costMp: 1000, kind: 'badge' },
  { id: 'lantern',   icon: 'lamp',      color: '#f97316', name: 'Lantern',   description: '節気を彩る期間限定の装飾。',             costMp: 1500, kind: 'badge' },
];

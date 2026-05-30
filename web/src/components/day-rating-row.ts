// 充実度 1-10 ドット列の共通ウィジェット。
// timeline 過去日と diary editor で使う。size で見た目を切り替え。

import { icons } from './icons';
import { openDayRatingModal } from './day-rating-modal';
import type { DayRating } from '../data/days';

/** 充実度 (0-10) を 1 色の HSL に補間。Day One 風のシエナ系で、低スコアは中性、
 *  高スコアは深い暖色。timeline の日付数字に当てて「点 10 個」UI を消すために使う。
 *  score 0 (未設定) は空文字 (=継承) を返して、呼び出し側で default 色を保てる。 */
export function ratingColor(score: number): string {
  if (score <= 0) return '';
  const t = (score - 1) / 9;
  const sat = Math.round(22 + t * 48);  // 22% → 70%
  const lum = Math.round(62 - t * 32);  // 62% → 30%
  return `hsl(20, ${sat}%, ${lum}%)`;
}

interface Options {
  date: string;
  days: Map<string, DayRating>; // 上位ページが持つキャッシュ。modal 保存後に書き戻す。
  size: 'sm' | 'md';             // sm = 12px (timeline)、md = 18px (editor)
  showLabel?: boolean;           // md で「今日の充実度 N/10」のラベルを出すか
}

export function renderRatingRow(el: HTMLElement, opts: Options): void {
  const { date, days, size, showLabel = false } = opts;
  const rating = days.get(date);
  const score = rating?.score ?? 0;
  const note = rating?.note ?? '';

  const dotSize = size === 'md' ? 18 : 12;
  const cls = size === 'md' ? 'rating-dots rating-dots-lg' : 'rating-dots';

  const noteHtml = size === 'md' && note
    ? `<span class="rating-note">${escapeHtml(note)}</span>`
    : size === 'sm' && note
      ? `<span class="rating-note-icon" title="${escapeHtml(note)}">${icons.pen(10)}</span>`
      : '';

  // 空のときは問いかけ、入ったらスコアだけ — ラベルで「点数を付けるところ」と
  // 説明しすぎず、ドット列と組み合わせて意味が伝わるようにする
  el.innerHTML = `
    ${showLabel ? `<div class="rating-label">${score > 0 ? `<strong>${score}</strong> / 10` : 'How was today?'}</div>` : ''}
    <div class="${cls}">
      ${Array.from({ length: 10 }, (_, i) => {
        const n = i + 1;
        const filled = n <= score;
        return `<button class="rating-dot${filled ? ' filled' : ''}" data-score="${n}" data-level="${n}" aria-label="${n}点">${filled ? icons.circleSolid(dotSize) : icons.circle(dotSize)}</button>`;
      }).join('')}
      ${noteHtml}
    </div>
  `;

  el.querySelectorAll('.rating-dot').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tapped = Number((btn as HTMLElement).dataset.score);
      openDayRatingModal({
        date,
        score: tapped,
        initialNote: note,
        onSaved: (saved) => {
          if (saved) days.set(date, saved); else days.delete(date);
          renderRatingRow(el, opts);
        },
      });
    });
  });
}

function escapeHtml(s: string | undefined | null): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

// 充実度 1-10 ドット列の共通ウィジェット。
// timeline 過去日と diary editor で使う。size で見た目を切り替え。

import { icons } from './icons';
import { openDayRatingModal } from './day-rating-modal';
import type { DayRating } from '../data/days';

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

  el.innerHTML = `
    ${showLabel ? `<div class="rating-label">${score > 0 ? `今日の充実度 <strong>${score}/10</strong>` : '今日の充実度'}</div>` : ''}
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

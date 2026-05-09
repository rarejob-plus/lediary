// 充実度スコア + ひとこと note を入力するモーダル。
// タイムラインで dot をタップした時に開く。score は呼び出し時に確定済みで、
// modal はそのスコア表示と note 入力（省略可）を担当する。

import { saveDayRating, deleteDayRating, type DayRating } from '../data/days';
import { showToast } from './toast';
import { icons } from './icons';

interface OpenOptions {
  date: string;
  score: number;
  initialNote?: string;
  onSaved: (r: DayRating | null) => void; // null = deleted
}

const SCORE_LABEL: Record<number, string> = {
  1: 'とても低い', 2: '低い', 3: 'いまいち', 4: 'やや低い', 5: '普通',
  6: 'まあまあ', 7: '良い', 8: 'とても良い', 9: '充実', 10: '最高',
};

function formatDateLabel(date: string): string {
  const d = new Date(date + 'T00:00:00');
  return d.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' });
}

export function openDayRatingModal(opts: OpenOptions): void {
  const { date, initialNote = '' } = opts;
  let { score } = opts;

  const overlay = document.createElement('div');
  overlay.className = 'day-rating-modal-overlay';

  overlay.innerHTML = `
    <div class="day-rating-modal" role="dialog" aria-modal="true">
      <div class="day-rating-modal-head">
        <span class="day-rating-modal-date">${formatDateLabel(date)}</span>
        <button class="day-rating-modal-close" aria-label="閉じる">×</button>
      </div>
      <div class="day-rating-modal-score-row">
        <span class="day-rating-modal-score-num"></span>
        <span class="day-rating-modal-score-label"></span>
      </div>
      <div class="day-rating-modal-dots"></div>
      <textarea class="day-rating-modal-note" rows="3" placeholder="一言（任意）— なぜこのスコア？"></textarea>
      <div class="day-rating-modal-actions">
        <button class="day-rating-modal-delete" type="button">取り消す</button>
        <button class="day-rating-modal-save" type="button">保存</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  document.body.classList.add('day-rating-modal-open');

  const numEl = overlay.querySelector('.day-rating-modal-score-num') as HTMLElement;
  const labelEl = overlay.querySelector('.day-rating-modal-score-label') as HTMLElement;
  const dotsEl = overlay.querySelector('.day-rating-modal-dots') as HTMLElement;
  const noteEl = overlay.querySelector('.day-rating-modal-note') as HTMLTextAreaElement;
  const saveBtn = overlay.querySelector('.day-rating-modal-save') as HTMLButtonElement;
  const delBtn = overlay.querySelector('.day-rating-modal-delete') as HTMLButtonElement;
  const closeBtn = overlay.querySelector('.day-rating-modal-close') as HTMLButtonElement;

  function paintDots(): void {
    dotsEl.innerHTML = '';
    for (let i = 1; i <= 10; i++) {
      const b = document.createElement('button');
      const filled = i <= score;
      b.className = 'day-rating-dot' + (filled ? ' filled' : '');
      b.dataset.score = String(i);
      b.dataset.level = String(i);
      b.setAttribute('aria-label', `${i} 点`);
      b.innerHTML = filled ? icons.circleSolid(22) : icons.circle(22);
      b.addEventListener('click', () => {
        score = i;
        paintDots();
        paintScore();
      });
      dotsEl.appendChild(b);
    }
  }

  function paintScore(): void {
    numEl.textContent = String(score);
    labelEl.textContent = SCORE_LABEL[score] || '';
    numEl.dataset.score = String(score);
  }

  paintDots();
  paintScore();
  noteEl.value = initialNote;

  // 入力即フォーカス（モバイルでも note が書きやすい）
  setTimeout(() => noteEl.focus(), 60);

  function close(result: DayRating | null, didChange: boolean): void {
    document.body.classList.remove('day-rating-modal-open');
    overlay.remove();
    if (didChange) opts.onSaved(result);
  }

  closeBtn.addEventListener('click', () => close(null, false));
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close(null, false);
  });

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    try {
      const saved = await saveDayRating(date, score, noteEl.value.trim());
      close(saved, true);
      showToast('スコアを保存しました');
    } catch (err) {
      console.error(err);
      saveBtn.disabled = false;
      alert('保存に失敗しました');
    }
  });

  delBtn.addEventListener('click', async () => {
    if (!confirm('この日のスコアを取り消しますか？')) return;
    delBtn.disabled = true;
    try {
      await deleteDayRating(date);
      close(null, true);
      showToast('スコアを取り消しました');
    } catch (err) {
      console.error(err);
      delBtn.disabled = false;
      alert('取り消しに失敗しました');
    }
  });

  // Esc で閉じる
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      document.removeEventListener('keydown', onKey);
      close(null, false);
    }
  }
  document.addEventListener('keydown', onKey);
}

// 「完成」直前の小テスト modal。
// 過去 entry の JP↔EN ペアから 3 問出題し、JP → EN を学習者が即訳する。
// 「機能だけ作っても使わない」を回避するため、編集 → 完成のパスに半強制的に挟む。
// スキップは可能だが、視線が必ず通る位置に置く。

import { scorePronunciation, renderScoreDiffHtml } from './pronunciation';
import { icons } from './icons';

export interface QuizPair { jp: string; en: string; entryDate?: string; }

interface QuizState {
  guess: string;       // ユーザが書いた英訳
  skipped: boolean;
  score: number;       // 0-100, skipped なら 0
}

/** 完成前クイズ modal を開く。
 *  pairs が空なら何もせず onComplete を即呼ぶ。
 *  ユーザが全問終えて「完成して保存」を押す or ESC で modal を閉じると onComplete が呼ばれる。
 *  abort (バツボタン) は onComplete を呼ばずに modal を閉じる (= 保存中断)。 */
export function openCompletionQuiz(pairs: QuizPair[], onComplete: () => void): void {
  if (pairs.length === 0) { onComplete(); return; }
  const states: QuizState[] = pairs.map(() => ({ guess: '', skipped: false, score: 0 }));
  let idx = 0;

  const overlay = document.createElement('div');
  overlay.className = 'cover-picker-overlay';
  overlay.innerHTML = `
    <div class="cover-picker completion-quiz">
      <header class="cover-picker-head">
        <h3 class="cover-picker-title">完成前チャレンジ (${pairs.length} 問)</h3>
        <button class="cover-picker-close" type="button" aria-label="中断して戻る" title="中断">${icons.x(16)}</button>
      </header>
      <div class="completion-quiz-body"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  const body = overlay.querySelector('.completion-quiz-body') as HTMLElement;

  // バツボタン = 中断 (保存しない)
  overlay.querySelector('.cover-picker-close')!.addEventListener('click', () => {
    overlay.remove();
  });

  function renderQuestion(): void {
    const pair = pairs[idx]!;
    body.innerHTML = `
      <div class="completion-quiz-progress">
        ${pairs.map((_, i) => `<span class="completion-quiz-step ${i < idx ? 'done' : i === idx ? 'now' : ''}"></span>`).join('')}
        <span class="completion-quiz-counter">${idx + 1} / ${pairs.length}</span>
      </div>
      <div class="completion-quiz-jp-label">これを英訳してみよう${pair.entryDate ? ` <span class="completion-quiz-source">(${pair.entryDate} の日記より)</span>` : ''}</div>
      <p class="completion-quiz-jp">${escapeHtml(pair.jp)}</p>
      <textarea class="completion-quiz-input" name="completion-quiz-input" rows="3" placeholder="まず思いつくままに英訳…" autocomplete="off"></textarea>
      <div class="completion-quiz-actions">
        <button class="btn btn-ghost completion-quiz-skip" type="button">スキップ</button>
        <button class="btn btn-primary completion-quiz-submit" type="button">採点する</button>
      </div>
    `;
    const ta = body.querySelector('.completion-quiz-input') as HTMLTextAreaElement;
    ta.focus();
    ta.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        (body.querySelector('.completion-quiz-submit') as HTMLButtonElement).click();
      }
    });
    body.querySelector('.completion-quiz-submit')!.addEventListener('click', () => {
      const guess = ta.value.trim();
      if (!guess) { ta.focus(); return; }
      const s = scorePronunciation(pair.en, guess);
      states[idx] = { guess, skipped: false, score: s.score };
      renderInlineFeedback(s);
    });
    body.querySelector('.completion-quiz-skip')!.addEventListener('click', () => {
      states[idx] = { guess: '', skipped: true, score: 0 };
      next();
    });
  }

  function renderInlineFeedback(s: ReturnType<typeof scorePronunciation>): void {
    const pair = pairs[idx]!;
    body.innerHTML = `
      <div class="completion-quiz-progress">
        ${pairs.map((_, i) => `<span class="completion-quiz-step ${i < idx ? 'done' : i === idx ? 'now' : ''}"></span>`).join('')}
        <span class="completion-quiz-counter">${idx + 1} / ${pairs.length}</span>
      </div>
      <div class="completion-quiz-jp-label">${escapeHtml(pair.jp)}</div>
      <div class="completion-quiz-score-row">
        <span class="completion-quiz-score-num">${s.score}</span>
        <span class="completion-quiz-score-denom">/ 100</span>
        ${s.score >= 100 ? '<span class="completion-quiz-badge completion-quiz-badge--perfect">🏆 Perfect!</span>'
          : s.score >= 90 ? '<span class="completion-quiz-badge completion-quiz-badge--great">✨ Great!</span>'
          : s.score >= 60 ? '<span class="completion-quiz-badge completion-quiz-badge--good">👍 Good!</span>'
          : ''}
      </div>
      <div class="completion-quiz-diff">${renderScoreDiffHtml(s.tokens)}</div>
      <div class="completion-quiz-answer">
        <div class="completion-quiz-answer-label">元の答え</div>
        <p>${escapeHtml(pair.en)}</p>
      </div>
      <div class="completion-quiz-actions">
        <button class="btn btn-primary completion-quiz-next" type="button">${idx + 1 === pairs.length ? 'まとめへ →' : '次の問題 →'}</button>
      </div>
    `;
    body.querySelector('.completion-quiz-next')!.addEventListener('click', () => next());
  }

  function next(): void {
    idx++;
    if (idx >= pairs.length) renderSummary();
    else renderQuestion();
  }

  function renderSummary(): void {
    const answered = states.filter((st) => !st.skipped).length;
    const avg = answered > 0
      ? Math.round(states.filter((st) => !st.skipped).reduce((a, b) => a + b.score, 0) / answered)
      : 0;
    body.innerHTML = `
      <div class="completion-quiz-summary">
        <h4>${icons.check(18)} お疲れさま</h4>
        <p class="completion-quiz-summary-stat">
          <strong>${answered}</strong> / ${pairs.length} 問回答、平均 <strong>${avg}</strong> 点
        </p>
        <ul class="completion-quiz-summary-list">
          ${states.map((st, i) => `
            <li>
              <span class="completion-quiz-summary-jp">${escapeHtml(pairs[i]!.jp)}</span>
              <span class="completion-quiz-summary-score ${st.skipped ? 'skipped' : st.score >= 60 ? 'ok' : 'low'}">${st.skipped ? 'skip' : st.score}</span>
            </li>
          `).join('')}
        </ul>
        <button class="btn btn-primary completion-quiz-done" type="button" style="width:100%;margin-top:14px;">完成して保存</button>
      </div>
    `;
    body.querySelector('.completion-quiz-done')!.addEventListener('click', () => {
      overlay.remove();
      onComplete();
    });
  }

  renderQuestion();
}

function escapeHtml(s: string | undefined | null): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

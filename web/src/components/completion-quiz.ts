// 「完成」直前の小テスト modal。
// 過去 entry の pick (今日の 1 フレーズ) から JP メモ → EN を学習者が即訳する。
// 「機能だけ作っても使わない」を回避するため、entry detail の 完成 ボタンの
// パスに半強制的に挟む。スキップは可能だが、視線が必ず通る位置に置く。

import { scorePronunciation, renderScoreDiffHtml } from './pronunciation';
import { icons } from './icons';
import { ensurePickAudioUrl } from '../data/picksAudio';

/** クイズ問題 1 件。pick ベースで構築するため、対応する entry / pick ID を保持して
 *  結果記録時に元の pick まで辿れるようにする。 */
export interface QuizPair {
  jp: string;
  en: string;
  entryId: string;
  entryDate: string;
  pickId: string;
}

/** 1 問あたりの結果。Firestore に永続化される。 */
export interface QuizResult {
  pickId: string;
  entryId: string;
  jp: string;
  expectedEn: string;
  guess: string;       // ユーザが書いた英訳。skipped なら空文字
  score: number;       // 0-100, skipped なら 0
  skipped: boolean;
  attemptedAt: number; // epoch ms
}

type QuizState = Omit<QuizResult, 'pickId' | 'entryId' | 'jp' | 'expectedEn' | 'attemptedAt'>;

/** 完成前クイズ modal を開く。
 *  pairs が空なら何もせず onComplete を即呼ぶ。
 *  ユーザが全問終えて「完成して保存」を押すと結果配列を引数に onComplete が呼ばれる。
 *  abort (バツボタン) は onComplete を呼ばずに modal を閉じる (= 完成中断)。 */
export function openCompletionQuiz(
  pairs: QuizPair[],
  onComplete: (results: QuizResult[]) => void,
): void {
  if (pairs.length === 0) { onComplete([]); return; }
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
        ${s.score >= 100 ? `<span class="completion-quiz-badge completion-quiz-badge--perfect">${icons.trophy(12)} Perfect!</span>`
          : s.score >= 90 ? `<span class="completion-quiz-badge completion-quiz-badge--great">${icons.sparkles(12)} Great!</span>`
          : s.score >= 60 ? `<span class="completion-quiz-badge completion-quiz-badge--good">${icons.thumbsUp(12)} Good!</span>`
          : ''}
      </div>
      <div class="completion-quiz-diff">${renderScoreDiffHtml(s.tokens)}</div>
      <div class="completion-quiz-answer">
        <div class="completion-quiz-answer-head">
          <span class="completion-quiz-answer-label">元の答え</span>
          <button class="completion-quiz-play" type="button" aria-label="再生" title="お手本を再生">${icons.play(14)}</button>
        </div>
        <p>${escapeHtml(pair.en)}</p>
      </div>
      <div class="completion-quiz-actions">
        <button class="btn btn-primary completion-quiz-next" type="button">${idx + 1 === pairs.length ? 'まとめへ →' : '次の問題 →'}</button>
      </div>
    `;
    bindPlayButton(pair);
    body.querySelector('.completion-quiz-next')!.addEventListener('click', () => next());
  }

  /** お手本再生ボタンの配線。pick の audio キャッシュ (ensurePickAudioUrl) と共有するので、
   *  既に entry で生成済みの WAV があれば即再生。無ければ TTS 生成 → 再生。 */
  function bindPlayButton(pair: QuizPair): void {
    const btn = body.querySelector('.completion-quiz-play') as HTMLButtonElement | null;
    if (!btn) return;
    const audio = new Audio();
    audio.preservesPitch = true;
    let busy = false;
    const setPlay = () => { btn.innerHTML = icons.play(14); };
    const setPause = () => { btn.innerHTML = icons.pause(14); };
    audio.addEventListener('ended', setPlay);
    audio.addEventListener('pause', setPlay);
    btn.addEventListener('click', async () => {
      if (!audio.paused) { audio.pause(); audio.currentTime = 0; return; }
      if (busy) return;
      busy = true;
      btn.classList.add('completion-quiz-play--loading');
      try {
        const url = await ensurePickAudioUrl({
          pickId: pair.pickId,
          text: pair.en,
        });
        audio.src = url;
        setPause();
        await audio.play();
      } catch (e) {
        console.error('[completion-quiz] play failed', e);
      } finally {
        btn.classList.remove('completion-quiz-play--loading');
        busy = false;
      }
    });
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
      const now = Date.now();
      const results: QuizResult[] = pairs.map((p, i) => ({
        pickId: p.pickId,
        entryId: p.entryId,
        jp: p.jp,
        expectedEn: p.en,
        guess: states[i]!.guess,
        score: states[i]!.score,
        skipped: states[i]!.skipped,
        attemptedAt: now,
      }));
      onComplete(results);
    });
  }

  renderQuestion();
}

function escapeHtml(s: string | undefined | null): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

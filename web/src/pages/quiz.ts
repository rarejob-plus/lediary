// JP↔EN 文ペア・クイズ。
// 過去 entry の sentencePairs を集めてランダム出題。未生成 entry はオンデマンドで align してキャッシュ。
// 採点は発音採点と同じく word-level diff + 一致率。

import { renderHeader } from '../components/header';
import { icons } from '../components/icons';
import { fetchEntries } from '../data/entries';
import { ensureSentencePairs } from '../data/posts';
import { scorePronunciation, renderScoreDiffHtml } from '../components/pronunciation';
import { getCurrentUser } from '../auth';
import { enhanceTextarea } from '../components/textarea';
import { MODE_META, type DiaryEntry } from '../data/mock';
import { navigate } from '../router';

interface QuizCard {
  jp: string;
  en: string;
  entryId: string;
  entryDate: string;
  entryMode: DiaryEntry['mode'];
}

export function renderQuiz(root: HTMLElement): void {
  root.appendChild(renderHeader('quiz'));

  const wrap = document.createElement('div');
  wrap.className = 'quiz-page';
  wrap.innerHTML = `<p class="quiz-loading">読み込み中…</p>`;
  root.appendChild(wrap);

  if (!getCurrentUser()) {
    wrap.innerHTML = `<p class="quiz-empty">ログインしてください</p>`;
    return;
  }

  void load();

  async function load(): Promise<void> {
    try {
      const entries = await fetchEntries();
      const usable = entries.filter((e) => e.contentJp && e.userTranslation);
      if (usable.length === 0) {
        wrap.innerHTML = `<p class="quiz-empty">日記がまだありません。少なくとも 1 つ書いて添削してからクイズを始められます。</p>`;
        return;
      }
      let cards: QuizCard[] = [];
      for (const e of usable) {
        const pairs = Array.isArray(e.sentencePairs) ? e.sentencePairs : [];
        for (const p of pairs) {
          if (p?.jp && p?.en) cards.push({ jp: p.jp, en: p.en, entryId: e.id, entryDate: e.date, entryMode: e.mode });
        }
      }
      if (cards.length === 0) {
        // 補完: sentencePairs を持たない entry を 1 つ選んでオンデマンド生成
        await buildFirstCardsFromBackfill(wrap, usable);
        return;
      }
      cards = shuffle(cards);
      startQuiz(wrap, cards);
    } catch (e) {
      console.error('[quiz]', e);
      wrap.innerHTML = `<p class="quiz-empty">読み込みに失敗しました</p>`;
    }
  }
}

/** sentencePairs が 1 件も無い場合の初回フロー。1 entry に対し align を実行してそのまま開始。 */
async function buildFirstCardsFromBackfill(wrap: HTMLElement, entries: DiaryEntry[]): Promise<void> {
  wrap.innerHTML = `
    <div class="quiz-empty">
      <p>過去の日記から文ペアを準備しています…</p>
      <p class="quiz-empty-sub">初回のみ AI で文を整列します (約 5-10 秒)。</p>
    </div>
  `;
  // newest first を維持しつつ、本文長が短すぎないものを 1 つ選ぶ
  const candidate = entries.find((e) => (e.userTranslation || '').length > 20) || entries[0]!;
  try {
    const pairs = await ensureSentencePairs(candidate.id, candidate.contentJp, candidate.userTranslation || '');
    if (pairs.length === 0) {
      wrap.innerHTML = `<p class="quiz-empty">文ペアを作れませんでした。もう少し長い日記があると有効です。</p>`;
      return;
    }
    const cards = shuffle(pairs.map((p) => ({
      jp: p.jp, en: p.en, entryId: candidate.id, entryDate: candidate.date, entryMode: candidate.mode,
    })));
    startQuiz(wrap, cards);
  } catch (e) {
    console.error('[quiz backfill]', e);
    wrap.innerHTML = `<p class="quiz-empty">準備に失敗しました</p>`;
  }
}

function startQuiz(wrap: HTMLElement, cards: QuizCard[]): void {
  let idx = 0;
  let revealed = false;

  function render(): void {
    const card = cards[idx];
    if (!card) {
      wrap.innerHTML = `
        <div class="quiz-done">
          <h2>${icons.check(20)} お疲れさま</h2>
          <p>${cards.length} 問チャレンジしました。</p>
          <button class="btn btn-primary" id="restart" type="button">もう一度</button>
        </div>
      `;
      wrap.querySelector('#restart')!.addEventListener('click', () => {
        idx = 0;
        revealed = false;
        cards = shuffle(cards);
        render();
      });
      return;
    }
    const modeMeta = MODE_META[card.entryMode];
    wrap.innerHTML = `
      <header class="quiz-head">
        <span class="quiz-count">${idx + 1} / ${cards.length}</span>
        <a class="quiz-source" data-href="/entry/${card.entryId}" title="元の日記を開く">
          <span class="quiz-mode" style="color:${modeMeta.color};">${modeMeta.label}</span>
          · ${card.entryDate}
        </a>
      </header>
      <section class="quiz-card">
        <div class="quiz-jp-label">これを英訳してみよう</div>
        <p class="quiz-jp-text">${escapeHtml(card.jp)}</p>
        <textarea class="quiz-en-input" name="quiz-en" rows="3" placeholder="自分の英訳を書く…"></textarea>
        <div class="quiz-actions">
          <button class="btn" id="reveal" type="button">答えを見る</button>
          <button class="btn btn-primary" id="check" type="button">採点する</button>
        </div>
        <div class="quiz-result" aria-live="polite"></div>
      </section>
      <div class="quiz-next-row">
        <button class="btn btn-ghost" id="skip" type="button">スキップ →</button>
      </div>
    `;
    const ta = wrap.querySelector('.quiz-en-input') as HTMLTextAreaElement;
    enhanceTextarea(ta, { onSubmit: () => (wrap.querySelector('#check') as HTMLButtonElement | null)?.click() });
    ta.focus();
    const resultEl = wrap.querySelector('.quiz-result') as HTMLElement;
    const checkBtn = wrap.querySelector('#check') as HTMLButtonElement;
    const revealBtn = wrap.querySelector('#reveal') as HTMLButtonElement;
    const skipBtn = wrap.querySelector('#skip') as HTMLButtonElement;

    (wrap.querySelector('.quiz-source') as HTMLElement).addEventListener('click', (e) => {
      e.preventDefault();
      navigate((e.currentTarget as HTMLElement).getAttribute('data-href') || '/');
    });

    checkBtn.addEventListener('click', () => {
      const guess = ta.value.trim();
      if (!guess) { alert('英訳を書いてください'); return; }
      const s = scorePronunciation(card.en, guess);
      resultEl.innerHTML = `
        <div class="quiz-score-headline">
          <span class="quiz-score-num">${s.score}</span>
          <span class="quiz-score-denom">/ 100</span>
          <span class="quiz-score-meta">${s.matched} / ${s.total} 単語一致</span>
        </div>
        <div class="quiz-diff">${renderScoreDiffHtml(s.tokens)}</div>
        <div class="quiz-answer">
          <div class="quiz-answer-label">元の答え</div>
          <p>${escapeHtml(card.en)}</p>
        </div>
        <div class="quiz-action-row">
          <button class="btn" id="next" type="button">次の問題 →</button>
        </div>
      `;
      resultEl.querySelector('#next')!.addEventListener('click', () => { idx++; revealed = false; render(); });
    });

    revealBtn.addEventListener('click', () => {
      revealed = true;
      resultEl.innerHTML = `
        <div class="quiz-answer">
          <div class="quiz-answer-label">答え</div>
          <p>${escapeHtml(card.en)}</p>
        </div>
        <div class="quiz-action-row">
          <button class="btn" id="next" type="button">次の問題 →</button>
        </div>
      `;
      resultEl.querySelector('#next')!.addEventListener('click', () => { idx++; revealed = false; render(); });
    });

    skipBtn.addEventListener('click', () => { idx++; revealed = false; render(); });
    void revealed;
  }
  render();
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

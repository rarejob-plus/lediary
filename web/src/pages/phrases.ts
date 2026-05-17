// 「私のフレーズ集」: 全エントリから picks を集約、SRS 順で復習できるグローバルページ。
// 英語日記 BOY 流の「言いたいフレーズを身体に染み込ませる」習慣を支える。

import { renderHeader } from '../components/header';
import { icons } from '../components/icons';
import { fetchAllPicks, pickStatus, sortBySrs, type PickWithContext } from '../data/picks';
import { savePostPicks } from '../data/posts';
import { fetchEntries } from '../data/entries';
import { MODE_META } from '../data/mock';
import { navigate } from '../router';

type Filter = 'all' | 'due' | 'mastered';

export function renderPhrases(root: HTMLElement): void {
  root.appendChild(renderHeader('phrases'));

  const wrap = document.createElement('div');
  wrap.className = 'phrases-page';
  wrap.innerHTML = `<p class="phrases-loading">読み込み中…</p>`;
  root.appendChild(wrap);

  fetchAllPicks().then((picks) => renderBody(wrap, picks)).catch((err) => {
    console.error('[phrases]', err);
    wrap.innerHTML = '<p class="phrases-loading">読み込みに失敗しました</p>';
  });
}

function renderBody(wrap: HTMLElement, allPicks: PickWithContext[]): void {
  let filter: Filter = 'all';
  let working = [...allPicks];

  function refresh(): void {
    wrap.innerHTML = '';

    // ヘッダー: タイトル + 件数 + フィルタ
    const dueCount = working.filter((p) => pickStatus(p) === 'due').length;
    const masteredCount = working.filter((p) => pickStatus(p) === 'mastered').length;
    const head = document.createElement('div');
    head.className = 'phrases-head';
    head.innerHTML = `
      <div class="phrases-title">
        <span class="phrases-title-text">私のフレーズ集</span>
        <span class="phrases-title-sub">${working.length} 件 · 今日の復習 ${dueCount} 件</span>
      </div>
      <div class="phrases-filter">
        <button class="phrases-filter-btn ${filter === 'all' ? 'on' : ''}" data-f="all">すべて</button>
        <button class="phrases-filter-btn ${filter === 'due' ? 'on' : ''}" data-f="due">復習 (${dueCount})</button>
        <button class="phrases-filter-btn ${filter === 'mastered' ? 'on' : ''}" data-f="mastered">習得 (${masteredCount})</button>
      </div>
    `;
    wrap.appendChild(head);
    head.querySelectorAll<HTMLButtonElement>('.phrases-filter-btn').forEach((b) => {
      b.addEventListener('click', () => {
        filter = (b.dataset.f as Filter) || 'all';
        refresh();
      });
    });

    // リスト
    if (working.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'phrases-empty';
      empty.textContent = 'まだフレーズをピックしていません。日記詳細から「今日の 1 フレーズ」を追加してください。';
      wrap.appendChild(empty);
      return;
    }

    const visible = sortBySrs(working).filter((p) => filter === 'all' || pickStatus(p) === filter);
    if (visible.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'phrases-empty';
      empty.textContent = filter === 'due' ? '今日は復習する pick はありません 🌿' : '該当するフレーズはありません';
      wrap.appendChild(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'phrases-list';
    wrap.appendChild(list);
    visible.forEach((pick) => {
      const card = renderPhraseCard(pick, async (delta) => {
        // SRS 更新: shadowingCount をインクリメント + lastShadowedAt を today に。
        pick.shadowingCount = (pick.shadowingCount || 0) + delta;
        pick.lastShadowedAt = Date.now();
        await persistPickUpdate(pick);
        // 状態変化に応じて再描画
        refresh();
      });
      list.appendChild(card);
    });
  }

  refresh();
}

function renderPhraseCard(
  pick: PickWithContext,
  onShadowed: (delta: number) => Promise<void>,
): HTMLElement {
  const card = document.createElement('div');
  card.className = `phrase-card phrase-card--${pickStatus(pick)}`;
  const modeMeta = MODE_META[pick.entryMode];
  card.innerHTML = `
    <div class="phrase-card-head">
      <a class="phrase-card-meta" data-nav="/entry/${pick.entryId}">
        <span class="phrase-card-mode" style="color:${modeMeta.color};">${modeMeta.label}</span>
        <span class="phrase-card-date">${pick.entryDate}</span>
      </a>
      <span class="phrase-card-status">${statusLabel(pick)}</span>
    </div>
    <p class="phrase-card-text">${escapeHtml(pick.text)}</p>
    ${pick.note ? `<p class="phrase-card-note">${escapeHtml(pick.note)}</p>` : ''}
    <div class="phrase-card-player">
      <button class="phrase-play" aria-label="再生">${icons.play(14)}</button>
      <div class="phrase-speeds">
        ${[0.5, 0.75, 1].map((s) => `<button class="phrase-speed${s === 1 ? ' active' : ''}" data-speed="${s}">${s === 0.5 ? '0.5x' : s === 0.75 ? '0.75x' : '1x'}</button>`).join('')}
      </div>
      <label class="phrase-repeat" title="リピート">
        <input type="checkbox" class="phrase-repeat-cb"> リピート
      </label>
      <span class="phrase-count" title="シャドーイング回数">${pick.shadowingCount || 0} 回</span>
    </div>
  `;

  card.querySelector('.phrase-card-meta')!.addEventListener('click', (e) => {
    e.preventDefault();
    navigate(`/entry/${pick.entryId}`);
  });

  let rate = 1;
  card.querySelectorAll<HTMLButtonElement>('.phrase-speed').forEach((b) => {
    b.addEventListener('click', () => {
      rate = parseFloat(b.dataset.speed || '1');
      card.querySelectorAll('.phrase-speed').forEach((x) => x.classList.toggle('active', x === b));
    });
  });

  const playBtn = card.querySelector('.phrase-play') as HTMLButtonElement;
  const repeatCb = card.querySelector('.phrase-repeat-cb') as HTMLInputElement;
  const countEl = card.querySelector('.phrase-count') as HTMLElement;
  let isPlaying = false;

  function speak(): void {
    if (!('speechSynthesis' in window)) {
      alert('お使いのブラウザは TTS に未対応です');
      return;
    }
    const u = new SpeechSynthesisUtterance(pick.text);
    u.lang = 'en-US';
    u.rate = rate;
    u.onend = () => {
      const next = (parseInt(countEl.textContent || '0') || 0) + 1;
      countEl.textContent = `${next} 回`;
      void onShadowed(1);
      if (repeatCb.checked) {
        speak();
      } else {
        isPlaying = false;
        playBtn.innerHTML = icons.play(14);
      }
    };
    u.onerror = () => {
      isPlaying = false;
      playBtn.innerHTML = icons.play(14);
    };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  playBtn.addEventListener('click', () => {
    if (isPlaying) {
      window.speechSynthesis.cancel();
      isPlaying = false;
      playBtn.innerHTML = icons.play(14);
      return;
    }
    isPlaying = true;
    playBtn.innerHTML = icons.pause(14);
    speak();
  });

  return card;
}

function statusLabel(pick: PickWithContext): string {
  const s = pickStatus(pick);
  if (s === 'due') return '復習する';
  if (s === 'mastered') return '習得';
  return '次回まで';
}

/** pick の差分を該当 entry に書き戻す。複数 pick 持ちの entry でも safe な merge。 */
async function persistPickUpdate(pick: PickWithContext): Promise<void> {
  const entries = await fetchEntries();
  const entry = entries.find((e) => e.id === pick.entryId);
  if (!entry || !Array.isArray(entry.picks)) return;
  const updated = entry.picks.map((p) =>
    p.id === pick.id
      ? { ...p, shadowingCount: pick.shadowingCount, lastShadowedAt: pick.lastShadowedAt }
      : p,
  );
  await savePostPicks(pick.entryId, updated);
}

function escapeHtml(s: string | undefined | null): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

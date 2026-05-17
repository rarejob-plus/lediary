// 「私のフレーズ集」: 全エントリから picks を集約、SRS 順で復習できるグローバルページ。
// 英語日記 BOY 流の「言いたいフレーズを身体に染み込ませる」習慣を支える。

import { renderHeader } from '../components/header';
import { icons } from '../components/icons';
import { fetchAllPicks, pickStatus, sortBySrs, type PickWithContext } from '../data/picks';
import { savePostPicks } from '../data/posts';
import { fetchEntries } from '../data/entries';
import { MODE_META } from '../data/mock';
import { navigate } from '../router';
import { isPushSupported, isSubscribed, subscribePush, unsubscribePush } from '../push';
import { getCurrentUser } from '../auth';
import { createShadowingPlayer } from '../components/shadowing-player';

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
      <div class="phrases-head-right">
        ${isPushSupported() ? `
          <button class="phrases-notify-btn ${isSubscribed() ? 'on' : ''}" type="button" title="毎朝の通知">
            ${isSubscribed() ? icons.check(12) : ''} 通知 ${isSubscribed() ? 'オン' : ''}
          </button>
        ` : ''}
        <div class="phrases-filter">
          <button class="phrases-filter-btn ${filter === 'all' ? 'on' : ''}" data-f="all">すべて</button>
          <button class="phrases-filter-btn ${filter === 'due' ? 'on' : ''}" data-f="due">復習 (${dueCount})</button>
          <button class="phrases-filter-btn ${filter === 'mastered' ? 'on' : ''}" data-f="mastered">習得 (${masteredCount})</button>
        </div>
      </div>
    `;
    wrap.appendChild(head);
    head.querySelectorAll<HTMLButtonElement>('.phrases-filter-btn').forEach((b) => {
      b.addEventListener('click', () => {
        filter = (b.dataset.f as Filter) || 'all';
        refresh();
      });
    });

    const notifyBtn = head.querySelector('.phrases-notify-btn') as HTMLButtonElement | null;
    if (notifyBtn) {
      notifyBtn.addEventListener('click', async () => {
        const u = getCurrentUser();
        if (!u) { alert('ログインが必要です'); return; }
        notifyBtn.disabled = true;
        try {
          if (isSubscribed()) {
            await unsubscribePush();
          } else {
            const ok = await subscribePush(u.uid);
            if (!ok) {
              alert('通知の許可が得られませんでした。ブラウザの設定をご確認ください。');
            }
          }
        } finally {
          notifyBtn.disabled = false;
          refresh();
        }
      });
    }

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
  `;

  card.querySelector('.phrase-card-meta')!.addEventListener('click', (e) => {
    e.preventDefault();
    navigate(`/entry/${pick.entryId}`);
  });

  card.appendChild(
    createShadowingPlayer({
      text: pick.text,
      initialCount: pick.shadowingCount || 0,
      classPrefix: 'phrase',
      onShadowed,
    }),
  );

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

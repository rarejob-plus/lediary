// 過去の日記アーカイブ。日付グループで 4 モード分の artifact を一覧表示。
// 各カードは元の日記 + 拡張ストーリーを並べて表示する。

import { fetchUserDiaries, type DiaryArtifact } from '../data/diaries';
import { getMode, MODES } from '../data/modes';
import { icons } from '../components/icons';

export async function renderArchive(root: HTMLElement, userId: string): Promise<void> {
  root.innerHTML = '<p class="archive-loading">読み込み中…</p>';
  const wrap = document.createElement('div');
  wrap.className = 'archive-screen';
  try {
    const all = await fetchUserDiaries(userId);
    root.innerHTML = '';
    if (all.length === 0) {
      wrap.innerHTML = '<p class="archive-empty">まだ完成した日記はありません。チャットで日記を書いて What if? を選ぶと、ここに残ります。</p>';
      root.appendChild(wrap);
      return;
    }

    // 日付でグループ化
    const byDate = new Map<string, DiaryArtifact[]>();
    for (const a of all) {
      const arr = byDate.get(a.date) || [];
      arr.push(a);
      byDate.set(a.date, arr);
    }

    // 連続日数
    const streak = computeStreak(all);

    wrap.innerHTML = `
      <header class="archive-header">
        <h2 class="archive-title">過去の日記</h2>
        ${streak > 0 ? `<div class="archive-streak">${icons.flame(14)} ${streak} 日連続</div>` : ''}
      </header>
      <div class="archive-list" id="archive-list"></div>
    `;
    const listEl = wrap.querySelector('#archive-list') as HTMLElement;
    Array.from(byDate.entries()).forEach(([date, items]) => {
      listEl.appendChild(renderDateGroup(date, items));
    });
    root.appendChild(wrap);
  } catch (e) {
    console.error('[archive]', e);
    root.innerHTML = '<p class="archive-empty">読み込みに失敗しました。</p>';
  }
}

function renderDateGroup(date: string, items: DiaryArtifact[]): HTMLElement {
  const group = document.createElement('section');
  group.className = 'archive-day';

  const itemsByMode = new Map(items.map((i) => [i.mode, i]));
  group.innerHTML = `
    <div class="archive-day-head">
      <div class="archive-day-date">${formatDate(date)}</div>
      <div class="archive-day-modes">
        ${MODES.map((m) => {
          const it = itemsByMode.get(m.id);
          const s = it?.status === 'completed' ? 'done' : it?.status === 'in-progress' ? 'prog' : 'empty';
          return `<span class="archive-day-mode-dot archive-day-mode-dot--${s}" title="${m.label}">${icons[m.icon](12)}</span>`;
        }).join('')}
      </div>
    </div>
    <div class="archive-day-cards"></div>
  `;
  const cardsEl = group.querySelector('.archive-day-cards') as HTMLElement;
  // mode 順 (morning → lesson → diary → story) に並べる
  for (const m of MODES) {
    const a = itemsByMode.get(m.id);
    if (!a) continue;
    cardsEl.appendChild(renderArtifactCard(a));
  }
  return group;
}

function renderArtifactCard(a: DiaryArtifact): HTMLElement {
  const card = document.createElement('article');
  const meta = getMode(a.mode);
  card.className = `archive-card archive-card--${a.status}`;
  card.innerHTML = `
    <header class="archive-card-head">
      <span class="archive-card-icon">${icons[meta.icon](16)}</span>
      <span class="archive-card-label">${meta.label}</span>
      <span class="archive-card-status">${a.status === 'completed' ? '完成' : '途中'}</span>
    </header>
    <div class="archive-card-original">
      <div class="archive-card-section-label">あなたの日記</div>
      <p>${escapeHtml(a.originalText || '')}</p>
    </div>
    ${a.friendReply ? `
      <div class="archive-card-reply">
        <div class="archive-card-section-label">友達の返信</div>
        <p>${escapeHtml(a.friendReply)}</p>
      </div>
    ` : ''}
    ${a.selectedOption ? `
      <div class="archive-card-twist">
        <div class="archive-card-section-label">選んだ What if?</div>
        <p><em>${escapeHtml(a.selectedOption)}</em></p>
      </div>
    ` : ''}
    ${a.expandedStory ? `
      <div class="archive-card-story">
        <div class="archive-card-section-label">拡張ストーリー</div>
        <p>${escapeHtml(a.expandedStory)}</p>
      </div>
    ` : ''}
  `;
  return card;
}

function formatDate(date: string): string {
  const d = new Date(date + 'T00:00:00');
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
}

function computeStreak(diaries: DiaryArtifact[]): number {
  // completed が 1 件以上ある日 = 「書いた日」とみなす
  const completedDates = new Set(
    diaries.filter((d) => d.status === 'completed').map((d) => d.date),
  );
  if (completedDates.size === 0) return 0;
  const cursor = new Date();
  const dateStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (!completedDates.has(dateStr(cursor))) cursor.setDate(cursor.getDate() - 1);
  let n = 0;
  while (completedDates.has(dateStr(cursor))) {
    n++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return n;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

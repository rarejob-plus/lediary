import { renderHeader, renderFab } from '../components/header';
import { icons } from '../components/icons';
import { coverFor } from '../components/cover';
import { renderRatingRow } from '../components/day-rating-row';
import { MODE_META, type DiaryEntry, type Mode } from '../data/mock';
import { fetchEntries } from '../data/entries';
import { fetchDays, type DayRating } from '../data/days';
import { renderSekkiInline, dayOfYear, daysInYear } from '../data/dateInfo';
import { navigate } from '../router';

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dateToStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 連続して書いた日数。今日まだ書いていない場合は昨日を起点（書くまで途切れさせない）
function computeStreak(entries: DiaryEntry[]): number {
  if (entries.length === 0) return 0;
  const dates = new Set(entries.map((e) => e.date));
  const cursor = new Date();
  if (!dates.has(dateToStr(cursor))) cursor.setDate(cursor.getDate() - 1);
  let count = 0;
  while (dates.has(dateToStr(cursor))) {
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

function dayHeaderParts(dateStr: string): { num: string; weekday: string; monthYear: string } {
  const d = new Date(dateStr + 'T00:00:00');
  return {
    num: String(d.getDate()),
    weekday: d.toLocaleDateString('en-US', { weekday: 'long' }),
    monthYear: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
  };
}

export function renderTimeline(root: HTMLElement): void {
  root.appendChild(renderHeader('timeline'));

  const wrap = document.createElement('div');
  wrap.className = 'timeline';
  wrap.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:40px 0;font-size:13px;">読み込み中…</p>`;
  root.appendChild(wrap);
  root.appendChild(renderFab());

  Promise.all([fetchEntries(), fetchDays()])
    .then(([entries, days]) => renderBody(wrap, entries, days))
    .catch((err) => {
      console.error(err);
      wrap.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:40px 0;">読み込みに失敗しました</p>`;
    });
}

function renderBody(wrap: HTMLElement, entries: DiaryEntry[], days: Map<string, DayRating>): void {
  wrap.innerHTML = '';

  // Top row: streak + today label
  const streak = computeStreak(entries);
  const topRow = document.createElement('div');
  topRow.className = 'timeline-top-row';
  topRow.innerHTML = `
    <span class="timeline-today-label">${formatYmd(new Date())}</span>
    ${streak > 0 ? `<div class="timeline-streak">${icons.flame(13)} <span>${streak} day streak</span></div>` : ''}
  `;
  wrap.appendChild(topRow);

  // Today's 4-mode cards
  const today = todayStr();
  const todayEntries = entries.filter((e) => e.date === today);
  const todayByMode = new Map(todayEntries.map((e) => [e.mode, e]));

  const todayRow = document.createElement('div');
  todayRow.className = 'today-row';
  const modeSubtitle: Record<Mode, string> = {
    morning: '今日の予定・意気込み',
    lesson: 'レッスンの振り返り',
    diary: '一日の終わりの日記',
    story: 'エピソード・小話',
  };
  (['morning', 'lesson', 'diary', 'story'] as Mode[]).forEach((m) => {
    const meta = MODE_META[m];
    const filled = todayByMode.get(m);
    const card = document.createElement('button');
    card.className = `today-card ${filled ? 'filled' : ''}`;
    const statusLabel = filled ? '書いた' : 'まだ書いていない';
    const statusInner = filled
      ? icons.check(12)
      : '';
    card.innerHTML = `
      <div class="today-card-row">
        <span class="today-card-icon">${iconFor(meta.icon, 22)}</span>
        <span class="today-card-status ${filled ? 'done' : 'todo'}"
              role="img" aria-label="${statusLabel}" title="${statusLabel}">${statusInner}</span>
      </div>
      <div class="today-card-title">${meta.label}</div>
      <div class="today-card-sub">${modeSubtitle[m]}</div>
    `;
    card.addEventListener('click', () => {
      if (filled) {
        navigate(`/entry/${filled.id}`);
      } else {
        navigate(`/editor?mode=${m}`);
      }
    });
    todayRow.appendChild(card);
  });
  wrap.appendChild(todayRow);

  // Group entries by date (今日も含めて履歴に表示する — Today 行はステータス、履歴は内容)
  const groups = new Map<string, DiaryEntry[]>();
  for (const e of entries) {
    if (!groups.has(e.date)) groups.set(e.date, []);
    groups.get(e.date)!.push(e);
  }

  // 直近 INITIAL_LIMIT 件まで初期描画 — 履歴増加に伴う cover 画像ロードの肥大化を防ぐ。
  // 残りは「もっと見る」で1回で展開する。
  const INITIAL_LIMIT = 10;
  const groupArr = Array.from(groups.entries());
  let cutoff = groupArr.length;
  let acc = 0;
  for (let i = 0; i < groupArr.length; i++) {
    acc += groupArr[i]![1].length;
    if (acc >= INITIAL_LIMIT) {
      cutoff = i + 1;
      break;
    }
  }
  for (let i = 0; i < cutoff; i++) {
    const [date, dayEntries] = groupArr[i]!;
    wrap.appendChild(renderDay(date, dayEntries, days));
  }

  if (cutoff < groupArr.length) {
    const moreBtn = document.createElement('button');
    moreBtn.className = 'timeline-more-btn';
    moreBtn.type = 'button';
    moreBtn.textContent = 'もっと見る';
    moreBtn.addEventListener('click', () => {
      const frag = document.createDocumentFragment();
      for (let i = cutoff; i < groupArr.length; i++) {
        const [date, dayEntries] = groupArr[i]!;
        frag.appendChild(renderDay(date, dayEntries, days));
      }
      moreBtn.replaceWith(frag);
    });
    wrap.appendChild(moreBtn);
  }

  if (entries.length === 0) {
    const empty = document.createElement('p');
    empty.style.cssText = 'color:var(--text-muted);text-align:center;padding:40px 0;font-style:italic;';
    empty.textContent = 'まだエントリがありません。今日のひとことから始めましょう。';
    wrap.appendChild(empty);
  }
}

function renderDay(date: string, dayEntries: DiaryEntry[], days: Map<string, DayRating>): HTMLElement {
  const day = document.createElement('div');
  day.className = 'timeline-day';

  const parts = dayHeaderParts(date);
  const header = document.createElement('div');
  header.className = 'timeline-day-header';
  header.innerHTML = `
    <div class="timeline-day-num">${parts.num}</div>
    <div class="timeline-day-meta">
      <strong>${parts.weekday}</strong>
      <span>${parts.monthYear}</span>
    </div>
    <div class="timeline-day-rating"></div>
  `;
  day.appendChild(header);

  const ratingEl = header.querySelector('.timeline-day-rating') as HTMLElement;
  renderRatingRow(ratingEl, { date, days, size: 'sm' });

  for (const entry of dayEntries) {
    const meta = MODE_META[entry.mode];
    const card = document.createElement('button');
    card.className = 'entry-card';
    card.innerHTML = `
      <div class="entry-cover" style="background:${entry.cover ?? coverFor(entry.mode, entry.time, entry.coverImageUrl)};"></div>
      <div class="entry-card-body">
        <div class="ld-meta entry-card-meta">
          <span class="ld-meta__item ld-meta__item--accent"><span class="ld-meta__icon">${iconFor(meta.icon, 12)}</span>${meta.label}</span>
          <span class="ld-meta__item">${renderSekkiInline(entry.date)}</span>
          <span class="ld-meta__item">${dayOfYear(entry.date)} / ${daysInYear(entry.date)}</span>
          ${entry.mood ? `<span class="ld-meta__item">${escapeHtml(entry.mood)}</span>` : ''}
          <span class="ld-meta__item">${entry.time}</span>
        </div>
        <p class="entry-card-text">${escapeHtml(entry.userTranslation || entry.contentJp)}</p>
        ${entry.vocabulary.length > 0 ? `
          <div class="entry-card-tags">
            ${entry.vocabulary.slice(0, 3).map((v) => `<span class="entry-tag">${escapeHtml(v.word)}</span>`).join('')}
          </div>
        ` : ''}
      </div>
    `;
    card.addEventListener('click', () => navigate(`/entry/${entry.id}`));
    day.appendChild(card);
  }

  return day;
}

function iconFor(name: 'sun' | 'graduation' | 'moon' | 'bookOpen', size = 11): string {
  if (name === 'sun') return icons.sun(size);
  if (name === 'graduation') return icons.graduation(size);
  if (name === 'bookOpen') return icons.bookOpen(size);
  return icons.moon(size);
}

function formatYmd(d: Date): string {
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

function escapeHtml(s: string | undefined | null): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

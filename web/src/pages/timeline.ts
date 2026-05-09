import { renderHeader, renderFab } from '../components/header';
import { icons } from '../components/icons';
import { coverFor } from '../components/cover';
import { openDayRatingModal } from '../components/day-rating-modal';
import { MODE_META, type DiaryEntry, type Mode } from '../data/mock';
import { fetchEntries } from '../data/entries';
import { fetchDays, type DayRating } from '../data/days';
import { renderSekkiPill, dayOfYear, daysInYear } from '../data/dateInfo';
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
  (['morning', 'lesson', 'diary', 'story'] as Mode[]).forEach((m) => {
    const meta = MODE_META[m];
    const filled = todayByMode.get(m);
    const card = document.createElement('button');
    card.className = `today-card ${filled ? 'filled' : ''}`;
    card.innerHTML = filled
      ? `
        <div class="today-card-mode" style="color:${meta.color};">
          ${iconFor(meta.icon, 14)} ${meta.label}
        </div>
        <div class="today-card-check-mark" style="color:${meta.color};">${icons.check(16)}</div>
      `
      : `
        <div class="today-card-mode">
          ${iconFor(meta.icon, 14)} ${meta.label}
        </div>
        <div class="today-card-status today-card-empty">まだ書いていない</div>
        <div class="today-card-check">${icons.pen(11)} 書く</div>
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

  // 今日の充実度: today-row の下に独立した行を出す（その日記の有無に関わらずタップ可）
  const todayRating = document.createElement('div');
  todayRating.className = 'today-rating';
  wrap.appendChild(todayRating);
  paintRatingRow(todayRating, today, days, true);

  // Group entries by date (今日も含めて履歴に表示する — Today 行はステータス、履歴は内容)
  const groups = new Map<string, DiaryEntry[]>();
  for (const e of entries) {
    if (!groups.has(e.date)) groups.set(e.date, []);
    groups.get(e.date)!.push(e);
  }

  for (const [date, dayEntries] of groups) {
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
    paintRatingRow(ratingEl, date, days, false);

    for (const entry of dayEntries) {
      const meta = MODE_META[entry.mode];
      const card = document.createElement('button');
      card.className = 'entry-card';
      card.innerHTML = `
        <div class="entry-cover" style="background:${entry.cover ?? coverFor(entry.mode, entry.time, entry.coverImageUrl)};">
          <div class="entry-cover-meta">
            <span class="entry-cover-pill">${iconFor(meta.icon)} ${meta.label}</span>
            ${renderSekkiPill(entry.date, 'entry-cover-pill')}
            <span class="entry-cover-pill">${dayOfYear(entry.date)} / ${daysInYear(entry.date)}</span>
            ${entry.mood ? `<span class="entry-cover-pill">${escapeHtml(entry.mood)}</span>` : ''}
          </div>
        </div>
        <div class="entry-card-body">
          <div class="entry-card-time">${entry.time}</div>
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

    wrap.appendChild(day);
  }

  if (entries.length === 0) {
    const empty = document.createElement('p');
    empty.style.cssText = 'color:var(--text-muted);text-align:center;padding:40px 0;font-style:italic;';
    empty.textContent = 'まだエントリがありません。今日のひとことから始めましょう。';
    wrap.appendChild(empty);
  }
}

// 充実度 1-10 のドット列。tap で modal を開き、保存後は再描画する。
function paintRatingRow(
  el: HTMLElement,
  date: string,
  days: Map<string, DayRating>,
  expanded: boolean,
): void {
  const rating = days.get(date);
  const score = rating?.score ?? 0;
  const note = rating?.note ?? '';

  const cls = expanded ? 'rating-dots rating-dots-lg' : 'rating-dots';
  const noteHtml = expanded && note
    ? `<span class="rating-note">${escapeHtml(note)}</span>`
    : !expanded && note
      ? `<span class="rating-note-icon" title="${escapeHtml(note)}">${icons.pen(10)}</span>`
      : '';

  const dotSize = expanded ? 18 : 12;
  el.innerHTML = `
    ${expanded ? `<div class="rating-label">${score > 0 ? `今日の充実度 <strong>${score}/10</strong>` : '今日の充実度'}</div>` : ''}
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
      const initialScore = score > 0 ? score : tapped;
      openDayRatingModal({
        date,
        score: tapped > 0 ? tapped : initialScore,
        initialNote: note,
        onSaved: (saved) => {
          if (saved) days.set(date, saved); else days.delete(date);
          paintRatingRow(el, date, days, expanded);
        },
      });
    });
  });
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

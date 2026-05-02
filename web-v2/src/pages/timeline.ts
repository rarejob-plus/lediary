import { renderHeader, renderFab, renderMockBanner } from '../components/header';
import { icons } from '../components/icons';
import { coverFor } from '../components/cover';
import { MOCK_ENTRIES, MODE_META, type DiaryEntry, type Mode } from '../data/mock';
import { navigate } from '../router';

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayKey(d: string): string {
  return d;
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

  // Top row: streak + today label
  const topRow = document.createElement('div');
  topRow.className = 'timeline-top-row';
  topRow.innerHTML = `
    <span class="timeline-today-label">${formatYmd(new Date())}</span>
    <div class="timeline-streak">${icons.flame(13)} <span>4 day streak</span></div>
  `;
  wrap.appendChild(topRow);

  // Today's 3-mode cards
  const today = todayStr();
  const todayEntries = MOCK_ENTRIES.filter((e) => e.date === today);
  const todayByMode = new Map(todayEntries.map((e) => [e.mode, e]));

  const todayRow = document.createElement('div');
  todayRow.className = 'today-row';
  (['morning', 'lesson', 'diary'] as Mode[]).forEach((m) => {
    const meta = MODE_META[m];
    const filled = todayByMode.get(m);
    const card = document.createElement('button');
    card.className = `today-card ${filled ? 'filled' : ''}`;
    card.innerHTML = `
      <div class="today-card-mode" style="${filled ? `color:${meta.color};` : ''}">
        ${iconFor(meta.icon, 14)} ${meta.label}
      </div>
      <div class="today-card-status ${filled ? '' : 'today-card-empty'}">
        ${filled ? escapeHtml(filled.userTranslation || filled.contentJp) : 'まだ書いていない'}
      </div>
      ${filled ? '' : `<div class="today-card-check">${icons.pen(11)} 書く</div>`}
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

  // Group past entries by date (excluding today)
  const groups = new Map<string, DiaryEntry[]>();
  for (const e of MOCK_ENTRIES) {
    if (e.date === today) continue;
    const k = dayKey(e.date);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(e);
  }

  for (const [date, entries] of groups) {
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
    `;
    day.appendChild(header);

    for (const entry of entries) {
      const meta = MODE_META[entry.mode];
      const card = document.createElement('button');
      card.className = 'entry-card';
      card.innerHTML = `
        <div class="entry-cover" style="background:${entry.cover ?? coverFor(entry.mode, entry.time)};">
          <div class="entry-cover-meta">
            <span class="entry-cover-pill">${iconFor(meta.icon)} ${meta.label}</span>
            ${entry.location ? `<span class="entry-cover-pill">${icons.mapPin(11)} ${escapeHtml(entry.location)}</span>` : ''}
          </div>
        </div>
        <div class="entry-card-body">
          <div class="entry-card-time">${entry.time}${entry.weather ? ` · ${escapeHtml(entry.weather)}` : ''}</div>
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

  root.appendChild(wrap);
  root.appendChild(renderFab());
  root.appendChild(renderMockBanner());
}

function iconFor(name: 'sun' | 'graduation' | 'moon', size = 11): string {
  if (name === 'sun') return icons.sun(size);
  if (name === 'graduation') return icons.graduation(size);
  return icons.moon(size);
}

function formatYmd(d: Date): string {
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

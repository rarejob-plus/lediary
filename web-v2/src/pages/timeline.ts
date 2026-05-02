import { renderHeader, renderFab, renderMockBanner } from '../components/header';
import { icons } from '../components/icons';
import { MOCK_ENTRIES, MODE_META, type DiaryEntry } from '../data/mock';
import { navigate } from '../router';

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

  const streak = document.createElement('div');
  streak.className = 'timeline-streak';
  streak.innerHTML = `${icons.flame(13)} <span>4 day streak</span>`;
  wrap.appendChild(streak);

  // Group entries by date
  const groups = new Map<string, DiaryEntry[]>();
  for (const e of MOCK_ENTRIES) {
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
        <div class="entry-cover" style="background:${entry.cover};">
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

function iconFor(name: 'sun' | 'graduation' | 'moon'): string {
  if (name === 'sun') return icons.sun(11);
  if (name === 'graduation') return icons.graduation(11);
  return icons.moon(11);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

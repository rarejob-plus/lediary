import { renderHeader, renderMockBanner } from '../components/header';
import { MOCK_ENTRIES, MODE_META } from '../data/mock';
import { navigate } from '../router';

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const ts = d.getTime();
  const diff = Math.round((today.getTime() - ts) / 86400000);
  if (diff === 0) return '今日';
  if (diff === 1) return '昨日';
  if (diff < 7) return `${diff}日前`;
  return d.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' });
}

export function renderTimeline(root: HTMLElement): void {
  root.appendChild(renderHeader('timeline'));

  const greeting = document.createElement('div');
  greeting.className = 'timeline-greeting';
  greeting.innerHTML = `
    今日も、ひとこと書こう。
    <span class="timeline-greeting-streak">🔥 4日連続</span>
  `;
  root.appendChild(greeting);

  const cta = document.createElement('button');
  cta.className = 'write-cta';
  cta.textContent = '今日を書く';
  cta.addEventListener('click', () => navigate('/editor'));
  root.appendChild(cta);

  const recentLabel = document.createElement('div');
  recentLabel.className = 'timeline-section-label';
  recentLabel.textContent = '最近のエントリ';
  root.appendChild(recentLabel);

  if (MOCK_ENTRIES.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'timeline-empty';
    empty.textContent = 'まだエントリがありません';
    root.appendChild(empty);
  } else {
    for (const entry of MOCK_ENTRIES) {
      const meta = MODE_META[entry.mode];
      const card = document.createElement('div');
      card.className = 'entry-card';
      card.innerHTML = `
        <div class="entry-card-meta">
          <span class="entry-mode-pill" style="color:${meta.color};">
            ${meta.emoji} ${meta.label}
          </span>
          <span>·</span>
          <span>${formatDate(entry.date)}</span>
        </div>
        <p class="entry-card-text">${escapeHtml(entry.userTranslation || entry.contentJp)}</p>
        ${entry.vocabulary.length > 0 ? `
          <div class="entry-card-vocab">
            ${entry.vocabulary.slice(0, 3).map((v) => `<span class="entry-vocab-chip">${escapeHtml(v.word)}</span>`).join('')}
          </div>
        ` : ''}
      `;
      card.addEventListener('click', () => navigate(`/entry/${entry.id}`));
      root.appendChild(card);
    }
  }

  root.appendChild(renderMockBanner());
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

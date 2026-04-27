/**
 * Home page — diary list.
 */

import { api } from '../../api/client';
import { logout } from '../../auth';
import { navigate } from '../../router';
import { Sunrise, GraduationCap, Moon, CheckCircle, type IconNode } from 'lucide';

const ICON_MAP: Record<string, IconNode> = { Sunrise, GraduationCap, Moon, CheckCircle };

interface DiaryPost {
  id: string;
  contentJp: string;
  userTranslation?: string;
  date: string;
  mode?: string;
}

function lucide(name: string, size = 20, cls = ''): string {
  const parts = ICON_MAP[name];
  if (!parts) return '';
  const elements = Array.from(parts as ArrayLike<[string, Record<string, string>]>);
  const inner = elements.map(([tag, attrs]) => {
    const attrStr = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ');
    return `<${tag} ${attrStr}/>`;
  }).join('');
  return `<svg class="lucide-icon ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

const MODE_ICONS: Record<string, string> = {
  morning: 'Sunrise',
  lesson: 'GraduationCap',
  diary: 'Moon',
};

const MODES = [
  { key: 'morning', label: 'Morning' },
  { key: 'lesson', label: 'Lesson' },
  { key: 'diary', label: 'Diary' },
];

function modeIconSvg(mode?: string, size = 18): string {
  const name = MODE_ICONS[mode || 'diary'] || 'Moon';
  return lucide(name, size, `mode-icon-${mode || 'diary'}`);
}

export function homeHTML(): string {
  return `
    <div class="app-header">
      <h1>Lediary</h1>
      <div class="header-actions">
        <a href="/settings" class="btn btn-ghost" title="Settings">Settings</a>
        <button id="logout-btn" class="btn btn-ghost" title="Logout">Logout</button>
      </div>
    </div>
    <div id="home-calendar" class="home-calendar"></div>
    <div id="day-detail" class="day-detail" style="display:none;"></div>
  `;
}

const CACHE_KEY = 'lediary_posts_cache';

function renderCalendar(posts: DiaryPost[]): void {
  const container = document.getElementById('home-calendar');
  if (!container) return;

  const today = getToday();

  // Build map: date → count of completed modes
  const dateModeCounts = new Map<string, number>();
  const dateModes = new Map<string, Set<string>>();
  for (const p of posts) {
    if (!p.date || !p.userTranslation) continue;
    dateModeCounts.set(p.date, (dateModeCounts.get(p.date) || 0) + 1);
    if (!dateModes.has(p.date)) dateModes.set(p.date, new Set());
    dateModes.get(p.date)!.add(p.mode || 'diary');
  }

  // Calculate streak
  let streak = 0;
  const sd = new Date(today + 'T00:00:00');
  while (true) {
    const ds = fmtDate(sd);
    if (dateModeCounts.has(ds)) {
      streak++;
      sd.setDate(sd.getDate() - 1);
    } else if (ds === today) {
      sd.setDate(sd.getDate() - 1);
    } else {
      break;
    }
  }

  // Build calendar
  const now = new Date(today + 'T00:00:00');
  const year = now.getFullYear();
  const month = now.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthName = now.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long' });

  let cells = '';
  for (let i = 0; i < firstDay; i++) cells += '<div class="cal-cell empty"></div>';
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const count = dateModeCounts.get(dateStr) || 0;
    const isToday = dateStr === today;
    const isFuture = dateStr > today;
    let cls = 'cal-cell';
    if (count >= 3) cls += ' level-3';
    else if (count === 2) cls += ' level-2';
    else if (count === 1) cls += ' level-1';
    else if (!isFuture) cls += ' level-0';
    if (isToday) cls += ' today';
    if (!isFuture) cls += ' clickable';
    cells += `<div class="${cls}" data-date="${dateStr}"><span>${day}</span></div>`;
  }

  container.innerHTML = `
    <div class="cal-header">
      <div class="streak-header">
        <span class="streak-count">${streak}</span>
        <span class="streak-label">日連続</span>
      </div>
      <div class="cal-month">${monthName}</div>
    </div>
    <div class="cal-weekdays">
      <span>日</span><span>月</span><span>火</span><span>水</span><span>木</span><span>金</span><span>土</span>
    </div>
    <div class="cal-grid">${cells}</div>
    <div class="cal-legend">
      <span class="cal-legend-item"><span class="cal-dot level-0"></span>0</span>
      <span class="cal-legend-item"><span class="cal-dot level-1"></span>1</span>
      <span class="cal-legend-item"><span class="cal-dot level-2"></span>2</span>
      <span class="cal-legend-item"><span class="cal-dot level-3"></span>3</span>
    </div>
  `;

  // Click handler: show day detail
  container.querySelectorAll('.cal-cell.clickable').forEach((cell) => {
    cell.addEventListener('click', () => {
      const date = (cell as HTMLElement).dataset.date!;
      showDayDetail(date, posts);
      // Highlight selected
      container.querySelectorAll('.cal-cell').forEach((c) => c.classList.remove('selected'));
      cell.classList.add('selected');
    });
  });

  // Auto-show today
  showDayDetail(today, posts);
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function showDayDetail(date: string, posts: DiaryPost[]): void {
  const detail = document.getElementById('day-detail')!;
  const dayPosts = posts.filter((p) => p.date === date);
  const today = getToday();
  const isToday = date === today;
  const dateLabel = isToday ? '今日' : new Date(date + 'T00:00:00').toLocaleDateString('ja-JP', { month: 'short', day: 'numeric', weekday: 'short' });

  let html = `<div class="day-detail-header">${dateLabel}</div><div class="day-detail-modes">`;

  for (const m of MODES) {
    const post = dayPosts.find((p) => (p.mode || 'diary') === m.key);
    if (post) {
      html += `
        <div class="day-mode-item done" data-id="${post.id}">
          <span class="day-mode-icon">${modeIconSvg(m.key, 16)}</span>
          <span class="day-mode-label">${m.label}</span>
          <span class="day-mode-check">${lucide('CheckCircle', 14, 'check-done')}</span>
        </div>`;
    } else if (isToday) {
      html += `
        <div class="day-mode-item todo" data-mode="${m.key}">
          <span class="day-mode-icon">${modeIconSvg(m.key, 16)}</span>
          <span class="day-mode-label">${m.label}</span>
        </div>`;
    }
  }

  html += '</div>';
  detail.innerHTML = html;
  detail.style.display = '';

  // Click handlers
  detail.querySelectorAll('.day-mode-item.done').forEach((el) => {
    el.addEventListener('click', () => {
      navigate(`/post/${(el as HTMLElement).dataset.id}`);
    });
  });
  detail.querySelectorAll('.day-mode-item.todo').forEach((el) => {
    el.addEventListener('click', () => {
      navigate(`/new/${(el as HTMLElement).dataset.mode}`);
    });
  });
}

export async function initHome(): Promise<void> {
  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    await logout();
    navigate('/login');
  });

  let loadedPosts: DiaryPost[] = [];

  // Show cached data immediately
  const cached = localStorage.getItem(CACHE_KEY);
  if (cached) {
    try {
      loadedPosts = JSON.parse(cached);
      renderCalendar(loadedPosts);
    } catch { /* ignore bad cache */ }
  }

  // Fetch fresh data in background
  try {
    const posts = await api.get<DiaryPost[]>('/diary/posts');
    const freshPosts = posts || [];
    localStorage.setItem(CACHE_KEY, JSON.stringify(freshPosts));

    if (JSON.stringify(freshPosts) !== JSON.stringify(loadedPosts)) {
      loadedPosts = freshPosts;
      renderCalendar(loadedPosts);
    }
  } catch (err) {
    console.error('Failed to fetch posts:', err);
  }
}

function getToday(): string {
  const now = new Date();
  if (now.getHours() < 4) now.setDate(now.getDate() - 1);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}



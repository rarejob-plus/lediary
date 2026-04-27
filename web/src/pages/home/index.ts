/**
 * Home page — diary list.
 */

import { api } from '../../api/client';
import { logout } from '../../auth';
import { navigate } from '../../router';
import { showToast } from '../../components/toast';
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
    <div id="streak-section" class="streak-section"></div>
    <div id="today-modes" class="today-modes"></div>
    <div id="diary-list">
      <div class="skeleton-block"></div>
      <div class="skeleton-block"></div>
    </div>
  `;
}

const CACHE_KEY = 'lediary_posts_cache';

function renderPosts(listEl: HTMLElement, posts: DiaryPost[]): void {
  if (!posts || posts.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <p>まだ日記がありません。<br>最初の日記を書きましょう！</p>
      </div>
    `;
    return;
  }

  // Show only today + yesterday
  const today = getToday();
  const yesterday = getYesterday();
  const recentPosts = posts.filter((p) => p.date === today || p.date === yesterday);

  if (recentPosts.length === 0) {
    listEl.innerHTML = '';
    return;
  }

  listEl.innerHTML = recentPosts
    .map(
      (post) => `
      <div class="card diary-card" data-id="${post.id}">
        <div class="diary-card-header">
          <div class="diary-card-date"><span class="diary-card-mode">${modeIconSvg(post.mode, 14)}</span> ${post.date === today ? '今日' : '昨日'}</div>
          <button class="delete-btn" data-id="${post.id}" title="削除"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
        </div>
        <div class="diary-card-en">${escapeHTML(post.userTranslation || post.contentJp || '')}</div>
      </div>
    `
    )
    .join('');
}

function getYesterday(): string {
  const d = new Date();
  if (d.getHours() < 4) d.setDate(d.getDate() - 1);
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function renderStreak(posts: DiaryPost[]): void {
  const container = document.getElementById('streak-section');
  if (!container) return;

  const today = getToday();

  // Build set of dates that have entries
  const writtenDates = new Set<string>();
  for (const p of posts) {
    if (p.date && p.userTranslation) writtenDates.add(p.date);
  }

  // Calculate streak
  let streak = 0;
  const d = new Date(today + 'T00:00:00');
  while (true) {
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (writtenDates.has(dateStr)) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else {
      // Allow today to be unwritten (streak doesn't break until tomorrow)
      if (dateStr === today) {
        d.setDate(d.getDate() - 1);
        continue;
      }
      break;
    }
  }

  // Build monthly calendar grid
  const now = new Date(today + 'T00:00:00');
  const year = now.getFullYear();
  const month = now.getMonth();
  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthName = now.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long' });

  let calCells = '';
  // Empty cells for days before 1st
  for (let i = 0; i < firstDay; i++) calCells += '<div class="cal-cell empty"></div>';
  // Day cells
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const isToday = dateStr === today;
    const written = writtenDates.has(dateStr);
    const isPast = dateStr < today;
    let cls = 'cal-cell';
    if (written) cls += ' written';
    else if (isPast) cls += ' missed';
    if (isToday) cls += ' today';
    calCells += `<div class="${cls}"><span>${day}</span></div>`;
  }

  container.innerHTML = `
    <div class="streak-header">
      <div class="streak-count">${streak}</div>
      <div class="streak-label">日連続</div>
    </div>
    <div class="streak-calendar">
      <div class="cal-month">${monthName}</div>
      <div class="cal-weekdays">
        <span>日</span><span>月</span><span>火</span><span>水</span><span>木</span><span>金</span><span>土</span>
      </div>
      <div class="cal-grid">${calCells}</div>
    </div>
  `;
}

function attachCardListeners(listEl: HTMLElement, loadedPosts: DiaryPost[]): void {
  listEl.querySelectorAll('.diary-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.delete-btn')) return;
      const id = (card as HTMLElement).dataset.id;
      navigate(`/post/${id}`);
    });
  });

  listEl.querySelectorAll('.delete-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = (btn as HTMLElement).dataset.id;
      if (!id) return;
      const card = btn.closest('.diary-card') as HTMLElement;
      if (!confirm('この日記を削除しますか？')) return;
      try {
        await api.delete(`/diary/posts/${id}`);
        card.remove();
        loadedPosts.splice(loadedPosts.findIndex((p) => p.id === id), 1);
        localStorage.setItem(CACHE_KEY, JSON.stringify(loadedPosts));
        showToast('削除しました');
        if (!listEl.querySelector('.diary-card')) {
          listEl.innerHTML = `<div class="empty-state"><p>まだ日記がありません。<br>最初の日記を書きましょう！</p></div>`;
        }
      } catch (_err) {
        showToast('削除に失敗しました');
      }
    });
  });
}

export async function initHome(): Promise<void> {
  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    await logout();
    navigate('/login');
  });

  const listEl = document.getElementById('diary-list')!;
  let loadedPosts: DiaryPost[] = [];

  // Show cached data immediately
  const cached = localStorage.getItem(CACHE_KEY);
  if (cached) {
    try {
      loadedPosts = JSON.parse(cached);
      renderPosts(listEl, loadedPosts);
      attachCardListeners(listEl, loadedPosts);
      renderTodayModes(loadedPosts);
      renderStreak(loadedPosts);
    } catch { /* ignore bad cache */ }
  }

  // Fetch fresh data in background
  try {
    const posts = await api.get<DiaryPost[]>('/diary/posts');
    const freshPosts = posts || [];
    localStorage.setItem(CACHE_KEY, JSON.stringify(freshPosts));

    // Only re-render if data changed
    if (JSON.stringify(freshPosts) !== JSON.stringify(loadedPosts)) {
      loadedPosts = freshPosts;
      renderPosts(listEl, loadedPosts);
      attachCardListeners(listEl, loadedPosts);
      renderTodayModes(loadedPosts);
      renderStreak(loadedPosts);
    }
  } catch (err) {
    console.error('Failed to fetch posts:', err);
    if (!cached) {
      listEl.innerHTML = `
        <div class="empty-state">
          <p>日記の読み込みに失敗しました。</p>
        </div>
      `;
    }
  }
}

function getToday(): string {
  const now = new Date();
  if (now.getHours() < 4) now.setDate(now.getDate() - 1);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function renderTodayModes(posts: DiaryPost[]): void {
  const container = document.getElementById('today-modes');
  if (!container) return;

  const today = getToday();

  container.innerHTML = MODES.map((m) => {
    const existing = posts.find((p) => p.date === today && (p.mode || 'diary') === m.key);
    const done = existing && existing.userTranslation;
    return `
      <div class="mode-card mode-${m.key} ${done ? 'done' : ''}" data-mode="${m.key}" data-post-id="${existing?.id || ''}">
        <span class="mode-icon">${modeIconSvg(m.key, 22)}</span>
        <span class="mode-label">${done ? lucide('CheckCircle', 14, 'check-done') + ' ' : ''}${m.label}</span>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.mode-card').forEach((card) => {
    card.addEventListener('click', () => {
      const mode = (card as HTMLElement).dataset.mode!;
      const postId = (card as HTMLElement).dataset.postId;
      if (postId) {
        navigate(`/post/${postId}`);
      } else {
        navigate(`/new/${mode}`);
      }
    });
  });
}

function escapeHTML(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

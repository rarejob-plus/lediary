/**
 * Home page — diary list.
 */

import { api } from '../../api/client';
import { logout } from '../../auth';
import { navigate } from '../../router';
import { showToast } from '../../components/toast';

interface DiaryPost {
  id: string;
  contentJp: string;
  contentEn?: string;
  date: string;
  createdAt: number;
}

export function homeHTML(): string {
  return `
    <div class="app-header">
      <h1>Lediary</h1>
      <div class="header-actions">
        <button id="logout-btn" class="btn btn-ghost" title="ログアウト">ログアウト</button>
      </div>
    </div>
    <div id="diary-list">
      <div class="skeleton-block"></div>
      <div class="skeleton-block"></div>
      <div class="skeleton-block"></div>
    </div>
    <button id="fab-new" class="fab" title="今日の日記を書く">+</button>
  `;
}

export async function initHome(): Promise<void> {
  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    await logout();
    navigate('/login');
  });

  const listEl = document.getElementById('diary-list')!;
  let loadedPosts: DiaryPost[] = [];

  // FAB: navigate to today's diary (existing or new)
  document.getElementById('fab-new')?.addEventListener('click', () => {
    const now = new Date();
    if (now.getHours() < 4) now.setDate(now.getDate() - 1);
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const existing = loadedPosts.find((p) => p.date === today);
    if (existing) {
      navigate(`/post/${existing.id}`);
    } else {
      navigate('/new');
    }
  });

  try {
    const posts = await api.get<DiaryPost[]>('/diary/posts');
    loadedPosts = posts || [];

    if (!posts || posts.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state">
          <p>まだ日記がありません。<br>最初の日記を書きましょう！</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = posts
      .map(
        (post) => `
        <div class="card diary-card" data-id="${post.id}">
          <div class="diary-card-header">
            <div class="diary-card-date">${post.date || ''}</div>
            <button class="delete-btn" data-id="${post.id}" title="削除">&times;</button>
          </div>
          <div class="diary-card-jp">${escapeHTML(post.contentJp || '')}</div>
          ${post.contentEn ? `<div class="diary-card-en">${escapeHTML(post.contentEn)}</div>` : ''}
        </div>
      `
      )
      .join('');

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
          showToast('削除しました');
          if (!listEl.querySelector('.diary-card')) {
            listEl.innerHTML = `<div class="empty-state"><p>まだ日記がありません。<br>最初の日記を書きましょう！</p></div>`;
          }
        } catch (_err) {
          showToast('削除に失敗しました');
        }
      });
    });
  } catch (err) {
    console.error('Failed to fetch posts:', err);
    listEl.innerHTML = `
      <div class="empty-state">
        <p>日記の読み込みに失敗しました。</p>
      </div>
    `;
  }
}

function escapeHTML(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

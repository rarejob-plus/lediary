/**
 * Home page — diary list.
 */

import { api } from '../../api/client';
import { logout } from '../../auth';
import { navigate } from '../../router';

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
    <a href="/new" class="fab" title="新しい日記を書く">+</a>
  `;
}

export async function initHome(): Promise<void> {
  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    await logout();
    navigate('/login');
  });

  const listEl = document.getElementById('diary-list')!;

  try {
    const posts = await api.get<DiaryPost[]>('/diary/posts');

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
          <div class="diary-card-date">${post.date || ''}</div>
          <div class="diary-card-jp">${escapeHTML(post.contentJp || '')}</div>
          ${post.contentEn ? `<div class="diary-card-en">${escapeHTML(post.contentEn)}</div>` : ''}
        </div>
      `
      )
      .join('');

    listEl.querySelectorAll('.diary-card').forEach((card) => {
      card.addEventListener('click', () => {
        const id = (card as HTMLElement).dataset.id;
        navigate(`/post/${id}`);
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

import { navigate, render as routerRender } from '../router';
import { icons } from './icons';
import { getCurrentUser, loginWithGoogle, logout } from '../auth';

export function renderHeader(active: 'timeline' | 'calendar' | 'editor' | null): HTMLElement {
  const user = getCurrentUser();

  const header = document.createElement('header');
  header.className = 'app-chrome';
  header.innerHTML = `
    <div class="app-chrome-inner">
      <div class="brand" data-nav="/">Lediary</div>
      <nav class="app-nav">
        <button class="icon-btn ${active === 'timeline' ? 'active' : ''}" data-nav="/" title="タイムライン">${icons.pen(18)}</button>
        <button class="icon-btn ${active === 'calendar' ? 'active' : ''}" data-nav="/calendar" title="カレンダー">${icons.calendar(18)}</button>
        ${user
          ? `<button class="icon-btn" id="auth-btn" title="ログアウト (${escapeAttr(user.email || '')})">
              <img src="${escapeAttr(user.photoURL || '')}" alt="" style="width:24px;height:24px;border-radius:50%;" />
            </button>`
          : `<button class="btn btn-sm" id="auth-btn" style="margin-left:8px;">ログイン</button>`}
      </nav>
    </div>
  `;
  header.querySelectorAll('[data-nav]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      navigate((el as HTMLElement).dataset.nav!);
    });
  });

  const authBtn = header.querySelector('#auth-btn') as HTMLButtonElement | null;
  if (authBtn) {
    authBtn.addEventListener('click', async () => {
      if (user) {
        if (!confirm('ログアウトしますか？')) return;
        await logout();
        routerRender();
      } else {
        try {
          await loginWithGoogle();
          routerRender();
        } catch (e) {
          console.error(e);
          alert('ログインに失敗しました');
        }
      }
    });
  }

  return header;
}

export function renderFab(): HTMLElement {
  const a = document.createElement('button');
  a.className = 'fab';
  a.innerHTML = `${icons.plus(18)} <span>今日を書く</span>`;
  a.addEventListener('click', () => navigate('/editor'));
  return a;
}

function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

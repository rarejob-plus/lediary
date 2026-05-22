import { navigate, render as routerRender } from '../router';
import { icons } from './icons';
import { getCurrentUser, loginWithGoogle, logout } from '../auth';
import { getStoredTheme, nextTheme, setStoredTheme, type Theme } from './theme';

export function renderHeader(active: 'timeline' | 'calendar' | 'editor' | 'phrases' | 'quiz' | null): HTMLElement {
  const user = getCurrentUser();

  const header = document.createElement('header');
  header.className = 'app-chrome';
  header.innerHTML = `
    <div class="app-chrome-inner">
      <div class="brand" data-nav="/">Lediary</div>
      <nav class="app-nav">
        <button class="icon-btn ${active === 'timeline' ? 'active' : ''}" data-nav="/" title="タイムライン">${icons.pen(18)}</button>
        <button class="icon-btn ${active === 'phrases' ? 'active' : ''}" data-nav="/phrases" title="私のフレーズ集">${icons.sparkles(18)}</button>
        <button class="icon-btn ${active === 'quiz' ? 'active' : ''}" data-nav="/quiz" title="日記クイズ">${icons.graduation(18)}</button>
        <button class="icon-btn ${active === 'calendar' ? 'active' : ''}" data-nav="/calendar" title="カレンダー">${icons.calendar(18)}</button>
        <button class="icon-btn" id="theme-btn" title="${themeTitle(getStoredTheme())}">${themeIcon(getStoredTheme())}</button>
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

  const themeBtn = header.querySelector('#theme-btn') as HTMLButtonElement | null;
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const next = nextTheme(getStoredTheme());
      setStoredTheme(next);
      themeBtn.innerHTML = themeIcon(next);
      themeBtn.title = themeTitle(next);
    });
  }

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

export function renderFab(opts?: { label?: string; mode?: string }): HTMLElement {
  const a = document.createElement('button');
  a.className = 'fab';
  const label = opts?.label ?? '今日を書く';
  a.innerHTML = `${icons.pen(16)} <span>${label}</span>`;
  const target = opts?.mode ? `/editor?mode=${opts.mode}` : '/editor';
  a.addEventListener('click', () => navigate(target));
  return a;
}

function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function themeIcon(t: Theme): string {
  if (t === 'dark')  return icons.moon(18);
  if (t === 'auto')  return icons.monitor(18);
  return icons.sun(18);
}
function themeTitle(t: Theme): string {
  if (t === 'dark')  return 'テーマ: ダーク (タップで自動に)';
  if (t === 'auto')  return 'テーマ: 自動 (OS 設定に追従)';
  return 'テーマ: ライト (タップでダークに)';
}

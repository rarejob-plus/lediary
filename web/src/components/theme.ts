// テーマ管理: light / dark / auto (= OS の prefers-color-scheme に追従)。
// 設定は localStorage に保持し、<html data-theme="..."> で CSS 切替を駆動する。
//
// 起動時にできるだけ早く applyTheme() を呼ぶこと (FOUC を避ける)。

export type Theme = 'light' | 'dark' | 'auto';

const STORAGE_KEY = 'lediary_theme';

export function getStoredTheme(): Theme {
  const v = localStorage.getItem(STORAGE_KEY);
  return v === 'dark' || v === 'auto' ? v : 'light';
}

export function setStoredTheme(t: Theme): void {
  localStorage.setItem(STORAGE_KEY, t);
  applyTheme();
}

/** localStorage の設定 + OS の prefers-color-scheme から `<html data-theme>` を設定。 */
export function applyTheme(): void {
  const t = getStoredTheme();
  const html = document.documentElement;
  html.setAttribute('data-theme', t);
  if (t === 'auto') {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    html.setAttribute('data-resolved-theme', isDark ? 'dark' : 'light');
  } else {
    html.removeAttribute('data-resolved-theme');
  }
}

/** 次のテーマ (light → dark → auto → light → ...)。 */
export function nextTheme(current: Theme): Theme {
  if (current === 'light') return 'dark';
  if (current === 'dark') return 'auto';
  return 'light';
}

// auto 時に OS 切替へ自動追従。
if (typeof window !== 'undefined' && window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getStoredTheme() === 'auto') applyTheme();
  });
}

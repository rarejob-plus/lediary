import { navigate } from '../router';
import { icons } from './icons';

export function renderHeader(active: 'timeline' | 'calendar' | 'editor' | null): HTMLElement {
  const header = document.createElement('header');
  header.className = 'app-chrome';
  header.innerHTML = `
    <div class="app-chrome-inner">
      <div class="brand" data-nav="/">Lediary</div>
      <nav class="app-nav">
        <button class="icon-btn ${active === 'timeline' ? 'active' : ''}" data-nav="/" title="タイムライン">${icons.pen(18)}</button>
        <button class="icon-btn ${active === 'calendar' ? 'active' : ''}" data-nav="/calendar" title="カレンダー">${icons.calendar(18)}</button>
      </nav>
    </div>
  `;
  header.querySelectorAll('[data-nav]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      navigate((el as HTMLElement).dataset.nav!);
    });
  });
  return header;
}

export function renderFab(): HTMLElement {
  const a = document.createElement('button');
  a.className = 'fab';
  a.innerHTML = `${icons.plus(18)} <span>今日を書く</span>`;
  a.addEventListener('click', () => navigate('/editor'));
  return a;
}

export function renderMockBanner(): HTMLElement {
  const div = document.createElement('div');
  div.className = 'mock-banner';
  div.textContent = 'Mock';
  return div;
}

import { navigate } from '../router';
export function renderHeader(active) {
    const header = document.createElement('header');
    header.className = 'app-header';
    header.innerHTML = `
    <div class="brand" data-nav="/">Lediary</div>
    <nav class="nav">
      <a class="nav-link ${active === 'timeline' ? 'active' : ''}" data-nav="/">タイムライン</a>
      <a class="nav-link ${active === 'calendar' ? 'active' : ''}" data-nav="/calendar">カレンダー</a>
      <a class="nav-link ${active === 'editor' ? 'active' : ''}" data-nav="/editor">書く</a>
    </nav>
  `;
    header.querySelectorAll('[data-nav]').forEach((el) => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            navigate(el.dataset.nav);
        });
        el.style.cursor = 'pointer';
    });
    return header;
}
export function renderMockBanner() {
    const div = document.createElement('div');
    div.className = 'mock-banner';
    div.textContent = 'MOCK · No data is saved';
    return div;
}

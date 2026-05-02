import { renderTimeline } from './pages/timeline';
import { renderEditor } from './pages/editor';
import { renderEntry } from './pages/entry';
import { renderCalendar } from './pages/calendar';

export type Route =
  | { name: 'timeline' }
  | { name: 'editor' }
  | { name: 'entry'; id: string }
  | { name: 'calendar' };

function parseRoute(): Route {
  const path = location.pathname;
  if (path === '/' || path === '') return { name: 'timeline' };
  if (path === '/editor') return { name: 'editor' };
  if (path === '/calendar') return { name: 'calendar' };
  const m = path.match(/^\/entry\/(.+)$/);
  if (m) return { name: 'entry', id: m[1]! };
  return { name: 'timeline' };
}

export function navigate(path: string): void {
  history.pushState({}, '', path);
  render();
}

export function render(): void {
  const route = parseRoute();
  const root = document.getElementById('app')!;
  root.innerHTML = '';
  switch (route.name) {
    case 'timeline':
      renderTimeline(root);
      break;
    case 'editor':
      renderEditor(root);
      break;
    case 'entry':
      renderEntry(root, route.id);
      break;
    case 'calendar':
      renderCalendar(root);
      break;
  }
  window.scrollTo({ top: 0, behavior: 'instant' });
}

window.addEventListener('popstate', render);

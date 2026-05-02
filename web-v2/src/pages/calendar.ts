import { renderHeader, renderFab, renderMockBanner } from '../components/header';
import { icons } from '../components/icons';
import { MOCK_ENTRIES, MODE_META } from '../data/mock';
import { navigate } from '../router';

export function renderCalendar(root: HTMLElement): void {
  root.appendChild(renderHeader('calendar'));

  const today = new Date();
  let viewYear = today.getFullYear();
  let viewMonth = today.getMonth();

  const wrap = document.createElement('div');
  wrap.style.cssText = 'padding: 32px 24px 0;';
  root.appendChild(wrap);

  function render() {
    wrap.innerHTML = '';

    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;';
    head.innerHTML = `
      <div>
        <div style="font-family:var(--serif);font-size:24px;font-weight:600;letter-spacing:-0.01em;">${monthLabel(viewYear, viewMonth)}</div>
      </div>
      <div style="display:flex;gap:4px;">
        <button class="icon-btn" id="prev">${icons.chevronLeft(16)}</button>
        <button class="icon-btn" id="next">${icons.chevronRight(16)}</button>
      </div>
    `;
    wrap.appendChild(head);
    head.querySelector('#prev')!.addEventListener('click', () => {
      viewMonth--;
      if (viewMonth < 0) {
        viewMonth = 11;
        viewYear--;
      }
      render();
    });
    head.querySelector('#next')!.addEventListener('click', () => {
      viewMonth++;
      if (viewMonth > 11) {
        viewMonth = 0;
        viewYear++;
      }
      render();
    });

    const grid = document.createElement('div');
    grid.style.cssText = `
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 0;
      border-top: 1px solid var(--border);
      border-left: 1px solid var(--border);
    `;
    wrap.appendChild(grid);

    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    weekdays.forEach((w) => {
      const cell = document.createElement('div');
      cell.style.cssText = 'text-align:center;font-size:10px;color:var(--text-muted);font-weight:600;letter-spacing:0.08em;text-transform:uppercase;padding:10px 0;border-bottom:1px solid var(--border);border-right:1px solid var(--border);';
      cell.textContent = w;
      grid.appendChild(cell);
    });

    const firstDay = new Date(viewYear, viewMonth, 1).getDay();
    const lastDate = new Date(viewYear, viewMonth + 1, 0).getDate();

    const entriesByDate = new Map<string, typeof MOCK_ENTRIES>();
    for (const e of MOCK_ENTRIES) {
      if (!entriesByDate.has(e.date)) entriesByDate.set(e.date, []);
      entriesByDate.get(e.date)!.push(e);
    }

    for (let i = 0; i < firstDay; i++) {
      const empty = document.createElement('div');
      empty.style.cssText = 'aspect-ratio:1;border-bottom:1px solid var(--border);border-right:1px solid var(--border);background:var(--surface-warm);';
      grid.appendChild(empty);
    }

    for (let d = 1; d <= lastDate; d++) {
      const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayEntries = entriesByDate.get(dateStr);
      const isToday = d === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear();

      const cell = document.createElement('button');
      cell.style.cssText = `
        aspect-ratio: 1;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        justify-content: space-between;
        padding: 8px;
        background: ${dayEntries ? 'var(--surface)' : 'transparent'};
        border: none;
        border-bottom: 1px solid var(--border);
        border-right: 1px solid var(--border);
        cursor: ${dayEntries ? 'pointer' : 'default'};
        text-align: left;
        position: relative;
        transition: background 0.12s;
      `;

      cell.innerHTML = `
        <span style="font-size:13px;color:${isToday ? 'white' : 'var(--text)'};font-weight:${isToday ? '700' : '400'};${isToday ? 'background:var(--text);width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;' : ''}">${d}</span>
        ${dayEntries ? `
          <div style="display:flex;gap:3px;">
            ${dayEntries.map((e) => `<span style="width:5px;height:5px;border-radius:50%;background:${MODE_META[e.mode].color};display:inline-block;"></span>`).join('')}
          </div>
        ` : ''}
      `;

      if (dayEntries) {
        cell.addEventListener('click', () => navigate(`/entry/${dayEntries[0]!.id}`));
        cell.addEventListener('mouseenter', () => { cell.style.background = 'var(--surface-warm)'; });
        cell.addEventListener('mouseleave', () => { cell.style.background = 'var(--surface)'; });
      }

      grid.appendChild(cell);
    }

    const legend = document.createElement('div');
    legend.style.cssText = 'display:flex;gap:18px;margin-top:18px;font-size:12px;color:var(--text-muted);justify-content:center;flex-wrap:wrap;';
    (['morning', 'lesson', 'diary'] as const).forEach((m) => {
      const meta = MODE_META[m];
      legend.innerHTML += `
        <span style="display:inline-flex;align-items:center;gap:6px;">
          <span style="width:7px;height:7px;border-radius:50%;background:${meta.color};display:inline-block;"></span>
          ${meta.label}
        </span>
      `;
    });
    wrap.appendChild(legend);
  }

  render();
  root.appendChild(renderFab());
  root.appendChild(renderMockBanner());
}

function monthLabel(y: number, m: number): string {
  const d = new Date(y, m, 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

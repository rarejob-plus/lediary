import { renderHeader, renderMockBanner } from '../components/header';
import { MOCK_ENTRIES, MODE_META } from '../data/mock';
import { navigate } from '../router';
export function renderCalendar(root) {
    root.appendChild(renderHeader('calendar'));
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();
    const monthLabel = today.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long' });
    const wrap = document.createElement('div');
    wrap.innerHTML = `
    <h2 style="font-family:var(--serif);font-size:20px;margin-bottom:16px;">${monthLabel}</h2>
    <div class="cal-grid"></div>
  `;
    root.appendChild(wrap);
    const grid = wrap.querySelector('.cal-grid');
    grid.style.cssText = `
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 6px;
    background: var(--surface);
    padding: 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
  `;
    const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
    weekdays.forEach((w) => {
        const cell = document.createElement('div');
        cell.style.cssText = 'text-align:center;font-size:11px;color:var(--text-faint);font-weight:600;padding:4px 0;';
        cell.textContent = w;
        grid.appendChild(cell);
    });
    const firstDay = new Date(year, month, 1).getDay();
    const lastDate = new Date(year, month + 1, 0).getDate();
    for (let i = 0; i < firstDay; i++) {
        grid.appendChild(document.createElement('div'));
    }
    const entriesByDate = new Map();
    for (const e of MOCK_ENTRIES) {
        if (!entriesByDate.has(e.date))
            entriesByDate.set(e.date, []);
        entriesByDate.get(e.date).push(e);
    }
    for (let d = 1; d <= lastDate; d++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const cell = document.createElement('div');
        const isToday = d === today.getDate();
        cell.style.cssText = `
      aspect-ratio: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 3px;
      font-size: 13px;
      color: ${isToday ? 'var(--primary)' : 'var(--text)'};
      font-weight: ${isToday ? '700' : '400'};
      border-radius: var(--radius-sm);
      cursor: pointer;
      transition: background 0.1s;
    `;
        cell.textContent = String(d);
        const dayEntries = entriesByDate.get(dateStr);
        if (dayEntries) {
            const dots = document.createElement('div');
            dots.style.cssText = 'display:flex;gap:2px;';
            dayEntries.forEach((e) => {
                const dot = document.createElement('span');
                dot.style.cssText = `width:5px;height:5px;border-radius:50%;background:${MODE_META[e.mode].color};`;
                dots.appendChild(dot);
            });
            cell.appendChild(dots);
            cell.addEventListener('click', () => navigate(`/entry/${dayEntries[0].id}`));
            cell.addEventListener('mouseenter', () => {
                cell.style.background = 'var(--surface-soft)';
            });
            cell.addEventListener('mouseleave', () => {
                cell.style.background = '';
            });
        }
        grid.appendChild(cell);
    }
    const legend = document.createElement('div');
    legend.style.cssText = 'display:flex;gap:14px;margin-top:16px;font-size:12px;color:var(--text-muted);justify-content:center;flex-wrap:wrap;';
    ['morning', 'lesson', 'diary'].forEach((m) => {
        const meta = MODE_META[m];
        legend.innerHTML += `
      <span style="display:inline-flex;align-items:center;gap:4px;">
        <span style="width:7px;height:7px;border-radius:50%;background:${meta.color};display:inline-block;"></span>
        ${meta.label}
      </span>
    `;
    });
    root.appendChild(legend);
    root.appendChild(renderMockBanner());
}

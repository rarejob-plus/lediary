import { renderHeader, renderFab } from '../components/header';
import { icons } from '../components/icons';
import { MODE_META, type DiaryEntry } from '../data/mock';
import { fetchEntries } from '../data/entries';
import { fetchDays, type DayRating } from '../data/days';
import { navigate } from '../router';

export function renderCalendar(root: HTMLElement): void {
  root.appendChild(renderHeader('calendar'));

  const today = new Date();
  let viewYear = today.getFullYear();
  let viewMonth = today.getMonth();
  let entries: DiaryEntry[] = [];
  let days: Map<string, DayRating> = new Map();

  const wrap = document.createElement('div');
  wrap.className = 'ld-cal';
  wrap.innerHTML = `<p style="color:var(--ld-muted);text-align:center;padding:40px 0;font-size:13px;">読み込み中…</p>`;
  root.appendChild(wrap);

  Promise.all([fetchEntries(), fetchDays()])
    .then(([es, ds]) => {
      entries = es;
      days = ds;
      render();
    })
    .catch((err) => {
      console.error(err);
      wrap.innerHTML = `<p style="color:var(--ld-muted);text-align:center;padding:40px 0;">読み込みに失敗しました</p>`;
    });

  function render() {
    wrap.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'ld-cal__hd';
    head.innerHTML = `
      <div class="ld-cal__title">${monthLabel(viewYear, viewMonth)}</div>
      <div style="display:flex;gap:4px;">
        <button class="icon-btn" id="prev" aria-label="前の月">${icons.chevronLeft(16)}</button>
        <button class="icon-btn" id="next" aria-label="次の月">${icons.chevronRight(16)}</button>
      </div>
    `;
    wrap.appendChild(head);
    head.querySelector('#prev')!.addEventListener('click', () => {
      viewMonth--;
      if (viewMonth < 0) { viewMonth = 11; viewYear--; }
      render();
    });
    head.querySelector('#next')!.addEventListener('click', () => {
      viewMonth++;
      if (viewMonth > 11) { viewMonth = 0; viewYear++; }
      render();
    });

    const grid = document.createElement('div');
    grid.className = 'ld-cal__grid';
    wrap.appendChild(grid);

    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    weekdays.forEach((w) => {
      const cell = document.createElement('div');
      cell.className = 'ld-cal__wd';
      cell.textContent = w;
      grid.appendChild(cell);
    });

    const firstDay = new Date(viewYear, viewMonth, 1).getDay();
    const lastDate = new Date(viewYear, viewMonth + 1, 0).getDate();
    const prevMonthLast = new Date(viewYear, viewMonth, 0).getDate();

    const entriesByDate = new Map<string, DiaryEntry[]>();
    for (const e of entries) {
      if (!entriesByDate.has(e.date)) entriesByDate.set(e.date, []);
      entriesByDate.get(e.date)!.push(e);
    }

    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

    // 前月の埋め草（off-month）
    for (let i = firstDay - 1; i >= 0; i--) {
      const dNum = prevMonthLast - i;
      const cell = document.createElement('div');
      cell.className = 'ld-cal__cell ld-cal__cell--off';
      cell.innerHTML = `<span class="ld-cal__num">${dNum}</span>`;
      grid.appendChild(cell);
    }

    // 当月
    for (let d = 1; d <= lastDate; d++) {
      const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayEntries = entriesByDate.get(dateStr);
      const dayRating = days.get(dateStr);
      const isToday = d === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear();
      const cellTime = new Date(viewYear, viewMonth, d).getTime();
      const isFuture = cellTime > todayStart;
      const writable = !isFuture;
      const hasEntry = !!dayEntries && dayEntries.length > 0;

      const cell = document.createElement('button');
      const classes = ['ld-cal__cell'];
      if (isToday) classes.push('ld-cal__cell--today');
      if (hasEntry) classes.push('ld-cal__cell--has');
      if (isFuture) classes.push('ld-cal__cell--future');
      cell.className = classes.join(' ');
      cell.disabled = !writable;

      // 表示: 数字 + (score dots OR mode dots)
      let footer = '';
      if (dayRating) {
        // 1-10 score dots（accent）
        const dots: string[] = [];
        for (let i = 1; i <= 10; i++) {
          dots.push(`<span class="ld-cal__sdot ${i <= dayRating.score ? 'on' : ''}"></span>`);
        }
        footer = `<div class="ld-cal__dots ld-cal__dots--score">${dots.join('')}</div>`;
      } else if (hasEntry) {
        footer = `<div class="ld-cal__dots">${dayEntries.slice(0, 4).map((e) =>
          `<span class="ld-cal__mdot" data-id="${e.id}" title="${MODE_META[e.mode].label}" style="background:${MODE_META[e.mode].color};"></span>`,
        ).join('')}</div>`;
      }

      cell.innerHTML = `<span class="ld-cal__num">${d}</span>${footer}`;

      if (writable) {
        // エントリがある日は閲覧画面へ (timeline カード選択と同じ挙動)、無い日は新規作成 editor へ。
        // 1 日に複数 entry がある場合は最初の entry を開く (mode dots からの個別選択は別途）。
        const firstEntry = dayEntries?.[0];
        cell.addEventListener('click', () => {
          if (firstEntry) navigate(`/entry/${firstEntry.id}`);
          else navigate(`/editor?date=${dateStr}`);
        });
        cell.querySelectorAll('.ld-cal__mdot').forEach((dot) => {
          dot.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = (dot as HTMLElement).dataset.id;
            if (id) navigate(`/entry/${id}`);
          });
        });
      }

      grid.appendChild(cell);
    }

    // 翌月の埋め草 (7 × 6 = 42 セル想定で残り)
    const placed = firstDay + lastDate;
    const trailing = (7 - (placed % 7)) % 7;
    for (let i = 1; i <= trailing; i++) {
      const cell = document.createElement('div');
      cell.className = 'ld-cal__cell ld-cal__cell--off';
      cell.innerHTML = `<span class="ld-cal__num">${i}</span>`;
      grid.appendChild(cell);
    }

    const legend = document.createElement('div');
    legend.className = 'ld-cal__legend';
    (['morning', 'lesson', 'diary', 'story'] as const).forEach((m) => {
      const meta = MODE_META[m];
      legend.innerHTML += `
        <span class="ld-cal__legend-item">
          <span class="ld-cal__legend-dot" style="background:${meta.color};"></span>
          ${meta.label}
        </span>
      `;
    });
    wrap.appendChild(legend);
  }

  root.appendChild(renderFab());
}

function monthLabel(y: number, m: number): string {
  const d = new Date(y, m, 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

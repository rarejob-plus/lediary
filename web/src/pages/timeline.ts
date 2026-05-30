import { renderHeader, renderFab } from '../components/header';
import { icons } from '../components/icons';
import { coverFor } from '../components/cover';
import { ratingColor } from '../components/day-rating-row';
import { openDayRatingModal } from '../components/day-rating-modal';
import { MODE_META, type DiaryEntry, type Mode } from '../data/mock';
import { fetchEntries } from '../data/entries';
import { fetchDays, type DayRating } from '../data/days';
import { ensurePickAudioUrl } from '../data/picksAudio';
import { savePostPick } from '../data/posts';
import { renderSekkiInline, dayOfYear, daysInYear } from '../data/dateInfo';
import { navigate } from '../router';

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dateToStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 連続して書いた日数。今日まだ書いていない場合は昨日を起点（書くまで途切れさせない）
function computeStreak(entries: DiaryEntry[]): number {
  if (entries.length === 0) return 0;
  const dates = new Set(entries.map((e) => e.date));
  const cursor = new Date();
  if (!dates.has(dateToStr(cursor))) cursor.setDate(cursor.getDate() - 1);
  let count = 0;
  while (dates.has(dateToStr(cursor))) {
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

// 直近 7 日（古い → 新しい順）の埋まり方。`isToday` は今日のドットを ring 装飾する用。
function computeLastSevenDays(entries: DiaryEntry[]): { date: string; filled: boolean; isToday: boolean }[] {
  const dates = new Set(entries.map((e) => e.date));
  const today = new Date();
  const todayStr = dateToStr(today);
  const out: { date: string; filled: boolean; isToday: boolean }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const s = dateToStr(d);
    out.push({ date: s, filled: dates.has(s), isToday: s === todayStr });
  }
  return out;
}

function dayHeaderParts(dateStr: string): { num: string; weekday: string; monthYear: string } {
  const d = new Date(dateStr + 'T00:00:00');
  return {
    num: String(d.getDate()),
    weekday: d.toLocaleDateString('en-US', { weekday: 'long' }),
    monthYear: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
  };
}

export function renderTimeline(root: HTMLElement): void {
  root.appendChild(renderHeader('timeline'));

  const wrap = document.createElement('div');
  wrap.className = 'timeline';
  wrap.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:40px 0;font-size:13px;">読み込み中…</p>`;
  root.appendChild(wrap);
  root.appendChild(renderFab());

  Promise.all([fetchEntries(), fetchDays()])
    .then(([entries, days]) => {
      renderBody(wrap, entries, days);
      // FloatingTodayCta: 既存 FAB を「次の未完了モード」ラベルに差し替える。
      const today = todayStr();
      const doneModes = new Set(entries.filter((e) => e.date === today).map((e) => e.mode));
      const next = (['morning', 'lesson', 'diary', 'story'] as Mode[]).find((m) => !doneModes.has(m));
      if (next) {
        const old = root.querySelector('.fab');
        if (old) old.remove();
        const label = `今日の ${MODE_META[next].label} を書く`;
        root.appendChild(renderFab({ label, mode: next }));
      }
    })
    .catch((err) => {
      console.error(err);
      wrap.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:40px 0;">読み込みに失敗しました</p>`;
    });
}

function renderBody(wrap: HTMLElement, entries: DiaryEntry[], days: Map<string, DayRating>): void {
  wrap.innerHTML = '';

  // 新規ユーザー向け: まだ entry 0 件なら、方法説明バナーを最上部に出す。
  // 1 件でも書けば自動で消える (関数の再 render に任せる)。
  if (entries.length === 0) {
    wrap.appendChild(renderOnboardingBanner());
  }

  // Top row: today label
  const streak = computeStreak(entries);
  const topRow = document.createElement('div');
  topRow.className = 'timeline-top-row';
  topRow.innerHTML = `<span class="timeline-today-label">${formatYmd(new Date())}</span>`;
  wrap.appendChild(topRow);

  // Streak strip: 直近 7 日のドット列 + 連続日数を serif で大きく。Day One 風。
  const week = computeLastSevenDays(entries);
  const streakStrip = document.createElement('div');
  streakStrip.className = 'streak-strip';
  streakStrip.innerHTML = `
    <div class="streak-strip-week">
      ${week.map((d) => `
        <span class="streak-day ${d.filled ? 'filled' : 'empty'} ${d.isToday ? 'is-today' : ''}"
              title="${d.date}${d.filled ? ' · 書いた' : ''}">
          ${d.filled ? icons.check(11) : ''}
        </span>
      `).join('')}
    </div>
    <div class="streak-strip-num">
      <span class="streak-num">${streak}</span>
      <span class="streak-label">${streak === 1 ? '日連続' : streak === 0 ? '今日から始めよう' : '日連続'}</span>
    </div>
  `;
  wrap.appendChild(streakStrip);

  // Today's 4-mode cards
  const today = todayStr();
  const todayEntries = entries.filter((e) => e.date === today);
  const todayByMode = new Map(todayEntries.map((e) => [e.mode, e]));

  const todayRow = document.createElement('div');
  todayRow.className = 'today-row';
  const modeSubtitle: Record<Mode, string> = {
    morning: '今日の予定・意気込み',
    lesson: 'レッスンの振り返り',
    diary: '一日の終わりの日記',
    story: 'エピソード・小話',
  };
  (['morning', 'lesson', 'diary', 'story'] as Mode[]).forEach((m) => {
    const meta = MODE_META[m];
    const filled = todayByMode.get(m);
    const card = document.createElement('button');
    card.className = `today-card ${filled ? 'filled' : ''}`;
    const statusLabel = filled ? '書いた' : 'まだ書いていない';
    const statusInner = filled
      ? icons.check(12)
      : '';
    card.innerHTML = `
      <div class="today-card-row">
        <span class="today-card-icon">${iconFor(meta.icon, 17)}</span>
        <span class="today-card-status ${filled ? 'done' : 'todo'}"
              role="img" aria-label="${statusLabel}" title="${statusLabel}">${statusInner}</span>
      </div>
      <div class="today-card-title">${meta.label}</div>
      <div class="today-card-sub">${modeSubtitle[m]}</div>
    `;
    card.addEventListener('click', () => {
      if (filled) {
        navigate(`/entry/${filled.id}`);
      } else {
        navigate(`/editor?mode=${m}`);
      }
    });
    todayRow.appendChild(card);
  });
  wrap.appendChild(todayRow);

  // Group entries by date (今日も含めて履歴に表示する — Today 行はステータス、履歴は内容)
  const groups = new Map<string, DiaryEntry[]>();
  for (const e of entries) {
    if (!groups.has(e.date)) groups.set(e.date, []);
    groups.get(e.date)!.push(e);
  }

  // 直近 INITIAL_LIMIT 件まで初期描画 — 履歴増加に伴う cover 画像ロードの肥大化を防ぐ。
  // 残りは「もっと見る」で1回で展開する。
  const INITIAL_LIMIT = 10;
  const groupArr = Array.from(groups.entries());
  let cutoff = groupArr.length;
  let acc = 0;
  for (let i = 0; i < groupArr.length; i++) {
    acc += groupArr[i]![1].length;
    if (acc >= INITIAL_LIMIT) {
      cutoff = i + 1;
      break;
    }
  }
  for (let i = 0; i < cutoff; i++) {
    const [date, dayEntries] = groupArr[i]!;
    wrap.appendChild(renderDay(date, dayEntries, days));
  }

  if (cutoff < groupArr.length) {
    const moreBtn = document.createElement('button');
    moreBtn.className = 'timeline-more-btn';
    moreBtn.type = 'button';
    moreBtn.textContent = 'もっと見る';
    moreBtn.addEventListener('click', () => {
      const frag = document.createDocumentFragment();
      for (let i = cutoff; i < groupArr.length; i++) {
        const [date, dayEntries] = groupArr[i]!;
        frag.appendChild(renderDay(date, dayEntries, days));
      }
      moreBtn.replaceWith(frag);
    });
    wrap.appendChild(moreBtn);
  }

  if (entries.length === 0) {
    const empty = document.createElement('p');
    empty.style.cssText = 'color:var(--text-muted);text-align:center;padding:40px 0;font-style:italic;';
    empty.textContent = 'まだエントリがありません。今日のひとことから始めましょう。';
    wrap.appendChild(empty);
  }
}

function renderDay(date: string, dayEntries: DiaryEntry[], days: Map<string, DayRating>): HTMLElement {
  const day = document.createElement('div');
  day.className = 'timeline-day';

  const parts = dayHeaderParts(date);
  const rating = days.get(date);
  const score = rating?.score ?? 0;
  const noteText = rating?.note ?? '';
  const tint = ratingColor(score);
  const numStyle = tint ? ` style="color:${tint};"` : '';
  const noteHint = noteText ? ` · ${noteText}` : '';
  const ariaLabel = score > 0
    ? `${parts.num}日 · 充実度 ${score}/10${noteHint}`
    : `${parts.num}日 · 充実度を記録`;

  const header = document.createElement('div');
  header.className = 'timeline-day-header';
  header.innerHTML = `
    <button type="button" class="timeline-day-num" title="${escapeAttr(ariaLabel)}" aria-label="${escapeAttr(ariaLabel)}"${numStyle}>${parts.num}</button>
    <div class="timeline-day-meta">
      <strong>${parts.weekday}</strong>
      <span>${parts.monthYear}</span>
    </div>
  `;
  day.appendChild(header);

  // 日付数字タップ → rating modal。「点 10 個」UI は廃止し、数字の色が充実度を語る。
  const numEl = header.querySelector('.timeline-day-num') as HTMLButtonElement;
  numEl.addEventListener('click', () => {
    openDayRatingModal({
      date,
      score: score > 0 ? score : 5,
      initialNote: noteText,
      onSaved: (saved) => {
        if (saved) days.set(date, saved); else days.delete(date);
        const next = days.get(date);
        const nextScore = next?.score ?? 0;
        const nextTint = ratingColor(nextScore);
        numEl.style.color = nextTint || '';
        const nextNote = next?.note ?? '';
        const nextHint = nextNote ? ` · ${nextNote}` : '';
        const nextAria = nextScore > 0
          ? `${parts.num}日 · 充実度 ${nextScore}/10${nextHint}`
          : `${parts.num}日 · 充実度を記録`;
        numEl.title = nextAria;
        numEl.setAttribute('aria-label', nextAria);
      },
    });
  });

  for (const entry of dayEntries) {
    const meta = MODE_META[entry.mode];
    const card = document.createElement('button');
    card.className = 'entry-card';
    card.innerHTML = `
      <div class="entry-cover" style="background:${entry.cover ?? coverFor(entry.mode, entry.time, entry.coverImageUrl)};"></div>
      <div class="entry-card-body">
        <div class="ld-meta entry-card-meta">
          <span class="ld-meta__item ld-meta__item--accent"><span class="ld-meta__icon">${iconFor(meta.icon, 12)}</span>${meta.label}</span>
          <span class="ld-meta__item">${renderSekkiInline(entry.date)}</span>
          <span class="ld-meta__item">${dayOfYear(entry.date)} / ${daysInYear(entry.date)}</span>
          ${entry.mood ? `<span class="ld-meta__item">${escapeHtml(entry.mood)}</span>` : ''}
          <span class="ld-meta__item">${entry.time}</span>
        </div>
        ${entry.pick ? `
          <p class="entry-card-pick">
            <button type="button" class="entry-card-pick-play" aria-label="再生" title="再生">${icons.play(14)}</button>
            <span class="entry-card-pick-text">${escapeHtml(entry.pick.text)}</span>
          </p>
          ${entry.pick.note ? `<p class="entry-card-pick-note">${escapeHtml(entry.pick.note)}</p>` : ''}
        ` : `
          <p class="entry-card-text">${escapeHtml(entry.userTranslation || entry.contentJp)}</p>
          <p class="entry-card-pick-empty">今日の 1 フレーズ未選定</p>
        `}
      </div>
    `;
    card.addEventListener('click', () => navigate(`/entry/${entry.id}`));

    // 1 フレーズの quick play: カードナビと干渉しないよう stopPropagation。
    // 1 タップ目で生成済 audio を再生、再生中タップで停止。
    const playBtn = card.querySelector<HTMLButtonElement>('.entry-card-pick-play');
    if (playBtn && entry.pick) {
      const pick = entry.pick;
      const audio = new Audio();
      audio.preservesPitch = true;
      let busy = false;
      const setPlayIcon = () => { playBtn.innerHTML = icons.play(14); };
      const setPauseIcon = () => { playBtn.innerHTML = icons.pause(14); };
      audio.addEventListener('ended', () => setPlayIcon());
      audio.addEventListener('pause', () => setPlayIcon());
      playBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!audio.paused) { audio.pause(); audio.currentTime = 0; return; }
        if (busy) return;
        busy = true;
        playBtn.classList.add('entry-card-pick-play--loading');
        try {
          const url = await ensurePickAudioUrl({
            pickId: pick.id,
            text: pick.text,
            audioPath: pick.audioPath,
            audioVoice: pick.audioVoice,
            onPersisted: async (path, voice) => {
              // 初回生成時に Firestore にも audioPath を焼き込んで、次回以降は fetch だけで済むように。
              pick.audioPath = path;
              pick.audioVoice = voice;
              await savePostPick(entry.id, pick);
            },
          });
          audio.src = url;
          setPauseIcon();
          await audio.play();
        } catch (err) {
          console.error('[timeline] quick play failed', err);
        } finally {
          playBtn.classList.remove('entry-card-pick-play--loading');
          busy = false;
        }
      });
    }

    day.appendChild(card);
  }

  return day;
}

function iconFor(name: 'sun' | 'graduation' | 'moon' | 'bookOpen', size = 11): string {
  if (name === 'sun') return icons.sun(size);
  if (name === 'graduation') return icons.graduation(size);
  if (name === 'bookOpen') return icons.bookOpen(size);
  return icons.moon(size);
}

function formatYmd(d: Date): string {
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

function escapeAttr(s: string | undefined | null): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function escapeHtml(s: string | undefined | null): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** 新規ユーザー向け 1 画面オンボーディング。entries 0 件のとき timeline 最上部に表示。 */
function renderOnboardingBanner(): HTMLElement {
  const el = document.createElement('section');
  el.className = 'onboarding-banner';
  el.innerHTML = `
    <h2 class="onboarding-banner-title">英語日記、続けるためのアプリ</h2>
    <p class="onboarding-banner-sub">
      「英語日記 BOY」流で、毎日の出来事を英語に。<br>
      ChatGPT に書かせず、<strong>自分で書く</strong>。AI は指摘と添削だけ。
    </p>
    <ol class="onboarding-steps">
      <li><span class="onboarding-step-n">1</span><div><strong>日本語で書く</strong><span>気分が乗らない日も、1〜3 行で OK。</span></div></li>
      <li><span class="onboarding-step-n">2</span><div><strong>英語にする</strong><span>ヒントを見ながら、自分の手で。</span></div></li>
      <li><span class="onboarding-step-n">3</span><div><strong>AI が添削</strong><span>添削を読んで、自分で書き直す。</span></div></li>
      <li><span class="onboarding-step-n">4</span><div><strong>1 フレーズを覚える</strong><span>シャドーイングして口に染み込ませる。</span></div></li>
    </ol>
    <p class="onboarding-banner-cta-hint">↓ 下のモードカードから今日の 1 つを選んで書き始められます。</p>
  `;
  return el;
}

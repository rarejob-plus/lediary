import { renderHeader } from '../components/header';
import { icons } from '../components/icons';
import { coverFor } from '../components/cover';
import { MODE_META, type DiaryEntry, type PickedPhrase } from '../data/mock';
import { deleteEntry, fetchEntry, invalidateEntriesCache, moveEntryMode, stashForEditor } from '../data/entries';
import { renderSekkiInline, dayOfYear, daysInYear } from '../data/dateInfo';
import { getCurrentUser, getIdToken } from '../auth';
import { navigate } from '../router';
import { enableTextSelectionBookmark, bookmarkPhrase } from '../components/text-selection-bookmark';
import { correctExpansionAnswer, generateExpansionQuestions, generateLessonSheetContent, generateShareId } from '../llm-diary';
import { savePostTextOnly, savePostPicks } from '../data/posts';
import { createShadowingPlayer } from '../components/shadowing-player';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';

export function renderEntry(root: HTMLElement, id: string): void {
  root.appendChild(renderHeader(null));

  const placeholder = document.createElement('p');
  placeholder.style.cssText = 'color:var(--text-muted);text-align:center;padding:60px 24px;font-size:13px;';
  placeholder.textContent = '読み込み中…';
  root.appendChild(placeholder);

  fetchEntry(id).then((entry) => {
    placeholder.remove();
    if (!entry) {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'padding: 32px 24px;';
      wrap.innerHTML = `
        <button class="btn btn-sm" id="back">${icons.chevronLeft(14)} 戻る</button>
        <p style="margin-top:18px;color:var(--text-muted);">エントリが見つかりませんでした</p>
      `;
      wrap.querySelector('#back')!.addEventListener('click', () => navigate('/'));
      root.appendChild(wrap);
      return;
    }
    renderEntryBody(root, entry);
  }).catch((err) => {
    placeholder.textContent = '読み込みに失敗しました';
    console.error(err);
  });
}

function renderEntryBody(root: HTMLElement, entry: DiaryEntry): void {
  const meta = MODE_META[entry.mode];
  const d = new Date(entry.date + 'T00:00:00');
  // remove placeholder/banner so we can append in order, banner re-added at end

  // Hero
  const hero = document.createElement('div');
  hero.className = 'entry-hero';
  hero.style.background = entry.cover ?? coverFor(entry.mode, entry.time, entry.coverImageUrl);
  hero.innerHTML = `
    <div class="entry-hero-fade"></div>
    <div class="entry-hero-overlay">
      <h1 class="entry-hero-title">${escapeHtml(deriveHeroTitle(entry))}</h1>
      <div class="ld-meta ld-meta--on-cover entry-hero-meta">
        <span class="ld-meta__item ld-meta__item--accent"><span class="ld-meta__icon">${iconFor(meta.icon, 12)}</span>${meta.label}</span>
        <span class="ld-meta__item">${renderSekkiInline(entry.date)}</span>
        <span class="ld-meta__item">${dayOfYear(entry.date)} / ${daysInYear(entry.date)}</span>
        ${entry.mood ? `<span class="ld-meta__item">${escapeHtml(entry.mood)}</span>` : ''}
      </div>
    </div>
    ${entry.coverImageUrl && entry.coverPhotographer ? `
      <div class="entry-hero-credit">
        Photo by <a href="${escapeHtml(entry.coverPhotographerUrl || '#')}?utm_source=lediary&utm_medium=referral" target="_blank" rel="noopener">${escapeHtml(entry.coverPhotographer)}</a>
        on <a href="https://unsplash.com/?utm_source=lediary&utm_medium=referral" target="_blank" rel="noopener">Unsplash</a>
      </div>
    ` : ''}
  `;
  root.appendChild(hero);

  // Content
  const content = document.createElement('div');
  content.className = 'entry-content';

  const dateBlock = document.createElement('div');
  dateBlock.className = 'entry-date-block';
  dateBlock.innerHTML = `
    <div class="entry-date-num">${d.getDate()}</div>
    <div class="entry-date-meta">
      <strong>${d.toLocaleDateString('en-US', { weekday: 'long' })}</strong>
      <span>${d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} · ${entry.time}</span>
    </div>
  `;
  content.appendChild(dateBlock);

  const actions = document.createElement('div');
  actions.className = 'entry-actions';
  actions.innerHTML = `
    <button class="btn btn-sm" id="edit">${icons.pencil(14)} 編集</button>
    <button class="btn btn-sm" id="redo">もう一度添削</button>
    <button class="btn btn-sm" id="flow">流れを整える</button>
    <button class="btn btn-sm" id="sheet">${icons.share(14)} レッスンシート</button>
    <button class="btn btn-sm" id="movemode">モード変更</button>
    <button class="btn btn-sm btn-ghost danger" id="del" title="削除">${icons.trash(14)}</button>
  `;
  actions.querySelector('#edit')!.addEventListener('click', () => {
    stashForEditor(entry);
    navigate(`/editor?date=${entry.date}&mode=${entry.mode}`);
  });
  actions.querySelector('#redo')!.addEventListener('click', () => {
    stashForEditor(entry);
    navigate(`/editor?date=${entry.date}&mode=${entry.mode}&action=correct`);
  });
  actions.querySelector('#flow')!.addEventListener('click', () => {
    stashForEditor(entry);
    navigate(`/editor?date=${entry.date}&mode=${entry.mode}&action=flow`);
  });
  const sheetBtn = actions.querySelector('#sheet') as HTMLButtonElement;
  if (entry.lessonSheetId) {
    sheetBtn.innerHTML = `${icons.share(14)} シートを開く`;
  }
  sheetBtn.addEventListener('click', async () => {
    if (!getCurrentUser()) {
      alert('ログインが必要です');
      return;
    }
    if (entry.lessonSheetId) {
      window.open(`https://lediary.web.app/s/${entry.lessonSheetId}`, '_blank');
      return;
    }
    const original = sheetBtn.innerHTML;
    sheetBtn.disabled = true;
    sheetBtn.textContent = '作成中…';
    try {
      const shareId = await createLessonSheet(entry);
      entry.lessonSheetId = shareId;
      sheetBtn.innerHTML = `${icons.share(14)} シートを開く`;
      sheetBtn.disabled = false;
      invalidateEntriesCache();
      const url = `https://lediary.web.app/s/${shareId}`;
      window.open(url, '_blank');
      navigator.clipboard?.writeText(url).catch(() => {});
    } catch (err) {
      console.error(err);
      alert('レッスンシート作成に失敗しました');
      sheetBtn.disabled = false;
      sheetBtn.innerHTML = original;
    }
  });
  actions.querySelector('#movemode')!.addEventListener('click', async () => {
    const user = getCurrentUser();
    if (!user) {
      alert('ログインが必要です');
      return;
    }
    const others = (['morning', 'lesson', 'diary', 'story'] as const).filter((m) => m !== entry.mode);
    const choice = prompt(`どのモードに移しますか？\n${others.map((m, i) => `${i + 1}. ${MODE_META[m].label}`).join('\n')}\n\n番号を入力 (1-${others.length})`);
    if (!choice) return;
    const idx = parseInt(choice, 10) - 1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= others.length) {
      alert('番号が正しくありません');
      return;
    }
    const targetMode = others[idx]!;
    const targetId = `${user.uid}_${entry.date}_${targetMode}`;
    // 移動先に既にエントリがあれば中止
    const existingTarget = await fetchEntry(targetId);
    if (existingTarget && (existingTarget.contentJp || existingTarget.userTranslation)) {
      alert(`${MODE_META[targetMode].label} には既にエントリがあります。先に削除してください。`);
      return;
    }
    if (!confirm(`このエントリを ${MODE_META[entry.mode].label} → ${MODE_META[targetMode].label} に移しますか？`)) return;
    const moveBtn = actions.querySelector('#movemode') as HTMLButtonElement;
    moveBtn.disabled = true;
    moveBtn.textContent = '移動中…';
    try {
      const res = await moveEntryMode(entry.id, targetMode);
      navigate(`/entry/${res.id || targetId}`);
    } catch (err) {
      console.error(err);
      alert('モード変更に失敗しました');
      moveBtn.disabled = false;
      moveBtn.textContent = 'モード変更';
    }
  });
  actions.querySelector('#del')!.addEventListener('click', async () => {
    if (!confirm('この日記を削除しますか？元に戻せません。')) return;
    const delBtn = actions.querySelector('#del') as HTMLButtonElement;
    delBtn.disabled = true;
    try {
      if (getCurrentUser()) {
        await deleteEntry(entry.id);
      }
      navigate('/');
    } catch (err) {
      console.error(err);
      alert('削除に失敗しました');
      delBtn.disabled = false;
    }
  });
  content.appendChild(actions);

  const jp = document.createElement('div');
  jp.className = 'entry-jp';
  jp.textContent = entry.contentJp;
  content.appendChild(jp);

  // 本文 + 下にコンパクトな TTS プレイヤー（再生 + 速度プリセット）
  const body = document.createElement('div');
  body.className = 'entry-body';
  body.textContent = entry.userTranslation;
  content.appendChild(body);
  if (entry.userTranslation) {
    content.appendChild(renderTTSPlayer(entry.userTranslation));
  }
  enableTextSelectionBookmark(body);

  // 英語日記 BOY 流: 添削後にユーザーが「覚えたい 1 フレーズ」を選び、専用シャドーイング
  appendSection(content, '今日の 1 フレーズ', renderPicksSection(entry), true);
  appendSection(content, '覚えたいフレーズ', renderVocabSection(entry.vocabulary), false);
  appendSection(content, '日記を膨らませる', renderExpansionSection(entry, body), false);

  root.appendChild(content);
}

function appendSection(parent: HTMLElement, title: string, body: HTMLElement, openByDefault: boolean): void {
  const sec = document.createElement('div');
  sec.className = 'section';
  const header = document.createElement('div');
  header.className = 'section-header';
  header.innerHTML = `
    <span class="section-title">${title}</span>
    <span class="section-chevron ${openByDefault ? 'open' : ''}">${icons.chevronDown(16)}</span>
  `;
  sec.appendChild(header);
  body.classList.add('section-body');
  if (openByDefault) body.classList.add('open');
  sec.appendChild(body);
  header.addEventListener('click', () => {
    body.classList.toggle('open');
    header.querySelector('.section-chevron')!.classList.toggle('open');
  });
  parent.appendChild(sec);
}

/** 英語日記 BOY 流「今日の 1 フレーズ」セクション。
 *  添削後のユーザー本文から覚えたいフレーズをピックし、専用シャドーイング player で繰り返す。
 *  各 pick は post.picks に永続化される。 */
function renderPicksSection(entry: DiaryEntry): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'picks-section';

  // ローカル mutable コピー。Firestore への保存はその都度 savePostPicks に委譲。
  const picks: PickedPhrase[] = Array.isArray(entry.picks) ? [...entry.picks] : [];

  const intro = document.createElement('p');
  intro.className = 'picks-intro';
  intro.textContent = '言えるようになりたい 1 フレーズを選んで、TTS でシャドーイング。';
  wrap.appendChild(intro);

  // 入力フォーム: 「本文から選ぶ」「自由入力」の 2 経路
  const form = document.createElement('div');
  form.className = 'picks-form';
  const sentences = splitIntoPickableSentences(entry.userTranslation || '');
  form.innerHTML = `
    ${sentences.length > 0 ? `
      <select class="picks-form-select" aria-label="本文から選ぶ">
        <option value="">— 本文の文から選ぶ —</option>
        ${sentences.map((s, i) => `<option value="${escapeAttr(s)}">${i + 1}. ${escapeHtml(s.length > 60 ? s.slice(0, 58) + '…' : s)}</option>`).join('')}
      </select>
    ` : ''}
    <textarea name="pick-text" class="picks-form-text" rows="2" placeholder="または自分で入力（添削後の英文を直接コピー可）"></textarea>
    <textarea name="pick-note" class="picks-form-note" rows="1" placeholder="日本語メモ（任意）— 何を言いたかったか"></textarea>
    <button class="btn btn-primary picks-form-btn" type="button">${icons.plus(14)} このフレーズを追加</button>
  `;
  wrap.appendChild(form);

  const list = document.createElement('div');
  list.className = 'picks-list';
  wrap.appendChild(list);

  function renderList(): void {
    if (picks.length === 0) {
      list.innerHTML = '<p class="expansion-empty">まだピックしていません。</p>';
      return;
    }
    list.innerHTML = '';
    picks.forEach((p, idx) => {
      const card = renderSinglePick(entry.id, p, idx, () => {
        picks.splice(idx, 1);
        void savePostPicks(entry.id, picks);
        renderList();
      }, async (delta) => {
        // shadowingCount の累積（再生終了時にインクリメント）+ SRS 用に lastShadowedAt を更新
        p.shadowingCount = (p.shadowingCount || 0) + delta;
        p.lastShadowedAt = Date.now();
        await savePostPicks(entry.id, picks);
      });
      list.appendChild(card);
    });
  }
  renderList();

  const selectEl = form.querySelector('.picks-form-select') as HTMLSelectElement | null;
  const textEl = form.querySelector('.picks-form-text') as HTMLTextAreaElement;
  const noteEl = form.querySelector('.picks-form-note') as HTMLTextAreaElement;
  const btnEl = form.querySelector('.picks-form-btn') as HTMLButtonElement;

  if (selectEl) {
    selectEl.addEventListener('change', () => {
      if (selectEl.value) textEl.value = selectEl.value;
    });
  }

  btnEl.addEventListener('click', async () => {
    const text = textEl.value.trim();
    if (!text) {
      alert('フレーズを入力してください');
      return;
    }
    const pick: PickedPhrase = {
      id: cryptoRandomId(),
      text,
      note: noteEl.value.trim() || undefined,
      createdAt: Date.now(),
      shadowingCount: 0,
    };
    picks.push(pick);
    btnEl.disabled = true;
    try {
      await savePostPicks(entry.id, picks);
      textEl.value = '';
      noteEl.value = '';
      if (selectEl) selectEl.value = '';
      renderList();
    } catch (e) {
      console.error('[picks] save failed', e);
      alert('保存に失敗しました');
      picks.pop();
    } finally {
      btnEl.disabled = false;
    }
  });

  return wrap;
}

/** 1 件分の pick の表示 + シャドーイング player。 */
function renderSinglePick(
  _entryId: string,
  pick: PickedPhrase,
  index: number,
  onDelete: () => void,
  onShadowed: (delta: number) => void | Promise<void>,
): HTMLElement {
  const card = document.createElement('div');
  card.className = 'pick-card';
  card.innerHTML = `
    <div class="pick-card-head">
      <span class="pick-card-num">#${index + 1}</span>
      <button class="pick-card-del" title="削除" aria-label="削除">${icons.trash(14)}</button>
    </div>
    <p class="pick-card-text">${escapeHtml(pick.text)}</p>
    ${pick.note ? `<p class="pick-card-note">${escapeHtml(pick.note)}</p>` : ''}
  `;
  card.querySelector('.pick-card-del')!.addEventListener('click', () => {
    if (confirm('この 1 フレーズを削除しますか?')) onDelete();
  });
  card.appendChild(
    createShadowingPlayer({
      text: pick.text,
      initialCount: pick.shadowingCount || 0,
      classPrefix: 'pick',
      onShadowed,
    }),
  );
  return card;
}

/** 本文を「pickable な文」に分解（. ! ? . で区切る、空白除く）。 */
function splitIntoPickableSentences(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  const re = /[^.!?]+[.!?]?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const s = m[0].trim();
    if (s.length >= 4) out.push(s);
  }
  return out;
}

function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return (crypto as Crypto).randomUUID();
  return `pick-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function renderVocabSection(vocab: { word: string; definition: string; example: string }[]): HTMLElement {
  const wrap = document.createElement('div');
  if (vocab.length === 0) {
    wrap.innerHTML = `<p class="expansion-empty">記録されたフレーズはありません</p>`;
    return wrap;
  }
  vocab.forEach((v) => {
    const row = document.createElement('div');
    row.className = 'vocab-row';
    row.innerHTML = `
      <span class="vocab-en">${escapeHtml(v.word)}</span>
      <button class="vocab-flashcard-btn">Flashcard</button>
      <span class="vocab-ja">${escapeHtml(v.definition)}</span>
      <span class="vocab-example">${escapeHtml(v.example)}</span>
    `;
    const btn = row.querySelector('.vocab-flashcard-btn') as HTMLButtonElement;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = '...';
      await bookmarkPhrase(v.word, v.definition);
      btn.textContent = '✓ 保存済';
    });
    wrap.appendChild(row);
  });
  enableTextSelectionBookmark(wrap);
  return wrap;
}

// 英文下に置くコンパクトな音声プレイヤー。
// 再生ボタン + 速度プリセット (0.75/1.0/1.25/1.5x)。
// 初回クリックで TTS 生成 → 再生、以降は同じバッファを使い回し。
const TTS_SPEEDS = [0.75, 1.0, 1.25, 1.5] as const;
const TTS_SPEED_KEY = 'lediary_v2_tts_speed';

function renderTTSPlayer(text: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'entry-tts';

  const savedSpeed = parseFloat(localStorage.getItem(TTS_SPEED_KEY) || '1.0');
  let playbackRate = TTS_SPEEDS.includes(savedSpeed as 0.75 | 1 | 1.25 | 1.5) ? savedSpeed : 1.0;

  wrap.innerHTML = `
    <button class="entry-tts-play" aria-label="音声を再生">${icons.play(14)}</button>
    <div class="entry-tts-speeds" role="group" aria-label="再生速度">
      ${TTS_SPEEDS.map((s) => `<button class="entry-tts-speed${s === playbackRate ? ' active' : ''}" data-speed="${s}">${s.toFixed(2).replace(/0$/, '')}x</button>`).join('')}
    </div>
  `;

  if (!getCurrentUser()) {
    const playBtn = wrap.querySelector('.entry-tts-play') as HTMLButtonElement;
    playBtn.disabled = true;
    playBtn.title = 'ログイン後に利用できます';
    wrap.querySelectorAll<HTMLButtonElement>('.entry-tts-speed').forEach((b) => (b.disabled = true));
    return wrap;
  }

  let audioCtx: AudioContext | null = null;
  let audioBuffer: AudioBuffer | null = null;
  let currentSource: AudioBufferSourceNode | null = null;
  let isPlaying = false;
  let loading = false;

  const playBtn = wrap.querySelector('.entry-tts-play') as HTMLButtonElement;

  function setIcon(name: 'play' | 'pause' | 'loading'): void {
    if (name === 'loading') {
      playBtn.innerHTML = `<span class="entry-tts-spinner"></span>`;
    } else {
      playBtn.innerHTML = name === 'play' ? icons.play(14) : icons.pause(14);
    }
  }

  function stop(): void {
    if (currentSource) {
      try { currentSource.stop(); } catch { /* */ }
    }
    currentSource = null;
    isPlaying = false;
    setIcon('play');
  }

  function play(): void {
    if (!audioCtx || !audioBuffer) return;
    stop();
    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.playbackRate.value = playbackRate;
    source.connect(audioCtx.destination);
    source.onended = () => {
      isPlaying = false;
      currentSource = null;
      setIcon('play');
    };
    source.start();
    currentSource = source;
    isPlaying = true;
    setIcon('pause');
  }

  playBtn.addEventListener('click', async () => {
    if (loading) return;
    if (isPlaying) { stop(); return; }
    if (audioBuffer) { play(); return; }
    loading = true;
    setIcon('loading');
    playBtn.disabled = true;
    try {
      audioCtx = audioCtx || new AudioContext();
      const token = await getIdToken();
      const voice = localStorage.getItem('lediary_v2_tts_voice') || 'Achird';
      const res = await fetch(`/api/diary/tts?text=${encodeURIComponent(text)}&voice=${voice}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`TTS ${res.status}`);
      audioBuffer = await audioCtx.decodeAudioData(await res.arrayBuffer());
      play();
    } catch (err) {
      console.error(err);
      setIcon('play');
      alert('音声の生成に失敗しました');
    } finally {
      loading = false;
      playBtn.disabled = false;
    }
  });

  wrap.querySelectorAll<HTMLButtonElement>('.entry-tts-speed').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = parseFloat(btn.dataset.speed || '1');
      if (next === playbackRate) return;
      playbackRate = next;
      localStorage.setItem(TTS_SPEED_KEY, String(next));
      wrap.querySelectorAll('.entry-tts-speed').forEach((b) => b.classList.toggle('active', b === btn));
      // 再生中なら即座に新しい速度で再生し直す
      if (isPlaying) play();
    });
  });

  return wrap;
}


interface ExpansionQ {
  question: string;
  hintJa: string;
  hintPhrases: string[];
  afterSentence?: string;
  beforeNext?: string;
  reflected?: boolean;
  answer?: string;
}

function splitSentences(text: string): { text: string; end: number }[] {
  const out: { text: string; end: number }[] = [];
  const re = /[^.!?]*[.!?]+\s*/g;
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = re.exec(text)) !== null) {
    out.push({ text: m[0].trim(), end: m.index + m[0].length });
    last = m.index + m[0].length;
  }
  const rest = text.slice(last).trim();
  if (rest) out.push({ text: rest, end: text.length });
  return out;
}

function showInsertionPicker(currentText: string, textToInsert: string): Promise<string | null> {
  return new Promise((resolve) => {
    const sentences = splitSentences(currentText);
    const overlay = document.createElement('div');
    overlay.className = 'insertion-picker-overlay';
    const panel = document.createElement('div');
    panel.className = 'insertion-picker';
    panel.innerHTML = `
      <div class="insertion-picker-title">挿入する場所を選択</div>
      <div class="insertion-picker-preview"></div>
    `;
    const preview = panel.querySelector('.insertion-picker-preview') as HTMLElement;

    function insertAt(pos: number) {
      const before = currentText.slice(0, pos).trimEnd();
      const after = currentText.slice(pos).trimStart();
      const newText = before + (before ? ' ' : '') + textToInsert + (after ? ' ' + after : '');
      cleanup();
      resolve(newText);
    }

    function cleanup() {
      overlay.remove();
      panel.remove();
    }

    const top = document.createElement('button');
    top.className = 'insertion-slot';
    top.textContent = '▼ ここに挿入';
    top.addEventListener('click', () => insertAt(0));
    preview.appendChild(top);

    for (const s of sentences) {
      const sentEl = document.createElement('div');
      sentEl.className = 'insertion-sentence';
      sentEl.textContent = s.text;
      preview.appendChild(sentEl);
      const slot = document.createElement('button');
      slot.className = 'insertion-slot';
      slot.textContent = '▼ ここに挿入';
      slot.addEventListener('click', () => insertAt(s.end));
      preview.appendChild(slot);
    }

    overlay.addEventListener('click', () => {
      cleanup();
      resolve(null);
    });
    document.body.appendChild(overlay);
    document.body.appendChild(panel);
  });
}

function renderExpansionSection(entry: DiaryEntry, bodyEl: HTMLElement): HTMLElement {
  const wrap = document.createElement('div');
  let questions: ExpansionQ[] = (entry.expansionQuestions || []) as ExpansionQ[];

  function rerender() {
    wrap.innerHTML = '';

    if (questions.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'text-align:center;padding:8px 0 4px;';
      empty.innerHTML = `
        <p class="expansion-empty" style="margin-bottom:12px;">添削が一段落したら 5W1H で深掘り質問を作れます</p>
        <button class="btn" id="gen-q">質問を生成</button>
      `;
      empty.querySelector('#gen-q')!.addEventListener('click', () => generate(empty));
      wrap.appendChild(empty);
      return;
    }

    questions.forEach((q, idx) => wrap.appendChild(renderCard(q, idx)));

    if (questions.every((q) => q.reflected)) {
      const moreWrap = document.createElement('div');
      moreWrap.style.cssText = 'text-align:center;margin-top:12px;';
      moreWrap.innerHTML = `<button class="btn" id="more-q">もっと膨らませる</button>`;
      moreWrap.querySelector('#more-q')!.addEventListener('click', () => generate(moreWrap));
      wrap.appendChild(moreWrap);
    }
  }

  async function generate(triggerEl: HTMLElement) {
    if (!getCurrentUser()) {
      alert('ログインが必要です');
      return;
    }
    const btn = triggerEl.querySelector('button') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = '生成中…';
    try {
      const expansion = await generateExpansionQuestions(entry.contentJp || '', entry.userTranslation || '');
      if (expansion.length > 0) {
        // expansion を ExpansionQ 形状に合わせる (hintJa が ExpansionQ にあるかは型次第なので最小マッピング)
        questions = expansion.map((q) => ({
          question: q.question,
          hintJa: '',
          hintPhrases: q.hintPhrases,
          afterSentence: q.afterSentence,
          beforeNext: q.beforeNext,
        }));
        entry.expansionQuestions = questions;
        // 保存も client から
        await updateDoc(doc(db, 'lediary-posts', entry.id), {
          expansionQuestions: questions,
          updatedAt: Date.now(),
        });
        invalidateEntriesCache();
        rerender();
      } else {
        alert('質問を生成できませんでした');
        btn.disabled = false;
        btn.textContent = '質問を生成';
      }
    } catch (err) {
      console.error(err);
      alert('生成に失敗しました');
      btn.disabled = false;
      btn.textContent = '質問を生成';
    }
  }

  function renderCard(q: ExpansionQ, idx: number): HTMLElement {
    const card = document.createElement('div');
    card.className = `expansion-q ${q.reflected ? 'reflected' : ''}`;
    if (q.reflected) {
      card.innerHTML = `
        <div class="expansion-q-text">${escapeHtml(q.question)}</div>
        <div class="expansion-reflected">✓ 追記しました</div>
      `;
      return card;
    }
    card.innerHTML = `
      <div class="expansion-q-text">${escapeHtml(q.question)}</div>
      <div class="expansion-q-hint">${escapeHtml(q.hintJa)}</div>
      <div class="expansion-q-phrases">
        ${(q.hintPhrases || []).map((p) => `<span class="expansion-q-phrase">${escapeHtml(p)}</span>`).join('')}
      </div>
      <textarea name="expansion-answer-${idx}" class="expansion-q-input" placeholder="英語で答えてみよう"></textarea>
      <div class="expansion-q-result" style="display:none;"></div>
      <div style="display:flex;justify-content:flex-end;margin-top:8px;">
        <button class="btn btn-sm expansion-q-submit">添削</button>
      </div>
    `;

    const input = card.querySelector('.expansion-q-input') as HTMLTextAreaElement;
    const result = card.querySelector('.expansion-q-result') as HTMLElement;
    let submitBtn = card.querySelector('.expansion-q-submit') as HTMLButtonElement;

    submitBtn.addEventListener('click', async () => {
      const answer = input.value.trim();
      if (!answer) return;
      submitBtn.disabled = true;
      submitBtn.textContent = '添削中…';
      try {
        const res = await correctExpansionAnswer(
          q.question,
          answer,
          entry.userTranslation || '',
          q.afterSentence || '',
          q.beforeNext || '',
        );
        const corrected = res.corrected || answer;
        const explanation = res.explanation || '';
        result.innerHTML = `
          <div class="expansion-corrected">${escapeHtml(corrected)}</div>
          ${explanation ? `<div class="expansion-explanation">${escapeHtml(explanation)}</div>` : ''}
        `;
        result.style.display = '';
        submitBtn.textContent = '日記に追記';
        submitBtn.disabled = false;

        // Replace handler with insertion flow
        const newBtn = submitBtn.cloneNode(true) as HTMLButtonElement;
        submitBtn.replaceWith(newBtn);
        submitBtn = newBtn;
        newBtn.addEventListener('click', async () => {
          const finalText = input.value.trim();
          if (!finalText) return;
          newBtn.disabled = true;
          const inserted = await showInsertionPicker(entry.userTranslation, finalText);
          if (inserted == null) {
            newBtn.disabled = false;
            return;
          }
          entry.userTranslation = inserted;
          bodyEl.textContent = inserted;
          questions[idx] = { ...q, reflected: true, answer: finalText };
          entry.expansionQuestions = questions;
          try {
            await savePostTextOnly({
              contentJp: entry.contentJp,
              userTranslation: inserted,
              date: entry.date,
              mode: entry.mode,
              expansionQuestions: questions,
            });
          } catch (err) {
            console.error(err);
            alert('保存に失敗しました（表示は更新されています）');
          }
          rerender();
        });
      } catch (err) {
        console.error(err);
        alert('添削に失敗しました');
        submitBtn.disabled = false;
        submitBtn.textContent = '添削';
      }
    });

    return card;
  }

  rerender();
  return wrap;
}

function iconFor(name: 'sun' | 'graduation' | 'moon' | 'bookOpen', size = 11): string {
  if (name === 'sun') return icons.sun(size);
  if (name === 'graduation') return icons.graduation(size);
  if (name === 'bookOpen') return icons.bookOpen(size);
  return icons.moon(size);
}

/** hero overlay 用に「最初の英文 1 文 → 日本語先頭」のいずれか短いものを 1 行のタイトルとして取り出す。 */
function deriveHeroTitle(entry: DiaryEntry): string {
  const source = (entry.userTranslation || entry.contentJp || '').trim();
  if (!source) return MODE_META[entry.mode].label;
  // 最初のセンテンス（. ! ? 。 ! ?）まで
  const m = source.match(/^[^.!?。！？]+[.!?。！？]?/);
  const first = (m ? m[0] : source).trim();
  // 80 文字を超えたら省略
  return first.length > 80 ? first.slice(0, 78).trimEnd() + '…' : first;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function escapeHtml(s: string | undefined | null): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

// 旧 POST /api/diary/lesson-sheet 相当: LLM 生成 → lediary-sheets に保存 → diary post に id 反映。
async function createLessonSheet(entry: DiaryEntry): Promise<string> {
  const user = getCurrentUser();
  if (!user) throw new Error('not authenticated');
  // 元 post をクライアントから取り直して、(corrected text や vocab の) 最新値を使う
  const postSnap = await getDoc(doc(db, 'lediary-posts', entry.id));
  if (!postSnap.exists()) throw new Error('post not found');
  const post = postSnap.data() as Record<string, unknown>;
  const contentJp = (post.contentJp as string) || '';
  const correctedText = (post.userTranslation as string) || '';
  const vocab = (post.vocabulary as { word: string; definition: string; example: string }[]) || [];

  const sheet = await generateLessonSheetContent(contentJp, correctedText, vocab);
  const shareId = generateShareId();
  await setDoc(doc(db, 'lediary-sheets', shareId), {
    shareId,
    userId: user.uid,
    postId: entry.id,
    title: sheet.title,
    articleBody: correctedText,
    contentJp,
    vocabulary: sheet.vocabulary,
    discussionTopics: sheet.discussionTopics,
    date: (post.date as string) || '',
    mode: (post.mode as string) || 'diary',
    createdAt: Date.now(),
  });
  await updateDoc(doc(db, 'lediary-posts', entry.id), { lessonSheetId: shareId });
  return shareId;
}

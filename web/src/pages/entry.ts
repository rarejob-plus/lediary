import { renderHeader } from '../components/header';
import { icons } from '../components/icons';
import { coverFor } from '../components/cover';
import { MODE_META, type DiaryEntry, type Mode, type PickedPhrase } from '../data/mock';
import { deleteEntry, fetchEntry, invalidateEntriesCache, moveEntryMode, stashForEditor } from '../data/entries';
import { renderSekkiInline, dayOfYear, daysInYear } from '../data/dateInfo';
import { getCurrentUser, getIdToken } from '../auth';
import { navigate } from '../router';
import { enableTextSelectionBookmark, bookmarkPhrase } from '../components/text-selection-bookmark';
import { correctExpansionAnswer, extractVocabulary, generateExpansionQuestions } from '../llm-diary';
import { savePostTextOnly, savePostPick, gatherKnownVocabFor, finalizeEntry, unfinalizeEntry } from '../data/posts';
import { searchUnsplashCandidates, notifyUnsplashDownload, type UnsplashCandidate } from '../unsplash';
import { createShadowingPlayer } from '../components/shadowing-player';
import { enhanceTextarea } from '../components/textarea';
import { deletePickAudio } from '../data/picksAudio';
import { doc, updateDoc } from 'firebase/firestore';
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
    <button type="button" class="entry-hero-cover-btn" title="カバー画像を変更" aria-label="カバー画像を変更">${icons.refreshCw(16)}</button>
    <div class="entry-hero-overlay">
      <h1 class="entry-hero-title">${escapeHtml(deriveHeroTitle(entry))}</h1>
      <div class="ld-meta ld-meta--on-cover entry-hero-meta">
        <button type="button" class="ld-meta__item ld-meta__item--accent ld-meta__item--link entry-hero-mode-trigger" title="モード変更"><span class="ld-meta__icon">${iconFor(meta.icon, 12)}</span>${meta.label}</button>
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
  content.className = `entry-content${entry.finalizedAt ? ' entry-content--finalized' : ''}`;

  const dateBlock = document.createElement('div');
  dateBlock.className = 'entry-date-block';
  dateBlock.innerHTML = `
    <div class="entry-date-num">${d.getDate()}</div>
    <div class="entry-date-meta">
      <strong>${d.toLocaleDateString('en-US', { weekday: 'long' })}</strong>
      <span>${d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} · ${entry.time}</span>
    </div>
    ${entry.finalizedAt ? `<span class="entry-finalized-pill" title="完成済 (タップで再編集)">${icons.check(12)} 完成</span>` : ''}
  `;
  content.appendChild(dateBlock);

  // 完成済のとき、date pill をクリック → 再編集モードに戻す
  if (entry.finalizedAt) {
    const pill = dateBlock.querySelector('.entry-finalized-pill') as HTMLElement | null;
    pill?.addEventListener('click', async () => {
      if (!confirm('完成済の日記を編集します。よろしいですか?')) return;
      try {
        await unfinalizeEntry(entry.id);
        entry.finalizedAt = undefined;
        navigate(`/entry/${entry.id}`); // 再 render
      } catch (e) {
        console.error(e); alert('解除に失敗しました');
      }
    });
  }

  const actions = document.createElement('div');
  actions.className = 'entry-actions';
  actions.innerHTML = `
    <button class="btn btn-sm" id="edit">${icons.pencil(14)} 編集</button>
    <button class="btn btn-sm" id="redo">もう一度添削</button>
    <button class="btn btn-sm" id="flow">流れを整える</button>
    ${entry.finalizedAt
      ? ''
      : `<button class="btn btn-sm btn-finalize" id="finalize" title="これ以上編集しない">${icons.check(14)} 完成</button>`}
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
  // モード変更: ヒーロー上の Morning/Lesson… pill クリックで起動
  const modeTrigger = hero.querySelector('.entry-hero-mode-trigger') as HTMLButtonElement | null;
  modeTrigger?.addEventListener('click', () => {
    const user = getCurrentUser();
    if (!user) {
      alert('ログインが必要です');
      return;
    }
    openModePicker(entry.mode, entry.date, user.uid, async (targetMode) => {
      modeTrigger.disabled = true;
      try {
        const res = await moveEntryMode(entry.id, targetMode);
        const targetId = `${user.uid}_${entry.date}_${targetMode}`;
        navigate(`/entry/${res.id || targetId}`);
      } catch (err) {
        console.error(err);
        alert('モード変更に失敗しました');
        modeTrigger.disabled = false;
      }
    });
  });
  const finalizeBtn = actions.querySelector('#finalize') as HTMLButtonElement | null;
  if (finalizeBtn) {
    finalizeBtn.addEventListener('click', async () => {
      if (!confirm('この日記を「完成」にしますか? 以降は読書モードで開き、編集に確認を挟むようになります。')) return;
      finalizeBtn.disabled = true;
      finalizeBtn.textContent = '保存中…';
      try {
        await finalizeEntry(entry.id);
        entry.finalizedAt = Date.now();
        navigate(`/entry/${entry.id}`); // 再 render で読書モードに
      } catch (e) {
        console.error(e);
        alert('保存に失敗しました');
        finalizeBtn.disabled = false;
      }
    });
  }

  // カバー画像差し替え: hero 右上の リフレッシュアイコンから起動。
  const coverTrigger = hero.querySelector('.entry-hero-cover-btn') as HTMLButtonElement | null;
  coverTrigger?.addEventListener('click', () => {
    const initial = (entry as { coverKeyword?: string }).coverKeyword || '';
    openCoverPicker(initial, async (chosen, keyword) => {
      try {
        await updateDoc(doc(db, 'lediary-posts', entry.id), {
          coverImageUrl: chosen.url,
          coverPhotographer: chosen.photographer,
          coverPhotographerUrl: chosen.photographerUrl,
          coverKeyword: keyword,
          updatedAt: Date.now(),
        });
        void notifyUnsplashDownload(chosen.downloadLocation);
        invalidateEntriesCache();
        entry.coverImageUrl = chosen.url;
        entry.coverPhotographer = chosen.photographer;
        entry.coverPhotographerUrl = chosen.photographerUrl;
        hero.style.background = entry.cover ?? coverFor(entry.mode, entry.time, chosen.url);
      } catch (e) {
        console.error('[cover] save failed', e);
        alert('カバー画像の保存に失敗しました');
      }
    });
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

  // 完成済 (読書モード) は pick を最上段に出して BOY シャドーイング先行。
  // 編集中 (完成前) は逆: 日記本文 (JP / EN) を先に見せ、その後 pick → 補助セクションの順。
  if (entry.finalizedAt && entry.pick) {
    appendSection(content, '今日の 1 フレーズ', renderPicksSection(entry, { readOnly: true }), true);
  }

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

  if (!entry.finalizedAt) {
    appendSection(content, '今日の 1 フレーズ', renderPicksSection(entry), true);
    appendSection(content, '覚えたいフレーズ', renderVocabSection(entry.vocabulary), false);
    appendSection(content, '日記を膨らませる', renderExpansionSection(entry, body), false);
  }

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
 *  添削後のユーザー本文から覚えたいフレーズを **ちょうど 1 個** ピックし、専用シャドーイング player で繰り返す。
 *  pick は post.pick に永続化される。「1 個に絞る」こと自体が選択の質を高める価値、という意図。 */
function renderPicksSection(entry: DiaryEntry, opts: { readOnly?: boolean } = {}): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'picks-section';

  // 状態: 現在の pick (null = 未選択)。差し替えは onPick → savePostPick で都度永続化。
  let pick: PickedPhrase | null = entry.pick ?? null;

  const slot = document.createElement('div');
  slot.className = 'picks-list';
  wrap.appendChild(slot);

  function renderPickCard(): void {
    slot.innerHTML = '';
    if (!pick) return; // 未ピック時は何も描画せず、下の入力フォームだけ見せる
    const card = renderSinglePick(entry.id, pick,
      // onDelete: Storage 上の WAV も best-effort で削除し、空に戻す
      opts.readOnly ? undefined : () => {
        const removed = pick;
        pick = null;
        void savePostPick(entry.id, null);
        if (removed?.audioPath) void deletePickAudio(removed.audioPath);
        renderPickCard();
        renderForm();
      },
      // onShadowed: SRS 更新
      async (delta) => {
        if (!pick) return;
        pick.shadowingCount = (pick.shadowingCount || 0) + delta;
        pick.lastShadowedAt = Date.now();
        await savePostPick(entry.id, pick);
      },
      // onPersisted: Storage upload 成功時に audioPath / voice を pick に焼き込む
      async (audioPath, voice) => {
        if (!pick) return;
        pick.audioPath = audioPath;
        pick.audioVoice = voice;
        await savePostPick(entry.id, pick);
      },
      // onScored: 発音スコアを pick に保存
      async ({ score, isNewBest }) => {
        if (!pick) return;
        pick.lastScore = score;
        if (isNewBest) pick.bestScore = score;
        pick.attemptCount = (pick.attemptCount || 0) + 1;
        await savePostPick(entry.id, pick);
      },
    );
    slot.appendChild(card);
  }

  // pick が無い (or 削除直後) のとき入力フォームを出す。readOnly では常に出さない。
  const formHost = document.createElement('div');
  wrap.appendChild(formHost);

  function renderForm(): void {
    formHost.innerHTML = '';
    if (opts.readOnly || pick) return;
    const sentences = splitIntoPickableSentences(entry.userTranslation || '');
    const form = document.createElement('div');
    form.className = 'picks-form';
    form.innerHTML = `
      ${sentences.length > 0 ? `
        <select class="picks-form-select" aria-label="本文から選ぶ">
          <option value="">— 本文の文から選ぶ —</option>
          ${sentences.map((s, i) => `<option value="${escapeAttr(s)}">${i + 1}. ${escapeHtml(s.length > 60 ? s.slice(0, 58) + '…' : s)}</option>`).join('')}
        </select>
      ` : ''}
      <textarea name="pick-text" class="picks-form-text" rows="2" placeholder="または自分で入力（添削後の英文を直接コピー可）"></textarea>
      <textarea name="pick-note" class="picks-form-note" rows="1" placeholder="日本語メモ（任意）— 本文から該当部分が自動入力されます"></textarea>
      <button class="btn btn-primary picks-form-btn" type="button">${icons.plus(14)} このフレーズに決める</button>
    `;
    formHost.appendChild(form);

    const selectEl = form.querySelector('.picks-form-select') as HTMLSelectElement | null;
    const textEl = form.querySelector('.picks-form-text') as HTMLTextAreaElement;
    const noteEl = form.querySelector('.picks-form-note') as HTMLTextAreaElement;
    const btnEl = form.querySelector('.picks-form-btn') as HTMLButtonElement;

    // EN を本文から選ぶと、sentencePairs (analyzeDiary が生成した JP↔EN 対応表) から
    // 該当する JP を引いて note に自動入力する。note を既に手で書いていれば上書きしない。
    selectEl?.addEventListener('change', () => {
      if (!selectEl.value) return;
      textEl.value = selectEl.value;
      if (noteEl.value.trim()) return;
      const jp = lookupJpForEn(entry, selectEl.value);
      if (jp) noteEl.value = jp;
    });

    btnEl.addEventListener('click', async () => {
      const text = textEl.value.trim();
      if (!text) {
        alert('フレーズを入力してください');
        return;
      }
      const noteVal = noteEl.value.trim();
      const next: PickedPhrase = {
        id: cryptoRandomId(),
        text,
        createdAt: Date.now(),
        shadowingCount: 0,
        ...(noteVal ? { note: noteVal } : {}),
      };
      btnEl.disabled = true;
      try {
        await savePostPick(entry.id, next);
        pick = next;
        renderPickCard();
        renderForm();
      } catch (e) {
        console.error('[pick] save failed', e);
        alert('保存に失敗しました');
        btnEl.disabled = false;
      }
    });
  }

  renderPickCard();
  renderForm();
  return wrap;
}

/** 単数 pick の表示 + シャドーイング player。onDelete が無いとき (readOnly) は削除ボタン非表示。 */
function renderSinglePick(
  _entryId: string,
  pick: PickedPhrase,
  onDelete: (() => void) | undefined,
  onShadowed: (delta: number) => void | Promise<void>,
  onPersisted: (audioPath: string, voice: string) => void | Promise<void>,
  onScored: (r: { score: number; transcript: string; isNewBest: boolean }) => void | Promise<void>,
): HTMLElement {
  const card = document.createElement('div');
  card.className = 'pick-card';
  card.innerHTML = `
    ${onDelete ? `
      <div class="pick-card-head">
        <button class="pick-card-del" title="差し替える / 削除" aria-label="差し替える">${icons.trash(14)}</button>
      </div>
    ` : ''}
    <p class="pick-card-text">${escapeHtml(pick.text)}</p>
    ${pick.note ? `<p class="pick-card-note">${escapeHtml(pick.note)}</p>` : ''}
  `;
  if (onDelete) {
    card.querySelector('.pick-card-del')!.addEventListener('click', () => {
      if (confirm('この 1 フレーズを削除して選び直しますか？')) onDelete();
    });
  }
  card.appendChild(
    createShadowingPlayer({
      pickId: pick.id,
      text: pick.text,
      audioPath: pick.audioPath,
      audioVoice: pick.audioVoice,
      initialCount: pick.shadowingCount || 0,
      lastScore: pick.lastScore,
      bestScore: pick.bestScore,
      attemptCount: pick.attemptCount,
      classPrefix: 'pick',
      eager: true,
      onShadowed,
      onPersisted,
      onScored,
    }),
  );
  return card;
}

/** 本文を「pickable な文」に分解（. ! ? . で区切る、空白除く）。 */
/** 選んだ EN 文に対応する JP 文を sentencePairs から探す。
 *  normalize (lower-case + 末尾句読点除去 + 空白圧縮) で寛容に比較。なければ null。 */
function lookupJpForEn(entry: DiaryEntry, en: string): string | null {
  const pairs = entry.sentencePairs;
  if (!Array.isArray(pairs) || pairs.length === 0) return null;
  const norm = (s: string) => s.toLowerCase().replace(/[\s]+/g, ' ').replace(/[.,!?;:]+$/g, '').trim();
  const target = norm(en);
  for (const p of pairs) {
    if (!p?.en || !p?.jp) continue;
    if (norm(p.en) === target) return p.jp;
  }
  // 部分一致 (LLM が完全一致しない添削後文を pair に入れている場合)
  for (const p of pairs) {
    if (!p?.en || !p?.jp) continue;
    if (norm(p.en).includes(target) || target.includes(norm(p.en))) return p.jp;
  }
  return null;
}

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
    enhanceTextarea(input, {
      onSubmit: () => (card.querySelector('.expansion-q-submit') as HTMLButtonElement | null)?.click(),
    });
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

          // 追記文 (finalText / 添削後を含む) から「過去出てない新規 vocab」を取りに行く。
          // 失敗してもエントリは更新済みなので noisily 失敗しない。
          void (async () => {
            try {
              const user = getCurrentUser();
              if (!user) return;
              const exclude = await gatherKnownVocabFor(user.uid, entry.id);
              const added = await extractVocabulary(finalText || inserted, exclude);
              if (added.length === 0) return;
              const merged = [...(entry.vocabulary || []), ...added];
              entry.vocabulary = merged;
              await updateDoc(doc(db, 'lediary-posts', entry.id), {
                vocabulary: merged,
                updatedAt: Date.now(),
              });
              invalidateEntriesCache();
              // 「覚えたいフレーズ」セクションを再描画して新規語を出す。
              const vocabBody = document.querySelector('.section .vocab-row')?.parentElement;
              if (vocabBody) {
                vocabBody.innerHTML = '';
                merged.forEach((v) => {
                  const row = document.createElement('div');
                  row.className = 'vocab-row';
                  row.innerHTML = `
                    <span class="vocab-en">${escapeHtml(v.word)}</span>
                    <button class="vocab-flashcard-btn">Flashcard</button>
                    <span class="vocab-ja">${escapeHtml(v.definition)}</span>
                    <span class="vocab-example">${escapeHtml(v.example)}</span>
                  `;
                  vocabBody.appendChild(row);
                });
              }
            } catch (e) {
              console.warn('[expand] extract vocab failed', e);
            }
          })();
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
  // 拡張カード内の英文 (添削後の文・ヒント句など) も選択 → Flashcard 保存できるように。
  // 漏れていたため iPhone でも「日記を膨らます」中の選択でボタンが出なかった。
  enableTextSelectionBookmark(wrap);
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

/** モード変更 modal。残り 3 モードをカード表示。既にエントリのあるモードは選択不可。 */
function openModePicker(
  currentMode: Mode,
  date: string,
  userId: string,
  onPick: (target: Mode) => void | Promise<void>,
): void {
  const others = (['morning', 'lesson', 'diary', 'story'] as const).filter((m) => m !== currentMode);
  const overlay = document.createElement('div');
  overlay.className = 'cover-picker-overlay';
  overlay.innerHTML = `
    <div class="cover-picker mode-picker">
      <header class="cover-picker-head">
        <h3 class="cover-picker-title">モードを変える</h3>
        <button class="cover-picker-close" type="button" aria-label="閉じる">${icons.x(16)}</button>
      </header>
      <div class="mode-picker-body">
        <p class="mode-picker-hint">${MODE_META[currentMode].label} の内容を、どのモードに移しますか？</p>
        <div class="mode-picker-grid">
          ${others.map((m) => `
            <button type="button" class="mode-picker-card" data-mode="${m}" disabled>
              <span class="mode-picker-icon" style="color: ${MODE_META[m].color}">${iconFor(MODE_META[m].icon, 20)}</span>
              <span class="mode-picker-label">${MODE_META[m].label}</span>
              <span class="mode-picker-status" data-status>確認中…</span>
            </button>
          `).join('')}
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector('.cover-picker-close')!.addEventListener('click', close);

  // 各候補モードの既存エントリを並列でチェックし、card を有効化 or 無効ラベル付き化。
  others.forEach(async (m) => {
    const card = overlay.querySelector<HTMLButtonElement>(`.mode-picker-card[data-mode="${m}"]`);
    if (!card) return;
    const statusEl = card.querySelector<HTMLElement>('[data-status]');
    const targetId = `${userId}_${date}_${m}`;
    let conflict = false;
    try {
      const existing = await fetchEntry(targetId);
      conflict = !!(existing && (existing.contentJp || existing.userTranslation));
    } catch {
      // フェッチ失敗は競合扱いせず、移動を試みさせる
    }
    if (conflict) {
      card.classList.add('mode-picker-card--disabled');
      if (statusEl) statusEl.textContent = '既にエントリあり';
      return;
    }
    card.disabled = false;
    if (statusEl) statusEl.remove();
    card.addEventListener('click', async () => {
      overlay.querySelectorAll<HTMLButtonElement>('.mode-picker-card').forEach((b) => (b.disabled = true));
      card.classList.add('mode-picker-card--chosen');
      await onPick(m);
      close();
    });
  });
}

/** Unsplash 候補グリッド modal。キーワード検索 → サムネイル一覧 → クリックで選択 → onPick(候補, 使ったキーワード)。 */
function openCoverPicker(
  initialKeyword: string,
  onPick: (chosen: UnsplashCandidate, keyword: string) => void | Promise<void>,
): void {
  const overlay = document.createElement('div');
  overlay.className = 'cover-picker-overlay';
  overlay.innerHTML = `
    <div class="cover-picker">
      <header class="cover-picker-head">
        <h3 class="cover-picker-title">カバーを変える</h3>
        <button class="cover-picker-close" type="button" aria-label="閉じる">${icons.x(16)}</button>
      </header>
      <form class="cover-picker-search">
        <input type="text" class="cover-picker-input" name="keyword" autocomplete="off"
          placeholder="英語のキーワード (例: bbq, autumn leaves)" value="${escapeAttr(initialKeyword)}" />
        <button class="btn btn-primary" type="submit">検索</button>
      </form>
      <div class="cover-picker-grid" id="cover-picker-grid">
        <p class="cover-picker-hint">キーワードを入れて検索してください。</p>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector('.cover-picker-close')!.addEventListener('click', close);

  const form = overlay.querySelector('.cover-picker-search') as HTMLFormElement;
  const input = overlay.querySelector('.cover-picker-input') as HTMLInputElement;
  const grid = overlay.querySelector('#cover-picker-grid') as HTMLElement;
  input.focus();
  input.select();

  async function search(): Promise<void> {
    const kw = input.value.trim();
    if (!kw) return;
    grid.innerHTML = '<p class="cover-picker-hint">検索中…</p>';
    const candidates = await searchUnsplashCandidates(kw, 12);
    if (candidates.length === 0) {
      grid.innerHTML = `<p class="cover-picker-hint">"${escapeHtml(kw)}" の画像が見つかりませんでした。別のキーワードを試してください。</p>`;
      return;
    }
    grid.innerHTML = candidates.map((c, i) => `
      <button class="cover-picker-thumb" type="button" data-i="${i}" title="${escapeAttr(c.alt || c.photographer)}">
        <img src="${escapeAttr(c.thumbUrl)}" loading="lazy" alt="" />
        <span class="cover-picker-credit">${escapeHtml(c.photographer)}</span>
      </button>
    `).join('');
    grid.querySelectorAll<HTMLButtonElement>('.cover-picker-thumb').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const idx = parseInt(btn.dataset.i || '0', 10);
        const chosen = candidates[idx];
        if (!chosen) return;
        btn.classList.add('cover-picker-thumb--chosen');
        await onPick(chosen, kw);
        close();
      });
    });
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void search();
  });
  // 初期キーワードがあれば即検索
  if (initialKeyword.trim()) void search();
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function escapeHtml(s: string | undefined | null): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}


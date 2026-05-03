import { renderHeader } from '../components/header';
import { icons } from '../components/icons';
import { coverFor } from '../components/cover';
import { MODE_META, type DiaryEntry } from '../data/mock';
import { fetchEntry, invalidateEntriesCache, stashForEditor } from '../data/entries';
import { solarTerm, dayOfYear, daysInYear } from '../data/dateInfo';
import { api } from '../api/client';
import { getCurrentUser, getIdToken } from '../auth';
import { navigate } from '../router';
import { enableTextSelectionBookmark, bookmarkPhrase } from '../components/text-selection-bookmark';

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
  hero.style.background = entry.cover ?? coverFor(entry.mode, entry.time);
  hero.innerHTML = `
    <div class="entry-hero-fade"></div>
    <div class="entry-hero-meta">
      <span class="entry-hero-pill">${iconFor(meta.icon)} ${meta.label}</span>
      <span class="entry-hero-pill">${solarTerm(entry.date)}</span>
      <span class="entry-hero-pill">${dayOfYear(entry.date)} / ${daysInYear(entry.date)}</span>
      ${entry.mood ? `<span class="entry-hero-pill">${escapeHtml(entry.mood)}</span>` : ''}
    </div>
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
      const res = await api.post<{ shareId: string }>('/diary/lesson-sheet', { postId: entry.id });
      entry.lessonSheetId = res.shareId;
      sheetBtn.innerHTML = `${icons.share(14)} シートを開く`;
      sheetBtn.disabled = false;
      invalidateEntriesCache();
      const url = `https://lediary.web.app/s/${res.shareId}`;
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
    const labels = others.map((m) => MODE_META[m].label);
    const choice = prompt(`どのモードに移しますか？\n${others.map((m, i) => `${i + 1}. ${labels[i]}`).join('\n')}\n\n番号を入力 (1-${others.length})`);
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
      const res = await api.post<{ id: string }>('/diary/posts/move', {
        fromId: entry.id,
        toMode: targetMode,
      });
      invalidateEntriesCache();
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
        await api.delete(`/diary/posts/${entry.id}`);
        invalidateEntriesCache();
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

  const body = document.createElement('div');
  body.className = 'entry-body';
  body.textContent = entry.userTranslation;
  content.appendChild(body);
  enableTextSelectionBookmark(body);

  appendSection(content, '覚えたいフレーズ', renderVocabSection(entry.vocabulary), true);
  appendSection(content, 'シャドーイング', renderShadowingSection(entry.userTranslation), false);
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

function renderShadowingSection(text: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="shadow-card">
      <div class="ra-generate-wrap">
        <button class="btn btn-primary ra-generate-btn">音声を生成</button>
      </div>
      <div class="ra-controls" style="display:none;">
        <div class="ra-controls-row">
          <button class="btn ra-play-btn">再生</button>
          <button class="btn ra-record-btn">録音</button>
          <div class="ra-speed-control">
            <span class="ra-speed-value">1.0x</span>
            <input type="range" class="ra-speed-range" min="0.5" max="1.5" step="0.1" value="1.0" />
          </div>
        </div>
        <div class="ra-recordings" style="display:none;">
          <div class="ra-recordings-row">
            <span class="ra-recordings-label">お手本</span>
            <button class="btn btn-sm ra-play-model">再生</button>
          </div>
          <div class="ra-recordings-row">
            <span class="ra-recordings-label">あなた</span>
            <audio class="ra-recording-audio" controls></audio>
          </div>
        </div>
      </div>
      <p class="shadow-paragraph" style="display:none;">${escapeHtml(text)}</p>
    </div>
  `;

  if (!getCurrentUser()) {
    // 未ログイン: 旧モック挙動
    const gen = wrap.querySelector('.ra-generate-btn') as HTMLButtonElement;
    gen.addEventListener('click', () => {
      (wrap.querySelector('.shadow-paragraph') as HTMLElement).style.display = '';
      gen.textContent = '再生（mock）';
    });
    return wrap;
  }

  let audioCtx: AudioContext | null = null;
  let audioBuffer: AudioBuffer | null = null;
  let currentSource: AudioBufferSourceNode | null = null;
  let isPlaying = false;
  let playbackRate = 1.0;
  let mediaRecorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];

  const generateBtn = wrap.querySelector('.ra-generate-btn') as HTMLButtonElement;
  const controls = wrap.querySelector('.ra-controls') as HTMLElement;
  const generateWrap = wrap.querySelector('.ra-generate-wrap') as HTMLElement;
  const paragraph = wrap.querySelector('.shadow-paragraph') as HTMLElement;
  const playBtn = wrap.querySelector('.ra-play-btn') as HTMLButtonElement;
  const playModelBtn = wrap.querySelector('.ra-play-model') as HTMLButtonElement;
  const recordBtn = wrap.querySelector('.ra-record-btn') as HTMLButtonElement;
  const recordingsArea = wrap.querySelector('.ra-recordings') as HTMLElement;
  const recordingAudio = wrap.querySelector('.ra-recording-audio') as HTMLAudioElement;
  const speedRange = wrap.querySelector('.ra-speed-range') as HTMLInputElement;
  const speedValue = wrap.querySelector('.ra-speed-value') as HTMLElement;

  function stopPlayback(): void {
    if (currentSource) {
      try { currentSource.stop(); } catch { /* */ }
    }
    currentSource = null;
    isPlaying = false;
    playBtn.textContent = '再生';
  }

  function startPlayback(): void {
    if (!audioCtx || !audioBuffer) return;
    stopPlayback();
    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.playbackRate.value = playbackRate;
    source.connect(audioCtx.destination);
    source.onended = () => {
      isPlaying = false;
      currentSource = null;
      playBtn.textContent = '再生';
    };
    source.start();
    currentSource = source;
    isPlaying = true;
    playBtn.textContent = '停止';
  }

  speedRange.addEventListener('input', () => {
    playbackRate = parseFloat(speedRange.value);
    speedValue.textContent = `${playbackRate.toFixed(1)}x`;
  });

  generateBtn.addEventListener('click', async () => {
    generateBtn.disabled = true;
    generateBtn.textContent = '生成中…';
    try {
      audioCtx = audioCtx || new AudioContext();
      const token = await getIdToken();
      const voice = localStorage.getItem('lediary_v2_tts_voice') || 'Achird';
      const res = await fetch(`/api/diary/tts?text=${encodeURIComponent(text)}&voice=${voice}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`TTS ${res.status}`);
      audioBuffer = await audioCtx.decodeAudioData(await res.arrayBuffer());
      generateWrap.style.display = 'none';
      controls.style.display = '';
      paragraph.style.display = '';
    } catch (err) {
      console.error(err);
      alert('音声の生成に失敗しました');
      generateBtn.disabled = false;
      generateBtn.textContent = '音声を生成';
    }
  });

  playBtn.addEventListener('click', () => {
    if (isPlaying) stopPlayback(); else startPlayback();
  });

  playModelBtn.addEventListener('click', () => startPlayback());

  recordBtn.addEventListener('click', async () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
      stopPlayback();
      recordBtn.textContent = '録音';
      recordBtn.classList.remove('ra-recording');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      mediaRecorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: 'audio/webm' });
        recordingAudio.src = URL.createObjectURL(blob);
        recordingsArea.style.display = '';
      };
      mediaRecorder.start();
      recordBtn.textContent = '停止';
      recordBtn.classList.add('ra-recording');
      startPlayback();
    } catch (err) {
      console.error(err);
      alert('マイクへのアクセスが必要です');
    }
  });

  return wrap;
}

interface ExpansionQ {
  question: string;
  hintJa: string;
  hintPhrases: string[];
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
      const res = await api.post<{ expansionQuestions: ExpansionQ[] }>('/diary/expand', {
        contentJp: entry.contentJp,
        userTranslation: entry.userTranslation,
        date: entry.date,
        mode: entry.mode,
      });
      if (res.expansionQuestions && res.expansionQuestions.length > 0) {
        questions = res.expansionQuestions;
        entry.expansionQuestions = questions;
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
      <textarea class="expansion-q-input" placeholder="英語で答えてみよう"></textarea>
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
        const res = await api.post<{ corrected: string; explanation: string }>('/diary/correct-answer', {
          question: q.question,
          answer,
          diaryContext: entry.userTranslation,
        });
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
            await api.post('/diary/posts', {
              contentJp: entry.contentJp,
              userTranslation: inserted,
              date: entry.date,
              mode: entry.mode,
              textOnly: true,
              expansionQuestions: questions,
            });
            invalidateEntriesCache();
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

function iconFor(name: 'sun' | 'graduation' | 'moon' | 'bookOpen'): string {
  if (name === 'sun') return icons.sun(11);
  if (name === 'graduation') return icons.graduation(11);
  if (name === 'bookOpen') return icons.bookOpen(11);
  return icons.moon(11);
}

function escapeHtml(s: string | undefined | null): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

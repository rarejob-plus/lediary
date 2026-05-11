import { renderHeader } from '../components/header';
import { icons } from '../components/icons';
import { coverFor } from '../components/cover';
import { MODE_META, type DiaryEntry } from '../data/mock';
import { fetchEntry, invalidateEntriesCache, stashForEditor } from '../data/entries';
import { renderSekkiPill, dayOfYear, daysInYear } from '../data/dateInfo';
import { api } from '../api/client';
import { getCurrentUser } from '../auth';
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
  hero.style.background = entry.cover ?? coverFor(entry.mode, entry.time, entry.coverImageUrl);
  hero.innerHTML = `
    <div class="entry-hero-fade"></div>
    <div class="entry-hero-meta">
      <span class="entry-hero-pill">${iconFor(meta.icon)} ${meta.label}</span>
      ${renderSekkiPill(entry.date, 'entry-hero-pill')}
      <span class="entry-hero-pill">${dayOfYear(entry.date)} / ${daysInYear(entry.date)}</span>
      ${entry.mood ? `<span class="entry-hero-pill">${escapeHtml(entry.mood)}</span>` : ''}
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


interface ExpansionQ {
  question: string;
  hintJa: string;
  hintPhrases: string[];
  afterSentence?: string;
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
          afterSentence: q.afterSentence,
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

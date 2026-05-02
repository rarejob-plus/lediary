import { renderHeader, renderMockBanner } from '../components/header';
import { icons } from '../components/icons';
import { coverFor } from '../components/cover';
import { MODE_META, type DiaryEntry } from '../data/mock';
import { fetchEntry, invalidateEntriesCache } from '../data/entries';
import { solarTerm, dayOfYear, daysInYear } from '../data/dateInfo';
import { api } from '../api/client';
import { getCurrentUser } from '../auth';
import { navigate } from '../router';

export function renderEntry(root: HTMLElement, id: string): void {
  root.appendChild(renderHeader(null));

  const placeholder = document.createElement('p');
  placeholder.style.cssText = 'color:var(--text-muted);text-align:center;padding:60px 24px;font-size:13px;';
  placeholder.textContent = '読み込み中…';
  root.appendChild(placeholder);
  root.appendChild(renderMockBanner());

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
      root.insertBefore(wrap, root.querySelector('.mock-banner'));
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
  root.querySelector('.mock-banner')?.remove();

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
    <button class="btn btn-sm btn-ghost danger" id="del" title="削除">${icons.trash(14)}</button>
  `;
  actions.querySelector('#edit')!.addEventListener('click', () => {
    navigate(`/editor?date=${entry.date}&mode=${entry.mode}`);
  });
  actions.querySelector('#redo')!.addEventListener('click', () => alert('もう一度添削モック'));
  actions.querySelector('#flow')!.addEventListener('click', () => alert('流れを整えるモック'));
  actions.querySelector('#sheet')!.addEventListener('click', () => alert('レッスンシート作成モック'));
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

  appendSection(content, '覚えたいフレーズ', renderVocabSection(entry.vocabulary), true);
  appendSection(content, 'シャドーイング', renderShadowingSection(entry.userTranslation), false);
  appendSection(content, '日記を膨らませる', renderExpansionSection(entry.expansionQuestions), false);

  root.appendChild(content);
  root.appendChild(renderMockBanner());
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
    row.querySelector('.vocab-flashcard-btn')!.addEventListener('click', () => alert('Flashcard 保存モック'));
    wrap.appendChild(row);
  });
  return wrap;
}

function renderShadowingSection(text: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="shadow-card">
      <button class="btn btn-primary" id="gen">音声を生成</button>
      <p class="shadow-paragraph" id="para">${escapeHtml(text)}</p>
    </div>
  `;
  wrap.querySelector('#gen')!.addEventListener('click', () => {
    wrap.querySelector('#para')!.classList.add('shown');
    (wrap.querySelector('#gen') as HTMLButtonElement).textContent = '再生';
  });
  return wrap;
}

function renderExpansionSection(questions: { question: string; hintJa: string; hintPhrases: string[] }[]): HTMLElement {
  const wrap = document.createElement('div');
  if (questions.length === 0) {
    wrap.innerHTML = `
      <div style="text-align:center;padding:8px 0 4px;">
        <p class="expansion-empty" style="margin-bottom:12px;">添削が一段落したら 5W1H で深掘り質問を作れます</p>
        <button class="btn">質問を生成</button>
      </div>
    `;
    wrap.querySelector('button')!.addEventListener('click', () => alert('質問生成モック'));
    return wrap;
  }
  questions.forEach((q) => {
    const card = document.createElement('div');
    card.className = 'expansion-q';
    card.innerHTML = `
      <div class="expansion-q-text">${escapeHtml(q.question)}</div>
      <div class="expansion-q-hint">${escapeHtml(q.hintJa)}</div>
      <div class="expansion-q-phrases">
        ${(q.hintPhrases || []).map((p) => `<span class="expansion-q-phrase">${escapeHtml(p)}</span>`).join('')}
      </div>
      <textarea class="expansion-q-input" placeholder="英語で答えてみよう"></textarea>
      <div style="display:flex;justify-content:flex-end;margin-top:8px;">
        <button class="btn btn-sm">添削</button>
      </div>
    `;
    wrap.appendChild(card);
  });
  return wrap;
}

function iconFor(name: 'sun' | 'graduation' | 'moon'): string {
  if (name === 'sun') return icons.sun(11);
  if (name === 'graduation') return icons.graduation(11);
  return icons.moon(11);
}

function escapeHtml(s: string | undefined | null): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

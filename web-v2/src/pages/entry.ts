import { renderHeader, renderMockBanner } from '../components/header';
import { findEntry, MODE_META } from '../data/mock';
import { navigate } from '../router';

export function renderEntry(root: HTMLElement, id: string): void {
  root.appendChild(renderHeader(null));

  const entry = findEntry(id);
  if (!entry) {
    const back = document.createElement('button');
    back.className = 'btn';
    back.textContent = '← タイムラインに戻る';
    back.addEventListener('click', () => navigate('/'));
    root.appendChild(back);
    const msg = document.createElement('p');
    msg.style.marginTop = '20px';
    msg.style.color = 'var(--text-muted)';
    msg.textContent = 'エントリが見つかりませんでした';
    root.appendChild(msg);
    root.appendChild(renderMockBanner());
    return;
  }

  const meta = MODE_META[entry.mode];
  const dateLabel = new Date(entry.date + 'T00:00:00').toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });

  const header = document.createElement('div');
  header.className = 'entry-header';
  header.innerHTML = `
    <div class="entry-date">${dateLabel}</div>
    <div class="entry-mode-meta">
      <span style="color:${meta.color};">${meta.emoji} ${meta.label}</span>
    </div>
    <div class="entry-actions">
      <button class="btn btn-sm" id="edit">編集</button>
      <button class="btn btn-sm" id="redo">もう一度添削</button>
      <button class="btn btn-sm" id="flow">流れを整える</button>
      <button class="btn btn-sm" id="sheet">レッスンシート</button>
      <button class="btn btn-sm btn-ghost" id="del" style="margin-left:auto;color:var(--accent);">削除</button>
    </div>
  `;
  header.querySelector('#edit')!.addEventListener('click', () => alert('編集モック'));
  header.querySelector('#redo')!.addEventListener('click', () => alert('もう一度添削モック'));
  header.querySelector('#flow')!.addEventListener('click', () => alert('流れを整えるモック'));
  header.querySelector('#sheet')!.addEventListener('click', () => alert('レッスンシート作成モック'));
  header.querySelector('#del')!.addEventListener('click', () => {
    if (confirm('この日記を削除しますか？')) {
      alert('削除モック → タイムラインに戻ります');
      navigate('/');
    }
  });
  root.appendChild(header);

  const jp = document.createElement('div');
  jp.className = 'entry-body-jp';
  jp.textContent = entry.contentJp;
  root.appendChild(jp);

  const body = document.createElement('div');
  body.className = 'entry-body';
  body.textContent = entry.userTranslation;
  root.appendChild(body);

  // Sections
  appendSection(root, '覚えたいフレーズ', renderVocabSection(entry.vocabulary), true);
  appendSection(root, 'シャドーイング', renderShadowingSection(entry.userTranslation), false);
  appendSection(
    root,
    '日記を膨らませる',
    renderExpansionSection(entry.expansionQuestions),
    false,
  );

  root.appendChild(renderMockBanner());
}

function appendSection(parent: HTMLElement, title: string, body: HTMLElement, openByDefault: boolean): void {
  const sec = document.createElement('div');
  sec.className = 'section';
  const header = document.createElement('div');
  header.className = 'section-header';
  header.innerHTML = `
    <span class="section-title">${title}</span>
    <span class="section-chevron ${openByDefault ? 'open' : ''}">▼</span>
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
      <span class="vocab-ja">${escapeHtml(v.definition)}</span>
      <button class="vocab-flashcard-btn">Flashcard</button>
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
    const para = wrap.querySelector('#para')!;
    para.classList.add('shown');
    (wrap.querySelector('#gen') as HTMLButtonElement).textContent = '再生 ▶︎';
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
        ${q.hintPhrases.map((p) => `<span class="expansion-q-phrase">${escapeHtml(p)}</span>`).join('')}
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

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

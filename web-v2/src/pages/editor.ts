import { renderHeader, renderMockBanner } from '../components/header';
import { icons } from '../components/icons';
import type { Mode } from '../data/mock';
import { MODE_META } from '../data/mock';
import { navigate } from '../router';

const SAMPLE_FEEDBACK = [
  {
    original: "I'm head to flower park with my family today!",
    corrected: "I'm heading to a flower park with my family today!",
    explanation: '"head" は動詞として進行形 "heading" に。"flower park" は初出なので冠詞 "a" が必要。',
  },
  {
    original: 'Anyway, today marks the start of Golden Week!',
    corrected: 'And today is finally the start of Golden Week!',
    explanation: '"Anyway" は話題を変える時に使うので、文脈が続く今回は不自然。',
  },
];

const SAMPLE_HINTS = [
  { en: 'head to', ja: '〜へ向かう' },
  { en: 'mark the start of', ja: '〜の始まりを告げる' },
  { en: 'finally', ja: 'いよいよ、ようやく' },
];

export function renderEditor(root: HTMLElement): void {
  root.appendChild(renderHeader('editor'));

  const today = new Date();
  const params = new URLSearchParams(location.search);
  const initialMode = params.get('mode') as Mode | null;
  let currentMode: Mode = (initialMode === 'morning' || initialMode === 'lesson' || initialMode === 'diary') ? initialMode : 'diary';
  let stoic = false;

  const wrap = document.createElement('div');
  wrap.className = 'editor';

  const meta = document.createElement('div');
  meta.className = 'editor-meta';
  meta.innerHTML = `
    <div class="editor-date">
      <div class="editor-date-num">${today.getDate()}</div>
      <div class="editor-date-meta">
        <strong>${today.toLocaleDateString('en-US', { weekday: 'long' })}</strong>
        <span>${today.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
      </div>
    </div>
    <div class="mode-pills">
      ${(['morning', 'lesson', 'diary'] as Mode[]).map((m) => `
        <button class="mode-pill ${m === currentMode ? 'active' : ''}" data-mode="${m}">${iconFor(MODE_META[m].icon)} ${MODE_META[m].label}</button>
      `).join('')}
    </div>
  `;
  meta.querySelectorAll('.mode-pill').forEach((b) => {
    b.addEventListener('click', () => {
      currentMode = (b as HTMLElement).dataset.mode as Mode;
      meta.querySelectorAll('.mode-pill').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
    });
  });
  wrap.appendChild(meta);

  const jpBlock = document.createElement('div');
  jpBlock.className = 'compose-block';
  jpBlock.innerHTML = `
    <div class="compose-label">日本語で書く</div>
    <textarea class="compose-textarea" placeholder="今日あったことを日本語で…">今日は家族でフラワーパークに行く！いよいよゴールデンウィーク開始！</textarea>
  `;
  wrap.appendChild(jpBlock);

  const hintsCard = document.createElement('div');
  hintsCard.className = 'hints-card';
  hintsCard.innerHTML = `
    <div class="hints-card-header">
      <span>英訳ヒント</span>
      <span style="text-transform:none;letter-spacing:0;color:var(--text-faint);font-weight:400;">日本語に対応する語のみ</span>
    </div>
    ${SAMPLE_HINTS.map((h) => `
      <div class="hint-row">
        <span class="hint-en">${h.en}</span>
        <span class="hint-ja">${h.ja}</span>
      </div>
    `).join('')}
  `;
  wrap.appendChild(hintsCard);

  const enBlock = document.createElement('div');
  enBlock.className = 'compose-block';
  enBlock.innerHTML = `
    <div class="compose-label">英語にする</div>
    <textarea class="compose-textarea en" placeholder="Write in English…">I'm head to flower park with my family today! Anyway, today marks the start of Golden Week!</textarea>
  `;
  wrap.appendChild(enBlock);

  const actionRow = document.createElement('div');
  actionRow.className = 'compose-action-row';
  actionRow.innerHTML = `<button class="btn btn-primary" id="correct-btn">添削してもらう</button>`;
  wrap.appendChild(actionRow);

  const correctionSection = document.createElement('div');
  correctionSection.id = 'correction-section';
  wrap.appendChild(correctionSection);

  function renderCorrection() {
    correctionSection.innerHTML = '';

    const label = document.createElement('div');
    label.className = 'compose-label';
    label.textContent = '添削（自分で書き直して定着させよう）';
    correctionSection.appendChild(label);

    const toggleRow = document.createElement('div');
    toggleRow.className = 'correction-mode-toggle';
    toggleRow.innerHTML = `
      <span>修正案を ${stoic ? '隠す（自力モード）' : '表示する'}</span>
      <button class="toggle-switch ${stoic ? 'on' : ''}" id="stoic-toggle"></button>
    `;
    toggleRow.querySelector('#stoic-toggle')!.addEventListener('click', () => {
      stoic = !stoic;
      renderCorrection();
    });
    correctionSection.appendChild(toggleRow);

    SAMPLE_FEEDBACK.forEach((fb, i) => {
      const card = document.createElement('div');
      card.className = 'correction-card';
      card.innerHTML = `
        <div class="correction-step">${i + 1} / ${SAMPLE_FEEDBACK.length}</div>
        <div class="correction-original">${escapeHtml(fb.original)}</div>
        ${stoic ? `
          <div class="stoic-veil" data-reveal="0">
            <div class="correction-corrected">${escapeHtml(fb.corrected)}</div>
            <div class="stoic-veil-hint">タップで答えを見る</div>
          </div>
          <div class="correction-explanation">${escapeHtml(fb.explanation)}</div>
          <div class="correction-rewrite-label">自分で書き直す</div>
          <textarea class="correction-rewrite" placeholder="ヒントだけで書き直してみよう"></textarea>
        ` : `
          <div class="correction-corrected">${escapeHtml(fb.corrected)}</div>
          <div class="correction-explanation">${escapeHtml(fb.explanation)}</div>
          <div class="correction-rewrite-label">自分で書き直す</div>
          <textarea class="correction-rewrite" placeholder="参考にして書き直してみよう"></textarea>
        `}
      `;
      const veil = card.querySelector('.stoic-veil') as HTMLElement | null;
      if (veil) {
        veil.addEventListener('click', () => {
          (veil.querySelector('.correction-corrected') as HTMLElement).style.filter = 'none';
          (veil.querySelector('.correction-corrected') as HTMLElement).style.userSelect = 'auto';
          (veil.querySelector('.stoic-veil-hint') as HTMLElement).style.display = 'none';
          veil.style.cursor = 'auto';
        });
      }
      correctionSection.appendChild(card);
    });

    const doneBtn = document.createElement('button');
    doneBtn.className = 'btn btn-primary';
    doneBtn.style.cssText = 'width:100%;margin-top:12px;';
    doneBtn.textContent = '完成';
    doneBtn.addEventListener('click', () => navigate('/entry/mock_2026-05-02_morning'));
    correctionSection.appendChild(doneBtn);
  }

  actionRow.querySelector('#correct-btn')!.addEventListener('click', () => {
    renderCorrection();
    correctionSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  root.appendChild(wrap);
  root.appendChild(renderMockBanner());
}

function iconFor(name: 'sun' | 'graduation' | 'moon'): string {
  if (name === 'sun') return icons.sun(12);
  if (name === 'graduation') return icons.graduation(12);
  return icons.moon(12);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

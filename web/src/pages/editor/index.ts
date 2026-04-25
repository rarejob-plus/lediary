/**
 * Editor page — write diary + get AI correction with step-by-step review.
 * Feedback loop inspired by ielts-akapen: one correction at a time → accept/edit → resubmit.
 */

import { api } from '../../api/client';
import { getIdToken } from '../../auth';
import { getRouteParams, navigate } from '../../router';
import { showToast } from '../../components/toast';
import { enableTextSelectionBookmark } from '../../components/text-selection-bookmark';
import { Sunrise, GraduationCap, Moon, CheckCircle, type IconNode } from 'lucide';

const EDITOR_ICONS: Record<string, IconNode> = { Sunrise, GraduationCap, Moon, CheckCircle };

function lucideIcon(name: string, size = 18): string {
  const parts = EDITOR_ICONS[name];
  if (!parts) return '';
  const elements = Array.from(parts as ArrayLike<[string, Record<string, string>]>);
  const inner = elements.map(([tag, attrs]) => {
    const attrStr = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ');
    return `<${tag} ${attrStr}/>`;
  }).join('');
  return `<svg class="lucide-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

const MODE_ICON_NAMES: Record<string, string> = { morning: 'Sunrise', lesson: 'GraduationCap', diary: 'Moon' };

type WriteMode = 'diary' | 'morning' | 'lesson';

interface DiaryPost {
  id: string;
  userId: string;
  contentJp: string;
  userTranslation?: string;
  date?: string;
  mode?: WriteMode;
  feedback?: FeedbackItem[];
  vocabulary?: VocabItem[];
  expansionQuestions?: ExpansionQuestion[];
  hints?: HintItem[];
  attemptCount?: number;
  dismissedVocab?: string[];
  lessonSheetId?: string;
}

const MODE_CONFIG: Record<WriteMode, { title: string; jpLabel: string; jpPlaceholder: string; enPlaceholder: string }> = {
  morning: {
    title: '朝の一言',
    jpLabel: '今日の予定・意気込み',
    jpPlaceholder: '今日やること、楽しみにしていることを1〜2行で',
    enPlaceholder: 'Write your morning intention in English',
  },
  lesson: {
    title: 'レッスン振り返り',
    jpLabel: 'レッスンで話したこと・感想',
    jpPlaceholder: 'レッスンで話した内容、言えなかったこと、感想を書きましょう',
    enPlaceholder: 'Write about your lesson in English',
  },
  diary: {
    title: '日記を書く',
    jpLabel: '日本語で3行日記',
    jpPlaceholder: '今日あったことを日本語で3行書いてみましょう',
    enPlaceholder: 'Write in English',
  },
};

interface FeedbackItem {
  original: string;
  corrected: string;
  explanation: string;
}

interface VocabItem {
  word: string;
  definition: string;
  example: string;
}

interface ExpansionQuestion {
  question: string;
  hintJa: string;
  hintPhrases?: string[];
  afterSentence: string;
  reflected?: boolean;
  answer?: string;
}

interface HintItem {
  japanese: string;
  english: string;
  note: string;
}

import { RJPLUS_API } from '../../constants';

// Module-level state for correction review
let currentFeedback: FeedbackItem[] = [];
let correctionIndex = 0;
let previousFeedback: FeedbackItem[] = [];
let attemptCount = 0;
let currentMode: WriteMode = 'diary';

export function editorHTML(): string {
  return `
    <div class="editor-header">
      <button class="back-btn" id="back-btn">&larr;</button>
      <h2></h2>
    </div>

    <input type="hidden" id="input-date" />

    <div class="editor-section">
      <textarea id="input-jp" rows="4" class="editor-textarea-minimal" placeholder="今日あったことを日本語で書く"></textarea>
    </div>

    <button id="hint-btn" class="btn btn-hint" style="display:none;">英訳ヒントを見る</button>

    <div id="writing-area" class="writing-area" style="display:none;">
      <div class="writing-ref-jp-sticky" id="writing-ref-jp-sticky" style="display:none;">
        <div class="writing-ref-jp" id="writing-ref-jp"></div>
      </div>
      <div class="writing-cols">
        <div class="writing-ref" id="writing-ref">
          <div id="hints-area" class="hints-area" style="display:none;">
            <h3>英訳ヒント</h3>
            <div id="hints-list"></div>
          </div>
        </div>
        <div class="writing-input">
          <textarea id="input-en" rows="8" class="editor-textarea-minimal en-textarea" placeholder="Write in English"></textarea>
          <button id="translate-btn" class="btn btn-primary" style="width:100%;margin-top:12px;">添削してもらう</button>
        </div>
      </div>
    </div>

    <!-- Step-by-step correction review -->
    <div id="correction-area" class="correction-area" style="display:none;">
      <div class="correction-header">
        <button class="back-btn" id="correction-back-btn">&larr;</button>
        <h3>添削 <span id="correction-counter"></span></h3>
        <span id="attempt-badge" class="attempt-badge"></span>
      </div>
      <div id="correction-card" class="correction-card">
        <div class="feedback-label">あなたの文</div>
        <div id="correction-original" class="feedback-original"></div>
        <div class="feedback-label">修正案</div>
        <div id="correction-corrected" class="feedback-corrected"></div>
        <div id="correction-explanation" class="feedback-explanation"></div>
        <div class="correction-edit-section">
          <div class="feedback-label">あなたの文を修正してください</div>
          <textarea id="correction-edit" rows="3" class="correction-edit-textarea"></textarea>
        </div>
        <div class="correction-actions">
          <button id="correction-next" class="btn btn-primary btn-sm">次へ</button>
        </div>
      </div>
      <div id="correction-complete" class="correction-complete" style="display:none;">
        <p id="correction-complete-text"></p>
      </div>
    </div>

    <!-- Vocabulary shown after correction complete -->
    <div id="completed-vocab" style="display:none;"></div>

    <!-- Expansion questions -->
    <div id="expansion-section" style="display:none;">
      <h3 class="expansion-title">日記を膨らまそう</h3>
      <div id="expansion-questions"></div>
    </div>

    <!-- Lesson sheet -->
    <div id="lesson-sheet-section" class="lesson-sheet-section" style="display:none;">
      <button id="lesson-sheet-btn" class="btn btn-primary btn-lesson-sheet">レッスンシートを作る</button>
    </div>
  `;
}

export async function initEditor(): Promise<void> {
  const params = getRouteParams();
  const postId = params.id;

  // Determine mode from URL or loaded post
  currentMode = (params.mode as WriteMode) || 'diary';
  const config = MODE_CONFIG[currentMode];

  // Apply mode icon to header (title will be set by updateHeaderDate)
  document.querySelector('.editor-header')!.classList.add(`editor-mode-${currentMode}`);
  const jpLabel = document.querySelector('.editor-section:nth-child(2) label');
  if (jpLabel) jpLabel.textContent = config.jpLabel;

  document.getElementById('back-btn')?.addEventListener('click', () => {
    navigate('/');
  });
  document.getElementById('correction-back-btn')?.addEventListener('click', () => {
    navigate('/');
  });

  const dateInput = document.getElementById('input-date') as HTMLInputElement;
  const jpInput = document.getElementById('input-jp') as HTMLTextAreaElement;
  const enInput = document.getElementById('input-en') as HTMLTextAreaElement;
  const translateBtn = document.getElementById('translate-btn') as HTMLButtonElement;
  const correctionArea = document.getElementById('correction-area')!;

  jpInput.placeholder = config.jpPlaceholder;
  enInput.placeholder = config.enPlaceholder;

  // If opening an existing post, hide the new-entry form immediately (before API call)
  if (postId) {
    document.querySelectorAll('.editor-section').forEach((s) => (s as HTMLElement).style.display = 'none');
    document.getElementById('hint-btn')!.style.display = 'none';
    document.getElementById('writing-area')!.style.display = 'none';
  }

  // Default date: today, but before 4:00 AM → yesterday
  const now = new Date();
  if (now.getHours() < 4) {
    now.setDate(now.getDate() - 1);
  }
  dateInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  updateHeaderDate();

  // If editing existing post, load it
  if (postId) {
    try {
      const post = await api.get<DiaryPost>(`/diary/posts/${postId}`);
      jpInput.value = post.contentJp;
      if (post.userTranslation) enInput.value = post.userTranslation;
      if (post.date) dateInput.value = post.date;
      if (post.attemptCount) attemptCount = post.attemptCount;
      if (post.mode) {
        currentMode = post.mode;
        document.querySelector('.editor-header')!.classList.add(`editor-mode-${currentMode}`);
        updateHeaderDate();
      }

      if (post.userTranslation) {
        // Already corrected — show completed view
        showCompletedView(post, enInput);
      } else if (post.hints && post.hints.length > 0) {
        document.getElementById('writing-area')!.style.display = '';
        renderHints(post.hints);
        activateWritingMode(post.contentJp);
      } else {
        // Japanese only, no translation yet — show editor + hint button
        document.querySelectorAll('.editor-section').forEach((s) => (s as HTMLElement).style.display = '');
        document.getElementById('hint-btn')!.style.display = '';
      }
    } catch (_err) {
      console.error('Failed to load post:', _err);
      showToast('日記の読み込みに失敗しました');
    }
  }

  // Show hint button when JP text is entered
  const hintBtn = document.getElementById('hint-btn') as HTMLButtonElement;
  jpInput.addEventListener('input', () => {
    hintBtn.style.display = jpInput.value.trim() ? '' : 'none';
  });

  hintBtn.addEventListener('click', async () => {
    const contentJp = jpInput.value.trim();
    if (!contentJp) {
      showToast('日本語を入力してください');
      return;
    }

    hintBtn.disabled = true;
    hintBtn.innerHTML = '<span class="loading-spinner"></span> ヒント生成中...';

    try {
      const date = dateInput.value;
      const res = await api.post<{ hints: HintItem[] }>('/diary/hints', { contentJp, date, mode: currentMode });
      renderHints(res.hints);
      hintBtn.style.display = 'none';
      activateWritingMode(jpInput.value);
    } catch (_err) {
      console.error('Hint generation failed:', _err);
      showToast('ヒント生成に失敗しました');
      hintBtn.disabled = false;
      hintBtn.textContent = '英訳ヒントを見る';
    }
  });

  // Submit for correction
  async function submitForCorrection() {
    const contentJp = jpInput.value.trim();
    if (!contentJp) {
      showToast('日本語を入力してください');
      return;
    }

    const userTranslation = enInput.value.trim();
    if (!userTranslation) {
      showToast('英語を入力してください');
      return;
    }

    translateBtn.disabled = true;
    translateBtn.innerHTML = '<span class="loading-spinner"></span> 添削中...';
    correctionArea.style.display = 'none';

    try {
      const date = dateInput.value;
      attemptCount++;
      const body: Record<string, unknown> = {
        contentJp,
        userTranslation,
        date,
        previousFeedback,
        attemptCount,
        mode: currentMode,
      };

      const post = await api.post<DiaryPost>('/diary/posts', body);

      // Clear readonly state if re-correcting
      if (enInput.readOnly) {
        enInput.readOnly = false;
        enInput.classList.remove('readonly');
        enInput.style.display = '';
        // Remove selectable text overlay and completion badge
        enInput.parentNode!.querySelector('.diary-text-selectable')?.remove();
      }

      if (post.feedback && post.feedback.length > 0) {
        // Start step-by-step correction review
        currentFeedback = post.feedback;
        correctionIndex = 0;
        startCorrectionReview(post, enInput);
      } else {
        // No corrections needed — show completed view directly
        showToast('修正点はありません！');
        showCompletedView(post, enInput);
      }

      translateBtn.textContent = 'もう一度添削する';

      if (post.id) {
        history.replaceState(null, '', `/post/${post.id}`);
      }
    } catch (_err) {
      console.error('Translation failed:', _err);
      showToast('添削に失敗しました');
    } finally {
      translateBtn.disabled = false;
      if (translateBtn.querySelector('.loading-spinner')) {
        translateBtn.textContent = '添削してもらう';
      }
    }
  }

  translateBtn.addEventListener('click', submitForCorrection);
}

// ─── Step-by-step correction review ───

function startCorrectionReview(post: DiaryPost, enInput: HTMLTextAreaElement): void {
  const correctionArea = document.getElementById('correction-area')!;
  const correctionComplete = document.getElementById('correction-complete')!;
  const correctionCard = document.getElementById('correction-card')!;

  // Hide ALL content above correction area
  const appEl = document.getElementById('app')!;
  for (let i = 0; i < appEl.children.length; i++) {
    const child = appEl.children[i] as HTMLElement;
    if (child.id === 'correction-area') continue;
    child.style.display = 'none';
  }

  correctionArea.style.display = 'block';
  correctionComplete.style.display = 'none';
  correctionCard.style.display = 'block';

  const attemptBadge = document.getElementById('attempt-badge')!;
  attemptBadge.textContent = attemptCount > 1 ? `${attemptCount}回目` : '';

  renderCurrentCorrection();

  // Enable text selection → Flashcard on correction card
  enableTextSelectionBookmark(correctionCard);

  // Scroll to top to show correction card
  window.scrollTo(0, 0);

  // Next button
  const nextBtn = document.getElementById('correction-next')!;
  const newNext = nextBtn.cloneNode(true) as HTMLButtonElement;
  nextBtn.replaceWith(newNext);

  newNext.addEventListener('click', () => {
    // Apply user's edited text back to the full translation
    const editArea = document.getElementById('correction-edit') as HTMLTextAreaElement;
    const editedSnippet = editArea.value;
    applySnippetToFullText(enInput, correctionIndex, editedSnippet);
    advanceCorrection(post, enInput);
  });
}

/** Apply edited sentence back into the full text */
function applySnippetToFullText(enInput: HTMLTextAreaElement, _fbIndex: number, editedSnippet: string): void {
  const fb = currentFeedback[_fbIndex]!;
  const fullText = enInput.value;

  // Exact match first
  if (fullText.includes(fb.original)) {
    enInput.value = fullText.replace(fb.original, editedSnippet);
    return;
  }

  // Fuzzy: normalize whitespace
  const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
  const normalizedOriginal = normalize(fb.original);
  const sentences = fullText.split(/(?<=[.!?])\s*/);
  for (const sentence of sentences) {
    if (normalize(sentence) === normalizedOriginal) {
      enInput.value = fullText.replace(sentence, editedSnippet);
      return;
    }
  }

  // Similarity match: find the sentence most similar to fb.original
  // (handles cases where Gemini auto-corrects typos in original)
  let bestMatch = '';
  let bestScore = 0;
  for (const sentence of sentences) {
    const score = similarity(normalize(sentence), normalizedOriginal);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = sentence;
    }
  }
  if (bestScore > 0.6 && bestMatch) {
    enInput.value = fullText.replace(bestMatch, editedSnippet);
  }
}

/** Simple word-overlap similarity (0-1) */
function similarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));
  let overlap = 0;
  for (const w of wordsA) { if (wordsB.has(w)) overlap++; }
  return overlap / Math.max(wordsA.size, wordsB.size);
}

function renderCurrentCorrection(): void {
  const fb = currentFeedback[correctionIndex]!;
  const counter = document.getElementById('correction-counter')!;
  counter.textContent = `(${correctionIndex + 1}/${currentFeedback.length})`;

  document.getElementById('correction-original')!.textContent = fb.original;
  document.getElementById('correction-corrected')!.textContent = fb.corrected;
  document.getElementById('correction-explanation')!.textContent = fb.explanation;

  // Show target sentence in editable textarea
  const editArea = document.getElementById('correction-edit') as HTMLTextAreaElement;
  editArea.value = fb.original;
}

function advanceCorrection(post: DiaryPost, enInput: HTMLTextAreaElement): void {
  correctionIndex++;
  if (correctionIndex >= currentFeedback.length) {
    // Save latest feedback for next attempt's previousFeedback
    previousFeedback = currentFeedback;
  }
  if (correctionIndex < currentFeedback.length) {
    renderCurrentCorrection();
  } else {
    showCompletedView(post, enInput);
  }
}

function renderVocab(post: DiaryPost, enInput: HTMLTextAreaElement): void {
  const vocabContainer = document.getElementById('completed-vocab');
  if (!vocabContainer || !post.vocabulary || post.vocabulary.length === 0) return;

  const dismissed = new Set(post.dismissedVocab || []);
  const visible = post.vocabulary.filter((v) => !dismissed.has(v.word));
  if (visible.length === 0) { vocabContainer.style.display = 'none'; return; }

  vocabContainer.innerHTML = `
    <h3 class="completed-section-title">覚えたいフレーズ</h3>
    ${visible.map((v) => `
      <div class="vocab-item" data-word="${escapeAttr(v.word)}">
        <span class="vocab-en">${escapeHTML(v.word)}</span>
        <span class="vocab-jp">${escapeHTML(v.definition)}</span>
        <span class="vocab-example">${escapeHTML(v.example)}</span>
        <button class="btn btn-sm btn-secondary bookmark-btn" data-en="${escapeAttr(v.word)}" data-jp="${escapeAttr(v.definition)}">Flashcard</button>
        <button class="vocab-dismiss" title="非表示">×</button>
      </div>
    `).join('')}
  `;
  vocabContainer.style.display = 'block';
  attachBookmarkListeners(vocabContainer, post.userTranslation || enInput.value);
  enableTextSelectionBookmark(vocabContainer);

  function dismissWord(word: string, itemEl: HTMLElement): void {
    dismissed.add(word);
    post.dismissedVocab = Array.from(dismissed);
    itemEl.remove();
    if (!vocabContainer!.querySelector('.vocab-item')) vocabContainer!.style.display = 'none';
    // Save dismissed state
    const dateInput = document.getElementById('input-date') as HTMLInputElement;
    api.post('/diary/posts', {
      contentJp: (document.getElementById('input-jp') as HTMLTextAreaElement).value,
      userTranslation: enInput.value,
      date: dateInput.value,
      textOnly: true,
      mode: currentMode,
      dismissedVocab: post.dismissedVocab,
    }).catch(() => {});
  }

  // Dismiss buttons
  vocabContainer.querySelectorAll('.vocab-dismiss').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = (btn as HTMLElement).closest('.vocab-item') as HTMLElement;
      const word = item.dataset.word || '';
      dismissWord(word, item);
    });
  });

  // Auto-dismiss after Flashcard save
  vocabContainer.querySelectorAll('.bookmark-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      setTimeout(() => {
        const item = (btn as HTMLElement).closest('.vocab-item') as HTMLElement;
        const word = item.dataset.word || '';
        item.style.opacity = '0.4';
        (btn as HTMLButtonElement).textContent = '✓ 保存済';
        (btn as HTMLButtonElement).disabled = true;
        dismissWord(word, item);
      }, 1500);
    }, { once: true });
  });
}

function updateHeaderDate(): void {
  const dateInput = document.getElementById('input-date') as HTMLInputElement;
  const headerH2 = document.querySelector('.editor-header h2');
  if (headerH2 && dateInput?.value) {
    headerH2.innerHTML = `${lucideIcon(MODE_ICON_NAMES[currentMode] || 'Moon')} ${escapeHTML(dateInput.value)}`;
  }
}

/** Split diary text into sentences, preserving original positions */
function splitSentences(text: string): { text: string; end: number }[] {
  const results: { text: string; end: number }[] = [];
  const regex = /[^.!?]*[.!?]+\s*/g;
  let match: RegExpExecArray | null;
  let lastEnd = 0;
  while ((match = regex.exec(text)) !== null) {
    results.push({ text: match[0].trim(), end: match.index + match[0].length });
    lastEnd = match.index + match[0].length;
  }
  // Remaining text without sentence-ending punctuation
  const remainder = text.slice(lastEnd).trim();
  if (remainder) {
    results.push({ text: remainder, end: text.length });
  }
  return results;
}

/** Show insertion point picker — user taps where to insert the text */
function showInsertionPicker(enInput: HTMLTextAreaElement, textToInsert: string): Promise<void> {
  return new Promise((resolve) => {
    const diary = enInput.value;
    const sentences = splitSentences(diary);

    const overlay = document.createElement('div');
    overlay.className = 'insertion-picker-overlay';

    const panel = document.createElement('div');
    panel.className = 'insertion-picker';

    const title = document.createElement('div');
    title.className = 'insertion-picker-title';
    title.textContent = '挿入する場所を選択';
    panel.appendChild(title);

    const preview = document.createElement('div');
    preview.className = 'insertion-picker-preview';
    panel.appendChild(preview);

    function insertAt(pos: number): void {
      const before = diary.slice(0, pos).trimEnd();
      const after = diary.slice(pos).trimStart();
      enInput.value = before + (before ? ' ' : '') + textToInsert + (after ? ' ' + after : '');
      overlay.remove();
      panel.remove();
      resolve();
    }

    // "Insert at beginning" slot
    const topSlot = document.createElement('button');
    topSlot.className = 'insertion-slot';
    topSlot.textContent = '▼ ここに挿入';
    topSlot.addEventListener('click', () => insertAt(0));
    preview.appendChild(topSlot);

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
      overlay.remove();
      panel.remove();
      resolve();
    });

    document.body.appendChild(overlay);
    document.body.appendChild(panel);
  });
}

function showCompletedView(post: DiaryPost, enInput: HTMLTextAreaElement): void {
  // Save corrected text if changed
  const correctedText = enInput.value.trim();
  if (correctedText && correctedText !== (post.userTranslation || '')) {
    const dateInput = document.getElementById('input-date') as HTMLInputElement;
    api.post('/diary/posts', {
      contentJp: (document.getElementById('input-jp') as HTMLTextAreaElement).value,
      userTranslation: correctedText,
      date: dateInput.value,
      textOnly: true,
      mode: currentMode,
    }).catch(() => {});
  }

  // Hide correction UI and JP input
  const correctionCard = document.getElementById('correction-card')!;
  const correctionArea = document.getElementById('correction-area')!;
  correctionCard.style.display = 'none';
  correctionArea.style.display = 'none';
  document.querySelectorAll('.editor-section').forEach((s) => (s as HTMLElement).style.display = 'none');
  document.getElementById('hint-btn')!.style.display = 'none';

  // Show writing area with readonly English
  const writingArea = document.getElementById('writing-area')!;
  writingArea.classList.remove('two-col');
  writingArea.style.display = 'block';
  const writingRef = document.getElementById('writing-ref')!;
  writingRef.style.display = 'none';

  enInput.readOnly = true;
  enInput.classList.add('readonly');

  // Add selectable text overlay for Flashcard bookmarking
  const existingOverlay = enInput.parentNode!.querySelector('.diary-text-selectable');
  if (existingOverlay) existingOverlay.remove();
  const diaryTextDiv = document.createElement('div');
  diaryTextDiv.className = 'diary-text-selectable';
  diaryTextDiv.textContent = enInput.value;
  enInput.style.display = 'none';
  enInput.parentNode!.insertBefore(diaryTextDiv, enInput.nextSibling);
  enableTextSelectionBookmark(diaryTextDiv);

  updateHeaderDate();

  const translateBtn = document.getElementById('translate-btn')!;
  translateBtn.textContent = 'もう一度添削する';
  translateBtn.className = 'btn btn-ghost btn-retranslate';

  // Edit button
  const existingEditBtn = translateBtn.parentNode!.querySelector('.btn-edit-diary');
  if (!existingEditBtn) {
    const jpInput = document.getElementById('input-jp') as HTMLTextAreaElement;
    const dateInput = document.getElementById('input-date') as HTMLInputElement;
    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-ghost btn-retranslate btn-edit-diary';
    editBtn.textContent = '編集する';
    translateBtn.parentNode!.insertBefore(editBtn, translateBtn);

    editBtn.addEventListener('click', () => {
      diaryTextDiv.style.display = 'none';
      enInput.style.display = '';
      enInput.readOnly = false;
      enInput.classList.remove('readonly');
      enInput.classList.add('editor-textarea-minimal', 'en-textarea');
      editBtn.style.display = 'none';
      translateBtn.style.display = 'none';

      const saveBtn = document.createElement('button');
      saveBtn.className = 'btn btn-primary';
      saveBtn.textContent = '保存する';
      saveBtn.style.width = '100%';
      saveBtn.style.marginTop = '12px';
      enInput.parentNode!.insertBefore(saveBtn, enInput.nextSibling);

      saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        saveBtn.textContent = '保存中...';
        try {
          await api.post('/diary/posts', {
            contentJp: jpInput.value,
            userTranslation: enInput.value,
            date: dateInput.value,
            textOnly: true,
            mode: currentMode,
          });
          // Update overlay with edited text
          const savedText = enInput.value;
          diaryTextDiv.textContent = savedText;
          diaryTextDiv.style.display = '';
          enInput.style.display = 'none';
          enInput.readOnly = true;
          enInput.classList.add('readonly');
          saveBtn.remove();
          editBtn.style.display = '';
          translateBtn.style.display = '';
          showToast('保存しました');
        } catch {
          showToast('保存に失敗しました');
          saveBtn.disabled = false;
          saveBtn.textContent = '保存する';
        }
      });

      enInput.focus();
    });
  }

  // Show vocabulary
  renderVocab(post, enInput);

  // Show expansion questions
  renderExpansionQuestions(post, enInput);

  // Show lesson sheet button
  renderLessonSheetButton(post);

  // Re-show editor header (back button)
  const editorHeader = document.querySelector('.editor-header') as HTMLElement;
  if (editorHeader) editorHeader.style.display = '';

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderExpansionQuestions(post: DiaryPost, enInput: HTMLTextAreaElement): void {
  const section = document.getElementById('expansion-section')!;
  const container = document.getElementById('expansion-questions')!;
  const questions = post.expansionQuestions;
  if (!questions || questions.length === 0) {
    section.style.display = 'none';
    return;
  }

  container.innerHTML = questions.map((q, i) => `
    <div class="expansion-card ${q.reflected ? 'reflected' : ''}" data-index="${i}">
      <div class="expansion-question">${escapeHTML(q.question)}</div>
      ${q.reflected ? `<div class="expansion-result" style="display:block;"><div class="expansion-reflected">${lucideIcon('CheckCircle', 14)} 追記しました</div></div>` : ''}
      ${q.hintPhrases && q.hintPhrases.length > 0 && !q.reflected ? `<div class="expansion-phrases">${q.hintPhrases.map((p) => `<span class="expansion-phrase">${escapeHTML(p)}</span>`).join('')}</div>` : ''}
      <div class="expansion-answer-area" ${q.reflected ? 'style="display:none;"' : ''}>
        <textarea class="expansion-input" rows="2" placeholder="英語で答えてみましょう"></textarea>
        <button class="btn btn-sm btn-primary expansion-submit">添削</button>
      </div>
      <div class="expansion-result" style="display:none;"></div>
    </div>
  `).join('');

  // Remove existing "more" button if any
  section.querySelector('.expansion-more-wrap')?.remove();

  section.style.display = 'block';

  // Enable text selection → Flashcard on expansion section
  enableTextSelectionBookmark(container);

  const totalCards = questions.length;
  let doneCount = questions.filter((q) => q.reflected).length;

  function checkAllDone(): void {
    if (doneCount < totalCards) return;
    // All cards answered — show "もっと膨らませる" button
    let moreWrap = section.querySelector('.expansion-more-wrap') as HTMLElement | null;
    if (!moreWrap) {
      moreWrap = document.createElement('div');
      moreWrap.className = 'expansion-more-wrap';
      moreWrap.innerHTML = '<button class="btn btn-primary expansion-more-btn">もっと膨らませる</button>';
      section.appendChild(moreWrap);

      moreWrap.querySelector('.expansion-more-btn')!.addEventListener('click', async () => {
        const btn = moreWrap!.querySelector('.expansion-more-btn') as HTMLButtonElement;
        btn.disabled = true;
        btn.innerHTML = '<span class="loading-spinner"></span> 生成中...';
        try {
          const dateInput = document.getElementById('input-date') as HTMLInputElement;
          const res = await api.post<{ expansionQuestions: DiaryPost['expansionQuestions'] }>('/diary/expand', {
            contentJp: (document.getElementById('input-jp') as HTMLTextAreaElement).value,
            userTranslation: enInput.value,
            date: dateInput.value,
            mode: currentMode,
          });
          if (res.expansionQuestions && res.expansionQuestions.length > 0) {
            renderExpansionQuestions({ ...post, expansionQuestions: res.expansionQuestions }, enInput);
          } else {
            showToast('質問を生成できませんでした');
          }
        } catch (_err) {
          showToast('生成に失敗しました');
        } finally {
          btn.disabled = false;
          btn.textContent = 'もっと膨らませる';
        }
      });
    }
  }

  function markCardDone(): void {
    doneCount++;
    checkAllDone();
  }

  // Check if all already done on load
  checkAllDone();

  // Attach handlers
  container.querySelectorAll('.expansion-card').forEach((card) => {
    // Skip already reflected cards
    if ((card as HTMLElement).classList.contains('reflected')) return;

    const submitBtn = card.querySelector('.expansion-submit') as HTMLButtonElement;
    const input = card.querySelector('.expansion-input') as HTMLTextAreaElement;
    const resultDiv = card.querySelector('.expansion-result') as HTMLElement;

    submitBtn.addEventListener('click', async () => {
      const answer = input.value.trim();
      if (!answer) return;

      submitBtn.disabled = true;
      submitBtn.textContent = '添削中...';

      try {
        const res = await api.post<{ corrected: string; explanation: string }>('/diary/correct-answer', {
          question: card.querySelector('.expansion-question')?.textContent,
          answer,
          diaryContext: enInput.value,
        });

        const corrected = res.corrected || answer;
        const explanation = res.explanation || '';

        // Show corrected version and explanation — user edits their own text
        resultDiv.innerHTML = `
          <div class="expansion-corrected">${escapeHTML(corrected)}</div>
          ${explanation ? `<div class="expansion-explanation">${escapeHTML(explanation)}</div>` : ''}
        `;
        resultDiv.style.display = 'block';

        // Keep original text in textarea for user to fix themselves
        submitBtn.textContent = '日記に追記';
        submitBtn.disabled = false;

        // Replace submit handler with reflect handler
        const newBtn = submitBtn.cloneNode(true) as HTMLButtonElement;
        submitBtn.replaceWith(newBtn);
        newBtn.addEventListener('click', async () => {
          const finalText = input.value.trim();
          if (!finalText) return;

          newBtn.disabled = true;
          await showInsertionPicker(enInput, finalText);

          enInput.readOnly = false;
          enInput.classList.remove('readonly');

          // Update selectable text overlay with new diary content
          const textOverlay = enInput.parentNode!.querySelector('.diary-text-selectable');
          if (textOverlay) textOverlay.textContent = enInput.value;

          input.style.display = 'none';
          newBtn.style.display = 'none';
          resultDiv.innerHTML = `<div class="expansion-reflected">${lucideIcon('CheckCircle', 14)} 追記しました</div>`;
          resultDiv.style.display = 'block';

          // Mark this question as reflected and save state
          const cardIndex = parseInt((card as HTMLElement).dataset.index || '0', 10);
          if (questions[cardIndex]) {
            questions[cardIndex].reflected = true;
            questions[cardIndex].answer = finalText;
          }
          markCardDone();

          setTimeout(() => {
            enInput.readOnly = true;
            enInput.classList.add('readonly');
          }, 0);

          const dateInput = document.getElementById('input-date') as HTMLInputElement;
          api.post('/diary/posts', {
            contentJp: (document.getElementById('input-jp') as HTMLTextAreaElement).value,
            userTranslation: enInput.value,
            date: dateInput.value,
            textOnly: true,
            mode: currentMode,
            expansionQuestions: questions,
          }).catch(() => {});

          showToast('日記に追記しました');
        });
      } catch (_err) {
        showToast('添削に失敗しました');
        submitBtn.disabled = false;
        submitBtn.textContent = '添削';
      }
    });
  });
}

function renderLessonSheetButton(post: DiaryPost): void {
  const section = document.getElementById('lesson-sheet-section')!;
  const btn = document.getElementById('lesson-sheet-btn') as HTMLButtonElement;

  // Only show if diary has been corrected (has userTranslation)
  if (!post.userTranslation) {
    section.style.display = 'none';
    return;
  }

  // If lesson sheet already exists, show link instead
  if (post.lessonSheetId) {
    section.style.display = 'block';
    btn.textContent = 'レッスンシートを開く';
    btn.className = 'btn btn-ghost btn-lesson-sheet';
    btn.onclick = () => {
      window.open(`/s/${post.lessonSheetId}`, '_blank');
    };
    return;
  }

  section.style.display = 'block';

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.innerHTML = '<span class="loading-spinner"></span> 生成中...';

    try {
      const dateInput = document.getElementById('input-date') as HTMLInputElement;
      const postId = `${post.userId}_${dateInput.value}_${currentMode}`;
      const res = await api.post<{ shareId: string }>('/diary/lesson-sheet', { postId });

      post.lessonSheetId = res.shareId;
      btn.textContent = 'レッスンシートを開く';
      btn.className = 'btn btn-ghost btn-lesson-sheet';
      btn.disabled = false;
      btn.onclick = () => {
        window.open(`/s/${res.shareId}`, '_blank');
      };

      // Copy URL to clipboard
      const url = `${location.origin}/s/${res.shareId}`;
      await navigator.clipboard.writeText(url);
      showToast('URLをコピーしました');
    } catch {
      showToast('生成に失敗しました');
      btn.disabled = false;
      btn.textContent = 'レッスンシートを作る';
    }
  });
}

// ─── Rendering helpers ───

/** Activate 2-column writing mode: JP sticky on top, hints on left, EN on right */
function activateWritingMode(jpText: string): void {
  // Copy JP text to sticky panel
  const refJp = document.getElementById('writing-ref-jp')!;
  refJp.textContent = jpText;
  document.getElementById('writing-ref-jp-sticky')!.style.display = '';

  // Show writing area and add 2-column class
  const writingArea = document.getElementById('writing-area')!;
  writingArea.style.display = '';
  writingArea.classList.add('two-col');

  // Set CSS variable for writing-input sticky offset
  requestAnimationFrame(() => {
    const jpSticky = document.getElementById('writing-ref-jp-sticky')!;
    const height = jpSticky.offsetHeight;
    writingArea.style.setProperty('--jp-sticky-height', `${height}px`);
  });

  // Mobile: floating JP toggle button + overlay
  setupMobileJpToggle(jpText);

  // Scroll to writing area
  writingArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function setupMobileJpToggle(jpText: string): void {
  // Remove existing if any
  document.querySelector('.jp-float-btn')?.remove();
  document.querySelector('.jp-overlay')?.remove();

  const btn = document.createElement('button');
  btn.className = 'jp-float-btn';
  btn.textContent = 'JP';
  btn.type = 'button';

  const overlay = document.createElement('div');
  overlay.className = 'jp-overlay';
  overlay.textContent = jpText;

  document.body.appendChild(overlay);
  document.body.appendChild(btn);

  btn.addEventListener('click', () => {
    const showing = overlay.classList.toggle('show');
    btn.classList.toggle('active', showing);
  });

  // Close on outside tap
  document.addEventListener('click', (e) => {
    if (overlay.classList.contains('show') && !overlay.contains(e.target as Node) && !btn.contains(e.target as Node)) {
      overlay.classList.remove('show');
      btn.classList.remove('active');
    }
  });
}

function renderHints(hints: HintItem[]): void {
  const hintsArea = document.getElementById('hints-area')!;
  const hintsList = document.getElementById('hints-list')!;

  if (hints.length === 0) {
    hintsArea.style.display = 'none';
    return;
  }

  hintsList.innerHTML = hints
    .map(
      (h) => `
      <div class="hint-item">
        <div class="hint-jp">${escapeHTML(h.japanese)}</div>
        <div class="hint-en">${escapeHTML(h.english)}</div>
        <div class="hint-note">${escapeHTML(h.note)}</div>
        <button class="btn btn-sm btn-secondary bookmark-btn" data-en="${escapeAttr(h.english)}" data-jp="${escapeAttr(h.japanese)}">Flashcard</button>
      </div>
    `
    )
    .join('');

  const jpInput = document.getElementById('jp-input') as HTMLTextAreaElement | null;
  attachBookmarkListeners(hintsList, jpInput?.value || '');

  hintsArea.style.display = 'block';
}

function attachBookmarkListeners(container: HTMLElement, context: string): void {
  container.querySelectorAll('.bookmark-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const el = btn as HTMLButtonElement;
      const english = el.dataset.en || '';
      const japanese = el.dataset.jp || '';

      el.disabled = true;
      el.textContent = '...';

      try {
        const token = await getIdToken();
        const res = await fetch(`${RJPLUS_API}/bookmarks/`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            text: english,
            type: 'expression',
            japanese,
            context,
            sourceTitle: 'Lediary',
          }),
        });

        if (!res.ok) throw new Error(`${res.status}`);
        el.textContent = '保存済';
        showToast('Flashcardに保存しました');
      } catch (_err) {
        console.error('Bookmark failed:', _err);
        el.disabled = false;
        el.textContent = 'Flashcard';
        showToast('保存に失敗しました');
      }
    });
  });
}

function escapeHTML(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

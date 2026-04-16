/**
 * Editor page — write diary + get AI correction with step-by-step review.
 * Feedback loop inspired by ielts-akapen: one correction at a time → accept/edit → resubmit.
 */

import { api } from '../../api/client';
import { getIdToken } from '../../auth';
import { getRouteParams, navigate } from '../../router';
import { showToast } from '../../components/toast';
import { enableTextSelectionBookmark } from '../../components/text-selection-bookmark';

interface DiaryPost {
  id: string;
  contentJp: string;
  userTranslation?: string;
  date?: string;
  feedback?: FeedbackItem[];
  vocabulary?: VocabItem[];
  expansionQuestions?: ExpansionQuestion[];
  hints?: HintItem[];
  accumulatedCorrections?: string[];
}

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
  afterSentence: string;
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
let accumulatedCorrections: string[] = [];
let attemptCount = 0;

export function editorHTML(): string {
  return `
    <div class="editor-header">
      <button class="back-btn" id="back-btn">&larr;</button>
      <h2>日記を書く</h2>
    </div>

    <div class="editor-section">
      <label>日付</label>
      <input type="date" id="input-date" />
    </div>

    <div class="editor-section">
      <label>日本語で3行日記</label>
      <textarea id="input-jp" rows="4" placeholder="今日あったことを日本語で3行書いてみましょう"></textarea>
    </div>

    <button id="hint-btn" class="btn btn-secondary" style="width:100%;margin-bottom:16px;">英訳ヒントを見る</button>

    <div id="writing-area" class="writing-area">
      <div class="writing-ref" id="writing-ref">
        <div class="writing-ref-jp" id="writing-ref-jp"></div>
        <div id="hints-area" class="hints-area" style="display:none;">
          <h3>英訳ヒント</h3>
          <div id="hints-list"></div>
        </div>
      </div>
      <div class="writing-input">
        <label>自分で英訳してみる</label>
        <textarea id="input-en" rows="8" placeholder="日本語の内容を英語で書いてみましょう"></textarea>
        <button id="translate-btn" class="btn btn-primary" style="width:100%;margin-top:12px;">添削してもらう</button>
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
  `;
}

export async function initEditor(): Promise<void> {
  const params = getRouteParams();
  const postId = params.id;

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

  // If editing existing post, load it
  if (postId) {
    try {
      const post = await api.get<DiaryPost>(`/diary/posts/${postId}`);
      jpInput.value = post.contentJp;
      if (post.userTranslation) enInput.value = post.userTranslation;
      if (post.date) dateInput.value = post.date;
      if (post.accumulatedCorrections) accumulatedCorrections = post.accumulatedCorrections;

      if (post.userTranslation) {
        // Already corrected — show read-only EN text + resubmit
        const writingArea = document.getElementById('writing-area')!;
        writingArea.style.display = 'block';
        const writingRef = document.getElementById('writing-ref')!;
        writingRef.style.display = 'none';
        enInput.readOnly = true;
        enInput.classList.add('readonly');
        translateBtn.textContent = 'もう一度添削する';

        // Replace label with completion badge
        const enLabel = enInput.previousElementSibling;
        if (enLabel?.tagName === 'LABEL') {
          (enLabel as HTMLElement).innerHTML = `<span class="completion-badge">✅ ${post.date || 'Today'}'s Diary</span>`;
          (enLabel as HTMLElement).classList.add('completion-label');
        }

        // Hide sections above writing area
        const editorSections = document.querySelectorAll('.editor-section');
        editorSections.forEach((s) => (s as HTMLElement).style.display = 'none');
        const hintBtn = document.getElementById('hint-btn')!;
        hintBtn.style.display = 'none';

        // Show vocabulary with Flashcard buttons
        const vocabContainer = document.getElementById('completed-vocab');
        if (vocabContainer && post.vocabulary && post.vocabulary.length > 0) {
          vocabContainer.innerHTML = `
            <h3 class="completed-section-title">覚えたいフレーズ</h3>
            ${post.vocabulary.map((v) => `
              <div class="vocab-item">
                <div class="vocab-text">
                  <div class="vocab-en">${escapeHTML(v.word)}</div>
                  <div class="vocab-jp">${escapeHTML(v.definition)}</div>
                  <div class="vocab-example">${escapeHTML(v.example)}</div>
                </div>
                <button class="btn btn-sm btn-secondary bookmark-btn" data-en="${escapeAttr(v.word)}" data-jp="${escapeAttr(v.definition)}">Flashcard</button>
              </div>
            `).join('')}
          `;
          vocabContainer.style.display = 'block';
          attachBookmarkListeners(vocabContainer, post.userTranslation || '');
        }
      } else if (post.hints && post.hints.length > 0) {
        renderHints(post.hints);
        activateWritingMode(post.contentJp);
      }
    } catch (_err) {
      console.error('Failed to load post:', _err);
      showToast('日記の読み込みに失敗しました');
    }
  }

  // Hint button
  const hintBtn = document.getElementById('hint-btn') as HTMLButtonElement;
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
      const res = await api.post<{ hints: HintItem[] }>('/diary/hints', { contentJp, date });
      renderHints(res.hints);
      activateWritingMode(jpInput.value);
    } catch (_err) {
      console.error('Hint generation failed:', _err);
      showToast('ヒント生成に失敗しました');
    } finally {
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
      showToast('まず自分で英訳してみましょう');
      return;
    }

    translateBtn.disabled = true;
    translateBtn.innerHTML = '<span class="loading-spinner"></span> 添削中...';
    correctionArea.style.display = 'none';

    try {
      const date = dateInput.value;
      const body: Record<string, unknown> = {
        contentJp,
        userTranslation,
        date,
        previousCorrections: accumulatedCorrections,
      };

      const post = await api.post<DiaryPost>('/diary/posts', body);
      attemptCount++;

      // Clear readonly state if re-correcting
      if (enInput.readOnly) {
        enInput.readOnly = false;
        enInput.classList.remove('readonly');
        const enLabel = enInput.previousElementSibling;
        if (enLabel?.tagName === 'LABEL') {
          (enLabel as HTMLElement).textContent = '自分で英訳してみる';
          (enLabel as HTMLElement).classList.remove('completion-label');
        }
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
    accumulatedCorrections.push(editedSnippet);
    advanceCorrection(post, enInput);
  });
}

/** Apply edited sentence back into the full text */
function applySnippetToFullText(enInput: HTMLTextAreaElement, _fbIndex: number, editedSnippet: string): void {
  const fb = currentFeedback[_fbIndex]!;
  const fullText = enInput.value;
  if (fullText.includes(fb.original)) {
    enInput.value = fullText.replace(fb.original, editedSnippet);
  }
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
  if (correctionIndex < currentFeedback.length) {
    renderCurrentCorrection();
  } else {
    showCompletedView(post, enInput);
  }
}

function showCompletedView(post: DiaryPost, enInput: HTMLTextAreaElement): void {
  // Hide correction UI
  const correctionCard = document.getElementById('correction-card')!;
  const correctionArea = document.getElementById('correction-area')!;
  correctionCard.style.display = 'none';
  correctionArea.style.display = 'none';

  // Show writing area with readonly English
  const writingArea = document.getElementById('writing-area')!;
  writingArea.classList.remove('two-col');
  writingArea.style.display = 'block';
  const writingRef = document.getElementById('writing-ref')!;
  writingRef.style.display = 'none';

  enInput.readOnly = true;
  enInput.classList.add('readonly');

  const enLabel = enInput.previousElementSibling;
  if (enLabel?.tagName === 'LABEL') {
    (enLabel as HTMLElement).innerHTML = `<span class="completion-badge">✅ ${post.date || "Today"}'s Diary</span>`;
    (enLabel as HTMLElement).classList.add('completion-label');
  }

  const translateBtn = document.getElementById('translate-btn')!;
  translateBtn.textContent = 'もう一度添削する';

  // Show vocabulary with Flashcard buttons
  const vocabContainer = document.getElementById('completed-vocab');
  if (vocabContainer && post.vocabulary && post.vocabulary.length > 0) {
    vocabContainer.innerHTML = `
      <h3 class="completed-section-title">覚えたいフレーズ</h3>
      ${post.vocabulary.map((v) => `
        <div class="vocab-item">
          <div class="vocab-text">
            <div class="vocab-en">${escapeHTML(v.word)}</div>
            <div class="vocab-jp">${escapeHTML(v.definition)}</div>
            <div class="vocab-example">${escapeHTML(v.example)}</div>
          </div>
          <button class="btn btn-sm btn-secondary bookmark-btn" data-en="${escapeAttr(v.word)}" data-jp="${escapeAttr(v.definition)}">Flashcard</button>
        </div>
      `).join('')}
    `;
    vocabContainer.style.display = 'block';
    attachBookmarkListeners(vocabContainer, post.userTranslation || enInput.value);
    enableTextSelectionBookmark(vocabContainer);
  }

  // Show expansion questions
  renderExpansionQuestions(post, enInput);

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
    <div class="expansion-card" data-index="${i}" data-after="${escapeAttr(q.afterSentence)}">
      <div class="expansion-question">${escapeHTML(q.question)}</div>
      <div class="expansion-hint">${escapeHTML(q.hintJa)}</div>
      <div class="expansion-answer-area">
        <textarea class="expansion-input" rows="2" placeholder="英語で答えてみましょう"></textarea>
        <button class="btn btn-sm btn-primary expansion-submit">添削</button>
      </div>
      <div class="expansion-result" style="display:none;"></div>
    </div>
  `).join('');

  section.style.display = 'block';

  // Attach handlers
  container.querySelectorAll('.expansion-card').forEach((card) => {
    const submitBtn = card.querySelector('.expansion-submit') as HTMLButtonElement;
    const input = card.querySelector('.expansion-input') as HTMLTextAreaElement;
    const resultDiv = card.querySelector('.expansion-result') as HTMLElement;
    const afterSentence = (card as HTMLElement).dataset.after || '';

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

        resultDiv.innerHTML = `
          <div class="expansion-corrected">${escapeHTML(corrected)}</div>
          ${explanation ? `<div class="expansion-explanation">${escapeHTML(explanation)}</div>` : ''}
          <button class="btn btn-sm btn-primary expansion-reflect">日記に反映する</button>
        `;
        resultDiv.style.display = 'block';
        input.style.display = 'none';
        submitBtn.style.display = 'none';

        // Attach reflect handler
        resultDiv.querySelector('.expansion-reflect')!.addEventListener('click', () => {
          // Insert after the matching sentence
          const diary = enInput.value;
          const insertPos = diary.indexOf(afterSentence);
          if (insertPos >= 0) {
            const endPos = insertPos + afterSentence.length;
            enInput.value = diary.slice(0, endPos) + ' ' + corrected + diary.slice(endPos);
          } else {
            // Fallback: append to end
            enInput.value = diary.trimEnd() + ' ' + corrected;
          }
          enInput.readOnly = false;
          enInput.classList.remove('readonly');

          // Mark as reflected
          resultDiv.innerHTML = `<div class="expansion-reflected">✅ 反映しました</div>`;

          // Update readonly display
          setTimeout(() => {
            enInput.readOnly = true;
            enInput.classList.add('readonly');
          }, 0);

          showToast('日記に反映しました');
        });
      } catch (_err) {
        showToast('添削に失敗しました');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '添削';
      }
    });
  });
}

// ─── Rendering helpers ───

/** Activate 2-column writing mode: JP+hints on left (sticky), EN on right */
function activateWritingMode(jpText: string): void {
  // Copy JP text to reference panel
  const refJp = document.getElementById('writing-ref-jp')!;
  refJp.textContent = jpText;

  // Add 2-column class
  const writingArea = document.getElementById('writing-area')!;
  writingArea.classList.add('two-col');

  // Scroll to writing area
  writingArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

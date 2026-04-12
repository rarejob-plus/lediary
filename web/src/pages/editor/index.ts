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
  contentEn: string;
  date?: string;
  feedback?: FeedbackItem[];
  vocabulary?: VocabItem[];
  expectedQuestions?: QuestionItem[];
  hints?: HintItem[];
  accumulatedCorrections?: string[];
  attemptCount?: number;
  createdAt: number;
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

interface QuestionItem {
  question: string;
  hintJa: string;
}

interface HintItem {
  japanese: string;
  english: string;
  note: string;
}

const RJPLUS_API = 'https://rarejob-plus-api-121737888244.asia-northeast1.run.app/api';

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

    <div id="hints-area" class="hints-area" style="display:none;">
      <h3>英訳ヒント</h3>
      <div id="hints-list"></div>
    </div>

    <div class="editor-section">
      <label>自分で英訳してみる</label>
      <textarea id="input-en" rows="4" placeholder="日本語の内容を英語で書いてみましょう"></textarea>
    </div>

    <button id="translate-btn" class="btn btn-primary" style="width:100%;margin-bottom:24px;">添削してもらう</button>

    <!-- Step-by-step correction review -->
    <div id="correction-area" class="correction-area" style="display:none;">
      <div class="correction-header">
        <h3>添削 <span id="correction-counter"></span></h3>
        <span id="attempt-badge" class="attempt-badge"></span>
      </div>
      <div id="correction-card" class="correction-card">
        <div class="feedback-label">あなたの文</div>
        <div id="correction-original" class="feedback-original"></div>
        <div class="feedback-label">修正案</div>
        <div id="correction-corrected" class="feedback-corrected"></div>
        <div id="correction-explanation" class="feedback-explanation"></div>
        <div class="correction-actions">
          <button id="correction-accept" class="btn btn-primary btn-sm">修正を適用</button>
          <button id="correction-skip" class="btn btn-ghost btn-sm">そのまま</button>
        </div>
      </div>
      <div id="correction-complete" class="correction-complete" style="display:none;">
        <p id="correction-complete-text"></p>
        <button id="resubmit-btn" class="btn btn-primary" style="width:100%;">修正版を再添削する</button>
      </div>
    </div>

    <!-- Results (shown after correction review) -->
    <div id="results-area" class="results-area">
      <div id="result-english" class="result-section">
        <h3>AI模範英訳</h3>
        <div id="result-english-text" class="result-english"></div>
      </div>

      <div id="result-vocab" class="result-section" style="display:none;">
        <h3>語彙</h3>
        <div id="result-vocab-list"></div>
      </div>

      <div id="result-questions" class="result-section" style="display:none;">
        <h3>予想される質問</h3>
        <div id="result-questions-list"></div>
      </div>
    </div>
  `;
}

export async function initEditor(): Promise<void> {
  const params = getRouteParams();
  const postId = params.id;

  document.getElementById('back-btn')?.addEventListener('click', () => {
    navigate('/');
  });

  const dateInput = document.getElementById('input-date') as HTMLInputElement;
  const jpInput = document.getElementById('input-jp') as HTMLTextAreaElement;
  const enInput = document.getElementById('input-en') as HTMLTextAreaElement;
  const translateBtn = document.getElementById('translate-btn') as HTMLButtonElement;
  const resultsArea = document.getElementById('results-area')!;
  const correctionArea = document.getElementById('correction-area')!;

  // Default date: today, but before 4:00 AM → yesterday
  const now = new Date();
  if (now.getHours() < 4) {
    now.setDate(now.getDate() - 1);
  }
  dateInput.value = now.toISOString().slice(0, 10);

  // If editing existing post, load it
  if (postId) {
    try {
      const post = await api.get<DiaryPost>(`/diary/posts/${postId}`);
      jpInput.value = post.contentJp;
      if (post.userTranslation) enInput.value = post.userTranslation;
      if (post.date) dateInput.value = post.date;
      if (post.accumulatedCorrections) accumulatedCorrections = post.accumulatedCorrections;
      if (post.attemptCount) attemptCount = post.attemptCount;

      if (post.hints && post.hints.length > 0) {
        renderHints(post.hints);
      }

      if (post.contentEn) {
        renderResultsOnly(post);
        resultsArea.classList.add('visible');
        translateBtn.textContent = 'もう一度添削する';
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
    resultsArea.classList.remove('visible');

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

      if (post.feedback && post.feedback.length > 0) {
        // Start step-by-step correction review
        currentFeedback = post.feedback;
        correctionIndex = 0;
        startCorrectionReview(post, enInput);
      } else {
        // No corrections needed — show results directly
        showToast('修正点はありません！');
        renderResultsOnly(post);
        resultsArea.classList.add('visible');
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

  // Resubmit button
  document.getElementById('resubmit-btn')?.addEventListener('click', () => {
    correctionArea.style.display = 'none';
    submitForCorrection();
  });
}

// ─── Step-by-step correction review ───

function startCorrectionReview(post: DiaryPost, enInput: HTMLTextAreaElement): void {
  const correctionArea = document.getElementById('correction-area')!;
  const correctionComplete = document.getElementById('correction-complete')!;
  const correctionCard = document.getElementById('correction-card')!;
  const resultsArea = document.getElementById('results-area')!;

  // Store post for later use in results
  correctionArea.dataset.postJson = JSON.stringify(post);

  // Hide ALL content above correction area by wrapping in a container check
  const appEl = document.getElementById('app')!;
  for (let i = 0; i < appEl.children.length; i++) {
    const child = appEl.children[i] as HTMLElement;
    if (child.id === 'correction-area' || child.id === 'results-area') continue;
    child.style.display = 'none';
  }

  correctionArea.style.display = 'block';
  correctionComplete.style.display = 'none';
  correctionCard.style.display = 'block';
  resultsArea.classList.remove('visible');

  const attemptBadge = document.getElementById('attempt-badge')!;
  attemptBadge.textContent = attemptCount > 1 ? `${attemptCount}回目` : '';

  renderCurrentCorrection();

  // Scroll to top to show correction card
  window.scrollTo(0, 0);

  // Accept button
  const acceptBtn = document.getElementById('correction-accept')!;
  const skipBtn = document.getElementById('correction-skip')!;

  // Remove old listeners by replacing elements
  const newAccept = acceptBtn.cloneNode(true) as HTMLButtonElement;
  const newSkip = skipBtn.cloneNode(true) as HTMLButtonElement;
  acceptBtn.replaceWith(newAccept);
  skipBtn.replaceWith(newSkip);

  newAccept.addEventListener('click', () => {
    const fb = currentFeedback[correctionIndex]!;
    // Apply correction to textarea
    const current = enInput.value;
    const updated = current.replace(fb.original, fb.corrected);
    if (updated !== current) {
      enInput.value = updated;
    }
    accumulatedCorrections.push(fb.corrected);
    advanceCorrection(post, enInput);
  });

  newSkip.addEventListener('click', () => {
    advanceCorrection(post, enInput);
  });
}

function renderCurrentCorrection(): void {
  const fb = currentFeedback[correctionIndex]!;
  const counter = document.getElementById('correction-counter')!;
  counter.textContent = `(${correctionIndex + 1}/${currentFeedback.length})`;

  document.getElementById('correction-original')!.textContent = fb.original;
  document.getElementById('correction-corrected')!.textContent = fb.corrected;
  document.getElementById('correction-explanation')!.textContent = fb.explanation;
}

function advanceCorrection(post: DiaryPost, enInput: HTMLTextAreaElement): void {
  correctionIndex++;
  if (correctionIndex < currentFeedback.length) {
    renderCurrentCorrection();
  } else {
    // All corrections reviewed
    const correctionCard = document.getElementById('correction-card')!;
    const correctionComplete = document.getElementById('correction-complete')!;
    const resultsArea = document.getElementById('results-area')!;

    correctionCard.style.display = 'none';
    correctionComplete.style.display = 'block';

    const completeText = document.getElementById('correction-complete-text')!;
    completeText.textContent = `${currentFeedback.length}件の添削を確認しました。英訳を修正した場合は再添削できます。`;

    // Re-show all sections
    const appEl = document.getElementById('app')!;
    for (let i = 0; i < appEl.children.length; i++) {
      const child = appEl.children[i] as HTMLElement;
      child.style.display = '';
    }
    const translateBtn = document.getElementById('translate-btn')!;
    translateBtn.textContent = 'もう一度添削する';

    // Show results (model translation, vocab, questions)
    renderResultsOnly(post);
    resultsArea.classList.add('visible');

    // Scroll to see the updated textarea
    setTimeout(() => {
      enInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  }
}

// ─── Rendering helpers ───

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
      </div>
    `
    )
    .join('');

  hintsArea.style.display = 'block';
}

/** Render results without feedback (vocab, questions, model translation). */
function renderResultsOnly(post: DiaryPost): void {
  // English model translation
  const enText = document.getElementById('result-english-text')!;
  enText.textContent = post.contentEn;

  // Vocabulary
  const vocabSection = document.getElementById('result-vocab')!;
  const vocabList = document.getElementById('result-vocab-list')!;
  if (post.vocabulary && post.vocabulary.length > 0) {
    vocabSection.style.display = 'block';
    vocabList.innerHTML = post.vocabulary
      .map(
        (v) => `
        <div class="vocab-item">
          <div class="vocab-text">
            <div class="vocab-en">${escapeHTML(v.word)}</div>
            <div class="vocab-jp">${escapeHTML(v.definition)}</div>
            <div class="vocab-example">${escapeHTML(v.example)}</div>
          </div>
          <button class="btn btn-sm btn-secondary bookmark-btn" data-en="${escapeAttr(v.word)}" data-jp="${escapeAttr(v.definition)}">Flashcard</button>
        </div>
      `
      )
      .join('');
    attachBookmarkListeners(vocabList, post.contentEn);
  } else {
    vocabSection.style.display = 'none';
  }

  // Questions
  const questionsSection = document.getElementById('result-questions')!;
  const questionsList = document.getElementById('result-questions-list')!;
  if (post.expectedQuestions && post.expectedQuestions.length > 0) {
    questionsSection.style.display = 'block';
    questionsList.innerHTML = post.expectedQuestions
      .map(
        (q) => `
        <div class="question-item">
          <div class="question-en">${escapeHTML(q.question)}</div>
          <div class="question-hint">
            ヒントを見る → <span class="question-hint-text">${escapeHTML(q.hintJa)}</span>
          </div>
        </div>
      `
      )
      .join('');

    questionsList.querySelectorAll('.question-hint').forEach((el) => {
      el.addEventListener('click', () => {
        el.querySelector('.question-hint-text')?.classList.toggle('visible');
      });
    });
  } else {
    questionsSection.style.display = 'none';
  }

  // Enable text selection → Flashcard
  const resultsArea = document.getElementById('results-area');
  if (resultsArea) {
    enableTextSelectionBookmark(resultsArea);
  }
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

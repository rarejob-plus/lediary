/**
 * Editor page — write diary + get AI translation.
 */

import { api } from '../../api/client';
import { getIdToken } from '../../auth';
import { getRouteParams, navigate } from '../../router';
import { showToast } from '../../components/toast';

interface DiaryPost {
  id: string;
  contentJp: string;
  userTranslation?: string;
  translationEn: string;
  feedback?: FeedbackItem[];
  vocabulary?: VocabItem[];
  questions?: QuestionItem[];
  createdAt: string;
}

interface FeedbackItem {
  original: string;
  corrected: string;
  explanation: string;
}

interface VocabItem {
  english: string;
  japanese: string;
}

interface QuestionItem {
  english: string;
  hintJp: string;
}

const RJPLUS_API = 'https://rarejob-plus-api-121737888244.asia-northeast1.run.app/api';

export function editorHTML(): string {
  return `
    <div class="editor-header">
      <button class="back-btn" id="back-btn">&larr;</button>
      <h2>日記を書く</h2>
    </div>

    <div class="editor-section">
      <label>日本語で3行日記</label>
      <textarea id="input-jp" rows="4" placeholder="今日あったことを日本語で3行書いてみましょう"></textarea>
    </div>

    <div class="editor-section">
      <label>自分で英訳してみる <span class="hint">（スキップ可）</span></label>
      <textarea id="input-en" rows="4" placeholder="日本語の内容を英語で書いてみましょう（スキップ可）"></textarea>
    </div>

    <button id="translate-btn" class="btn btn-primary" style="width:100%;margin-bottom:24px;">AI翻訳する</button>

    <div id="results-area" class="results-area">
      <div id="result-english" class="result-section">
        <h3>AI英訳</h3>
        <div id="result-english-text" class="result-english"></div>
      </div>

      <div id="result-feedback" class="result-section" style="display:none;">
        <h3>フィードバック</h3>
        <div id="result-feedback-list"></div>
      </div>

      <div id="result-vocab" class="result-section" style="display:none;">
        <h3>語彙</h3>
        <div id="result-vocab-list"></div>
      </div>

      <div id="result-questions" class="result-section" style="display:none;">
        <h3>予想される質問</h3>
        <div id="result-questions-list"></div>
      </div>

      <div style="display:flex;gap:8px;margin-top:16px;">
        <a id="lesson-link" href="#" class="btn btn-primary" style="flex:1;text-align:center;">レッスンモードへ</a>
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

  const jpInput = document.getElementById('input-jp') as HTMLTextAreaElement;
  const enInput = document.getElementById('input-en') as HTMLTextAreaElement;
  const translateBtn = document.getElementById('translate-btn') as HTMLButtonElement;
  const resultsArea = document.getElementById('results-area')!;

  // If editing existing post, load it
  if (postId) {
    try {
      const post = await api.get<DiaryPost>(`/diary/posts/${postId}`);
      jpInput.value = post.contentJp;
      if (post.userTranslation) enInput.value = post.userTranslation;

      if (post.translationEn) {
        renderResults(post);
        resultsArea.classList.add('visible');
        translateBtn.textContent = '再翻訳する';
      }
    } catch (err) {
      console.error('Failed to load post:', err);
      showToast('日記の読み込みに失敗しました');
    }
  }

  translateBtn.addEventListener('click', async () => {
    const contentJp = jpInput.value.trim();
    if (!contentJp) {
      showToast('日本語を入力してください');
      return;
    }

    translateBtn.disabled = true;
    translateBtn.innerHTML = '<span class="loading-spinner"></span> 翻訳中...';

    try {
      const body: Record<string, string> = { contentJp };
      const userTranslation = enInput.value.trim();
      if (userTranslation) body.userTranslation = userTranslation;

      const post = await api.post<DiaryPost>('/diary/posts', body);

      renderResults(post);
      resultsArea.classList.add('visible');
      translateBtn.textContent = '再翻訳する';

      // Update URL to reflect new post ID
      if (!postId && post.id) {
        history.replaceState(null, '', `/post/${post.id}`);
      }
    } catch (err) {
      console.error('Translation failed:', err);
      showToast('翻訳に失敗しました');
    } finally {
      translateBtn.disabled = false;
      if (translateBtn.querySelector('.loading-spinner')) {
        translateBtn.textContent = 'AI翻訳する';
      }
    }
  });
}

function renderResults(post: DiaryPost): void {
  // English translation
  const enText = document.getElementById('result-english-text')!;
  enText.textContent = post.translationEn;

  // Feedback
  const feedbackSection = document.getElementById('result-feedback')!;
  const feedbackList = document.getElementById('result-feedback-list')!;
  if (post.feedback && post.feedback.length > 0) {
    feedbackSection.style.display = 'block';
    feedbackList.innerHTML = post.feedback
      .map(
        (f) => `
        <div class="feedback-item">
          <div class="feedback-original">${escapeHTML(f.original)}</div>
          <div class="feedback-corrected">${escapeHTML(f.corrected)}</div>
          <div class="feedback-explanation">${escapeHTML(f.explanation)}</div>
        </div>
      `
      )
      .join('');
  } else {
    feedbackSection.style.display = 'none';
  }

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
            <div class="vocab-en">${escapeHTML(v.english)}</div>
            <div class="vocab-jp">${escapeHTML(v.japanese)}</div>
          </div>
          <button class="btn btn-sm btn-secondary bookmark-btn" data-en="${escapeAttr(v.english)}" data-jp="${escapeAttr(v.japanese)}">Flashcard</button>
        </div>
      `
      )
      .join('');
    attachBookmarkListeners(vocabList, post.translationEn);
  } else {
    vocabSection.style.display = 'none';
  }

  // Questions
  const questionsSection = document.getElementById('result-questions')!;
  const questionsList = document.getElementById('result-questions-list')!;
  if (post.questions && post.questions.length > 0) {
    questionsSection.style.display = 'block';
    questionsList.innerHTML = post.questions
      .map(
        (q) => `
        <div class="question-item">
          <div class="question-en">${escapeHTML(q.english)}</div>
          <div class="question-hint">
            ヒントを見る → <span class="question-hint-text">${escapeHTML(q.hintJp)}</span>
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

  // Lesson link
  const lessonLink = document.getElementById('lesson-link') as HTMLAnchorElement;
  lessonLink.href = `/lesson/${post.id}`;
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
        const res = await fetch(`${RJPLUS_API}/bookmarks`, {
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
      } catch (err) {
        console.error('Bookmark failed:', err);
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

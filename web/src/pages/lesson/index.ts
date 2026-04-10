/**
 * Lesson mode — used during RareJob lesson.
 */

import { api } from '../../api/client';
import { getIdToken } from '../../auth';
import { getRouteParams, navigate } from '../../router';
import { showToast } from '../../components/toast';

interface DiaryPost {
  id: string;
  contentJp: string;
  translationEn: string;
  questions?: QuestionItem[];
}

interface QuestionItem {
  english: string;
  hintJp: string;
}

const RJPLUS_API = 'https://rarejob-plus-api-121737888244.asia-northeast1.run.app/api';

const GREETING_TEXT = `I'd like to share my diary entry today. Let me read it to you.`;

export function lessonHTML(): string {
  return `
    <div class="lesson-page">
      <div class="editor-header">
        <button class="back-btn" id="back-btn">&larr;</button>
        <h2>Lesson Mode</h2>
      </div>

      <div class="lesson-greeting">
        <p id="greeting-text">${GREETING_TEXT}</p>
        <button class="copy-btn" id="copy-greeting-btn">Copy</button>
      </div>

      <div class="lesson-english" id="lesson-english">
        <div class="loading-overlay">
          <span class="loading-spinner"></span>
          読み込み中...
        </div>
      </div>

      <div class="lesson-questions" id="lesson-questions" style="display:none;">
        <h3>Expected Questions</h3>
        <div id="lesson-questions-list"></div>
      </div>

      <div class="lesson-fab">
        <button class="lesson-fab-btn" id="quick-add-btn" title="Flashcardに保存">+</button>
      </div>

      <div class="quick-add-form" id="quick-add-form">
        <input type="text" id="quick-add-en" placeholder="English expression" />
        <input type="text" id="quick-add-jp" placeholder="日本語" />
        <button class="btn btn-primary btn-sm" id="quick-add-submit" style="width:100%;">保存</button>
      </div>
    </div>
  `;
}

export async function initLesson(): Promise<void> {
  const params = getRouteParams();
  const postId = params.id;

  document.getElementById('back-btn')?.addEventListener('click', () => {
    if (postId) {
      navigate(`/post/${postId}`);
    } else {
      navigate('/');
    }
  });

  // Copy greeting
  document.getElementById('copy-greeting-btn')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(GREETING_TEXT);
      showToast('コピーしました');
    } catch {
      showToast('コピーに失敗しました');
    }
  });

  // Quick-add form toggle
  const quickAddBtn = document.getElementById('quick-add-btn')!;
  const quickAddForm = document.getElementById('quick-add-form')!;
  quickAddBtn.addEventListener('click', () => {
    quickAddForm.classList.toggle('visible');
  });

  // Quick-add submit
  document.getElementById('quick-add-submit')?.addEventListener('click', async () => {
    const enInput = document.getElementById('quick-add-en') as HTMLInputElement;
    const jpInput = document.getElementById('quick-add-jp') as HTMLInputElement;
    const english = enInput.value.trim();
    const japanese = jpInput.value.trim();

    if (!english) {
      showToast('英語表現を入力してください');
      return;
    }

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
          context: '',
          sourceTitle: 'Lediary',
        }),
      });

      if (!res.ok) throw new Error(`${res.status}`);
      showToast('Flashcardに保存しました');
      enInput.value = '';
      jpInput.value = '';
      quickAddForm.classList.remove('visible');
    } catch (err) {
      console.error('Quick-add failed:', err);
      showToast('保存に失敗しました');
    }
  });

  // Load post data
  if (!postId) {
    document.getElementById('lesson-english')!.innerHTML = '<p>投稿が見つかりません。</p>';
    return;
  }

  try {
    const post = await api.get<DiaryPost>(`/diary/posts/${postId}`);

    // Render English translation
    const englishEl = document.getElementById('lesson-english')!;
    englishEl.innerHTML = `<p>${escapeHTML(post.translationEn)}</p>`;

    // Render questions
    if (post.questions && post.questions.length > 0) {
      const questionsSection = document.getElementById('lesson-questions')!;
      questionsSection.style.display = 'block';
      const questionsList = document.getElementById('lesson-questions-list')!;
      questionsList.innerHTML = post.questions
        .map(
          (q) => `
          <div class="lesson-question-item">
            <div class="lesson-question-en">${escapeHTML(q.english)}</div>
            <div class="lesson-question-hint">
              ヒント → <span class="lesson-question-hint-text">${escapeHTML(q.hintJp)}</span>
            </div>
          </div>
        `
        )
        .join('');

      questionsList.querySelectorAll('.lesson-question-hint').forEach((el) => {
        el.addEventListener('click', () => {
          el.querySelector('.lesson-question-hint-text')?.classList.toggle('visible');
        });
      });
    }
  } catch (err) {
    console.error('Failed to load post:', err);
    document.getElementById('lesson-english')!.innerHTML = '<p>読み込みに失敗しました。</p>';
  }
}

function escapeHTML(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

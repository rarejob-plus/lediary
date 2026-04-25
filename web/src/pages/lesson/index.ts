/**
 * Public lesson sheet page — shared with RareJob tutors.
 * Designed to look like a RareJob WNA/DNA material page.
 * No authentication required.
 */

import { getRouteParams } from '../../router';

interface VocabItem {
  word: string;
  definition: string;
  example: string;
}

interface DiscussionTopic {
  topic: string;
  questions: string[];
}

interface LessonSheetData {
  title: string;
  articleBody: string;
  vocabulary: VocabItem[];
  discussionTopics: DiscussionTopic[];
  date: string;
}

export function lessonSheetHTML(): string {
  return `<div class="ls-page"><div class="ls-loading">Loading...</div></div>`;
}

export async function initLessonSheet(): Promise<void> {
  const { id } = getRouteParams();
  if (!id) return;

  const page = document.querySelector('.ls-page')!;

  try {
    const res = await fetch(`/api/diary/lesson-sheet/${id}`);
    if (!res.ok) {
      page.innerHTML = '<div class="ls-loading">Lesson sheet not found.</div>';
      return;
    }
    const data: LessonSheetData = await res.json();
    render(page, data);
  } catch (err) {
    console.error('[LessonSheet]', err);
    page.innerHTML = '<div class="ls-loading">Failed to load.</div>';
  }
}

function render(page: Element, data: LessonSheetData): void {
  const paragraphs = data.articleBody
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  // If only one paragraph, split by sentences for readability
  const articleChunks = paragraphs.length === 1
    ? splitIntoChunks(paragraphs[0]!)
    : paragraphs;

  page.innerHTML = `
    <div class="ls-title-bar">
      <div class="ls-category">Diary Lesson</div>
      <h1 class="ls-title">${esc(data.title)}</h1>
      ${data.date ? `<div class="ls-date">${formatDate(data.date)}</div>` : ''}
    </div>

    <div class="ls-nav">
      <span class="ls-nav-item" data-target="ls-vocab">Vocabulary</span>
      <span class="ls-nav-item" data-target="ls-article">Article</span>
      <span class="ls-nav-item" data-target="ls-discussion">Discussion</span>
    </div>

    <section id="ls-vocab" class="ls-section">
      <h2 class="ls-section-heading">Vocabulary</h2>
      ${data.vocabulary.map((v) => `
        <div class="ls-vocab-card">
          <div class="ls-vocab-word">${esc(v.word)}</div>
          <div class="ls-vocab-def">${esc(v.definition)}</div>
          ${v.example ? `<div class="ls-vocab-ex">${esc(v.example)}</div>` : ''}
        </div>
      `).join('')}
    </section>

    <section id="ls-article" class="ls-section">
      <h2 class="ls-section-heading">Article</h2>
      <div class="ls-article-body">
        ${articleChunks.map((p) => `<p class="ls-article-p">${esc(p)}</p>`).join('')}
      </div>
    </section>

    <section id="ls-discussion" class="ls-section">
      <h2 class="ls-section-heading">Discussion</h2>
      <div class="ls-discussion-grid">
      ${data.discussionTopics.map((topic, ti) => `
        <div class="ls-discussion-group">
          ${topic.topic ? `<h3 class="ls-topic-heading"><span class="ls-topic-num">Topic ${ti + 1}</span> ${esc(topic.topic)}</h3>` : ''}
          ${topic.questions.map((q, qi) => `
            <div class="ls-question">
              <span class="ls-question-num">${qi + 1}</span>
              <span class="ls-question-text">${esc(q)}</span>
            </div>
          `).join('')}
        </div>
      `).join('')}
      </div>
    </section>

    <div class="ls-footer">Powered by Lediary</div>
  `;

  // Nav click handlers
  page.querySelectorAll('.ls-nav-item').forEach((item) => {
    item.addEventListener('click', () => {
      const target = (item as HTMLElement).dataset.target;
      if (target) {
        document.getElementById(target)?.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });
}

function splitIntoChunks(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+\s*/g) || [text];
  const chunks: string[] = [];
  let current = '';
  for (const s of sentences) {
    current += s;
    if (current.length > 80) {
      chunks.push(current.trim());
      current = '';
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

function esc(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

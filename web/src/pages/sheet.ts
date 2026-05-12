import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

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

export async function renderSheet(root: HTMLElement, id: string): Promise<void> {
  root.innerHTML = `
    <div class="ls-page">
      <p class="ls-loading">Loading lesson sheet…</p>
    </div>
  `;
  try {
    const snap = await getDoc(doc(db, 'lediary-sheets', id));
    if (!snap.exists()) {
      root.querySelector('.ls-page')!.innerHTML = '<p class="ls-loading">Lesson sheet not found.</p>';
      return;
    }
    drawSheet(root.querySelector('.ls-page')!, snap.data() as LessonSheetData);
  } catch (err) {
    console.error('[Sheet]', err);
    root.querySelector('.ls-page')!.innerHTML = '<p class="ls-loading">Failed to load.</p>';
  }
}

function drawSheet(page: Element, data: LessonSheetData): void {
  const paragraphs = (data.articleBody || '')
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const articleChunks =
    paragraphs.length === 1 ? splitIntoChunks(paragraphs[0]!) : paragraphs;

  page.innerHTML = `
    <div class="ls-title-bar">
      <div class="ls-category">Diary Lesson</div>
      <h1 class="ls-title">${esc(data.title || 'Untitled')}</h1>
      ${data.date ? `<div class="ls-date">${formatDate(data.date)}</div>` : ''}
    </div>

    <div class="ls-nav">
      <button class="ls-nav-item" data-target="ls-vocab">Vocabulary</button>
      <button class="ls-nav-item" data-target="ls-article">Article</button>
      <button class="ls-nav-item" data-target="ls-discussion">Discussion</button>
    </div>

    <section id="ls-vocab" class="ls-section">
      <h2 class="ls-section-heading">Vocabulary</h2>
      ${(data.vocabulary || []).map((v, i) => `
        <div class="ls-vocab-card">
          <div class="ls-vocab-word">${i + 1}. ${esc(v.word)}</div>
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
      <p class="ls-instruction">After reading the article aloud, ask a few short comprehension questions about the content (e.g. "What's the main idea?" / "Why did ...?").</p>
    </section>

    <section id="ls-discussion" class="ls-section">
      <h2 class="ls-section-heading">Discussion</h2>
      <div class="ls-discussion-grid">
        ${(data.discussionTopics || []).map((topic, ti) => `
          <div class="ls-discussion-group">
            ${topic.topic ? `<h3 class="ls-topic-heading"><span class="ls-topic-num">Topic ${ti + 1}</span> ${esc(topic.topic)}</h3>` : ''}
            ${(topic.questions || []).map((q, qi) => `
              <div class="ls-question">
                <span class="ls-question-num">${qi + 1}</span>
                <span class="ls-question-text">${esc(q)}</span>
              </div>
            `).join('')}
          </div>
        `).join('')}
      </div>
    </section>

    <p class="ls-footer">Powered by Lediary</p>
  `;

  page.querySelectorAll('.ls-nav-item').forEach((item) => {
    item.addEventListener('click', () => {
      const id = (item as HTMLElement).dataset.target;
      if (id) document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
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

function formatDate(s: string): string {
  try {
    const d = new Date(s + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return s;
  }
}

function esc(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

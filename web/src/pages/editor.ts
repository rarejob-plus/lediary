import { renderHeader } from '../components/header';
import { icons } from '../components/icons';
import type { Mode, FeedbackItem } from '../data/mock';
import { MODE_META } from '../data/mock';
import { fetchEntry, invalidateEntriesCache, takeStashedEntry } from '../data/entries';
import { fetchDays, type DayRating } from '../data/days';
import { renderRatingRow } from '../components/day-rating-row';
import { api } from '../api/client';
import { getCurrentUser } from '../auth';
import { navigate } from '../router';
import { enableTextSelectionBookmark } from '../components/text-selection-bookmark';
import { callLLM } from '../llm';
import { flowCheck } from '../llm-diary';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

interface HintItem { english: string; japanese: string; note?: string; }

const SAMPLE_FEEDBACK: FeedbackItem[] = [
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

const SAMPLE_HINTS: HintItem[] = [
  { english: 'head to', japanese: '〜へ向かう' },
  { english: 'mark the start of', japanese: '〜の始まりを告げる' },
  { english: 'finally', japanese: 'いよいよ、ようやく' },
];

const STOIC_KEY = 'lediary_v2_stoic';

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function renderEditor(root: HTMLElement): void {
  root.appendChild(renderHeader('editor'));

  const params = new URLSearchParams(location.search);
  const initialMode = params.get('mode');
  const dateStr = params.get('date') || todayStr();
  const dateObj = new Date(dateStr + 'T00:00:00');
  const validModes: Mode[] = ['morning', 'lesson', 'diary', 'story'];
  let currentMode: Mode = validModes.includes(initialMode as Mode) ? (initialMode as Mode) : 'diary';
  const action = params.get('action'); // 'correct' | 'flow' | null
  let stoic = localStorage.getItem(STOIC_KEY) === '1';
  let currentFeedback: FeedbackItem[] = [];
  let feedbackKind: 'correct' | 'flow' = 'correct';
  let rewrites: string[] = [];
  let revealed: boolean[] = [];
  let submitting = false;

  const wrap = document.createElement('div');
  wrap.className = 'editor';

  const meta = document.createElement('div');
  meta.className = 'editor-meta';
  meta.innerHTML = `
    <div class="editor-date">
      <div class="editor-date-num">${dateObj.getDate()}</div>
      <div class="editor-date-meta">
        <strong>${dateObj.toLocaleDateString('en-US', { weekday: 'long' })}</strong>
        <span>${dateObj.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
      </div>
    </div>
    <div class="mode-pills">
      ${(['morning', 'lesson', 'diary', 'story'] as Mode[]).map((m) => `
        <button class="mode-pill ${m === currentMode ? 'active' : ''}" data-mode="${m}">${iconFor(MODE_META[m].icon)} ${MODE_META[m].label}</button>
      `).join('')}
    </div>
  `;

  meta.querySelectorAll('.mode-pill').forEach((b) => {
    b.addEventListener('click', () => {
      const next = (b as HTMLElement).dataset.mode as Mode;
      if (next === currentMode) return;
      currentMode = next;
      meta.querySelectorAll('.mode-pill').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      refreshRating();
      loadForMode(currentMode);
    });
  });
  wrap.appendChild(meta);

  // 充実度: diary モードのときだけ表示。modal で点数 + 一言を入力。
  const ratingHost = document.createElement('div');
  ratingHost.className = 'editor-rating';
  wrap.appendChild(ratingHost);
  let cachedDays: Map<string, DayRating> | null = null;
  function refreshRating(): void {
    if (currentMode !== 'diary') {
      ratingHost.innerHTML = '';
      ratingHost.style.display = 'none';
      return;
    }
    ratingHost.style.display = '';
    if (cachedDays) {
      renderRatingRow(ratingHost, { date: dateStr, days: cachedDays, size: 'md', showLabel: true });
    } else {
      ratingHost.innerHTML = '';
      fetchDays().then((days) => {
        cachedDays = days;
        if (currentMode === 'diary') {
          renderRatingRow(ratingHost, { date: dateStr, days, size: 'md', showLabel: true });
        }
      }).catch(() => { /* noop */ });
    }
  }
  refreshRating();

  // 3 カラム grid (PC): 左=JP+ヒント、中=EN+ボタン、右=添削結果。
  // 中幅 (≥720px <1100px) は 2 カラム (JP+ヒント | EN+添削)。モバイルは縦積み。
  const grid = document.createElement('div');
  grid.className = 'compose-grid';
  wrap.appendChild(grid);

  const left = document.createElement('div');
  left.className = 'compose-left';
  grid.appendChild(left);

  const right = document.createElement('div');
  right.className = 'compose-right';
  grid.appendChild(right);

  const third = document.createElement('div');
  third.className = 'compose-third';
  grid.appendChild(third);

  const jpBlock = document.createElement('div');
  jpBlock.className = 'compose-block';
  jpBlock.innerHTML = `
    <div class="compose-label">日本語で書く</div>
    <textarea id="jp-input" class="compose-textarea" placeholder=""></textarea>
  `;
  left.appendChild(jpBlock);

  const hintToggleRow = document.createElement('div');
  hintToggleRow.className = 'compose-action-row';
  hintToggleRow.style.marginBottom = '24px';
  hintToggleRow.innerHTML = `<button class="btn" id="show-hints">英訳ヒントを見る</button>`;
  left.appendChild(hintToggleRow);

  const hintsCard = document.createElement('div');
  hintsCard.className = 'hints-card';
  hintsCard.style.display = 'none';
  left.appendChild(hintsCard);

  hintToggleRow.querySelector('#show-hints')!.addEventListener('click', async () => {
    const btn = hintToggleRow.querySelector('#show-hints') as HTMLButtonElement;
    const jp = (jpBlock.querySelector('#jp-input') as HTMLTextAreaElement).value.trim();
    if (!jp) {
      alert('まず日本語を書いてください');
      return;
    }
    btn.disabled = true;
    btn.textContent = '生成中…';
    try {
      const hints = await loadHints(jp, dateStr, currentMode);
      renderHintsInto(hintsCard, hints);
      hintsCard.style.display = '';
      hintToggleRow.style.display = 'none';
    } catch (e) {
      console.error(e);
      btn.disabled = false;
      btn.textContent = '英訳ヒントを見る';
      alert('ヒント生成に失敗しました');
    }
  });

  const enBlock = document.createElement('div');
  enBlock.className = 'compose-block';
  enBlock.innerHTML = `
    <div class="compose-label">英語にする</div>
    <textarea id="en-input" class="compose-textarea en" placeholder=""></textarea>
  `;
  right.appendChild(enBlock);
  // モバイルで EN フォーカス時にヒントを下部 sticky にするためのクラス制御
  const enInputEl = enBlock.querySelector('#en-input') as HTMLTextAreaElement;
  enInputEl.addEventListener('focus', () => document.body.classList.add('en-focused'));
  enInputEl.addEventListener('blur', () => document.body.classList.remove('en-focused'));

  const actionRow = document.createElement('div');
  actionRow.className = 'compose-action-row';
  actionRow.innerHTML = `<button class="btn btn-primary" id="correct-btn">添削してもらう</button>`;
  right.appendChild(actionRow);

  const correctionSection = document.createElement('div');
  correctionSection.id = 'correction-section';
  third.appendChild(correctionSection);

  function captureRewrites(): void {
    correctionSection.querySelectorAll<HTMLTextAreaElement>('.correction-rewrite').forEach((ta) => {
      const idx = Number(ta.dataset.idx);
      if (Number.isInteger(idx)) rewrites[idx] = ta.value;
    });
  }

  function renderCorrection() {
    captureRewrites(); // re-render 前に現在の入力を退避
    correctionSection.innerHTML = '';

    const label = document.createElement('div');
    label.className = 'compose-label';
    label.textContent = feedbackKind === 'flow'
      ? '流れを整える（自分で書き直して定着させよう）'
      : '添削（自分で書き直して定着させよう）';
    correctionSection.appendChild(label);

    const toggleRow = document.createElement('div');
    toggleRow.className = 'correction-mode-toggle';
    toggleRow.innerHTML = `
      <span>修正案を ${stoic ? '隠す（自力モード）' : '表示する'}</span>
      <button class="toggle-switch ${stoic ? 'on' : ''}" id="stoic-toggle"></button>
    `;
    toggleRow.querySelector('#stoic-toggle')!.addEventListener('click', () => {
      stoic = !stoic;
      localStorage.setItem(STOIC_KEY, stoic ? '1' : '0');
      renderCorrection();
    });
    correctionSection.appendChild(toggleRow);

    if (currentFeedback.length === 0) {
      const noFb = document.createElement('p');
      noFb.style.cssText = 'color:var(--text-muted);text-align:center;padding:24px 0;font-size:13px;';
      noFb.textContent = '修正点はありません。よく書けています。';
      correctionSection.appendChild(noFb);
    }

    currentFeedback.forEach((fb, i) => {
      const isRevealed = !stoic || revealed[i];
      const card = document.createElement('div');
      card.className = 'correction-card';
      card.innerHTML = `
        <div class="correction-step">${i + 1} / ${currentFeedback.length}</div>
        <div class="correction-original">${escapeHtml(fb.original)}</div>
        ${stoic && !isRevealed ? `
          <div class="stoic-veil" data-idx="${i}">
            <div class="correction-corrected">${escapeHtml(fb.corrected)}</div>
            <div class="stoic-veil-hint">タップで答えを見る</div>
          </div>
          <div class="correction-explanation">${escapeHtml(fb.explanation)}</div>
          <div class="correction-rewrite-label">自分で書き直す</div>
          <textarea class="correction-rewrite" data-idx="${i}" placeholder="ヒントだけで書き直してみよう">${escapeHtml(rewrites[i] || '')}</textarea>
        ` : `
          <div class="correction-corrected">${escapeHtml(fb.corrected)}</div>
          <div class="correction-explanation">${escapeHtml(fb.explanation)}</div>
          <div class="correction-rewrite-label">自分で書き直す</div>
          <textarea class="correction-rewrite" data-idx="${i}" placeholder="${stoic ? 'ヒントだけで書き直してみよう' : '参考にして書き直してみよう'}">${escapeHtml(rewrites[i] || '')}</textarea>
        `}
      `;
      const veil = card.querySelector('.stoic-veil') as HTMLElement | null;
      if (veil) {
        veil.addEventListener('click', () => {
          revealed[i] = true;
          (veil.querySelector('.correction-corrected') as HTMLElement).style.filter = 'none';
          (veil.querySelector('.correction-corrected') as HTMLElement).style.userSelect = 'auto';
          (veil.querySelector('.stoic-veil-hint') as HTMLElement).style.display = 'none';
          veil.style.cursor = 'auto';
        });
      }
      const ta = card.querySelector('.correction-rewrite') as HTMLTextAreaElement;
      ta.addEventListener('input', () => {
        rewrites[i] = ta.value;
      });
      correctionSection.appendChild(card);
    });

    const doneBtn = document.createElement('button');
    doneBtn.className = 'btn btn-primary';
    doneBtn.style.cssText = 'width:100%;margin-top:12px;';
    doneBtn.textContent = '完成';
    doneBtn.addEventListener('click', async () => {
      captureRewrites(); // 直前の入力も拾う
      const user = getCurrentUser();
      // rewrites を本文に反映（空なら AI の corrected を採用）
      let finalText = (enBlock.querySelector('#en-input') as HTMLTextAreaElement).value;
      currentFeedback.forEach((fb, i) => {
        const replacement = (rewrites[i] || '').trim() || fb.corrected;
        if (fb.original && finalText.includes(fb.original)) {
          finalText = finalText.replace(fb.original, replacement);
        }
      });

      doneBtn.disabled = true;
      doneBtn.textContent = '保存中…';
      try {
        if (user && currentFeedback.length > 0) {
          await api.post('/diary/posts', {
            contentJp: (jpBlock.querySelector('#jp-input') as HTMLTextAreaElement).value,
            userTranslation: finalText,
            date: dateStr,
            mode: currentMode,
            textOnly: true,
          });
          invalidateEntriesCache();
        }
        if (user) {
          navigate(`/entry/${user.uid}_${dateStr}_${currentMode}`);
        } else {
          navigate('/entry/mock_2026-05-02_morning');
        }
      } catch (err) {
        console.error(err);
        alert('保存に失敗しました');
        doneBtn.disabled = false;
        doneBtn.textContent = '完成';
      }
    });
    correctionSection.appendChild(doneBtn);

    // 添削結果の英文（original / corrected / explanation 内の英文）からも
    // テキスト選択で Flashcard 保存できるように
    enableTextSelectionBookmark(correctionSection);
  }

  actionRow.querySelector('#correct-btn')!.addEventListener('click', async () => {
    if (submitting) return;
    const jp = (jpBlock.querySelector('#jp-input') as HTMLTextAreaElement).value.trim();
    const en = (enBlock.querySelector('#en-input') as HTMLTextAreaElement).value.trim();
    if (!jp) {
      alert('日本語を書いてください');
      return;
    }
    const btn = actionRow.querySelector('#correct-btn') as HTMLButtonElement;
    submitting = true;
    btn.disabled = true;
    btn.textContent = '添削中…';
    // どうせ新しい結果で上書きするので、リクエスト中は古いカードを残さない
    currentFeedback = [];
    rewrites = [];
    revealed = [];
    showCorrectionLoading();
    try {
      feedbackKind = 'correct';
      currentFeedback = await loadFeedback(jp, en, dateStr, currentMode);
      rewrites = [];
      revealed = [];
      renderCorrection();
      correctionSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      console.error(e);
      correctionSection.innerHTML = '';
      alert('添削に失敗しました');
    } finally {
      submitting = false;
      btn.disabled = false;
      btn.textContent = 'もう一度添削';
    }
  });

  // ローディング中に古いカードを残さないための薄いプレースホルダ
  function showCorrectionLoading() {
    correctionSection.innerHTML = `
      <div class="correction-loading">
        <div class="correction-loading-spinner"></div>
        <span>処理中…</span>
      </div>
    `;
  }

  // 流れを整える 経由で来たときの自動トリガー（再添削も同様）
  async function triggerFlow(en: string) {
    if (submitting) return;
    submitting = true;
    const btn = actionRow.querySelector('#correct-btn') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = '流れを確認中…';
    // 前回の結果はクリアして処理中表示に切り替え
    currentFeedback = [];
    rewrites = [];
    revealed = [];
    showCorrectionLoading();
    try {
      feedbackKind = 'flow';
      currentFeedback = await loadFlowCheck(en);
      rewrites = [];
      revealed = [];
      renderCorrection();
      correctionSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      console.error(e);
      correctionSection.innerHTML = '';
      alert('流れチェックに失敗しました');
    } finally {
      submitting = false;
      btn.disabled = false;
      btn.textContent = 'もう一度添削';
    }
  }

  root.appendChild(wrap);

  // initial mount だけ ?action= を消費する。モード切替の再ロードでは無視。
  let initialLoad = true;

  function applyEntry(entry: ReturnType<typeof takeStashedEntry> | Awaited<ReturnType<typeof loadExisting>>): void {
    // モードに紐づく既存エントリがなければ全部リセット
    if (!entry) {
      (jpBlock.querySelector('#jp-input') as HTMLTextAreaElement).value = '';
      (enBlock.querySelector('#en-input') as HTMLTextAreaElement).value = '';
      currentFeedback = [];
      rewrites = [];
      revealed = [];
      correctionSection.innerHTML = '';
      return;
    }
    (jpBlock.querySelector('#jp-input') as HTMLTextAreaElement).value = entry.contentJp;
    (enBlock.querySelector('#en-input') as HTMLTextAreaElement).value = entry.userTranslation;
    if (entry.feedback?.length) {
      feedbackKind = 'correct';
      currentFeedback = entry.feedback;
      rewrites = [];
      revealed = [];
      renderCorrection();
    } else {
      currentFeedback = [];
      rewrites = [];
      revealed = [];
      correctionSection.innerHTML = '';
    }
    if (initialLoad) {
      initialLoad = false;
      if (action === 'flow' && entry.userTranslation) {
        triggerFlow(entry.userTranslation);
      } else if (action === 'correct') {
        (actionRow.querySelector('#correct-btn') as HTMLButtonElement).click();
      }
    }
  }

  function refreshPlaceholders(mode: Mode): void {
    const m = MODE_META[mode];
    (jpBlock.querySelector('#jp-input') as HTMLTextAreaElement).placeholder = m.jpPlaceholder;
    (enBlock.querySelector('#en-input') as HTMLTextAreaElement).placeholder = m.enPlaceholder;
  }

  function loadForMode(mode: Mode): void {
    refreshPlaceholders(mode);
    loadExisting(dateStr, mode).then(applyEntry).catch(() => applyEntry(undefined));
  }

  refreshPlaceholders(currentMode);
  const stashed = takeStashedEntry();
  if (stashed && stashed.date === dateStr && stashed.mode === currentMode) {
    applyEntry(stashed);
  } else {
    loadForMode(currentMode);
  }
}

async function loadExisting(date: string, mode: Mode) {
  const user = getCurrentUser();
  if (!user) return undefined;
  const id = `${user.uid}_${date}_${mode}`;
  return fetchEntry(id);
}

// 旧サーバプロンプトをそのまま移植 — 表現は触らない。
const HINTS_SYSTEM_PROMPT = `You are an English writing coach helping a Japanese learner translate their diary into natural English.
Given a Japanese diary entry, suggest the MINIMUM SET of English building blocks the learner needs to write their own translation.

Critical rules — stay strictly within the user's text:
- Each hint MUST correspond to a specific word, phrase, or idea that ACTUALLY APPEARS in the Japanese diary. The "japanese" field must be a quote (or near-paraphrase) of part of the user's text.
- Do NOT add expressions that "would sound nice" but are not needed to translate what the user wrote. For example, if the diary does not say "わくわく" or similar, do NOT suggest "excited to". If it does not say "いよいよ" / "ようやく", do NOT suggest "finally".
- Skip basic vocabulary the learner already knows (family, today, go, start, etc.). Focus on the words/phrases most likely to trip up an intermediate Japanese learner: idiomatic expressions, casual connectors, collocations, less-obvious verbs.
- If the diary is short and uses only common vocabulary, return very few items (even 2-3 is fine). Quantity should scale with the diary's content, not a fixed target.
- Each Japanese concept/phrase should appear only ONCE — no synonyms for the same idea.
- Do NOT provide a full translation — just the building blocks.

Style:
- Match the tone and casualness of the original Japanese diary.
- Always show expressions in their base/dictionary form (e.g. "feel under the weather" not "feeling under the weather", "hit up" not "hit up a restaurant").

Tone: casual, like a friend. Avoid stiff/formal English unless the Japanese is clearly formal.

Return a JSON array (typically 2-8 items, no upper requirement — just enough to cover the parts the learner might struggle with):
[
  {"japanese": "日本語の部分/概念（必ずユーザー文中の言葉）", "english": "対応する英語表現", "note": "使い方の補足（日本語、1文）"}
]

Return ONLY the JSON array, no markdown fences or extra text.`;

function parseHintsJsonArray(raw: string): HintItem[] {
  let s = raw.trim();
  // ```json ... ``` フェンス除去
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  // 文字列内に紛れた配列を抽出 (LLM が前後に話を入れた場合の保険)
  const first = s.indexOf('[');
  const last = s.lastIndexOf(']');
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  const parsed = JSON.parse(s);
  if (!Array.isArray(parsed)) throw new Error('not an array');
  return parsed as HintItem[];
}

async function generateHintsClient(contentJp: string): Promise<HintItem[]> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await callLLM(HINTS_SYSTEM_PROMPT, contentJp);
      return parseHintsJsonArray(response);
    } catch (err) {
      console.warn(`[generateHints] parse failure attempt ${attempt + 1}:`, err);
    }
  }
  return [];
}

async function loadHints(contentJp: string, date: string, mode: Mode): Promise<HintItem[]> {
  const user = getCurrentUser();
  if (!user) {
    await new Promise((r) => setTimeout(r, 350));
    return SAMPLE_HINTS;
  }
  const hints = await generateHintsClient(contentJp);
  // 旧サーバ実装と同じく lediary-posts に merge 保存。createdAt は新規作成時のみ書く
  // (merge:true でも明示フィールドは上書きされるので、既存 doc では含めない)。
  const docID = `${user.uid}_${date}_${mode}`;
  const ref = doc(db, 'lediary-posts', docID);
  const existing = await getDoc(ref);
  const now = Date.now();
  const payload: Record<string, unknown> = {
    userId: user.uid,
    contentJp,
    mode,
    date,
    hints,
    updatedAt: now,
  };
  if (!existing.exists()) payload.createdAt = now;
  await setDoc(ref, payload, { merge: true });
  return hints;
}

interface RawAnalysisResponse {
  feedback?: FeedbackItem[];
  vocabulary?: unknown[];
  expansionQuestions?: unknown[];
}

async function loadFeedback(contentJp: string, userTranslation: string, date: string, mode: Mode): Promise<FeedbackItem[]> {
  if (!getCurrentUser()) {
    await new Promise((r) => setTimeout(r, 600));
    return SAMPLE_FEEDBACK;
  }
  const res = await api.post<RawAnalysisResponse>('/diary/posts', {
    contentJp,
    userTranslation,
    date,
    mode,
  });
  invalidateEntriesCache();
  return res.feedback || [];
}

async function loadFlowCheck(text: string): Promise<FeedbackItem[]> {
  if (!getCurrentUser()) {
    await new Promise((r) => setTimeout(r, 600));
    return SAMPLE_FEEDBACK;
  }
  const res = await flowCheck(text);
  return res.suggestions.map((s) => ({
    original: s.between,
    corrected: s.revised,
    explanation: `${s.suggestion} — ${s.reason}`,
  }));
}

function renderHintsInto(card: HTMLElement, hints: HintItem[]): void {
  card.innerHTML = `
    <div class="hints-card-header">
      <span>英訳ヒント</span>
    </div>
    ${hints.length === 0
      ? '<p style="color:var(--text-muted);text-align:center;padding:8px 0;font-size:13px;">ヒントはありません</p>'
      : hints.map((h) => `
        <div class="hint-row">
          <span class="hint-en">${escapeHtml(h.english)}</span>
          <span class="hint-ja">${escapeHtml(h.japanese)}</span>
        </div>
      `).join('')
    }
  `;
  enableTextSelectionBookmark(card);
}

function iconFor(name: 'sun' | 'graduation' | 'moon' | 'bookOpen'): string {
  if (name === 'sun') return icons.sun(12);
  if (name === 'graduation') return icons.graduation(12);
  if (name === 'bookOpen') return icons.bookOpen(12);
  return icons.moon(12);
}

function escapeHtml(s: string | undefined | null): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

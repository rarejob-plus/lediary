// LINE 風チャット画面 + IF ストーリー選択肢 + 4 モード日記。
// フロー:
//   モード選択 (Morning/Lesson/Diary/Story) → 日記投稿 (date+mode タグ付き)
//   → AI 返信 + IF 候補 → 1 つ選択 → 拡張ストーリー → 日記 artifact が "completed"

import { appendMessages, newMessageId, subscribeChat, type ChatMessage, type ChatThread } from '../data/chat';
import { getCurrentUser, logout } from '../auth';
import { getPersona } from '../data/personas';
import { generateFriendReplyAndOptions, generateExpandedStory } from '../data/llm';
import { renderOnboarding } from './onboarding';
import { MODES, defaultModeForNow, getMode, todayStr, type DiaryMode } from '../data/modes';
import {
  upsertDiaryStart, updateDiaryReply, completeDiary, fetchTodayStatus,
  type DiaryStatus,
} from '../data/diaries';
import { renderArchive } from './archive';

interface RenderChatOptions {
  personaId: string;
}

export function renderChat(root: HTMLElement, opts: RenderChatOptions): void {
  const authUser = getCurrentUser();
  if (!authUser) return;
  const userId = authUser.uid;
  const persona = getPersona(opts.personaId);

  let selectedMode: DiaryMode = defaultModeForNow();
  let todayStatus: Record<DiaryMode, DiaryStatus | null> = {
    morning: null, lesson: null, diary: null, story: null,
  };

  const wrap = document.createElement('div');
  wrap.className = 'chat-screen';
  wrap.innerHTML = `
    <header class="chat-header">
      <button class="chat-friend" id="open-persona" type="button" aria-label="友達を変える">
        <div class="chat-avatar">${persona.emoji}</div>
        <div class="chat-friend-meta">
          <div class="chat-friend-name">${escapeHtml(persona.name)}</div>
          <div class="chat-friend-sub">${escapeHtml(persona.city)} · ${escapeHtml(persona.vibe)}</div>
        </div>
        <div class="chat-friend-chevron">›</div>
      </button>
      <button class="chat-header-archive" id="archive-btn" type="button" title="過去の日記">📓</button>
      <button class="chat-header-logout" id="logout-btn" type="button" title="ログアウト">×</button>
    </header>
    <div class="today-progress" id="today-progress"></div>
    <div class="chat-scroll" id="chat-scroll"></div>
    <div class="mode-bar" id="mode-bar"></div>
    <form class="chat-input-bar" id="chat-input-bar">
      <textarea id="chat-input" name="diary" rows="2" placeholder="" required></textarea>
      <button type="submit" class="chat-send" aria-label="送信">→</button>
    </form>
  `;
  root.appendChild(wrap);

  const scrollEl = wrap.querySelector('#chat-scroll') as HTMLElement;
  const formEl = wrap.querySelector('#chat-input-bar') as HTMLFormElement;
  const inputEl = wrap.querySelector('#chat-input') as HTMLTextAreaElement;
  const modeBarEl = wrap.querySelector('#mode-bar') as HTMLElement;
  const progressEl = wrap.querySelector('#today-progress') as HTMLElement;

  wrap.querySelector('#logout-btn')!.addEventListener('click', async () => {
    if (!confirm('ログアウトしますか?')) return;
    await logout();
  });

  wrap.querySelector('#archive-btn')!.addEventListener('click', () => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal-close-bar"><button id="modal-close" type="button">閉じる</button></div>`;
    const body = document.createElement('div');
    body.className = 'modal-body';
    overlay.appendChild(body);
    document.body.appendChild(overlay);
    renderArchive(body, userId);
    overlay.querySelector('#modal-close')!.addEventListener('click', () => overlay.remove());
  });

  wrap.querySelector('#open-persona')!.addEventListener('click', () => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal-close-bar"><button id="modal-close" type="button">閉じる</button></div>`;
    const overlayBody = document.createElement('div');
    overlayBody.className = 'modal-body';
    overlay.appendChild(overlayBody);
    document.body.appendChild(overlay);
    renderOnboarding(overlayBody, { changeMode: true });
    overlay.querySelector('#modal-close')!.addEventListener('click', () => overlay.remove());
  });

  function renderModeBar(): void {
    modeBarEl.innerHTML = MODES.map((m) => {
      const status = todayStatus[m.id];
      const stateClass = m.id === selectedMode ? ' mode-chip--selected' : '';
      const doneClass = status === 'completed' ? ' mode-chip--done' : status === 'in-progress' ? ' mode-chip--prog' : '';
      const marker = status === 'completed' ? '✓' : status === 'in-progress' ? '•' : '';
      return `
        <button class="mode-chip${stateClass}${doneClass}" type="button" data-mode="${m.id}" title="${escapeAttr(m.jaShort)}">
          <span class="mode-chip-emoji">${m.emoji}</span>
          <span class="mode-chip-label">${m.label}</span>
          ${marker ? `<span class="mode-chip-marker">${marker}</span>` : ''}
        </button>
      `;
    }).join('');
    modeBarEl.querySelectorAll<HTMLButtonElement>('.mode-chip').forEach((b) => {
      b.addEventListener('click', () => {
        selectedMode = (b.dataset.mode as DiaryMode) || 'diary';
        inputEl.placeholder = getMode(selectedMode).jaPrompt;
        renderModeBar();
      });
    });
  }

  function renderTodayProgress(): void {
    const completedCount = MODES.filter((m) => todayStatus[m.id] === 'completed').length;
    progressEl.innerHTML = `
      <div class="progress-label">今日の進捗</div>
      <div class="progress-dots">
        ${MODES.map((m) => {
          const s = todayStatus[m.id];
          const cls = s === 'completed' ? 'on' : s === 'in-progress' ? 'half' : '';
          return `<span class="progress-dot ${cls}" title="${m.label}: ${s || '未着手'}"></span>`;
        }).join('')}
      </div>
      <div class="progress-count">${completedCount} / ${MODES.length}</div>
    `;
  }

  async function refreshTodayStatus(): Promise<void> {
    try {
      todayStatus = await fetchTodayStatus(userId, todayStr());
      renderModeBar();
      renderTodayProgress();
    } catch (e) {
      console.warn('[today-status] fetch failed', e);
    }
  }

  inputEl.placeholder = getMode(selectedMode).jaPrompt;
  renderModeBar();
  renderTodayProgress();
  void refreshTodayStatus();

  let currentMessages: ChatMessage[] = [];
  let typing = false;
  let pickInFlight = false;

  function render(): void {
    let activeOptionPromptId: string | null = null;
    for (let i = currentMessages.length - 1; i >= 0; i--) {
      const m = currentMessages[i]!;
      if (m.type === 'option-prompt') {
        activeOptionPromptId = m.id;
        for (let j = i + 1; j < currentMessages.length; j++) {
          if (currentMessages[j]!.type === 'option-pick') { activeOptionPromptId = null; break; }
        }
        break;
      }
    }

    const chosenByPromptId = new Map<string, string>();
    for (let i = 0; i < currentMessages.length; i++) {
      const m = currentMessages[i]!;
      if (m.type !== 'option-prompt') continue;
      const next = currentMessages[i + 1];
      if (next && next.type === 'option-pick') chosenByPromptId.set(m.id, next.text);
    }

    const html = currentMessages.map((m) => {
      if (m.type === 'option-prompt') {
        const active = m.id === activeOptionPromptId;
        const chosen = chosenByPromptId.get(m.id);
        return renderOptionPromptBubble(m, persona.emoji, active, chosen);
      }
      return renderBubble(m, persona.emoji);
    }).join('');
    const typingHtml = typing ? renderTypingBubble(persona.emoji) : '';
    scrollEl.innerHTML = html + typingHtml;
    scrollEl.scrollTop = scrollEl.scrollHeight;

    if (activeOptionPromptId && !pickInFlight) {
      const cardsEl = scrollEl.querySelector(`[data-options-for="${activeOptionPromptId}"]`);
      cardsEl?.querySelectorAll<HTMLButtonElement>('.option-card').forEach((b) => {
        b.addEventListener('click', () => onPickOption(activeOptionPromptId!, b.dataset.text || ''));
      });
    }
  }

  async function onPickOption(promptId: string, optionText: string): Promise<void> {
    if (!optionText || pickInFlight) return;
    pickInFlight = true;

    // option-prompt から逆引きで mode / date / 元の diary を取得
    const ctx = findContextForPrompt(currentMessages, promptId);
    const pickMode: DiaryMode = (ctx?.mode as DiaryMode) || selectedMode;
    const pickDate: string = ctx?.date || todayStr();
    const originalDiary = ctx?.diaryText || optionText;

    const pickMsg: ChatMessage = {
      id: newMessageId(),
      role: 'user',
      text: optionText,
      type: 'option-pick',
      mode: pickMode,
      date: pickDate,
      createdAt: Date.now(),
    };
    await appendMessages(userId, [pickMsg]);

    typing = true; render();
    const minTypingMs = 1400;
    const startedAt = Date.now();
    try {
      const story = await generateExpandedStory(persona, currentMessages, originalDiary, optionText, pickMode);
      const elapsed = Date.now() - startedAt;
      if (elapsed < minTypingMs) await sleep(minTypingMs - elapsed);
      const storyMsg: ChatMessage = {
        id: newMessageId(),
        role: 'ai',
        text: story,
        type: 'expanded-story',
        mode: pickMode,
        date: pickDate,
        createdAt: Date.now(),
      };
      await appendMessages(userId, [storyMsg]);
      // artifact を completed に
      await completeDiary(userId, pickDate, pickMode, optionText, story);
      await refreshTodayStatus();
    } catch (err) {
      console.error('[chat] expanded story failed', err);
      const fallback: ChatMessage = {
        id: newMessageId(),
        role: 'ai',
        text: `Whoa, my imagination froze for a sec 😅 try picking another option?`,
        type: 'reply',
        mode: pickMode,
        date: pickDate,
        createdAt: Date.now(),
      };
      await appendMessages(userId, [fallback]);
    } finally {
      typing = false;
      pickInFlight = false;
      render();
    }
  }

  const unsubChat = subscribeChat(userId, (thread: ChatThread | null) => {
    currentMessages = thread?.messages || [];
    render();
  });

  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = '';
    inputEl.disabled = true;

    const dateStr = todayStr();
    const mode: DiaryMode = selectedMode;

    const diaryMsg: ChatMessage = {
      id: newMessageId(),
      role: 'user',
      text,
      type: 'diary',
      mode,
      date: dateStr,
      createdAt: Date.now(),
    };
    await appendMessages(userId, [diaryMsg]);
    // artifact (in-progress) 作成
    void upsertDiaryStart(userId, dateStr, mode, text).catch(console.warn);

    typing = true;
    render();
    const minTypingMs = 1400;
    const startedAt = Date.now();
    try {
      const { reply, options } = await generateFriendReplyAndOptions(persona, currentMessages, text, mode);
      const elapsed = Date.now() - startedAt;
      if (elapsed < minTypingMs) await sleep(minTypingMs - elapsed);
      const replyMsg: ChatMessage = {
        id: newMessageId(),
        role: 'ai',
        text: reply,
        type: 'reply',
        mode,
        date: dateStr,
        createdAt: Date.now(),
      };
      const toAppend: ChatMessage[] = [replyMsg];
      if (options.length >= 2) {
        toAppend.push({
          id: newMessageId(),
          role: 'ai',
          text: 'Or, what if…?',
          type: 'option-prompt',
          options,
          mode,
          date: dateStr,
          createdAt: Date.now() + 1,
        });
      }
      await appendMessages(userId, toAppend);
      void updateDiaryReply(userId, dateStr, mode, reply).catch(console.warn);
      await refreshTodayStatus();
    } catch (err) {
      console.error('[chat] reply failed', err);
      const fallback: ChatMessage = {
        id: newMessageId(),
        role: 'ai',
        text: `Hmm, my brain glitched 😅 try sending that again?`,
        type: 'reply',
        mode,
        date: dateStr,
        createdAt: Date.now(),
      };
      await appendMessages(userId, [fallback]);
    } finally {
      typing = false;
      inputEl.disabled = false;
      inputEl.focus();
      render();
    }
  });

  window.addEventListener('beforeunload', () => unsubChat(), { once: true });
}

/** option-prompt から「元の diary テキスト」「mode」「date」を引く。 */
function findContextForPrompt(messages: ChatMessage[], promptId: string): { diaryText?: string; mode?: string; date?: string } | null {
  const idx = messages.findIndex((m) => m.id === promptId);
  if (idx < 0) return null;
  const prompt = messages[idx]!;
  for (let i = idx - 1; i >= 0; i--) {
    if (messages[i]!.type === 'diary') {
      return { diaryText: messages[i]!.text, mode: messages[i]!.mode ?? prompt.mode, date: messages[i]!.date ?? prompt.date };
    }
  }
  return { mode: prompt.mode, date: prompt.date };
}

function renderBubble(m: ChatMessage, friendEmoji: string): string {
  const safeText = escapeHtml(m.text);
  const modeLabel = m.mode ? `<span class="bubble-mode" title="${escapeAttr(getMode(m.mode).jaShort)}">${getMode(m.mode).emoji}</span>` : '';
  if (m.role === 'user') {
    const extra = m.type === 'option-pick' ? ' bubble--option-pick' : '';
    return `<div class="msg msg--user">${modeLabel}<div class="bubble bubble--user${extra}">${safeText}</div></div>`;
  }
  const extra = m.type === 'expanded-story' ? ' bubble--story' : '';
  return `
    <div class="msg msg--ai">
      <div class="msg-avatar">${friendEmoji}</div>
      <div class="bubble bubble--ai${extra}">${safeText}</div>
    </div>
  `;
}

function renderOptionPromptBubble(
  m: ChatMessage,
  friendEmoji: string,
  active: boolean,
  chosen: string | undefined,
): string {
  const options = m.options || [];
  const labels = ['A', 'B', 'C'];
  const cardsHtml = options.map((opt, i) => {
    const isChosen = chosen && opt === chosen;
    return `
      <button class="option-card${active ? '' : ' option-card--inactive'}${isChosen ? ' option-card--chosen' : ''}"
        type="button" data-text="${escapeAttr(opt)}" ${active ? '' : 'disabled'}>
        <span class="option-label">${labels[i] || '?'}</span>
        <span class="option-text">${escapeHtml(opt)}</span>
      </button>
    `;
  }).join('');
  const header = m.text ? `<div class="bubble bubble--ai bubble--option-prompt"><em>${escapeHtml(m.text)}</em></div>` : '';
  return `
    <div class="msg msg--ai">
      <div class="msg-avatar">${friendEmoji}</div>
      <div class="option-wrap">
        ${header}
        <div class="option-cards" data-options-for="${m.id}">${cardsHtml}</div>
      </div>
    </div>
  `;
}

function renderTypingBubble(friendEmoji: string): string {
  return `
    <div class="msg msg--ai">
      <div class="msg-avatar">${friendEmoji}</div>
      <div class="bubble bubble--ai bubble--typing">
        <span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>
      </div>
    </div>
  `;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

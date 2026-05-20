// LINE 風チャット (短返信) + 任意の What if 動線 + 4 モード日記。
// フロー:
//   モード選択 → 投稿 (Cmd/Ctrl+Enter or 送信ボタン) → 短い AI 返信 → artifact "completed"
//   返信下に「What if? を見る」リンク (任意)。押すと 3 枚の選択肢が出る。
//   1 つ選ぶと拡張ストーリーが届く (artifact に selectedOption / expandedStory が追記)。

import {
  appendMessages, migrateLegacyChat, newMessageId, subscribeChat,
  type ChatMessage, type ChatThread,
} from '../data/chat';
import { getCurrentUser, logout } from '../auth';
import { getPersona } from '../data/personas';
import { generateFriendReply, generateWhatIfOptions, generateExpandedStory } from '../data/llm';
import { renderOnboarding } from './onboarding';
import { MODES, defaultModeForNow, getMode, todayStr, type DiaryMode } from '../data/modes';
import {
  upsertDiaryStart, updateDiaryReply, completeDiary, fetchTodayStatus,
  type DiaryStatus,
} from '../data/diaries';
import { renderArchive } from './archive';
import { renderGifts } from './gifts';
import { addPoints, subscribeUser } from '../data/user';
import { icons } from '../components/icons';

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
        <div class="chat-avatar" style="background:${persona.color};">${icons[persona.icon](18)}</div>
        <div class="chat-friend-meta">
          <div class="chat-friend-name">${escapeHtml(persona.name)}</div>
          <div class="chat-friend-sub">${escapeHtml(persona.city)} · ${escapeHtml(persona.vibe)}</div>
        </div>
        <div class="chat-friend-chevron">${icons.chevronRight(16)}</div>
      </button>
      <div class="chat-header-mp" id="header-mp" title="モチベーションポイント">— MP</div>
      <button class="chat-header-icon" id="gifts-btn" type="button" aria-label="ギフト" title="ギフト">${icons.gift(18)}</button>
      <button class="chat-header-icon" id="archive-btn" type="button" aria-label="過去の日記" title="過去の日記">${icons.notebookPen(18)}</button>
      <button class="chat-header-icon" id="logout-btn" type="button" aria-label="ログアウト" title="ログアウト">${icons.x(18)}</button>
    </header>
    <div class="today-progress" id="today-progress"></div>
    <div class="chat-scroll" id="chat-scroll"></div>
    <div class="mode-bar" id="mode-bar"></div>
    <form class="chat-input-bar" id="chat-input-bar">
      <textarea id="chat-input" name="diary" rows="2" required></textarea>
      <button type="submit" class="chat-send" aria-label="送信">${icons.send(18)}</button>
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
    openModal((body) => { void renderArchive(body, userId); });
  });
  wrap.querySelector('#gifts-btn')!.addEventListener('click', () => {
    openModal((body) => renderGifts(body, userId));
  });

  function openModal(fill: (body: HTMLElement) => void): void {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal-close-bar"><button id="modal-close" type="button" aria-label="閉じる">${icons.x(14)} 閉じる</button></div>`;
    const body = document.createElement('div');
    body.className = 'modal-body';
    overlay.appendChild(body);
    document.body.appendChild(overlay);
    fill(body);
    overlay.querySelector('#modal-close')!.addEventListener('click', () => overlay.remove());
  }

  const mpEl = wrap.querySelector('#header-mp') as HTMLElement;
  const unsubUser = subscribeUser(userId, (u) => {
    mpEl.textContent = `${u?.currentPoints ?? 0} MP`;
  });

  wrap.querySelector('#open-persona')!.addEventListener('click', () => {
    openModal((body) => renderOnboarding(body, { changeMode: true }));
  });

  function renderModeBar(): void {
    modeBarEl.innerHTML = MODES.map((m) => {
      const status = todayStatus[m.id];
      const stateClass = m.id === selectedMode ? ' mode-chip--selected' : '';
      const doneClass = status === 'completed' ? ' mode-chip--done' : status === 'in-progress' ? ' mode-chip--prog' : '';
      const marker = status === 'completed' ? icons.check(11) : '';
      return `
        <button class="mode-chip${stateClass}${doneClass}" type="button" data-mode="${m.id}" title="${escapeAttr(m.jaShort)}">
          <span class="mode-chip-icon">${icons[m.icon](14)}</span>
          <span class="mode-chip-label">${m.label}</span>
          ${marker ? `<span class="mode-chip-marker">${marker}</span>` : ''}
        </button>
      `;
    }).join('');
    modeBarEl.querySelectorAll<HTMLButtonElement>('.mode-chip').forEach((b) => {
      b.addEventListener('click', () => {
        selectedMode = (b.dataset.mode as DiaryMode) || 'diary';
        renderModeBar();
      });
    });
  }

  function renderTodayProgress(): void {
    const completedCount = MODES.filter((m) => todayStatus[m.id] === 'completed').length;
    progressEl.innerHTML = `
      <div class="progress-label">今日</div>
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

  renderModeBar();
  renderTodayProgress();
  void refreshTodayStatus();
  void migrateLegacyChat(userId, persona.id);

  // Cmd/Ctrl+Enter で送信
  inputEl.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      formEl.requestSubmit();
    }
  });

  let currentMessages: ChatMessage[] = [];
  let typing = false;
  let pickInFlight = false;
  // option-prompt id -> 「What if 取得中」を示すフラグ。同じ diary に対して 2 重発火しないように
  const whatIfInFlight = new Set<string>();

  function render(): void {
    // 「最新の未消化 option-prompt」を割り出す
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

    // 最新の AI reply に「What if? を見る」ボタンを足す対象を決定
    let latestReplyIndex = -1;
    for (let i = currentMessages.length - 1; i >= 0; i--) {
      if (currentMessages[i]!.type === 'reply') { latestReplyIndex = i; break; }
    }

    const html = currentMessages.map((m, i) => {
      if (m.type === 'option-prompt') {
        const active = m.id === activeOptionPromptId;
        const chosen = chosenByPromptId.get(m.id);
        return renderOptionPromptBubble(m, persona, active, chosen);
      }
      const isLatestReply = i === latestReplyIndex && m.type === 'reply';
      const showWhatIfBtn = isLatestReply && !hasOptionPromptAfter(currentMessages, i);
      return renderBubble(m, persona, showWhatIfBtn);
    }).join('');
    const typingHtml = typing ? renderTypingBubble(persona) : '';
    scrollEl.innerHTML = html + typingHtml;
    scrollEl.scrollTop = scrollEl.scrollHeight;

    if (activeOptionPromptId && !pickInFlight) {
      const cardsEl = scrollEl.querySelector(`[data-options-for="${activeOptionPromptId}"]`);
      cardsEl?.querySelectorAll<HTMLButtonElement>('.option-card').forEach((b) => {
        b.addEventListener('click', () => onPickOption(activeOptionPromptId!, b.dataset.text || ''));
      });
    }

    // 「What if? を見る」ボタン
    const whatIfBtns = scrollEl.querySelectorAll<HTMLButtonElement>('.whatif-btn');
    whatIfBtns.forEach((b) => {
      const replyId = b.dataset.replyId!;
      b.addEventListener('click', () => onRequestWhatIf(replyId));
    });
  }

  async function onRequestWhatIf(replyId: string): Promise<void> {
    if (whatIfInFlight.has(replyId)) return;
    whatIfInFlight.add(replyId);
    // 直近の diary を引っ張る
    const replyIdx = currentMessages.findIndex((m) => m.id === replyId);
    let origDiary = '';
    let mode: DiaryMode = selectedMode;
    let dateStr = todayStr();
    for (let i = replyIdx - 1; i >= 0; i--) {
      if (currentMessages[i]!.type === 'diary') {
        origDiary = currentMessages[i]!.text;
        mode = (currentMessages[i]!.mode as DiaryMode) || mode;
        dateStr = currentMessages[i]!.date || dateStr;
        break;
      }
    }
    typing = true; render();
    const minTypingMs = 800;
    const startedAt = Date.now();
    try {
      const options = await generateWhatIfOptions(persona, currentMessages, origDiary || '今日の出来事');
      const elapsed = Date.now() - startedAt;
      if (elapsed < minTypingMs) await sleep(minTypingMs - elapsed);
      if (options.length >= 2) {
        await appendMessages(userId, persona.id, [{
          id: newMessageId(),
          role: 'ai',
          text: 'Or, what if…?',
          type: 'option-prompt',
          options,
          mode,
          date: dateStr,
          createdAt: Date.now(),
        }]);
      }
    } catch (err) {
      console.error('[whatif] failed', err);
    } finally {
      typing = false;
      render();
    }
  }

  async function onPickOption(promptId: string, optionText: string): Promise<void> {
    if (!optionText || pickInFlight) return;
    pickInFlight = true;

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
    await appendMessages(userId, persona.id, [pickMsg]);
    void addPoints(userId, 5).catch(console.warn);

    typing = true; render();
    const minTypingMs = 1200;
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
      await appendMessages(userId, persona.id, [storyMsg]);
      // artifact に追記 (既に completed でも上書きで selectedOption / expandedStory を保存)
      await completeDiary(userId, pickDate, pickMode, optionText, story);
      await refreshTodayStatus();
    } catch (err) {
      console.error('[chat] expanded story failed', err);
    } finally {
      typing = false;
      pickInFlight = false;
      render();
    }
  }

  const unsubChat = subscribeChat(userId, persona.id, (thread: ChatThread | null) => {
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
    await appendMessages(userId, persona.id, [diaryMsg]);
    void upsertDiaryStart(userId, dateStr, mode, text).catch(console.warn);
    void addPoints(userId, 10).catch(console.warn);

    typing = true;
    render();
    const minTypingMs = 1000;
    const startedAt = Date.now();
    try {
      const reply = await generateFriendReply(persona, currentMessages, text, mode);
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
      await appendMessages(userId, persona.id, [replyMsg]);
      void updateDiaryReply(userId, dateStr, mode, reply).catch(console.warn);
      // 返信が届いた時点で日記を完成扱いに。What if は任意の追加体験。
      await completeDiary(userId, dateStr, mode, '', '').catch(console.warn);
      await refreshTodayStatus();
    } catch (err) {
      console.error('[chat] reply failed', err);
      const fallback: ChatMessage = {
        id: newMessageId(),
        role: 'ai',
        text: `Hmm, my brain glitched. Try again?`,
        type: 'reply',
        mode,
        date: dateStr,
        createdAt: Date.now(),
      };
      await appendMessages(userId, persona.id, [fallback]);
    } finally {
      typing = false;
      inputEl.disabled = false;
      inputEl.focus();
      render();
    }
  });

  window.addEventListener('beforeunload', () => { unsubChat(); unsubUser(); }, { once: true });
}

function hasOptionPromptAfter(messages: ChatMessage[], afterIdx: number): boolean {
  for (let i = afterIdx + 1; i < messages.length; i++) {
    if (messages[i]!.type === 'option-prompt') return true;
  }
  return false;
}

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

function renderBubble(m: ChatMessage, persona: { icon: import('../components/icons').IconName; color: string }, showWhatIfBtn: boolean): string {
  const safeText = escapeHtml(m.text);
  const modeIcon = m.mode ? `<span class="bubble-mode-icon" title="${escapeAttr(getMode(m.mode).jaShort)}">${icons[getMode(m.mode).icon](12)}</span>` : '';
  if (m.role === 'user') {
    const extra = m.type === 'option-pick' ? ' bubble--option-pick' : '';
    return `<div class="msg msg--user">${modeIcon}<div class="bubble bubble--user${extra}">${safeText}</div></div>`;
  }
  const extra = m.type === 'expanded-story' ? ' bubble--story' : '';
  const whatif = showWhatIfBtn ? `
    <button class="whatif-btn" type="button" data-reply-id="${m.id}">
      ${icons.sparkles(12)} もしも…？ を見る
    </button>
  ` : '';
  return `
    <div class="msg msg--ai">
      <div class="msg-avatar" style="background:${persona.color};">${icons[persona.icon](14)}</div>
      <div class="msg-content">
        <div class="bubble bubble--ai${extra}">${safeText}</div>
        ${whatif}
      </div>
    </div>
  `;
}

function renderOptionPromptBubble(
  m: ChatMessage,
  persona: { icon: import('../components/icons').IconName; color: string },
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
      <div class="msg-avatar" style="background:${persona.color};">${icons[persona.icon](14)}</div>
      <div class="option-wrap">
        ${header}
        <div class="option-cards" data-options-for="${m.id}">${cardsHtml}</div>
      </div>
    </div>
  `;
}

function renderTypingBubble(persona: { icon: import('../components/icons').IconName; color: string }): string {
  return `
    <div class="msg msg--ai">
      <div class="msg-avatar" style="background:${persona.color};">${icons[persona.icon](14)}</div>
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

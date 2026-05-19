// LINE 風チャット画面 + IF ストーリー選択肢。
// フロー:
//   ユーザー投稿 → AI 返信 + 3 つの IF 候補 (1 リクエスト) → ユーザーが 1 つタップ
//   → AI が "拡張ストーリー" を返す。
// "active" な option-prompt は「未消化の最後の 1 つ」のみ。古いものは選んだ案だけハイライトして読み専用。

import { appendMessages, newMessageId, subscribeChat, type ChatMessage, type ChatThread } from '../data/chat';
import { getCurrentUser, logout } from '../auth';
import { getPersona } from '../data/personas';
import { generateFriendReplyAndOptions, generateExpandedStory } from '../data/llm';
import { renderOnboarding } from './onboarding';

interface RenderChatOptions {
  personaId: string;
}

export function renderChat(root: HTMLElement, opts: RenderChatOptions): void {
  const authUser = getCurrentUser();
  if (!authUser) return;
  const userId = authUser.uid;
  const persona = getPersona(opts.personaId);

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
      <button class="chat-header-logout" id="logout-btn" type="button" title="ログアウト">×</button>
    </header>
    <div class="chat-scroll" id="chat-scroll"></div>
    <form class="chat-input-bar" id="chat-input-bar">
      <textarea
        id="chat-input"
        name="diary"
        rows="2"
        placeholder="今日のひとこと日記を英語または日本語で…"
        required
      ></textarea>
      <button type="submit" class="chat-send" aria-label="送信">→</button>
    </form>
  `;
  root.appendChild(wrap);

  const scrollEl = wrap.querySelector('#chat-scroll') as HTMLElement;
  const formEl = wrap.querySelector('#chat-input-bar') as HTMLFormElement;
  const inputEl = wrap.querySelector('#chat-input') as HTMLTextAreaElement;

  wrap.querySelector('#logout-btn')!.addEventListener('click', async () => {
    if (!confirm('ログアウトしますか?')) return;
    await logout();
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

  let currentMessages: ChatMessage[] = [];
  let typing = false;
  let pickInFlight = false; // option クリック後の二重発火防止

  function render(): void {
    // 「最新の未消化 option-prompt」を割り出す: option-prompt 以降に option-pick が来ていなければ active
    let activeOptionPromptId: string | null = null;
    for (let i = currentMessages.length - 1; i >= 0; i--) {
      const m = currentMessages[i]!;
      if (m.type === 'option-prompt') {
        activeOptionPromptId = m.id;
        // この後 (= 配列上の index > i) に option-pick があれば消化済
        for (let j = i + 1; j < currentMessages.length; j++) {
          if (currentMessages[j]!.type === 'option-pick') { activeOptionPromptId = null; break; }
        }
        break;
      }
    }

    // 各 option-prompt について「どの案を選んだか」を逆引き
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

    // option ボタンに handler を bind
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
    const pickMsg: ChatMessage = {
      id: newMessageId(),
      role: 'user',
      text: optionText,
      type: 'option-pick',
      createdAt: Date.now(),
    };
    await appendMessages(userId, [pickMsg]);

    // 拡張ストーリー生成
    typing = true; render();
    const minTypingMs = 1400;
    const startedAt = Date.now();
    // 元の日記テキストを option-prompt の前の最新 diary から探す
    const originalDiary = findOriginalDiaryBefore(currentMessages, promptId) || optionText;
    try {
      const story = await generateExpandedStory(persona, currentMessages, originalDiary, optionText);
      const elapsed = Date.now() - startedAt;
      if (elapsed < minTypingMs) await sleep(minTypingMs - elapsed);
      const storyMsg: ChatMessage = {
        id: newMessageId(),
        role: 'ai',
        text: story,
        type: 'expanded-story',
        createdAt: Date.now(),
      };
      await appendMessages(userId, [storyMsg]);
    } catch (err) {
      console.error('[chat] expanded story failed', err);
      const fallback: ChatMessage = {
        id: newMessageId(),
        role: 'ai',
        text: `Whoa, my imagination froze for a sec 😅 try picking another option?`,
        type: 'reply',
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

    const diaryMsg: ChatMessage = {
      id: newMessageId(),
      role: 'user',
      text,
      type: 'diary',
      createdAt: Date.now(),
    };
    await appendMessages(userId, [diaryMsg]);

    typing = true;
    render();
    const minTypingMs = 1400;
    const startedAt = Date.now();
    try {
      const { reply, options } = await generateFriendReplyAndOptions(persona, currentMessages, text);
      const elapsed = Date.now() - startedAt;
      if (elapsed < minTypingMs) await sleep(minTypingMs - elapsed);
      const replyMsg: ChatMessage = {
        id: newMessageId(),
        role: 'ai',
        text: reply,
        type: 'reply',
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
          createdAt: Date.now() + 1,
        });
      }
      await appendMessages(userId, toAppend);
    } catch (err) {
      console.error('[chat] reply failed', err);
      const fallback: ChatMessage = {
        id: newMessageId(),
        role: 'ai',
        text: `Hmm, my brain glitched 😅 try sending that again?`,
        type: 'reply',
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

/** option-prompt より時系列で前にある最新の diary テキストを引く。なければ undefined。 */
function findOriginalDiaryBefore(messages: ChatMessage[], promptId: string): string | undefined {
  const idx = messages.findIndex((m) => m.id === promptId);
  if (idx < 0) return undefined;
  for (let i = idx - 1; i >= 0; i--) {
    if (messages[i]!.type === 'diary') return messages[i]!.text;
  }
  return undefined;
}

function renderBubble(m: ChatMessage, friendEmoji: string): string {
  const safeText = escapeHtml(m.text);
  if (m.role === 'user') {
    const extra = m.type === 'option-pick' ? ' bubble--option-pick' : '';
    return `<div class="msg msg--user"><div class="bubble bubble--user${extra}">${safeText}</div></div>`;
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
        type="button"
        data-text="${escapeAttr(opt)}"
        ${active ? '' : 'disabled'}>
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
        <div class="option-cards" data-options-for="${m.id}">
          ${cardsHtml}
        </div>
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

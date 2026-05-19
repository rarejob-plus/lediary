// LINE 風 1 対 1 チャット画面。
// レイアウト:
//   [header]  Lediary Next / 友達アバター
//   [scroll]  メッセージタイムライン (古→新)
//   [input]   3 行日記入力 + 送信
//
// 現状: AI 返信は mock (3 秒のタイピング演出後、定型文)。
//        次フェーズ (b) で Gemini と人格システムプロンプトに繋ぐ。

import { appendMessages, newMessageId, subscribeChat, type ChatMessage } from '../data/chat';
import { getCurrentUser } from '../auth';
import { DEFAULT_PERSONA_ID, getPersona } from '../data/personas';

export function renderChat(root: HTMLElement): void {
  const user = getCurrentUser();
  if (!user) {
    root.innerHTML = '<p style="padding:24px;text-align:center;color:#86868b;">ログインが必要です。</p>';
    return;
  }

  // 後で users doc から personaId を読む。当面はデフォルト固定。
  const persona = getPersona(DEFAULT_PERSONA_ID);

  const wrap = document.createElement('div');
  wrap.className = 'chat-screen';
  wrap.innerHTML = `
    <header class="chat-header">
      <div class="chat-friend">
        <div class="chat-avatar">${persona.emoji}</div>
        <div class="chat-friend-meta">
          <div class="chat-friend-name">${persona.name}</div>
          <div class="chat-friend-sub">${persona.city} · ${persona.vibe}</div>
        </div>
      </div>
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

  let currentMessages: ChatMessage[] = [];
  let typingTimer: ReturnType<typeof setTimeout> | null = null;

  function render(): void {
    const html = currentMessages.map((m) => renderBubble(m, persona.emoji)).join('');
    const typingHtml = typingTimer ? renderTypingBubble(persona.emoji) : '';
    scrollEl.innerHTML = html + typingHtml;
    // 最下部にスクロール
    scrollEl.scrollTop = scrollEl.scrollHeight;
  }

  // Firestore 購読
  subscribeChat(user.uid, (thread) => {
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
    await appendMessages(user.uid, [diaryMsg]);

    // タイピング演出 → mock AI 返信。(b) で Gemini に差し替え。
    typingTimer = setTimeout(async () => {
      const reply: ChatMessage = {
        id: newMessageId(),
        role: 'ai',
        text: `Oh, that's interesting! Tell me more about it 😊 (mock reply — AI persona coming soon)`,
        type: 'reply',
        createdAt: Date.now(),
      };
      typingTimer = null;
      await appendMessages(user.uid, [reply]);
      inputEl.disabled = false;
      inputEl.focus();
    }, 2200);
    render();
  });
}

function renderBubble(m: ChatMessage, friendEmoji: string): string {
  const safeText = escapeHtml(m.text);
  if (m.role === 'user') {
    return `
      <div class="msg msg--user">
        <div class="bubble bubble--user">${safeText}</div>
      </div>
    `;
  }
  return `
    <div class="msg msg--ai">
      <div class="msg-avatar">${friendEmoji}</div>
      <div class="bubble bubble--ai">${safeText}</div>
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

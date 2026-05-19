// LINE 風チャット画面。
// - persona は users doc の personaId から決まる。未設定なら呼び出し元 (main) が onboarding に振り分ける。
// - 投稿 → タイピング演出 → Gemini で返信 → Firestore append → realtime で UI 更新。
// - chat ヘッダーをタップで友達変更画面へ。

import { appendMessages, newMessageId, subscribeChat, type ChatMessage, type ChatThread } from '../data/chat';
import { getCurrentUser, logout } from '../auth';
import { getPersona } from '../data/personas';
import { generateFriendReply } from '../data/llm';
import { renderOnboarding } from './onboarding';

interface RenderChatOptions {
  personaId: string;
}

export function renderChat(root: HTMLElement, opts: RenderChatOptions): void {
  const user = getCurrentUser();
  if (!user) return;
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

  // ヘッダクリック → friend 変更 modal (簡易: フル画面オーバーレイ)
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
    // persona 切替成功 → main の subscribeUser で chat 再描画されるので overlay を閉じる
    const cleanup = subscribeUserPersonaForClose(user.uid, () => overlay.remove());
    overlay.addEventListener('remove', cleanup as EventListener);
  });

  let currentMessages: ChatMessage[] = [];
  let typing = false;

  function render(): void {
    const html = currentMessages.map((m) => renderBubble(m, persona.emoji)).join('');
    const typingHtml = typing ? renderTypingBubble(persona.emoji) : '';
    scrollEl.innerHTML = html + typingHtml;
    scrollEl.scrollTop = scrollEl.scrollHeight;
  }

  const unsubChat = subscribeChat(user.uid, (thread: ChatThread | null) => {
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

    // タイピング演出を見せつつ Gemini と並走 — どちらが先に終わっても自然に見えるよう
    // 最低 1.4 秒は typing を見せる。
    typing = true;
    render();
    const minTypingMs = 1400;
    const startedAt = Date.now();
    try {
      const replyText = await generateFriendReply(persona, currentMessages, text);
      const elapsed = Date.now() - startedAt;
      if (elapsed < minTypingMs) await sleep(minTypingMs - elapsed);
      const reply: ChatMessage = {
        id: newMessageId(),
        role: 'ai',
        text: replyText,
        type: 'reply',
        createdAt: Date.now(),
      };
      await appendMessages(user.uid, [reply]);
    } catch (err) {
      console.error('[chat] reply failed', err);
      const fallback: ChatMessage = {
        id: newMessageId(),
        role: 'ai',
        text: `Hmm, my brain glitched 😅 try sending that again?`,
        type: 'reply',
        createdAt: Date.now(),
      };
      await appendMessages(user.uid, [fallback]);
    } finally {
      typing = false;
      inputEl.disabled = false;
      inputEl.focus();
      render();
    }
  });

  // 画面離脱時に unsub (SPA で書き換わったら main 側が新しい root に置き換えるので一応保険)
  window.addEventListener('beforeunload', () => unsubChat(), { once: true });
}

function subscribeUserPersonaForClose(_uid: string, onChange: () => void): () => void {
  // overlay を閉じるトリガとして persona 変更を検知する。
  // ただし subscribeChat で十分 reactive なので、ここでは setTimeout-based の polling は避け
  // 単純に「overlay を残したまま」main 側に任せる → cleanup は no-op で OK。
  // (将来 personaId のみ変化したケースを別途検知する余地のためフックは残す)
  void onChange;
  return () => { /* no-op */ };
}

function renderBubble(m: ChatMessage, friendEmoji: string): string {
  const safeText = escapeHtml(m.text);
  if (m.role === 'user') {
    return `<div class="msg msg--user"><div class="bubble bubble--user">${safeText}</div></div>`;
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

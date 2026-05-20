// "今日の日記" ページ — 1 日 1 モードを 1 つの artifact として育てる state machine。
// 表示は当日 (+ 選択中モード) のみ。過去日記は archive モーダルで読む。
//
// 現在実装中: Phase 1 (JP 日記入力) + Phase 2 (AI 質問で拡張)
// Stage B 予定: Phase 3 (英訳) + Phase 4 (添削)

import { getCurrentUser, logout } from '../auth';
import { getPersona } from '../data/personas';
import { MODES, defaultModeForNow, getMode, todayStr, type DiaryMode } from '../data/modes';
import {
  appendExpansionMessage, createDraftDiary, fetchTodayStatus, setPhase,
  subscribeDiary, updateExpandedJp, type DiaryArtifact, type DiaryStatus,
  type ExpansionMessage,
} from '../data/diaries';
import { renderArchive } from './archive';
import { renderGifts } from './gifts';
import { renderOnboarding } from './onboarding';
import { addPoints, subscribeUser } from '../data/user';
import { icons } from '../components/icons';
import { stepExpand } from '../data/llm';

interface RenderTodayOptions {
  personaId: string;
}

export function renderToday(root: HTMLElement, opts: RenderTodayOptions): void {
  const authUser = getCurrentUser();
  if (!authUser) return;
  const userId = authUser.uid;
  const persona = getPersona(opts.personaId);
  const dateStr = todayStr();

  let selectedMode: DiaryMode = defaultModeForNow();
  let todayStatus: Record<DiaryMode, DiaryStatus | null> = {
    morning: null, lesson: null, diary: null, story: null,
  };
  let artifact: DiaryArtifact | null = null;
  let typing = false;

  // ── chrome ──
  const wrap = document.createElement('div');
  wrap.className = 'today-screen';
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
      <button class="chat-header-icon" id="gifts-btn" type="button" aria-label="ギフト">${icons.gift(18)}</button>
      <button class="chat-header-icon" id="archive-btn" type="button" aria-label="過去の日記">${icons.notebookPen(18)}</button>
      <button class="chat-header-icon" id="logout-btn" type="button" aria-label="ログアウト">${icons.x(18)}</button>
    </header>
    <div class="today-progress" id="today-progress"></div>
    <div class="mode-bar" id="mode-bar"></div>
    <div class="today-body" id="today-body"></div>
  `;
  root.appendChild(wrap);

  const modeBarEl = wrap.querySelector('#mode-bar') as HTMLElement;
  const progressEl = wrap.querySelector('#today-progress') as HTMLElement;
  const bodyEl = wrap.querySelector('#today-body') as HTMLElement;

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
  wrap.querySelector('#open-persona')!.addEventListener('click', () => {
    openModal((body) => renderOnboarding(body, { changeMode: true }));
  });

  function openModal(fill: (body: HTMLElement) => void): void {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal-close-bar"><button id="modal-close" type="button">${icons.x(14)} 閉じる</button></div>`;
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

  // ── mode bar / today progress ──
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
        const next = (b.dataset.mode as DiaryMode) || 'diary';
        if (next === selectedMode) return;
        selectedMode = next;
        renderModeBar();
        rewireDiarySubscription();
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
          return `<span class="progress-dot ${cls}" title="${m.label}"></span>`;
        }).join('')}
      </div>
      <div class="progress-count">${completedCount} / ${MODES.length}</div>
    `;
  }

  async function refreshTodayStatus(): Promise<void> {
    try {
      todayStatus = await fetchTodayStatus(userId, dateStr);
      renderModeBar();
      renderTodayProgress();
    } catch (e) { console.warn(e); }
  }

  renderModeBar();
  renderTodayProgress();
  void refreshTodayStatus();

  // ── artifact subscription (mode 切替時に都度 rewire) ──
  let unsubDiary: (() => void) | null = null;
  function rewireDiarySubscription(): void {
    if (unsubDiary) { unsubDiary(); unsubDiary = null; }
    artifact = null;
    renderBody();
    unsubDiary = subscribeDiary(userId, dateStr, selectedMode, (a) => {
      artifact = a;
      renderBody();
    });
  }
  rewireDiarySubscription();

  // ── body: phase に応じて UI を切り替え ──
  function renderBody(): void {
    if (!artifact || artifact.phase === 'draft') return renderPhaseIntake();
    if (artifact.phase === 'expanding') return renderPhaseExpanding();
    // Phase 3-4 (Stage B) はまだ。読み取り専用で「次は英訳・添削 (近日)」と表示。
    return renderPhaseStub();
  }

  function renderPhaseIntake(): void {
    const meta = getMode(selectedMode);
    bodyEl.innerHTML = `
      <div class="intake">
        <div class="intake-head">
          <span class="intake-mode-icon">${icons[meta.icon](20)}</span>
          <span class="intake-mode-label">${meta.label}</span>
          <span class="intake-mode-sub">${escapeHtml(meta.jaShort)}</span>
        </div>
        <p class="intake-instructions">
          今日の日記を <strong>日本語で 3〜5 文</strong>。<br>
          書いたら ${persona.name} が「もっと詳しく」を聞いてくれます。
        </p>
        <form id="intake-form">
          <textarea id="intake-jp" name="originalJp" rows="6" required
            placeholder="例: 朝から雨で気が乗らなかった。それでも 9 時に出社。会議で…"></textarea>
          <button type="submit" class="intake-submit">日記を書く</button>
        </form>
      </div>
    `;
    const form = bodyEl.querySelector('#intake-form') as HTMLFormElement;
    const ta = bodyEl.querySelector('#intake-jp') as HTMLTextAreaElement;
    ta.focus();
    ta.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        form.requestSubmit();
      }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = ta.value.trim();
      if (!text) return;
      ta.disabled = true;
      try {
        await createDraftDiary(userId, dateStr, selectedMode, text);
        void addPoints(userId, 10).catch(console.warn);
        // 最初の質問を取得して append
        typing = true;
        renderBody();
        const step = await stepExpand(persona, selectedMode, text, [], '');
        if (step.updatedDiary && step.updatedDiary !== text) {
          await updateExpandedJp(userId, dateStr, selectedMode, step.updatedDiary);
        }
        if (step.question) {
          await appendExpansionMessage(userId, dateStr, selectedMode, {
            id: newId(),
            role: 'ai',
            text: step.question,
            createdAt: Date.now(),
          });
        }
      } catch (err) {
        console.error('[intake] failed', err);
        alert('保存に失敗しました');
      } finally {
        typing = false;
        ta.disabled = false;
        await refreshTodayStatus();
        renderBody();
      }
    });
  }

  function renderPhaseExpanding(): void {
    if (!artifact) return;
    const a = artifact;
    bodyEl.innerHTML = `
      <div class="expand">
        <section class="expand-diary">
          <div class="expand-diary-head">
            <span class="expand-diary-label">今日の日記</span>
            <span class="expand-diary-mode">${getMode(a.mode).label}</span>
          </div>
          <div class="expand-diary-text" id="expand-diary-text">${escapeHtml(a.expandedJp)}</div>
        </section>
        <section class="expand-chat" id="expand-chat"></section>
        <form class="expand-answer-bar" id="expand-answer-form">
          <textarea id="expand-answer" name="answer" rows="2" required
            placeholder="${persona.name} の質問に答えてみよう (日本語 OK)"></textarea>
          <button type="submit" class="chat-send" aria-label="送信">${icons.send(18)}</button>
        </form>
        <div class="expand-actions">
          <button class="expand-finish" id="finish-expand" type="button">
            これで充分 → 次へ進む
          </button>
        </div>
      </div>
    `;

    // チャット表示
    const chatEl = bodyEl.querySelector('#expand-chat') as HTMLElement;
    const msgHtml = a.expansionMessages.map((m) => renderExpansionBubble(m, persona)).join('');
    const typingHtml = typing ? renderTypingBubble(persona) : '';
    chatEl.innerHTML = msgHtml + typingHtml;
    chatEl.scrollTop = chatEl.scrollHeight;

    // 入力
    const ansForm = bodyEl.querySelector('#expand-answer-form') as HTMLFormElement;
    const ansEl = bodyEl.querySelector('#expand-answer') as HTMLTextAreaElement;
    ansEl.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        ansForm.requestSubmit();
      }
    });
    ansForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const ans = ansEl.value.trim();
      if (!ans || typing) return;
      ansEl.value = '';
      ansEl.disabled = true;
      // user の回答を append + 拡張ステップ
      await appendExpansionMessage(userId, dateStr, selectedMode, {
        id: newId(),
        role: 'user',
        text: ans,
        createdAt: Date.now(),
      });
      void addPoints(userId, 2).catch(console.warn);
      typing = true; renderBody();
      try {
        const step = await stepExpand(persona, selectedMode, a.expandedJp, a.expansionMessages, ans);
        if (step.updatedDiary && step.updatedDiary !== a.expandedJp) {
          await updateExpandedJp(userId, dateStr, selectedMode, step.updatedDiary);
        }
        if (step.question) {
          await appendExpansionMessage(userId, dateStr, selectedMode, {
            id: newId(),
            role: 'ai',
            text: step.question,
            createdAt: Date.now(),
          });
        }
      } catch (err) {
        console.error('[expand] step failed', err);
      } finally {
        typing = false;
        ansEl.disabled = false;
        ansEl.focus();
        renderBody();
      }
    });

    // 「次へ進む」 = Phase 3 (Stage B) へ。Stage A 完了時点では英訳画面 stub に。
    bodyEl.querySelector('#finish-expand')!.addEventListener('click', async () => {
      if (!confirm('日記の拡張を終えて、次のステップ (英訳・添削) へ進みますか?')) return;
      try {
        await setPhase(userId, dateStr, selectedMode, 'englishing');
        await refreshTodayStatus();
      } catch (e) {
        console.error(e);
        alert('保存に失敗しました');
      }
    });
  }

  function renderPhaseStub(): void {
    if (!artifact) return;
    const a = artifact;
    bodyEl.innerHTML = `
      <div class="expand">
        <section class="expand-diary">
          <div class="expand-diary-head">
            <span class="expand-diary-label">今日の日記 (拡張済)</span>
            <span class="expand-diary-mode">${getMode(a.mode).label}</span>
          </div>
          <div class="expand-diary-text">${escapeHtml(a.expandedJp)}</div>
        </section>
        <div class="phase-stub">
          <p>次のステップ「英訳 → 添削」はもうすぐ実装します。</p>
          <button id="back-to-expand" type="button" class="expand-finish">戻って拡張を続ける</button>
        </div>
      </div>
    `;
    bodyEl.querySelector('#back-to-expand')!.addEventListener('click', async () => {
      try {
        await setPhase(userId, dateStr, selectedMode, 'expanding');
      } catch (e) { console.error(e); }
    });
  }

  // unload cleanup
  window.addEventListener('beforeunload', () => {
    unsubUser();
    if (unsubDiary) unsubDiary();
  }, { once: true });
}

function renderExpansionBubble(m: ExpansionMessage, persona: { icon: import('../components/icons').IconName; color: string }): string {
  const safeText = escapeHtml(m.text);
  if (m.role === 'user') {
    return `<div class="msg msg--user"><div class="bubble bubble--user">${safeText}</div></div>`;
  }
  return `
    <div class="msg msg--ai">
      <div class="msg-avatar" style="background:${persona.color};">${icons[persona.icon](14)}</div>
      <div class="msg-content"><div class="bubble bubble--ai">${safeText}</div></div>
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

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return (crypto as Crypto).randomUUID();
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

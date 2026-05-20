// "今日の日記" ページ — 1 日 1 モードを 1 つの artifact として育てる state machine。
// 表示は当日 (+ 選択中モード) のみ。過去日記は archive モーダルで読む。
//
// 現在実装中: Phase 1 (JP 日記入力) + Phase 2 (AI 質問で拡張)
// Stage B 予定: Phase 3 (英訳) + Phase 4 (添削)

import { getCurrentUser, logout } from '../auth';
import { getPersona } from '../data/personas';
import { MODES, defaultModeForNow, getMode, todayStr, type DiaryMode } from '../data/modes';
import {
  appendExpansionMessage, createDraftDiary, deleteDiary, fetchTodayStatus, setPhase,
  subscribeDiary, updateExpandedJp, updateEnglishDraft, updateCorrections,
  type DiaryArtifact, type DiaryStatus, type ExpansionMessage,
} from '../data/diaries';
import { renderArchive } from './archive';
import { renderGifts } from './gifts';
import { renderOnboarding } from './onboarding';
import { addPoints, subscribeUser } from '../data/user';
import { icons } from '../components/icons';
import { stepExpand, correctEnglish } from '../data/llm';
import { getTeacher } from '../data/teachers';

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
    if (!artifact) return renderPhaseIntake();
    const phase = artifact.phase || (artifact.status === 'completed' ? 'completed' : 'expanding');
    if (phase === 'draft') return renderPhaseIntake();
    if (phase === 'expanding') renderPhaseExpanding();
    else if (phase === 'englishing') renderPhaseEnglishing();
    else if (phase === 'correcting') renderPhaseCorrecting();
    else renderPhaseCompleted();
    bindResetButton();
  }

  function bindResetButton(): void {
    const btn = bodyEl.querySelector<HTMLButtonElement>('.diary-reset-btn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      if (!artifact) return;
      if (!confirm('今日の日記をリセット (削除) しますか? チャット履歴も全部消えます。')) return;
      btn.disabled = true;
      try {
        await deleteDiary(userId, artifact.date, artifact.mode);
        await refreshTodayStatus();
        // subscribeDiary が null を吹くので renderPhaseIntake に戻る
      } catch (e) {
        console.error(e);
        alert('削除に失敗しました');
        btn.disabled = false;
      }
    });
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
            ${resetButtonHtml()}
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

  // ── Phase 3: 英訳 ──
  function renderPhaseEnglishing(): void {
    if (!artifact) return;
    const a = artifact;
    const teacher = getTeacher();
    bodyEl.innerHTML = `
      <div class="english">
        <section class="expand-diary">
          <div class="expand-diary-head">
            <span class="expand-diary-label">今日の日記 (拡張済)</span>
            <span class="expand-diary-mode">${getMode(a.mode).label}</span>
            <button class="expand-back" id="back-to-expand" type="button">${icons.chevronRight(12)} 戻る</button>
            ${resetButtonHtml()}
          </div>
          <div class="expand-diary-text">${escapeHtml(a.expandedJp)}</div>
        </section>
        <section class="english-pane">
          <div class="english-head">
            <span class="english-label">英訳</span>
            <span class="english-sub">日本語を見ながら、自分の言葉で英語にしてみよう。</span>
          </div>
          <textarea id="english-input" name="englishDraft" rows="8"
            placeholder="Write your English here...">${escapeHtml(a.englishDraft || '')}</textarea>
          <div class="english-actions">
            <button id="ask-correction" type="button" class="english-submit">
              <span class="english-teacher-icon" style="color:${teacher.color};">${icons[teacher.icon](14)}</span>
              ${teacher.name} に添削してもらう
            </button>
          </div>
        </section>
      </div>
    `;
    const taEl = bodyEl.querySelector('#english-input') as HTMLTextAreaElement;
    taEl.focus();
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    taEl.addEventListener('input', () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        void updateEnglishDraft(userId, dateStr, selectedMode, taEl.value).catch(console.warn);
      }, 600);
    });
    taEl.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        (bodyEl.querySelector('#ask-correction') as HTMLButtonElement).click();
      }
    });
    bodyEl.querySelector('#back-to-expand')!.addEventListener('click', async () => {
      await setPhase(userId, dateStr, selectedMode, 'expanding');
    });
    bodyEl.querySelector('#ask-correction')!.addEventListener('click', async () => {
      const en = taEl.value.trim();
      if (!en) { alert('英訳を書いてください'); return; }
      const btn = bodyEl.querySelector('#ask-correction') as HTMLButtonElement;
      btn.disabled = true;
      btn.textContent = '添削中…';
      try {
        await updateEnglishDraft(userId, dateStr, selectedMode, en);
        void addPoints(userId, 5).catch(console.warn);
        const items = await correctEnglish(teacher, a.expandedJp, en);
        await updateCorrections(userId, dateStr, selectedMode, items);
        await setPhase(userId, dateStr, selectedMode, 'correcting');
      } catch (err) {
        console.error('[correct] failed', err);
        alert('添削に失敗しました');
        btn.disabled = false;
        btn.textContent = `${teacher.name} に添削してもらう`;
      }
    });
  }

  // ── Phase 4: 添削レビュー ──
  function renderPhaseCorrecting(): void {
    if (!artifact) return;
    const a = artifact;
    const teacher = getTeacher();
    const items = a.corrections || [];
    const allClean = items.length > 0 && items.every((c) => normalizeText(c.original) === normalizeText(c.corrected));
    bodyEl.innerHTML = `
      <div class="correcting">
        <section class="expand-diary">
          <div class="expand-diary-head">
            <span class="expand-diary-label">今日の日記</span>
            <span class="expand-diary-mode">${getMode(a.mode).label}</span>
            ${resetButtonHtml()}
          </div>
          <div class="expand-diary-text">${escapeHtml(a.expandedJp)}</div>
        </section>
        <section class="english-pane english-pane--readonly">
          <div class="english-head">
            <span class="english-label">あなたの英訳</span>
          </div>
          <div class="english-readonly">${escapeHtml(a.englishDraft || '')}</div>
        </section>
        <section class="corrections">
          <div class="corrections-head">
            <span class="corrections-teacher" style="background:${teacher.color};">${icons[teacher.icon](14)}</span>
            <span class="corrections-teacher-name">${teacher.name}</span>
            <span class="corrections-sub">${allClean ? 'よく書けています。直すところは見つかりませんでした。' : `${items.filter((c) => normalizeText(c.original) !== normalizeText(c.corrected)).length} 文に提案があります。`}</span>
          </div>
          ${items.map((c, i) => renderCorrectionCard(c, i)).join('')}
        </section>
        <div class="expand-actions" style="gap:8px;">
          <button class="expand-finish" id="back-to-english" type="button">英訳をやり直す</button>
          <button class="finish-day" id="finish-day" type="button">${icons.check(14)} 今日の ${getMode(a.mode).label} を完成にする</button>
        </div>
      </div>
    `;
    bodyEl.querySelector('#back-to-english')!.addEventListener('click', async () => {
      await setPhase(userId, dateStr, selectedMode, 'englishing');
    });
    bodyEl.querySelector('#finish-day')!.addEventListener('click', async () => {
      try {
        await setPhase(userId, dateStr, selectedMode, 'completed');
        void addPoints(userId, 10).catch(console.warn);
        await refreshTodayStatus();
      } catch (e) {
        console.error(e);
        alert('保存に失敗しました');
      }
    });
  }

  // ── Phase 5: 完成 ──
  function renderPhaseCompleted(): void {
    if (!artifact) return;
    const a = artifact;
    const items = a.corrections || [];
    const nextMode = MODES.find((m) => todayStatus[m.id] !== 'completed' && m.id !== a.mode);
    bodyEl.innerHTML = `
      <div class="completed">
        <div class="completed-banner">
          <div class="completed-check">${icons.check(20)}</div>
          <div>
            <div class="completed-title">今日の ${getMode(a.mode).label} 完成</div>
            <div class="completed-sub">アーカイブから読み返せます。</div>
          </div>
        </div>
        <section class="expand-diary">
          <div class="expand-diary-head">
            <span class="expand-diary-label">日本語日記</span>
            ${resetButtonHtml()}
          </div>
          <div class="expand-diary-text">${escapeHtml(a.expandedJp)}</div>
        </section>
        ${a.englishDraft ? `
          <section class="english-pane english-pane--readonly">
            <div class="english-head"><span class="english-label">英訳</span></div>
            <div class="english-readonly">${escapeHtml(a.englishDraft)}</div>
          </section>
        ` : ''}
        ${items.length > 0 ? `
          <section class="corrections">
            <div class="corrections-head">
              <span class="corrections-sub">添削メモ (${items.length} 件)</span>
            </div>
            ${items.map((c, i) => renderCorrectionCard(c, i)).join('')}
          </section>
        ` : ''}
        <div class="expand-actions" style="gap:8px;">
          ${nextMode ? `
            <button class="finish-day" id="next-mode" type="button">
              <span style="display:inline-flex;">${icons[nextMode.icon](14)}</span>
              次は ${nextMode.label} を書く
            </button>
          ` : `
            <p class="phase-stub" style="margin:0;">今日のモード全て完成しました 🎉</p>
          `}
        </div>
      </div>
    `;
    const next = bodyEl.querySelector('#next-mode') as HTMLButtonElement | null;
    if (next && nextMode) {
      next.addEventListener('click', () => {
        selectedMode = nextMode.id;
        renderModeBar();
        rewireDiarySubscription();
      });
    }
  }

  // unload cleanup
  window.addEventListener('beforeunload', () => {
    unsubUser();
    if (unsubDiary) unsubDiary();
  }, { once: true });
}

function resetButtonHtml(): string {
  return `
    <button class="diary-reset-btn" type="button" title="今日の日記を削除してやり直し" aria-label="リセット">
      <span class="diary-reset-icon">${icons.refresh(12)}</span>
      リセット
    </button>
  `;
}

function renderCorrectionCard(c: { original: string; corrected: string; explanation: string }, i: number): string {
  const isClean = normalizeText(c.original) === normalizeText(c.corrected);
  return `
    <article class="correction-card ${isClean ? 'correction-card--clean' : ''}">
      <header class="correction-card-head">
        <span class="correction-card-num">${i + 1}</span>
        <span class="correction-card-status">${isClean ? '自然' : '提案あり'}</span>
      </header>
      <div class="correction-row">
        <div class="correction-label">${isClean ? 'あなたの英文' : '元'}</div>
        <p class="correction-text correction-text--original">${escapeHtml(c.original)}</p>
      </div>
      ${isClean ? '' : `
        <div class="correction-row">
          <div class="correction-label">提案</div>
          <p class="correction-text correction-text--corrected">${escapeHtml(c.corrected)}</p>
        </div>
      `}
      ${c.explanation ? `
        <div class="correction-explanation">${escapeHtml(c.explanation)}</div>
      ` : ''}
    </article>
  `;
}

function normalizeText(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase().replace(/[.!?,;:"']/g, '');
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

function escapeHtml(s: string | undefined | null): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function escapeAttr(s: string | undefined | null): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

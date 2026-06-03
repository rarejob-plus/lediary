import { renderHeader } from '../components/header';
import { icons } from '../components/icons';
import type { Mode, FeedbackItem } from '../data/mock';
import { MODE_META } from '../data/mock';
import { fetchEntry, takeStashedEntry } from '../data/entries';
import { fetchDays, type DayRating } from '../data/days';
import { renderRatingRow } from '../components/day-rating-row';
import { enhanceTextarea } from '../components/textarea';
import { getCurrentUser } from '../auth';
import { navigate } from '../router';
import { enableTextSelectionBookmark } from '../components/text-selection-bookmark';
import { callLLM } from '../llm';
import { flowCheck } from '../llm-diary';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { analyzeAndSavePost, savePostTextOnly } from '../data/posts';
import { diffWords, renderDiffHtml } from '../diff';
import { lintPlainJp, LINT_TYPE_META, type LintIssue } from '../plainJpLint';

interface HintItem { english: string; japanese: string; note?: string; }

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
  let currentFeedback: FeedbackItem[] = [];
  let feedbackKind: 'correct' | 'flow' = 'correct';
  let rewrites: string[] = [];
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
    <div class="editor-meta-right">
      <div class="mode-pills">
        ${(['morning', 'lesson', 'diary', 'story'] as Mode[]).map((m) => `
          <button class="mode-pill ${m === currentMode ? 'active' : ''}" data-mode="${m}">${iconFor(MODE_META[m].icon)} ${MODE_META[m].label}</button>
        `).join('')}
      </div>
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

  // ── JP / plain JP を 2 つの独立した collapsible として配置 ──
  // 1) jpCollapse: 既存エントリの再編集時 (もう一度添削 / 流れを整える 等) は折りたたみ。
  //    JP は大半のケースで変えないため、画面下の EN + 添削に集中させる。
  // 2) plainCollapse: 和文和訳ブロック。toggle 常時表示。
  //    モバイル新規入力時はデフォルト折りたたみ (JP→EN 視線移動の間に挟まないため)。
  //    PC では従来通り展開。再編集時は常に折りたたみ。
  const jpCollapse = document.createElement('div');
  jpCollapse.className = 'jp-collapse';
  const jpToggle = document.createElement('button');
  jpToggle.className = 'jp-collapse-toggle';
  jpToggle.type = 'button';
  jpCollapse.appendChild(jpToggle);
  const jpBody = document.createElement('div');
  jpBody.className = 'jp-collapse-body';
  jpCollapse.appendChild(jpBody);
  left.appendChild(jpCollapse);

  const jpBlock = document.createElement('div');
  jpBlock.className = 'compose-block';
  jpBlock.innerHTML = `
    <div class="compose-label">日本語で書く</div>
    <textarea id="jp-input" class="compose-textarea" placeholder=""></textarea>
  `;
  jpBody.appendChild(jpBlock);

  const plainCollapse = document.createElement('div');
  plainCollapse.className = 'jp-collapse plain-collapse';
  const plainToggle = document.createElement('button');
  plainToggle.className = 'jp-collapse-toggle';
  plainToggle.type = 'button';
  plainCollapse.appendChild(plainToggle);
  const plainBody = document.createElement('div');
  plainBody.className = 'jp-collapse-body';
  plainCollapse.appendChild(plainBody);
  left.appendChild(plainCollapse);

  // ── 和文和訳 (Plain JP) ── 学習者自身が書き換える練習場。
  // AI は採点・自動書き換えしない。役割は以下の 2 つだけ:
  //   (1) ルールベース指摘バッジ — 常時、textarea を debounce 監視 (LLM 不使用)
  //   (2) on-demand LLM — 「主語チェック」「言い換え例を見る」ボタン押下時のみ
  const plainBlock = document.createElement('div');
  plainBlock.className = 'compose-block plain-jp-block';
  plainBlock.innerHTML = `
    <div class="plain-jp-row">
      <span class="compose-label" style="margin:0;">和文和訳（plain JP）</span>
      <div class="plain-jp-actions">
        <button class="btn btn-sm" id="subject-check-btn" type="button">${icons.eye(12)} 主語チェック</button>
        <button class="btn btn-sm" id="variants-btn" type="button">${icons.pen(12)} 言い換え例を見る</button>
      </div>
    </div>
    <div class="plain-jp-lints" id="plain-jp-lints" aria-live="polite"></div>
    <textarea id="plain-jp-input" name="plain-jp" class="compose-textarea plain-jp-textarea"
      placeholder="自分で書き換えてみよう。主語をはっきり、長い修飾を切り分け、抽象表現を動詞に。"></textarea>
    <div class="plain-jp-variants" id="plain-jp-variants"></div>
    <p class="plain-jp-note">AI は採点せず、求めたときだけ指摘・例示します。書くのは自分。</p>
  `;
  plainBody.appendChild(plainBlock);

  // plain JP は toggle を常時表示、デフォルトはモバイル時のみ折りたたみ。
  function renderPlainToggleLabel(): void {
    const collapsed = plainCollapse.classList.contains('collapsed');
    plainToggle.innerHTML = collapsed
      ? `<span class="jp-collapse-chevron">${icons.chevronDown(12)}</span><span class="jp-collapse-label">和文和訳 (任意)</span>`
      : `<span class="jp-collapse-chevron jp-collapse-chevron--open">${icons.chevronDown(12)}</span><span class="jp-collapse-label">和文和訳を閉じる</span>`;
  }
  function setPlainCollapsed(collapsed: boolean): void {
    plainCollapse.classList.toggle('collapsed', collapsed);
    renderPlainToggleLabel();
  }
  plainToggle.addEventListener('click', () => setPlainCollapsed(!plainCollapse.classList.contains('collapsed')));
  // 初期: モバイル幅なら折りたたみ。PC は展開。
  const isNarrowViewport = window.matchMedia('(max-width: 720px)').matches;
  setPlainCollapsed(isNarrowViewport);

  // collapse のトグル制御。
  // - `has-existing`: 既存エントリ再編集モード。toggle ボタンを表示。
  // - `collapsed`: body を非表示。toggle ボタンのラベルが「直す」「隠す」を切替。
  function renderJpToggleLabel(): void {
    const collapsed = jpCollapse.classList.contains('collapsed');
    const previewRaw = (jpBlock.querySelector('#jp-input') as HTMLTextAreaElement).value.trim();
    const preview = previewRaw.slice(0, 48) + (previewRaw.length > 48 ? '…' : '');
    if (collapsed) {
      jpToggle.innerHTML = `
        <span class="jp-collapse-chevron">${icons.chevronDown(12)}</span>
        <span class="jp-collapse-label">日本語を直す</span>
        ${previewRaw ? `<span class="jp-collapse-preview">${escapeHtml(preview)}</span>` : '<span class="jp-collapse-preview jp-collapse-preview--empty">まだ書かれていません</span>'}
      `;
    } else {
      jpToggle.innerHTML = `
        <span class="jp-collapse-chevron jp-collapse-chevron--open">${icons.chevronDown(12)}</span>
        <span class="jp-collapse-label">日本語を隠す</span>
      `;
    }
  }
  function setJpCollapsed(collapsed: boolean): void {
    jpCollapse.classList.toggle('collapsed', collapsed);
    // 既存エントリで一度でも collapsed=true になったら、以降は toggle を出し続ける。
    if (collapsed) jpCollapse.classList.add('has-existing');
    renderJpToggleLabel();
  }
  jpToggle.addEventListener('click', () => setJpCollapsed(!jpCollapse.classList.contains('collapsed')));

  const plainInput = plainBlock.querySelector('#plain-jp-input') as HTMLTextAreaElement;
  const lintsEl = plainBlock.querySelector('#plain-jp-lints') as HTMLElement;
  const variantsEl = plainBlock.querySelector('#plain-jp-variants') as HTMLElement;
  const subjectBtn = plainBlock.querySelector('#subject-check-btn') as HTMLButtonElement;
  const variantsBtn = plainBlock.querySelector('#variants-btn') as HTMLButtonElement;

  // ── (1) ルールベース指摘バッジ: JP textarea を 500ms debounce で監視 ──
  let ruleIssues: LintIssue[] = [];
  let llmSubjectIssues: SubjectIssue[] = []; // (c) LLM 結果。再 lint 時に保持する。
  let lintTimer: ReturnType<typeof setTimeout> | null = null;

  function renderLints(): void {
    const all: { kind: string; label: string; snippet: string; color: string }[] = [];
    for (const it of ruleIssues) {
      const meta = LINT_TYPE_META[it.type];
      all.push({ kind: meta.label, label: it.message, snippet: it.snippet, color: meta.color });
    }
    for (const it of llmSubjectIssues) {
      all.push({
        kind: LINT_TYPE_META['subject-missing'].label,
        label: it.suggested_subject ? `主語: ${it.suggested_subject}` : '主語省略',
        snippet: it.sentence,
        color: LINT_TYPE_META['subject-missing'].color,
      });
    }
    if (all.length === 0) {
      lintsEl.innerHTML = '';
      return;
    }
    lintsEl.innerHTML = all.map((b) => `
      <span class="plain-jp-badge" style="--badge-color:${b.color};">
        <span class="plain-jp-badge-kind">${escapeHtml(b.kind)}</span>
        <span class="plain-jp-badge-label">${escapeHtml(b.label)}</span>
        <span class="plain-jp-badge-snippet">${escapeHtml(b.snippet)}</span>
      </span>
    `).join('');
  }

  function scheduleLint(): void {
    if (lintTimer) clearTimeout(lintTimer);
    lintTimer = setTimeout(() => {
      const jp = (jpBlock.querySelector('#jp-input') as HTMLTextAreaElement).value;
      ruleIssues = lintPlainJp(jp);
      // JP 本文が変わったら、過去の LLM 主語チェック結果は古くなるので破棄。
      llmSubjectIssues = [];
      renderLints();
    }, 500);
  }
  (jpBlock.querySelector('#jp-input') as HTMLTextAreaElement).addEventListener('input', scheduleLint);

  // ── (c) on-demand LLM: 主語省略チェック ──
  subjectBtn.addEventListener('click', async () => {
    const jp = (jpBlock.querySelector('#jp-input') as HTMLTextAreaElement).value.trim();
    if (!jp) { alert('まず日本語を書いてください'); return; }
    subjectBtn.disabled = true;
    const original = subjectBtn.innerHTML;
    subjectBtn.textContent = '解析中…';
    try {
      llmSubjectIssues = await detectSubjectOmissions(jp);
      renderLints();
      if (llmSubjectIssues.length === 0) {
        // 0 件も「OK」シグナルとして見えるように 1 バッジ出す
        lintsEl.insertAdjacentHTML('beforeend',
          '<span class="plain-jp-badge plain-jp-badge--ok">主語省略は見当たらず</span>');
      }
    } catch (e) {
      console.error('[subjectCheck] failed', e);
      alert('主語チェックに失敗しました');
    } finally {
      subjectBtn.disabled = false;
      subjectBtn.innerHTML = original;
    }
  });

  // ── (d) on-demand LLM: 言い換え例 (複数バリアント) ──
  variantsBtn.addEventListener('click', async () => {
    const jp = (jpBlock.querySelector('#jp-input') as HTMLTextAreaElement).value.trim();
    if (!jp) { alert('まず日本語を書いてください'); return; }
    variantsBtn.disabled = true;
    const original = variantsBtn.innerHTML;
    variantsBtn.textContent = '生成中…';
    try {
      const v = await generatePlainJpVariants(jp);
      if (!v) { variantsEl.innerHTML = '<p class="plain-jp-variants-empty">取得に失敗しました</p>'; return; }
      variantsEl.innerHTML = `
        <div class="plain-jp-variants-head">言い換え例（参考。これだけが正解ではありません）</div>
        ${[
          { key: 'variant_subject', label: '主語をはっきり', text: v.variant_subject },
          { key: 'variant_verb',    label: '動詞に戻す',    text: v.variant_verb },
          { key: 'variant_split',   label: '短く分割',      text: v.variant_split },
        ].map((row) => `
          <div class="plain-jp-variant">
            <div class="plain-jp-variant-head">
              <span class="plain-jp-variant-label">${row.label}</span>
              <button class="btn btn-sm btn-ghost" data-text="${escapeAttr(row.text || '')}" type="button">この案を採用</button>
            </div>
            <div class="plain-jp-variant-text">${escapeHtml(row.text || '')}</div>
          </div>
        `).join('')}
      `;
      variantsEl.querySelectorAll('button[data-text]').forEach((b) => {
        b.addEventListener('click', () => {
          plainInput.value = (b as HTMLElement).dataset.text || '';
          plainInput.focus();
        });
      });
    } catch (e) {
      console.error('[variants] failed', e);
      alert('言い換え例の取得に失敗しました');
    } finally {
      variantsBtn.disabled = false;
      variantsBtn.innerHTML = original;
    }
  });

  // ヒントは EN textarea の直上 (right 列内) に置く。
  // 学習者が「JP を見ながら英作する」流れで、ヒント / EN を同じ視線で扱えるようにする。
  // left に置くと、JP が長いとヒントが下に押し下げられて見えない問題が出る。
  const hintToggleRow = document.createElement('div');
  hintToggleRow.className = 'compose-action-row';
  hintToggleRow.style.marginBottom = '16px';
  hintToggleRow.innerHTML = `<button class="btn" id="show-hints">英訳ヒントを見る</button>`;
  right.appendChild(hintToggleRow);

  const hintsCard = document.createElement('div');
  hintsCard.className = 'hints-card';
  hintsCard.style.display = 'none';
  right.appendChild(hintsCard);

  hintToggleRow.querySelector('#show-hints')!.addEventListener('click', async () => {
    const btn = hintToggleRow.querySelector('#show-hints') as HTMLButtonElement;
    const rawJp = (jpBlock.querySelector('#jp-input') as HTMLTextAreaElement).value.trim();
    const plainJp = plainInput.value.trim();
    const sourceJp = plainJp || rawJp; // hint 生成は plain があればそちらを優先
    if (!rawJp) {
      alert('まず日本語を書いてください');
      return;
    }
    btn.disabled = true;
    btn.textContent = '生成中…';
    try {
      const hints = await loadHints(sourceJp, rawJp, plainJp, dateStr, currentMode);
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

  // 共通 textarea 拡張: field-sizing 未対応ブラウザでも自動リサイズ + Cmd+Enter で添削開始。
  enhanceTextarea(jpBlock.querySelector('#jp-input') as HTMLTextAreaElement);
  enhanceTextarea(plainBlock.querySelector('#plain-jp-input') as HTMLTextAreaElement);
  enhanceTextarea(enInputEl, {
    onSubmit: () => (actionRow.querySelector('#correct-btn') as HTMLButtonElement | null)?.click(),
  });

  const actionRow = document.createElement('div');
  actionRow.className = 'compose-action-row';
  actionRow.innerHTML = `
    <button class="btn btn-primary" id="correct-btn">添削してもらう</button>
    <button class="btn" id="save-btn" style="display:none;">${icons.check(14)} 完成</button>
  `;
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
    label.textContent = feedbackKind === 'flow' ? '流れを整える' : '添削';
    correctionSection.appendChild(label);

    if (currentFeedback.length === 0) {
      const noFb = document.createElement('p');
      noFb.style.cssText = 'color:var(--text-muted);text-align:center;padding:24px 0;font-size:13px;';
      noFb.textContent = '修正点はありません。よく書けています。';
      correctionSection.appendChild(noFb);
    }

    currentFeedback.forEach((fb, i) => {
      const card = document.createElement('div');
      card.className = 'correction-card';
      // word diff 固定: original→corrected を <del>/<ins> でインライン重ね合わせ。
      // flow（流れを整える）は diff が読みにくいので corrected ブロックそのまま。
      const usableDiff = feedbackKind === 'correct' && !!fb.original && !!fb.corrected;
      const correctedBlock = usableDiff
        ? `<div class="correction-diff">${renderDiffHtml(diffWords(fb.original, fb.corrected))}</div>`
        : `<div class="correction-corrected">${escapeHtml(fb.corrected)}</div>`;
      card.innerHTML = `
        <div class="correction-step">${i + 1} / ${currentFeedback.length}</div>
        <div class="correction-original">${escapeHtml(fb.original)}</div>
        ${correctedBlock}
        <div class="correction-explanation">${escapeHtml(fb.explanation)}</div>
        <div class="correction-rewrite-label">自分で書き直す</div>
        <textarea name="correction-rewrite-${i}" class="correction-rewrite" data-idx="${i}" placeholder="参考にして書き直してみよう">${escapeHtml(rewrites[i] || '')}</textarea>
      `;
      const ta = card.querySelector('.correction-rewrite') as HTMLTextAreaElement;
      ta.addEventListener('input', () => {
        rewrites[i] = ta.value;
      });
      enhanceTextarea(ta);
      correctionSection.appendChild(card);
    });

    const doneBtn = document.createElement('button');
    doneBtn.className = 'btn btn-primary';
    doneBtn.style.cssText = 'width:100%;margin-top:8px;';
    doneBtn.textContent = '完成';
    doneBtn.addEventListener('click', async () => {
      captureRewrites(); // 直前の入力も拾う
      const user = getCurrentUser();
      // rewrites を本文に反映。**空欄の文は触らない** (= 元の自分の英訳のまま残す)。
      // 「AI に書かせない、自分で書く力を鍛える」ポリシーのため、空欄を AI corrected で
      // 自動置換することはしない。学習者が AI 版を採用したい場合は明示的に書き直し欄に書く。
      let finalText = (enBlock.querySelector('#en-input') as HTMLTextAreaElement).value;
      currentFeedback.forEach((fb, i) => {
        const rewrite = (rewrites[i] || '').trim();
        if (!rewrite) return; // 空欄はスキップ
        if (fb.original && finalText.includes(fb.original)) {
          finalText = finalText.replace(fb.original, rewrite);
        }
      });

      doneBtn.disabled = true;
      doneBtn.textContent = '保存中…';
      try {
        if (user && currentFeedback.length > 0) {
          await savePostTextOnly({
            contentJp: (jpBlock.querySelector('#jp-input') as HTMLTextAreaElement).value,
            userTranslation: finalText,
            date: dateStr,
            mode: currentMode,
            plainJp: plainInput.value.trim(),
          });
        }
        if (user) {
          navigate(`/entry/${user.uid}_${dateStr}_${currentMode}`);
        } else {
          navigate('/');
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

  actionRow.querySelector('#save-btn')!.addEventListener('click', async () => {
    if (submitting) return;
    const jp = (jpBlock.querySelector('#jp-input') as HTMLTextAreaElement).value;
    const en = (enBlock.querySelector('#en-input') as HTMLTextAreaElement).value;
    const user = getCurrentUser();
    if (!user) {
      navigate('/');
      return;
    }
    const btn = actionRow.querySelector('#save-btn') as HTMLButtonElement;
    submitting = true;
    btn.disabled = true;
    btn.textContent = '保存中…';
    try {
      await savePostTextOnly({
        contentJp: jp,
        userTranslation: en,
        date: dateStr,
        mode: currentMode,
        plainJp: plainInput.value.trim(),
      });
      navigate(`/entry/${user.uid}_${dateStr}_${currentMode}`);
    } catch (err) {
      console.error(err);
      alert('保存に失敗しました');
      btn.disabled = false;
      btn.textContent = `${icons.check(14)} 完成`;
    } finally {
      submitting = false;
    }
  });

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
    // 添削カード側に完成ボタンが出るので、inline の保存ボタンは隠す
    (actionRow.querySelector('#save-btn') as HTMLButtonElement).style.display = 'none';
    // どうせ新しい結果で上書きするので、リクエスト中は古いカードを残さない
    currentFeedback = [];
    rewrites = [];
    showCorrectionLoading();
    try {
      feedbackKind = 'correct';
      currentFeedback = await loadFeedback(jp, en, dateStr, currentMode, plainInput.value.trim());
      rewrites = [];
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
    (actionRow.querySelector('#save-btn') as HTMLButtonElement).style.display = 'none';
    // 前回の結果はクリアして処理中表示に切り替え
    currentFeedback = [];
    rewrites = [];
    showCorrectionLoading();
    try {
      feedbackKind = 'flow';
      currentFeedback = await loadFlowCheck(en);
      rewrites = [];
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
    const saveBtn = actionRow.querySelector('#save-btn') as HTMLButtonElement;
    // モードに紐づく既存エントリがなければ全部リセット
    if (!entry) {
      (jpBlock.querySelector('#jp-input') as HTMLTextAreaElement).value = '';
      (enBlock.querySelector('#en-input') as HTMLTextAreaElement).value = '';
      currentFeedback = [];
      rewrites = [];
      correctionSection.innerHTML = '';
      saveBtn.style.display = 'none';
      setJpCollapsed(false); // 新規入力: JP を開く
      setPlainCollapsed(isNarrowViewport); // 新規 + モバイル → 和文和訳を折りたたみ
      return;
    }
    (jpBlock.querySelector('#jp-input') as HTMLTextAreaElement).value = entry.contentJp;
    (enBlock.querySelector('#en-input') as HTMLTextAreaElement).value = entry.userTranslation;
    // 保存されている plainJp があれば復元 (上書きしないようにここで埋める)
    plainInput.value = entry.plainJp || '';
    // 既存エントリ再編集: JP / plain JP は折りたたみ、必要なときだけ直せる。
    // 多くの再編集 (もう一度添削 / 流れを整える) で JP に手は入らないため、邪魔にならない位置に置く。
    setJpCollapsed(!!entry.contentJp);
    setPlainCollapsed(true);
    // 既存エントリの過去添削は再表示しない。ユーザが必要なら「もう一度添削」を選ぶ。
    // 編集モードでは 完成 ボタンを露出して直接保存できるようにする。
    currentFeedback = [];
    rewrites = [];
    correctionSection.innerHTML = '';
    // 添削/流れ整理経由なら、それぞれの「完成」がカード側にあるので inline 保存は不要
    const wantsCorrection = action === 'correct' || action === 'flow';
    saveBtn.style.display = entry.userTranslation && !wantsCorrection ? '' : 'none';
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

// 主語省略の検出 (on-demand)。client 側ルールでは精度が出ないため LLM に委譲。
const SUBJECT_CHECK_PROMPT = `あなたは日本語学習者向け英作文コーチです。学習者の日本語日記から、英訳時に主語の補完が必要になりそうな文を検出してください。

ルール:
1. 主語が省略されていて、英訳時に "I"/"It"/"They" などを補う必要がありそうな文だけを抽出。
2. 文脈から主語が自明な場合 (直前の文と同じ主語など) は除外。
3. JSON 配列で返す: [{"sentence": "対象文の抜粋", "suggested_subject": "想定される主語"}]
4. 1 文も該当しなければ []。
5. 説明文や前置きは一切付けず JSON のみ出力。`;

// 言い換え例 (on-demand)。複数バリアントを示すことで「唯一解感」を避け、学習者が選択する余地を残す。
const PLAIN_JP_VARIANTS_PROMPT = `あなたは日本語学習者向け英作文コーチです。学習者の日本語日記を、英訳しやすい "plain JP" に書き換える例を 3 通り提示してください。

3 通りのバリエーション:
- variant_subject: 主語をはっきり補うことに重点を置いた書き換え
- variant_verb:    抽象名詞や「〜になる/〜感じ」を具体的な動詞に戻すことに重点を置いた書き換え
- variant_split:   1 文が長い場合に短く分割することに重点を置いた書き換え

ルール:
1. 元の意味を変えない。情報を勝手に足さない。
2. 各バリアントの方針が分かるよう、明確な差を付ける。
3. JSON で返す: {"variant_subject": "...", "variant_verb": "...", "variant_split": "..."}
4. 説明文や前置きは一切付けず JSON のみ出力。`;

const HINTS_SYSTEM_PROMPT = `Give the English building blocks a Japanese learner needs to translate their diary themselves. Do NOT translate the whole thing.

Each hint must map to a word/phrase that actually appears in the Japanese. Skip only the truly trivial (family, today, go, eat, see). Cover idiomatic expressions, casual connectors, collocations, tricky verbs, and any noun/verb the learner might hesitate on. Each Japanese concept once, no synonyms.

Coverage target: roughly 1 hint per ~25 Japanese characters.
- 50 chars → ~2 hints
- 150 chars → ~6 hints
- 300 chars → ~10–12 hints
- 500+ chars → 14+ hints
When in doubt about whether a phrase is "basic enough to skip," include it. Better one hint too many than one too few.

Show English in base/dictionary form ("feel under the weather", not "feeling..."). Match the tone (casual = casual, formal = formal). Never add expressions the diary doesn't call for.

Return JSON array:
[{"japanese":"diaryからの該当語/概念","english":"対応表現","note":"使い方の補足(日本語1文)"}]

Return ONLY the JSON array.`;

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

interface SubjectIssue { sentence: string; suggested_subject: string; }
interface PlainJpVariants { variant_subject: string; variant_verb: string; variant_split: string; }

async function detectSubjectOmissions(contentJp: string): Promise<SubjectIssue[]> {
  const raw = await callLLM(SUBJECT_CHECK_PROMPT, contentJp);
  try {
    let s = raw.trim();
    const first = s.indexOf('[');
    const last = s.lastIndexOf(']');
    if (first >= 0 && last > first) s = s.slice(first, last + 1);
    const arr = JSON.parse(s);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.warn('[detectSubjectOmissions] parse fail', e);
    return [];
  }
}

async function generatePlainJpVariants(contentJp: string): Promise<PlainJpVariants | null> {
  const raw = await callLLM(PLAIN_JP_VARIANTS_PROMPT, contentJp);
  try {
    let s = raw.trim();
    const first = s.indexOf('{');
    const last = s.lastIndexOf('}');
    if (first >= 0 && last > first) s = s.slice(first, last + 1);
    return JSON.parse(s) as PlainJpVariants;
  } catch (e) {
    console.warn('[generatePlainJpVariants] parse fail', e);
    return null;
  }
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

/** ヒント生成 + Firestore 保存。
 *  contentJp は **常に元の生 JP** を書き戻す (和文和訳で上書きしてはいけない)。
 *  plain JP は別フィールド plainJp として併存させる。 */
async function loadHints(
  sourceJp: string,       // LLM に渡す source (plainJp があれば plainJp、なければ rawJp)
  rawContentJp: string,   // post.contentJp に書き戻す元の日本語日記
  plainJp: string,        // post.plainJp に保存する和文和訳。空なら保存しない
  date: string,
  mode: Mode,
): Promise<HintItem[]> {
  const user = getCurrentUser();
  if (!user) return [];
  const hints = await generateHintsClient(sourceJp);
  const docID = `${user.uid}_${date}_${mode}`;
  const ref = doc(db, 'lediary-posts', docID);
  const existing = await getDoc(ref);
  const now = Date.now();
  const payload: Record<string, unknown> = {
    userId: user.uid,
    contentJp: rawContentJp,
    mode,
    date,
    hints,
    updatedAt: now,
  };
  if (plainJp) payload.plainJp = plainJp;
  if (!existing.exists()) payload.createdAt = now;
  await setDoc(ref, payload, { merge: true });
  return hints;
}

async function loadFeedback(
  contentJp: string,
  userTranslation: string,
  date: string,
  mode: Mode,
  plainJp?: string,
): Promise<FeedbackItem[]> {
  if (!getCurrentUser()) return [];
  const res = await analyzeAndSavePost({ contentJp, userTranslation, date, mode, plainJp });
  return res.feedback || [];
}

async function loadFlowCheck(text: string): Promise<FeedbackItem[]> {
  if (!getCurrentUser()) return [];
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

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function escapeHtml(s: string | undefined | null): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

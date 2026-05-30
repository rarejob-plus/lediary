// 1 フレーズ・シャドーイング player。
// 動作モード:
//   1. pick.audioPath が既に Storage 上にあれば fetch → blob URL
//   2. なければ Gemini TTS で生成 → WAV → Blob URL → 並行で Storage upload (永続化)
//   3. メモリキャッシュ (タブ存続中) で再フェッチ抑止
//
// 再生は HTMLAudioElement で行う。
// AudioBufferSourceNode と違い、playbackRate を変えても preservesPitch=true なら声の高さは保たれる。
// (0.7x にしても "太い声" にならない)

import { ensurePickAudioUrl } from '../data/picksAudio';
import { icons } from './icons';
import { isSpeechRecognitionSupported, recognizeStreaming, scorePronunciation, renderScoreDiffHtml } from './pronunciation';

const RATES = [0.5, 0.75, 1];
const DEFAULT_VOICE = 'Charon';
/** BOY 方式の最低リピート目安 = 30 回 (聞く 10 + 喋る 10 + シャドーイング 10)。
 *  これだけやれば最低限すらすら読み上げられるラインの肌感。 */
const SHADOWING_GOAL = 30;
const VOLUME_KEY = 'lediary_shadowing_volume';

function loadVolume(): number {
  const v = parseFloat(localStorage.getItem(VOLUME_KEY) || '1');
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 1;
}
function saveVolume(v: number): void {
  localStorage.setItem(VOLUME_KEY, String(v));
}

export interface ShadowingPlayerOptions {
  pickId: string;
  text: string;
  audioPath?: string;
  audioVoice?: string;
  initialCount?: number;
  /** 発音採点の前回 / ベストスコア (0-100)。表示用。 */
  lastScore?: number;
  bestScore?: number;
  attemptCount?: number;
  classPrefix?: string;
  /** マウント直後に TTS を確保 (or 既存 audioPath を fetch)。再生ボタンは準備中は disabled、
   *  完了後に enable。"決定" 直後にすぐ再生可能にしたいときに使う。 */
  eager?: boolean;
  onShadowed?: (delta: number) => void | Promise<void>;
  onPersisted?: (audioPath: string, voice: string) => void | Promise<void>;
  /** 録音 → 採点完了時。呼び出し側で pick.bestScore/lastScore/attemptCount を保存する。 */
  onScored?: (result: { score: number; transcript: string; isNewBest: boolean }) => void | Promise<void>;
}

export function createShadowingPlayer(opts: ShadowingPlayerOptions): HTMLElement {
  const prefix = opts.classPrefix || 'pick';
  const root = document.createElement('div');
  root.className = `${prefix}-card-player`;
  const srSupported = isSpeechRecognitionSupported();
  const scoreLineHtml = (opts.lastScore !== undefined || opts.bestScore !== undefined) ? `
    <div class="pron-score-line">
      ${opts.lastScore !== undefined ? `<span class="pron-score-last">前回 ${opts.lastScore}</span>` : ''}
      ${opts.bestScore !== undefined ? `<span class="pron-score-best">★ベスト ${opts.bestScore}</span>` : ''}
      ${opts.attemptCount ? `<span class="pron-score-count">${opts.attemptCount} 回</span>` : ''}
    </div>
  ` : '';
  root.innerHTML = `
    <div class="${prefix}-card-player-row">
      <button class="${prefix}-play" aria-label="再生">${icons.play(14)}</button>
      <div class="${prefix}-speeds">
        ${RATES.map((s) => `<button class="${prefix}-speed${s === 1 ? ' active' : ''}" data-speed="${s}">${s === 0.5 ? '0.5x' : s === 0.75 ? '0.75x' : '1x'}</button>`).join('')}
      </div>
      <label class="${prefix}-volume" title="音量">
        <span class="${prefix}-volume-icon">${icons.volume2(14)}</span>
        <input type="range" class="${prefix}-volume-range" min="0" max="1" step="0.05" value="${loadVolume()}">
      </label>
      <label class="${prefix}-repeat" title="リピート">
        <input type="checkbox" class="${prefix}-repeat-cb"> リピート
      </label>
      <span class="${prefix}-count" title="シャドーイング回数">${formatGoal(opts.initialCount || 0)}</span>
    </div>
    <div class="${prefix}-goal-bar" title="目標 ${SHADOWING_GOAL} 回">
      <div class="${prefix}-goal-fill" style="width:${goalPercent(opts.initialCount || 0)}%"></div>
    </div>
    ${srSupported ? `
      <div class="pron-pane">
        <button class="pron-rec" type="button" title="自分の発音を録音">
          <span class="pron-rec-icon">${icons.mic(14)}</span>
          <span class="pron-rec-label">録音する</span>
        </button>
        ${scoreLineHtml}
        <div class="pron-result" aria-live="polite"></div>
      </div>
    ` : ''}
  `;

  const playBtn = root.querySelector(`.${prefix}-play`) as HTMLButtonElement;
  const repeatCb = root.querySelector(`.${prefix}-repeat-cb`) as HTMLInputElement;
  const countEl = root.querySelector(`.${prefix}-count`) as HTMLElement;
  const goalFillEl = root.querySelector(`.${prefix}-goal-fill`) as HTMLElement | null;
  let currentCount = opts.initialCount || 0;
  if (currentCount >= SHADOWING_GOAL) countEl.classList.add(`${prefix}-count--achieved`);

  let rate = 1;
  let isPlaying = false;
  let audioPath = opts.audioPath;
  const voice = opts.audioVoice || DEFAULT_VOICE;

  // 再利用する 1 つの HTMLAudioElement。リピート時は ended → play() で再開。
  const audioEl = new Audio();
  audioEl.preload = 'auto';
  // ピッチ保持 (ブラウザ間 prefix 対応)。デフォルト true だが念のため明示。
  audioEl.preservesPitch = true;
  // @ts-expect-error legacy webkit
  audioEl.webkitPreservesPitch = true;
  // @ts-expect-error legacy moz
  audioEl.mozPreservesPitch = true;
  audioEl.playbackRate = 1;
  audioEl.volume = loadVolume();

  const volumeRange = root.querySelector(`.${prefix}-volume-range`) as HTMLInputElement | null;
  volumeRange?.addEventListener('input', () => {
    const v = parseFloat(volumeRange.value);
    audioEl.volume = v;
    saveVolume(v);
  });

  root.querySelectorAll<HTMLButtonElement>(`.${prefix}-speed`).forEach((b) => {
    b.addEventListener('click', () => {
      rate = parseFloat(b.dataset.speed || '1');
      audioEl.playbackRate = rate;
      root.querySelectorAll(`.${prefix}-speed`).forEach((x) => x.classList.toggle('active', x === b));
    });
  });

  function stop(): void {
    audioEl.pause();
    audioEl.currentTime = 0;
    isPlaying = false;
    playBtn.innerHTML = icons.play(14);
  }

  audioEl.addEventListener('ended', () => {
    currentCount += 1;
    countEl.textContent = formatGoal(currentCount);
    if (goalFillEl) goalFillEl.style.width = `${goalPercent(currentCount)}%`;
    if (currentCount >= SHADOWING_GOAL) countEl.classList.add(`${prefix}-count--achieved`);
    void opts.onShadowed?.(1);
    if (repeatCb.checked && isPlaying) {
      audioEl.currentTime = 0;
      // 連続再生の境目が詰まりすぎるとリスニングの区切りが取れないので、
      // ほんの少し (600ms) だけ間を空けてから再生。途中で stop されたら発火しない。
      window.setTimeout(() => {
        if (isPlaying && repeatCb.checked) void audioEl.play();
      }, 600);
    } else {
      isPlaying = false;
      playBtn.innerHTML = icons.play(14);
    }
  });

  audioEl.addEventListener('error', () => {
    isPlaying = false;
    playBtn.innerHTML = icons.play(14);
  });

  /** 再生用 blob URL を確保 (キャッシュ / Storage fetch / 生成 + upload の優先順)。
   *  ロジックは data/picksAudio.ts に集約されており、timeline などとキャッシュも共有。 */
  function ensureUrl(): Promise<string> {
    return ensurePickAudioUrl({
      pickId: opts.pickId,
      text: opts.text,
      audioPath,
      audioVoice: voice,
      onPersisted: (path, v) => {
        audioPath = path;
        return opts.onPersisted?.(path, v);
      },
    });
  }

  if (opts.eager) {
    playBtn.disabled = true;
    playBtn.classList.add(`${prefix}-play--loading`);
    void ensureUrl()
      .then(() => {
        playBtn.disabled = false;
        playBtn.classList.remove(`${prefix}-play--loading`);
      })
      .catch((e) => {
        console.error('[shadowing] eager preload failed', e);
        playBtn.classList.remove(`${prefix}-play--loading`);
        playBtn.disabled = false; // ユーザが手動 retry できるようには戻す
      });
  }

  playBtn.addEventListener('click', async () => {
    if (isPlaying) { stop(); return; }
    isPlaying = true;
    playBtn.innerHTML = icons.pause(14);
    try {
      const url = await ensureUrl();
      if (audioEl.src !== url) audioEl.src = url;
      audioEl.playbackRate = rate;
      audioEl.preservesPitch = true;
      audioEl.currentTime = 0;
      await audioEl.play();
    } catch (e) {
      console.error('[shadowing] TTS failed', e);
      alert('音声の生成に失敗しました');
      isPlaying = false;
      playBtn.innerHTML = icons.play(14);
    }
  });

  // ── 発音採点 ──
  const recBtn = root.querySelector('.pron-rec') as HTMLButtonElement | null;
  const resultEl = root.querySelector('.pron-result') as HTMLElement | null;
  if (recBtn && resultEl) {
    let recording = false;
    let activeController: ReturnType<typeof recognizeStreaming> | null = null;
    let bestScore = opts.bestScore;
    const recLabelEl = recBtn.querySelector('.pron-rec-label') as HTMLElement | null;
    const idleLabelText = recLabelEl?.textContent || '録音する';
    recBtn.addEventListener('click', async () => {
      // 録音中にもう一度押されたら手動停止 → これまでの累積で採点する。
      if (recording && activeController) {
        activeController.stop();
        return;
      }
      // TTS 再生中なら止める (マイクと競合させない)
      if (isPlaying) { audioEl.pause(); isPlaying = false; playBtn.innerHTML = icons.play(14); }
      recording = true;
      recBtn.classList.add('pron-rec--active');
      if (recLabelEl) recLabelEl.textContent = '録音中… (押すと停止)';
      resultEl.innerHTML = '';
      // ── マイク入力レベル diagnostic ──
      // Web Speech API と並行で getUserMedia + AnalyserNode を回し、録音中の RMS を計測。
      // 「no-speech が連発するけど本当にマイクから音が拾えてないだけ？」を切り分けるための観測装置。
      // 結果: maxLevel >= 0.05 程度なら音は拾えてる → API 側の問題確定 → Deepgram 載せ替えへ。
      const meter = setupLevelMeter(resultEl);

      try {
        // continuous + interim 累積で発話途中のポーズで切れない。
        // startupGrace 12s = ボタン押してから話し始めるまでの猶予 (silence timer は最初の発話後に始動)。
        // silence 2.5s = 話し終わってからの auto-stop。max 30s = ハードタイムアウト。
        activeController = recognizeStreaming({ maxMs: 30_000, silenceMs: 2_500, startupGraceMs: 12_000 });
        const rec = await activeController.result;
        activeController = null;
        const diag = await meter.finish();
        if (!rec || !('transcript' in rec)) {
          const reason = rec && 'reason' in rec ? rec.reason : 'unknown';
          const msg = reasonMessage(reason);
          const verdict = diag
            ? (diag.maxLevel >= 0.04
                ? `<br><small>(マイク入力は検出されています: 最大レベル ${(diag.maxLevel * 100).toFixed(1)} → 音声認識 API 側の問題の可能性大)</small>`
                : `<br><small>(マイク入力レベルがほぼゼロ: 最大 ${(diag.maxLevel * 100).toFixed(2)} → 入力デバイスや権限を確認してください)</small>`)
            : '';
          resultEl.innerHTML = `<p class="pron-error">${msg}${verdict}</p>`;
          return;
        }
        const s = scorePronunciation(opts.text, rec.transcript);
        const isNewBest = bestScore === undefined || s.score > bestScore;
        if (isNewBest) bestScore = s.score;
        // 100 = Perfect, 90+ = Great, 60+ = Good。100 はゴールとして据え置き、
        // 中間段にも称揚を入れて「100 にできなくて萎える」を緩和する (BOY 方式の継続性を優先)。
        const tierBadge = s.score >= 100
          ? '<span class="pron-score-badge pron-score-badge--perfect">🏆 Perfect!</span>'
          : s.score >= 90
            ? '<span class="pron-score-badge pron-score-badge--great">✨ Great!</span>'
            : s.score >= 60
              ? '<span class="pron-score-badge pron-score-badge--good">👍 Good!</span>'
              : '';
        resultEl.innerHTML = `
          <div class="pron-score-headline">
            <span class="pron-score-num">${s.score}</span>
            <span class="pron-score-denom">/ 100</span>
            <span class="pron-score-meta">${s.matched} / ${s.total} 単語一致</span>
            ${tierBadge}
            ${isNewBest ? '<span class="pron-score-badge">★ ベスト更新</span>' : ''}
          </div>
          <div class="pron-diff">${renderScoreDiffHtml(s.tokens)}</div>
          <div class="pron-heard">聞き取り: <em>${escapeHtml(rec.transcript)}</em></div>
        `;
        void opts.onScored?.({ score: s.score, transcript: rec.transcript, isNewBest });
      } catch (e) {
        console.error('[pron] failed', e);
        resultEl.innerHTML = '<p class="pron-error">エラーが発生しました</p>';
      } finally {
        recording = false;
        recBtn.classList.remove('pron-rec--active');
        if (recLabelEl) recLabelEl.textContent = idleLabelText;
      }
    });
  }

  return root;
}

/** getUserMedia でマイクストリームを開いて AnalyserNode で RMS レベルを観測。
 *  録音 UI (resultEl) に簡易メーターを表示し、終了時に maxLevel を返す。
 *  失敗 (権限拒否など) しても採点フロー本体は止めない。 */
function setupLevelMeter(host: HTMLElement): {
  finish: () => Promise<{ maxLevel: number } | null>;
} {
  const meter = document.createElement('div');
  meter.className = 'pron-meter';
  meter.innerHTML = `
    <div class="pron-meter-label">mic レベル (診断用)</div>
    <div class="pron-meter-bar"><div class="pron-meter-fill"></div></div>
    <div class="pron-meter-value">0.0</div>
  `;
  host.appendChild(meter);
  const fillEl = meter.querySelector('.pron-meter-fill') as HTMLElement;
  const valEl = meter.querySelector('.pron-meter-value') as HTMLElement;

  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = null;
  let rafId: number | null = null;
  let maxLevel = 0;
  let stopped = false;

  const start = async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const tick = () => {
        if (stopped) return;
        analyser.getByteTimeDomainData(buf);
        // 0..255 → -1..1 に正規化して RMS
        let sumSq = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i]! - 128) / 128;
          sumSq += v * v;
        }
        const rms = Math.sqrt(sumSq / buf.length);
        if (rms > maxLevel) maxLevel = rms;
        const pct = Math.min(100, rms * 400);
        fillEl.style.width = `${pct}%`;
        valEl.textContent = rms.toFixed(3);
        rafId = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      console.warn('[pron-meter] getUserMedia failed', e);
      meter.remove();
      stream = null;
    }
  };
  void start();

  return {
    finish: async () => {
      stopped = true;
      if (rafId) cancelAnimationFrame(rafId);
      stream?.getTracks().forEach((t) => t.stop());
      try { await ctx?.close(); } catch { /* ignore */ }
      console.log('[pron-meter] maxLevel =', maxLevel.toFixed(4));
      // 採点結果が出る場合は邪魔なので消す。エラー表示の時は呼び出し側で参照済。
      meter.remove();
      return stream ? { maxLevel } : null;
    },
  };
}

function reasonMessage(reason: string): string {
  switch (reason) {
    case 'no-speech':
      return '発話を検出できませんでした。マイクに近づいて、もう少し大きめの声で試してください。';
    case 'audio-capture':
      return 'マイクにアクセスできませんでした。他のアプリがマイクを使用していないか、入力デバイスの設定を確認してください。';
    case 'not-allowed':
      return 'マイクの使用が許可されていません。ブラウザのサイト設定からマイク権限を許可してください。';
    case 'network':
      return 'ネットワークエラー (音声認識は Google のクラウド処理に依存します)。接続を確認して再試行してください。';
    case 'aborted':
      return '録音が中断されました。もう一度試してください。';
    default:
      return '録音できませんでした。マイク設定と発話を確認してください。';
  }
}

function formatGoal(n: number): string {
  if (n >= SHADOWING_GOAL) return `${n} / ${SHADOWING_GOAL} ✓`;
  return `${n} / ${SHADOWING_GOAL}`;
}
function goalPercent(n: number): number {
  return Math.min(100, Math.round((n / SHADOWING_GOAL) * 100));
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

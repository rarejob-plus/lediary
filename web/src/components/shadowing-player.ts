// 1 フレーズ・シャドーイング player。Gemini TTS で AudioBuffer を 1 回生成 → メモリキャッシュ。
// リピート再生・速度変更はその AudioBuffer を AudioBufferSourceNode で再生して行う (追加コスト 0)。
//
// pick / phrase card 双方で利用。Web Speech API より自然な音声を狙う。

import { generateTtsAudioBuffer } from '../llm';
import { icons } from './icons';

const RATES = [0.5, 0.75, 1];
const audioCtxRef: { ctx: AudioContext | null } = { ctx: null };
function ctx(): AudioContext {
  if (!audioCtxRef.ctx) audioCtxRef.ctx = new AudioContext();
  return audioCtxRef.ctx;
}

// AudioBuffer を「voice + テキスト」単位でキャッシュ (タブ存続中)。
// voice を切替えると別の AudioBuffer が必要になるためキーに含める。
const audioCache = new Map<string, AudioBuffer>();
const DEFAULT_VOICE = 'Charon';
function cacheKey(voice: string, text: string): string {
  return `${voice}::${text}`;
}

export interface ShadowingPlayerOptions {
  text: string;
  initialCount?: number;
  classPrefix?: string;        // 既存 CSS との互換: 'pick' or 'phrase'
  onShadowed?: (delta: number) => void | Promise<void>;
}

/** 単発のシャドーイング player UI を返す。再生・停止・速度・リピート・回数表示・カウント。 */
export function createShadowingPlayer(opts: ShadowingPlayerOptions): HTMLElement {
  const prefix = opts.classPrefix || 'pick';
  const root = document.createElement('div');
  root.className = `${prefix}-card-player`;
  root.innerHTML = `
    <button class="${prefix}-play" aria-label="再生">${icons.play(14)}</button>
    <div class="${prefix}-speeds">
      ${RATES.map((s) => `<button class="${prefix}-speed${s === 1 ? ' active' : ''}" data-speed="${s}">${s === 0.5 ? '0.5x' : s === 0.75 ? '0.75x' : '1x'}</button>`).join('')}
    </div>
    <label class="${prefix}-repeat" title="リピート">
      <input type="checkbox" class="${prefix}-repeat-cb"> リピート
    </label>
    <span class="${prefix}-count" title="シャドーイング回数">${opts.initialCount || 0} 回</span>
  `;

  const playBtn = root.querySelector(`.${prefix}-play`) as HTMLButtonElement;
  const repeatCb = root.querySelector(`.${prefix}-repeat-cb`) as HTMLInputElement;
  const countEl = root.querySelector(`.${prefix}-count`) as HTMLElement;

  let rate = 1;
  root.querySelectorAll<HTMLButtonElement>(`.${prefix}-speed`).forEach((b) => {
    b.addEventListener('click', () => {
      rate = parseFloat(b.dataset.speed || '1');
      root.querySelectorAll(`.${prefix}-speed`).forEach((x) => x.classList.toggle('active', x === b));
      if (currentSource) currentSource.playbackRate.value = rate;
    });
  });

  let currentSource: AudioBufferSourceNode | null = null;
  let isPlaying = false;

  function stop(): void {
    if (currentSource) {
      try { currentSource.onended = null; currentSource.stop(); } catch { /* ignore */ }
      currentSource = null;
    }
    isPlaying = false;
    playBtn.innerHTML = icons.play(14);
  }

  async function ensureBuffer(): Promise<AudioBuffer> {
    const key = cacheKey(DEFAULT_VOICE, opts.text);
    const cached = audioCache.get(key);
    if (cached) return cached;
    const buf = await generateTtsAudioBuffer(opts.text, ctx(), DEFAULT_VOICE);
    audioCache.set(key, buf);
    return buf;
  }

  function play(buf: AudioBuffer): void {
    const src = ctx().createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    src.connect(ctx().destination);
    src.onended = () => {
      // ユーザーが手動 stop した場合はカウントしない (currentSource をクリア済)
      if (currentSource !== src) return;
      currentSource = null;
      const next = (parseInt(countEl.textContent || '0') || 0) + 1;
      countEl.textContent = `${next} 回`;
      void opts.onShadowed?.(1);
      if (repeatCb.checked) {
        play(buf);
      } else {
        isPlaying = false;
        playBtn.innerHTML = icons.play(14);
      }
    };
    currentSource = src;
    src.start();
  }

  playBtn.addEventListener('click', async () => {
    if (isPlaying) { stop(); return; }
    isPlaying = true;
    playBtn.innerHTML = icons.pause(14);
    try {
      const buf = await ensureBuffer();
      play(buf);
    } catch (e) {
      console.error('[shadowing] TTS failed', e);
      alert('音声の生成に失敗しました');
      isPlaying = false;
      playBtn.innerHTML = icons.play(14);
    }
  });

  return root;
}

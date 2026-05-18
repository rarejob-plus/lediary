// 1 フレーズ・シャドーイング player。
// 動作モード:
//   1. pick.audioPath が既に Storage 上にあれば fetch → AudioBuffer
//   2. なければ Gemini TTS で生成 → AudioBuffer + WAV → Storage upload → audioPath を返却
//   3. メモリキャッシュ (タブ存続中) で再フェッチ抑止
// 速度・リピートは AudioBuffer を AudioBufferSourceNode で再生して制御。

import { generateTtsAudio, pcm16leToWav } from '../llm';
import { uploadPickAudio, fetchPickAudioBuffer } from '../data/picksAudio';
import { icons } from './icons';

const RATES = [0.5, 0.75, 1];
const DEFAULT_VOICE = 'Charon';

const audioCtxRef: { ctx: AudioContext | null } = { ctx: null };
function ctx(): AudioContext {
  if (!audioCtxRef.ctx) audioCtxRef.ctx = new AudioContext();
  return audioCtxRef.ctx;
}

// AudioBuffer をテキスト + voice 単位でメモリキャッシュ。
const audioCache = new Map<string, AudioBuffer>();
function cacheKey(voice: string, text: string): string { return `${voice}::${text}`; }

export interface ShadowingPlayerOptions {
  pickId: string;
  text: string;
  audioPath?: string;
  audioVoice?: string;
  initialCount?: number;
  classPrefix?: string;
  /** 累積回数を持つ呼び出し元へ通知。 */
  onShadowed?: (delta: number) => void | Promise<void>;
  /** Storage upload 成功時に呼ばれる。entry / phrases 側で pick.audioPath を Firestore に保存する。 */
  onPersisted?: (audioPath: string, voice: string) => void | Promise<void>;
}

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
  let currentSource: AudioBufferSourceNode | null = null;
  let isPlaying = false;
  let audioPath = opts.audioPath;
  // voice が pick に保存されてれば優先、なければ現行デフォルト。
  const voice = opts.audioVoice || DEFAULT_VOICE;

  root.querySelectorAll<HTMLButtonElement>(`.${prefix}-speed`).forEach((b) => {
    b.addEventListener('click', () => {
      rate = parseFloat(b.dataset.speed || '1');
      root.querySelectorAll(`.${prefix}-speed`).forEach((x) => x.classList.toggle('active', x === b));
      if (currentSource) currentSource.playbackRate.value = rate;
    });
  });

  function stop(): void {
    if (currentSource) {
      try { currentSource.onended = null; currentSource.stop(); } catch { /* ignore */ }
      currentSource = null;
    }
    isPlaying = false;
    playBtn.innerHTML = icons.play(14);
  }

  async function ensureBuffer(): Promise<AudioBuffer> {
    const key = cacheKey(voice, opts.text);
    const cached = audioCache.get(key);
    if (cached) return cached;

    // (1) Storage に既にあれば fetch
    if (audioPath) {
      const buf = await fetchPickAudioBuffer(audioPath, ctx());
      if (buf) {
        audioCache.set(key, buf);
        return buf;
      }
      // 失敗したら再生成にフォールバック
    }

    // (2) Gemini TTS で生成 + (3) Storage に upload (best-effort、失敗してもメモリ再生は継続)
    const tts = await generateTtsAudio(opts.text, ctx(), voice);
    audioCache.set(key, tts.audioBuffer);
    const wav = pcm16leToWav(tts.pcm, tts.sampleRate);
    void uploadPickAudio(opts.pickId, wav).then((path) => {
      if (path && path !== audioPath) {
        audioPath = path;
        void opts.onPersisted?.(path, voice);
      }
    });
    return tts.audioBuffer;
  }

  function play(buf: AudioBuffer): void {
    const src = ctx().createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    src.connect(ctx().destination);
    src.onended = () => {
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

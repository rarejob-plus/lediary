// 1 フレーズ・シャドーイング player。
// 動作モード:
//   1. pick.audioPath が既に Storage 上にあれば fetch → blob URL
//   2. なければ Gemini TTS で生成 → WAV → Blob URL → 並行で Storage upload (永続化)
//   3. メモリキャッシュ (タブ存続中) で再フェッチ抑止
//
// 再生は HTMLAudioElement で行う。
// AudioBufferSourceNode と違い、playbackRate を変えても preservesPitch=true なら声の高さは保たれる。
// (0.7x にしても "太い声" にならない)

import { generateTtsAudio, pcm16leToWav } from '../llm';
import { uploadPickAudio } from '../data/picksAudio';
import { getDownloadURL, ref as storageRef, getStorage } from 'firebase/storage';
import { app } from '../firebase';
import { icons } from './icons';
import { isSpeechRecognitionSupported, recognizeOnce, scorePronunciation, renderScoreDiffHtml } from './pronunciation';

const RATES = [0.5, 0.75, 1];
const DEFAULT_VOICE = 'Charon';

// blob URL をテキスト + voice 単位でメモリキャッシュ (タブ存続中)。
const urlCache = new Map<string, string>();
function cacheKey(voice: string, text: string): string { return `${voice}::${text}`; }

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
      <label class="${prefix}-repeat" title="リピート">
        <input type="checkbox" class="${prefix}-repeat-cb"> リピート
      </label>
      <span class="${prefix}-count" title="シャドーイング回数">${opts.initialCount || 0} 回</span>
    </div>
    ${srSupported ? `
      <div class="pron-pane">
        <button class="pron-rec" type="button" title="自分の発音を録音">🎤 録音する</button>
        ${scoreLineHtml}
        <div class="pron-result" aria-live="polite"></div>
      </div>
    ` : ''}
  `;

  const playBtn = root.querySelector(`.${prefix}-play`) as HTMLButtonElement;
  const repeatCb = root.querySelector(`.${prefix}-repeat-cb`) as HTMLInputElement;
  const countEl = root.querySelector(`.${prefix}-count`) as HTMLElement;

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
    const next = (parseInt(countEl.textContent || '0') || 0) + 1;
    countEl.textContent = `${next} 回`;
    void opts.onShadowed?.(1);
    if (repeatCb.checked && isPlaying) {
      audioEl.currentTime = 0;
      void audioEl.play();
    } else {
      isPlaying = false;
      playBtn.innerHTML = icons.play(14);
    }
  });

  audioEl.addEventListener('error', () => {
    isPlaying = false;
    playBtn.innerHTML = icons.play(14);
  });

  /** Storage 上の audioPath を download URL に解決して blob として fetch。失敗時 null。 */
  async function fetchPersistedAsBlobUrl(path: string): Promise<string | null> {
    try {
      const url = await getDownloadURL(storageRef(getStorage(app), path));
      const res = await fetch(url);
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    } catch (e) {
      console.warn('[shadowing] persisted fetch failed', e);
      return null;
    }
  }

  /** 再生用の blob URL を確保。なければ生成 + upload。 */
  async function ensureUrl(): Promise<string> {
    const key = cacheKey(voice, opts.text);
    const cached = urlCache.get(key);
    if (cached) return cached;

    if (audioPath) {
      const url = await fetchPersistedAsBlobUrl(audioPath);
      if (url) { urlCache.set(key, url); return url; }
      // 失敗 → 再生成
    }

    const tts = await generateTtsAudio(opts.text, new AudioContext(), voice);
    const wav = pcm16leToWav(tts.pcm, tts.sampleRate);
    const blob = new Blob([wav as unknown as BlobPart], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    urlCache.set(key, url);
    void uploadPickAudio(opts.pickId, wav).then((path) => {
      if (path && path !== audioPath) {
        audioPath = path;
        void opts.onPersisted?.(path, voice);
      }
    });
    return url;
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
    let bestScore = opts.bestScore;
    recBtn.addEventListener('click', async () => {
      if (recording) return;
      // TTS 再生中なら止める (マイクと競合させない)
      if (isPlaying) { audioEl.pause(); isPlaying = false; playBtn.innerHTML = icons.play(14); }
      recording = true;
      const original = recBtn.textContent;
      recBtn.classList.add('pron-rec--active');
      recBtn.textContent = '🎤 録音中… 話してください';
      resultEl.innerHTML = '';
      try {
        const rec = await recognizeOnce(10_000);
        if (!rec) {
          resultEl.innerHTML = '<p class="pron-error">録音できませんでした。マイク許可と発話を確認してください。</p>';
          return;
        }
        const s = scorePronunciation(opts.text, rec.transcript);
        const isNewBest = bestScore === undefined || s.score > bestScore;
        if (isNewBest) bestScore = s.score;
        resultEl.innerHTML = `
          <div class="pron-score-headline">
            <span class="pron-score-num">${s.score}</span>
            <span class="pron-score-denom">/ 100</span>
            <span class="pron-score-meta">${s.matched} / ${s.total} 単語一致</span>
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
        recBtn.textContent = original || '🎤 録音する';
      }
    });
  }

  return root;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

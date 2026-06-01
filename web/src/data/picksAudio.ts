// pick の TTS 音声を Firebase Storage に永続化する layer。
// Storage path: lediary-picks/{userId}/{pickId}.wav
// セキュリティ rules で {userId} == request.auth.uid を強制する想定。

import { getStorage, ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { app } from '../firebase';
import { getCurrentUser } from '../auth';
import { generateTtsAudio, pcm16leToWav } from '../llm';

const DEFAULT_VOICE = 'Iapetus';

// blob URL を pickId + voice + text のキーでメモリキャッシュ (タブ存続中)。
// timeline と entry detail の両方で同じ pick を扱うため、ここに集約してキャッシュ共有する。
const blobUrlCache = new Map<string, string>();
function cacheKey(voice: string, text: string): string { return `${voice}::${text}`; }

function pickAudioRef(userId: string, pickId: string) {
  return storageRef(getStorage(app), `lediary-picks/${userId}/${pickId}.wav`);
}

/** WAV bytes を Storage にアップロード。成功時は Storage path を返す。
 *  失敗時はログを残して null を返す (バケット未作成・権限不足等のときに UI 全体を巻き込まないため)。 */
export async function uploadPickAudio(pickId: string, wav: Uint8Array): Promise<string | null> {
  const user = getCurrentUser();
  if (!user) return null;
  try {
    const r = pickAudioRef(user.uid, pickId);
    await uploadBytes(r, wav, { contentType: 'audio/wav' });
    return r.fullPath;
  } catch (e) {
    console.warn('[picksAudio] upload failed (Storage 未設定の可能性):', e);
    return null;
  }
}

/** Storage path から WAV を fetch して AudioBuffer に decode。
 *  失敗時は null を返し、呼び出し側で TTS 再生成にフォールバック。 */
export async function fetchPickAudioBuffer(path: string, audioCtx: AudioContext): Promise<AudioBuffer | null> {
  try {
    const url = await getDownloadURL(storageRef(getStorage(app), path));
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    return await audioCtx.decodeAudioData(await res.arrayBuffer());
  } catch (e) {
    console.warn('[picksAudio] fetch failed for', path, e);
    return null;
  }
}

/** Storage path から blob URL に解決 (decodeAudioData 不要なシンプル再生用)。 */
async function fetchPersistedAsBlobUrl(path: string): Promise<string | null> {
  try {
    const url = await getDownloadURL(storageRef(getStorage(app), path));
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch (e) {
    console.warn('[picksAudio] blob fetch failed', e);
    return null;
  }
}

export interface EnsurePickAudioInput {
  pickId: string;
  text: string;
  audioPath?: string;
  audioVoice?: string;
  /** 新規生成 → upload 成功時に audioPath / voice を呼び出し側で永続化する callback。 */
  onPersisted?: (path: string, voice: string) => void | Promise<void>;
}

/** 再生用の blob URL を確保する単一の入口。
 *  1) メモリキャッシュ
 *  2) Storage 上の audioPath があれば fetch
 *  3) なければ Gemini TTS で生成 → 再生用 URL + 並行で Storage upload */
export async function ensurePickAudioUrl(input: EnsurePickAudioInput): Promise<string> {
  const voice = input.audioVoice || DEFAULT_VOICE;
  const key = cacheKey(voice, input.text);
  const cached = blobUrlCache.get(key);
  if (cached) return cached;

  if (input.audioPath) {
    const url = await fetchPersistedAsBlobUrl(input.audioPath);
    if (url) { blobUrlCache.set(key, url); return url; }
  }

  const tts = await generateTtsAudio(input.text, new AudioContext(), voice);
  const wav = pcm16leToWav(tts.pcm, tts.sampleRate);
  const blob = new Blob([wav as unknown as BlobPart], { type: 'audio/wav' });
  const url = URL.createObjectURL(blob);
  blobUrlCache.set(key, url);
  void uploadPickAudio(input.pickId, wav).then((path) => {
    if (path && path !== input.audioPath) {
      void input.onPersisted?.(path, voice);
    }
  });
  return url;
}

/** pick 削除時の cleanup (best-effort)。失敗しても呼び出し元には影響させない。 */
export async function deletePickAudio(path: string | undefined): Promise<void> {
  if (!path) return;
  try {
    await deleteObject(storageRef(getStorage(app), path));
  } catch (e) {
    // 既に消えてる / 権限なし 等は無視
    console.warn('[picksAudio] delete failed:', e);
  }
}

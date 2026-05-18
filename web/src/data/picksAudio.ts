// pick の TTS 音声を Firebase Storage に永続化する layer。
// Storage path: lediary-picks/{userId}/{pickId}.wav
// セキュリティ rules で {userId} == request.auth.uid を強制する想定。

import { getStorage, ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { app } from '../firebase';
import { getCurrentUser } from '../auth';

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

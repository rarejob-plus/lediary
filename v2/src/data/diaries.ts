// 日記 artifact: 日付 × モードで 1 つ。1 日 1 モードに対して、フェーズが進む。
// フェーズ:
//   draft       → JP 日記を書いた直後 (まだ AI 質問なし)
//   expanding   → AI が質問しユーザーが答えて膨らませている最中
//   englishing  → 拡張 JP を確定して英訳ステップへ (Stage B)
//   correcting  → 英訳を別 persona (teacher) が添削中 (Stage B)
//   completed   → 完成 = archive 行き
//
// チャット (expansionMessages) はこの artifact の中に持つ。日が変わると別 artifact になり、
// 表示上 1 日ごとに「リセット」される (過去のチャットは archive で読める)。

import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db, V2_COLLECTIONS } from '../firebase';
import type { DiaryMode } from './modes';

export type DiaryStatus = 'in-progress' | 'completed';
export type DiaryPhase = 'draft' | 'expanding' | 'englishing' | 'correcting' | 'completed';

export interface ExpansionMessage {
  id: string;
  role: 'user' | 'ai';     // ai = friend persona
  text: string;
  createdAt: number;
}

export interface CorrectionItem {
  original: string;
  corrected: string;
  explanation: string;
}

export interface DiaryArtifact {
  userId: string;
  date: string;
  mode: DiaryMode;
  /** 学習者が最初に書いた JP 日記。改変しない (元のスナップショット保存)。 */
  originalJp: string;
  /** AI 質問 + 学習者の回答を経て膨らんだ JP 日記。回答ごとに自動更新される。 */
  expandedJp: string;
  /** 拡張フェーズの会話履歴。新しい順ではなく、追記式 (古→新)。 */
  expansionMessages: ExpansionMessage[];
  /** Stage B: ユーザーが書いた英訳。 */
  englishDraft?: string;
  /** Stage B: teacher persona による添削。 */
  corrections?: CorrectionItem[];
  phase: DiaryPhase;
  status: DiaryStatus;
  createdAt: number;
  updatedAt: number;

  // ── 旧 schema (Stage A 以前) との互換 ──
  // 過去 artifact は friendReply / selectedOption / expandedStory を持ち得るので archive 側で fallback 表示。
  /** legacy: 旧 originalText フィールド。 */
  originalText?: string;
  friendReply?: string;
  selectedOption?: string;
  expandedStory?: string;
}

function diaryId(userId: string, date: string, mode: DiaryMode): string {
  return `${userId}_${date}_${mode}`;
}

function diaryRef(userId: string, date: string, mode: DiaryMode) {
  return doc(db, V2_COLLECTIONS.diaries, diaryId(userId, date, mode));
}

/** 日記の初稿を投稿: originalJp + expandedJp = 同じテキスト、phase='expanding'。 */
export async function createDraftDiary(
  userId: string, date: string, mode: DiaryMode, originalJp: string,
): Promise<void> {
  const ref = diaryRef(userId, date, mode);
  const now = Date.now();
  await setDoc(ref, {
    userId, date, mode,
    originalJp,
    expandedJp: originalJp,
    expansionMessages: [],
    phase: 'expanding',
    status: 'in-progress',
    createdAt: now,
    updatedAt: now,
  } as DiaryArtifact, { merge: true });
}

export async function appendExpansionMessage(
  userId: string, date: string, mode: DiaryMode, msg: ExpansionMessage,
): Promise<void> {
  const ref = diaryRef(userId, date, mode);
  const snap = await getDoc(ref);
  const existing = snap.exists() ? (snap.data() as DiaryArtifact) : null;
  const messages = [...(existing?.expansionMessages || []), msg];
  await updateDoc(ref, { expansionMessages: messages, updatedAt: Date.now() });
}

export async function updateExpandedJp(
  userId: string, date: string, mode: DiaryMode, expandedJp: string,
): Promise<void> {
  await updateDoc(diaryRef(userId, date, mode), { expandedJp, updatedAt: Date.now() });
}

export async function setPhase(
  userId: string, date: string, mode: DiaryMode, phase: DiaryPhase,
): Promise<void> {
  const status: DiaryStatus = phase === 'completed' ? 'completed' : 'in-progress';
  await updateDoc(diaryRef(userId, date, mode), { phase, status, updatedAt: Date.now() });
}

export async function updateEnglishDraft(
  userId: string, date: string, mode: DiaryMode, englishDraft: string,
): Promise<void> {
  await updateDoc(diaryRef(userId, date, mode), { englishDraft, updatedAt: Date.now() });
}

export async function updateCorrections(
  userId: string, date: string, mode: DiaryMode, corrections: CorrectionItem[],
): Promise<void> {
  await updateDoc(diaryRef(userId, date, mode), { corrections, updatedAt: Date.now() });
}

/** 試験中の使い捨て: 指定 (date, mode) の artifact を物理削除。Intake からやり直しになる。 */
export async function deleteDiary(
  userId: string, date: string, mode: DiaryMode,
): Promise<void> {
  await deleteDoc(diaryRef(userId, date, mode));
}

export function subscribeDiary(
  userId: string, date: string, mode: DiaryMode,
  cb: (a: DiaryArtifact | null) => void,
): () => void {
  return onSnapshot(diaryRef(userId, date, mode), (snap) => {
    cb(snap.exists() ? (snap.data() as DiaryArtifact) : null);
  });
}

export async function fetchUserDiaries(userId: string): Promise<DiaryArtifact[]> {
  const q = query(
    collection(db, V2_COLLECTIONS.diaries),
    where('userId', '==', userId),
    orderBy('date', 'desc'),
    orderBy('updatedAt', 'desc'),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as DiaryArtifact);
}

export async function fetchTodayStatus(
  userId: string, date: string,
): Promise<Record<DiaryMode, DiaryStatus | null>> {
  const q = query(
    collection(db, V2_COLLECTIONS.diaries),
    where('userId', '==', userId),
    where('date', '==', date),
  );
  const snap = await getDocs(q);
  const out: Record<DiaryMode, DiaryStatus | null> = {
    morning: null, lesson: null, diary: null, story: null,
  };
  snap.forEach((d) => {
    const a = d.data() as DiaryArtifact;
    out[a.mode] = a.status;
  });
  return out;
}

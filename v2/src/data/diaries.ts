// 日記 artifact: 日付 × モードで 1 つ。同じ (date, mode) を再投稿すると上書き。
// chat の messages 配列とは別系統で、過去のアーカイブ参照用に保存する。

import { collection, doc, getDocs, query, setDoc, updateDoc, where, orderBy } from 'firebase/firestore';
import { db, V2_COLLECTIONS } from '../firebase';
import type { DiaryMode } from './modes';

export type DiaryStatus = 'in-progress' | 'completed';

export interface DiaryArtifact {
  userId: string;
  date: string;           // YYYY-MM-DD
  mode: DiaryMode;
  originalText: string;
  friendReply?: string;
  selectedOption?: string;
  expandedStory?: string;
  status: DiaryStatus;
  createdAt: number;
  updatedAt: number;
}

function diaryId(userId: string, date: string, mode: DiaryMode): string {
  return `${userId}_${date}_${mode}`;
}

function diaryRef(userId: string, date: string, mode: DiaryMode) {
  return doc(db, V2_COLLECTIONS.diaries, diaryId(userId, date, mode));
}

/** diary 投稿時に呼ぶ: 同じ (date, mode) があれば内容を更新、なければ新規作成。
 *  status は新規 / 再投稿で 'in-progress' へ戻す (expanded-story が来るまで完成扱いしない)。 */
export async function upsertDiaryStart(
  userId: string,
  date: string,
  mode: DiaryMode,
  originalText: string,
): Promise<void> {
  const ref = diaryRef(userId, date, mode);
  const now = Date.now();
  await setDoc(ref, {
    userId,
    date,
    mode,
    originalText,
    status: 'in-progress',
    createdAt: now,
    updatedAt: now,
  } satisfies Partial<DiaryArtifact> & { userId: string }, { merge: true });
}

export async function updateDiaryReply(
  userId: string, date: string, mode: DiaryMode, friendReply: string,
): Promise<void> {
  await updateDoc(diaryRef(userId, date, mode), { friendReply, updatedAt: Date.now() });
}

export async function completeDiary(
  userId: string, date: string, mode: DiaryMode,
  selectedOption: string, expandedStory: string,
): Promise<void> {
  await updateDoc(diaryRef(userId, date, mode), {
    selectedOption,
    expandedStory,
    status: 'completed',
    updatedAt: Date.now(),
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

/** 当日分 (date 一致) の 4 モード status を返す。 */
export async function fetchTodayStatus(userId: string, date: string): Promise<Record<DiaryMode, DiaryStatus | null>> {
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

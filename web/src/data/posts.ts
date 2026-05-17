// Diary post の save パス。旧 POST /api/diary/posts のサーバロジックをクライアントへ移植。
// - savePostTextOnly: LLM を呼ばずに contentJp / userTranslation / expansionQuestions / dismissedVocab を更新
// - analyzeAndSavePost: analyzeDiary → Unsplash cover → Firestore write の一気通貫

import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { getCurrentUser } from '../auth';
import { analyzeDiary, type FeedbackItem, type DiaryAnalysis } from '../llm-diary';
import { fetchUnsplashCover, notifyUnsplashDownload } from '../unsplash';
import { invalidateEntriesCache } from './entries';
import type { Mode } from './mock';

export interface TextOnlySaveInput {
  contentJp?: string;
  userTranslation: string;
  date: string;
  mode: Mode;
  expansionQuestions?: unknown[];
  dismissedVocab?: unknown[];
}

export async function savePostTextOnly(input: TextOnlySaveInput): Promise<void> {
  const user = getCurrentUser();
  if (!user) throw new Error('not authenticated');
  const docId = `${user.uid}_${input.date}_${input.mode}`;
  const updates: Record<string, unknown> = {
    userTranslation: input.userTranslation || '',
    updatedAt: Date.now(),
  };
  if (typeof input.contentJp === 'string' && input.contentJp.length > 0) {
    updates.contentJp = input.contentJp;
  }
  if (input.expansionQuestions) updates.expansionQuestions = input.expansionQuestions;
  if (input.dismissedVocab) updates.dismissedVocab = input.dismissedVocab;
  await updateDoc(doc(db, 'lediary-posts', docId), updates);
  invalidateEntriesCache();
}

/** 「今日の 1 フレーズ」リストを上書き保存。 */
export async function savePostPicks(entryId: string, picks: unknown[]): Promise<void> {
  const user = getCurrentUser();
  if (!user) throw new Error('not authenticated');
  await updateDoc(doc(db, 'lediary-posts', entryId), {
    picks,
    updatedAt: Date.now(),
  });
  invalidateEntriesCache();
}

export interface AnalyzeSaveInput {
  contentJp: string;
  userTranslation: string;
  date: string;
  mode: Mode;
  previousFeedback?: FeedbackItem[];
  attemptCount?: number;
}

export interface AnalyzeSaveResult extends DiaryAnalysis {
  id: string;
}

export async function analyzeAndSavePost(input: AnalyzeSaveInput): Promise<AnalyzeSaveResult> {
  const user = getCurrentUser();
  if (!user) throw new Error('not authenticated');
  const docId = `${user.uid}_${input.date}_${input.mode}`;
  const ref = doc(db, 'lediary-posts', docId);

  // 既存 doc を先に読んで cover/mood 関連を再利用する判断材料にする
  const existingSnap = await getDoc(ref);
  const existing = existingSnap.exists() ? existingSnap.data() : null;
  const createdAt = (existing?.createdAt as number | undefined) || Date.now();

  const existingMood = (existing?.mood as string | undefined) || '';
  let coverImageUrl = (existing?.coverImageUrl as string | undefined) || '';
  let coverPhotographer = (existing?.coverPhotographer as string | undefined) || '';
  let coverPhotographerUrl = (existing?.coverPhotographerUrl as string | undefined) || '';
  let coverKeyword = (existing?.coverKeyword as string | undefined) || '';

  // contentJp が変わってない & 既に mood/coverKeyword 両方ある → LLM プロンプトから外す
  const skipMoodAndCover =
    existing?.contentJp === input.contentJp && !!existingMood && !!coverKeyword;

  const analysis = await analyzeDiary(input.contentJp, input.userTranslation || '', {
    previousFeedback: input.previousFeedback || [],
    attemptCount: input.attemptCount ?? 1,
    skipMoodAndCover,
  });

  const finalMood = skipMoodAndCover ? existingMood : (analysis.mood || '');
  const newKeyword = skipMoodAndCover ? coverKeyword : (analysis.coverKeyword?.trim() || '');
  if (!skipMoodAndCover && newKeyword && newKeyword !== coverKeyword) {
    const cover = await fetchUnsplashCover(newKeyword);
    if (cover) {
      coverImageUrl = cover.url;
      coverPhotographer = cover.photographer;
      coverPhotographerUrl = cover.photographerUrl;
      coverKeyword = newKeyword;
      // fire-and-forget: Unsplash の DL ガイドライン遵守用 ping
      void notifyUnsplashDownload(cover.downloadLocation);
    }
  }

  const post: Record<string, unknown> = {
    userId: user.uid,
    contentJp: input.contentJp,
    userTranslation: input.userTranslation || '',
    feedback: analysis.feedback,
    vocabulary: analysis.vocabulary,
    expansionQuestions: analysis.expansionQuestions,
    mood: finalMood,
    coverImageUrl,
    coverPhotographer,
    coverPhotographerUrl,
    coverKeyword,
    attemptCount: input.attemptCount ?? 1,
    mode: input.mode,
    date: input.date,
    createdAt,
    updatedAt: Date.now(),
  };

  await setDoc(ref, post);
  invalidateEntriesCache();
  return { ...analysis, id: docId };
}

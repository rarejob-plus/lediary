// Diary post の save パス。旧 POST /api/diary/posts のサーバロジックをクライアントへ移植。
// - savePostTextOnly: LLM を呼ばずに contentJp / userTranslation / expansionQuestions / dismissedVocab を更新
// - analyzeAndSavePost: analyzeDiary → Unsplash cover → Firestore write の一気通貫

import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { getCurrentUser } from '../auth';
import { alignSentences, analyzeDiary, type FeedbackItem, type DiaryAnalysis, type SentencePair } from '../llm-diary';
import { fetchUnsplashCover, notifyUnsplashDownload } from '../unsplash';
import { fetchEntries, invalidateEntriesCache } from './entries';
import type { Mode } from './mock';

/** 過去 entry 全件 + 現在 entry の vocabulary + dismissedVocab を集めて重複排除した語句リスト。
 *  analyzeDiary / extractVocabulary に「これらは除外」として渡す用。 */
export async function gatherKnownVocabFor(userId: string, currentEntryId?: string): Promise<string[]> {
  void userId;
  try {
    const entries = await fetchEntries();
    const seen = new Set<string>();
    for (const e of entries) {
      // 同じエントリの既存 vocab も除外対象に入れる (再添削で同じ語が再度出てこないように)
      void currentEntryId;
      for (const v of (e.vocabulary || [])) {
        if (v?.word) seen.add(v.word.toLowerCase().trim());
      }
      const dismissed = (e as unknown as { dismissedVocab?: Array<{ word?: string } | string> }).dismissedVocab;
      if (Array.isArray(dismissed)) {
        for (const d of dismissed) {
          const w = typeof d === 'string' ? d : d?.word;
          if (w) seen.add(w.toLowerCase().trim());
        }
      }
    }
    return Array.from(seen);
  } catch (e) {
    console.warn('[gatherKnownVocab] failed', e);
    return [];
  }
}

export interface TextOnlySaveInput {
  contentJp?: string;
  userTranslation: string;
  date: string;
  mode: Mode;
  expansionQuestions?: unknown[];
  dismissedVocab?: unknown[];
  /** 和文和訳 (plain JP)。空文字なら更新しない (上書き防止)。 */
  plainJp?: string;
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
  if (typeof input.plainJp === 'string' && input.plainJp.length > 0) {
    updates.plainJp = input.plainJp;
  }
  if (input.expansionQuestions) updates.expansionQuestions = input.expansionQuestions;
  if (input.dismissedVocab) updates.dismissedVocab = input.dismissedVocab;
  await updateDoc(doc(db, 'lediary-posts', docId), updates);
  invalidateEntriesCache();
}

/** entry の JP↔EN sentencePairs を保証する。既存にあればそれ、無ければ LLM で生成 + 保存。 */
export async function ensureSentencePairs(
  entryId: string,
  contentJp: string,
  userTranslation: string,
  existing?: SentencePair[],
): Promise<SentencePair[]> {
  if (Array.isArray(existing) && existing.length > 0) return existing;
  if (!contentJp.trim() || !userTranslation.trim()) return [];
  const pairs = await alignSentences(contentJp, userTranslation);
  if (pairs.length > 0) {
    try {
      await updateDoc(doc(db, 'lediary-posts', entryId), {
        sentencePairs: pairs,
        updatedAt: Date.now(),
      });
      invalidateEntriesCache();
    } catch (e) {
      console.warn('[ensureSentencePairs] save failed', e);
    }
  }
  return pairs;
}

/** 「完成」マーカーを付ける。以降は entry detail が読書モードで開く。 */
export async function finalizeEntry(entryId: string): Promise<void> {
  await updateDoc(doc(db, 'lediary-posts', entryId), {
    finalizedAt: Date.now(),
    updatedAt: Date.now(),
  });
  invalidateEntriesCache();
}

/** 完成解除 (再編集に戻す)。 */
export async function unfinalizeEntry(entryId: string): Promise<void> {
  await updateDoc(doc(db, 'lediary-posts', entryId), {
    finalizedAt: null,
    updatedAt: Date.now(),
  });
  invalidateEntriesCache();
}

/** 「今日の 1 フレーズ」リストを上書き保存。
 *  Firestore は undefined を弾くため、各 pick オブジェクトから undefined フィールドを除去する。 */
export async function savePostPicks(entryId: string, picks: unknown[]): Promise<void> {
  const user = getCurrentUser();
  if (!user) throw new Error('not authenticated');
  const sanitized = picks.map((p) => stripUndefined(p as Record<string, unknown>));
  await updateDoc(doc(db, 'lediary-posts', entryId), {
    picks: sanitized,
    updatedAt: Date.now(),
  });
  invalidateEntriesCache();
}

function stripUndefined(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export interface AnalyzeSaveInput {
  contentJp: string;
  userTranslation: string;
  date: string;
  mode: Mode;
  previousFeedback?: FeedbackItem[];
  attemptCount?: number;
  /** 和文和訳 (plain JP)。post.plainJp に保持。空なら更新しない。 */
  plainJp?: string;
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

  // 既知 vocab (= 過去 entry の vocab + dismissed) を集めて exclude 指示に使う。
  // 失敗しても問題なし。空配列で進む。
  const excludeVocab = await gatherKnownVocabFor(user.uid, docId);

  const analysis = await analyzeDiary(input.contentJp, input.userTranslation || '', {
    previousFeedback: input.previousFeedback || [],
    attemptCount: input.attemptCount ?? 1,
    skipMoodAndCover,
    excludeVocab,
    mode: input.mode,
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

  // 既存 doc に保存されていて、再添削で消えてほしくないフィールドを引き継ぐ。
  const existingPlainJp = (existing?.plainJp as string | undefined) || '';
  const existingPicks = Array.isArray(existing?.picks) ? (existing!.picks as unknown[]) : [];
  const existingHints = Array.isArray(existing?.hints) ? (existing!.hints as unknown[]) : [];
  const existingDismissedVocab = Array.isArray(existing?.dismissedVocab)
    ? (existing!.dismissedVocab as unknown[])
    : [];
  const existingLessonSheetId = (existing?.lessonSheetId as string | undefined) || '';

  const post: Record<string, unknown> = {
    userId: user.uid,
    contentJp: input.contentJp,
    userTranslation: input.userTranslation || '',
    feedback: analysis.feedback,
    vocabulary: analysis.vocabulary,
    expansionQuestions: analysis.expansionQuestions,
    sentencePairs: analysis.sentencePairs || [],
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

  // 引き継ぎフィールド: 入力に明示があれば優先、なければ existing を保つ。
  // setDoc 全置換でも picks / plainJp / hints / 共有 sheet 等が消えないようにする。
  const plainJp = typeof input.plainJp === 'string' && input.plainJp.length > 0
    ? input.plainJp
    : existingPlainJp;
  if (plainJp) post.plainJp = plainJp;
  if (existingPicks.length > 0) post.picks = existingPicks;
  if (existingHints.length > 0) post.hints = existingHints;
  if (existingDismissedVocab.length > 0) post.dismissedVocab = existingDismissedVocab;
  if (existingLessonSheetId) post.lessonSheetId = existingLessonSheetId;

  await setDoc(ref, post);
  invalidateEntriesCache();
  return { ...analysis, id: docId };
}

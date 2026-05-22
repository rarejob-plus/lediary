// Hardcoded mock data — no Firestore.

export type Mode = 'morning' | 'lesson' | 'diary' | 'story';

export interface VocabItem {
  word: string;
  definition: string;
  example: string;
}

export interface ExpansionQuestion {
  question: string;
  hintJa: string;
  hintPhrases: string[];
  reflected?: boolean;
  answer?: string;
}

export interface FeedbackItem {
  original: string;
  corrected: string;
  explanation: string;
}

/** 英語日記 BOY メソッドの「今日の 1 フレーズ」を保存する型。
 *  添削後にユーザーが選んだ覚えたいフレーズ（シャドーイング対象）。 */
export interface PickedPhrase {
  id: string;          // クライアント生成 UUID
  text: string;        // 英文
  note?: string;       // 日本語メモ / 言いたかったこと
  createdAt: number;
  /** シャドーイング回数の累積。SRS 復習や習得トラッキングに使う。 */
  shadowingCount?: number;
  /** 最終シャドーイング時刻 (epoch ms)。SRS の due 判定に使う。未定義なら createdAt を流用。 */
  lastShadowedAt?: number;
  /** Firebase Storage 上の WAV パス。生成済 TTS をデバイス横断で再利用。 */
  audioPath?: string;
  /** TTS 生成時のボイス名。voice 変更時に audio を再生成すべきか判定する。 */
  audioVoice?: string;
  /** 発音スコア (0-100) のベスト値。 */
  bestScore?: number;
  /** 直近の発音スコア。 */
  lastScore?: number;
  /** 発音チャレンジ回数 (録音 → 採点した回数)。 */
  attemptCount?: number;
}

export interface DiaryEntry {
  id: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM (mock)
  mode: Mode;
  location?: string; // mock metadata pill (geo) — currently unused
  weather?: string; // mock — currently unused
  cover?: string; // CSS background string override for hero placeholder
  coverImageUrl?: string; // Unsplash 写真 URL（AI が抽出したキーワードで取得）
  coverPhotographer?: string; // Unsplash 写真家名（クレジット表示用）
  coverPhotographerUrl?: string; // Unsplash 写真家プロフィール URL
  mood?: string; // 感情語（AI feedback 解析結果想定）— "はずむ" "穏やか" 等
  lessonSheetId?: string; // 共有レッスンシート ID（生成済みなら）
  contentJp: string;
  /** 和文和訳 (plain JP)。学習者が任意で書いた英訳しやすい言い換え。 */
  plainJp?: string;
  userTranslation: string;
  feedback: FeedbackItem[];
  /** 「完成」マーカー (epoch ms)。これ以降は読書モードで開かれ、編集に確認を挟む。 */
  finalizedAt?: number;
  vocabulary: VocabItem[];
  expansionQuestions: ExpansionQuestion[];
  /** 英語日記 BOY 流: 添削後にピックする「覚えたい 1 フレーズ」群。 */
  picks?: PickedPhrase[];
  createdAt: number;
}


export type ModeIcon = 'sun' | 'graduation' | 'moon' | 'bookOpen';

export const MODE_META: Record<
  Mode,
  { label: string; icon: ModeIcon; color: string; jpPlaceholder: string; enPlaceholder: string }
> = {
  morning: {
    label: 'Morning',
    icon: 'sun',
    color: '#c47832',
    jpPlaceholder: '今日の予定や意気込みを日本語で…',
    enPlaceholder: 'Write your plan or intention for today…',
  },
  lesson: {
    label: 'Lesson',
    icon: 'graduation',
    color: '#3b6cb0',
    jpPlaceholder: 'レッスンで学んだこと・気づきを日本語で…',
    enPlaceholder: 'Write what you learned in the lesson…',
  },
  diary: {
    label: 'Diary',
    icon: 'moon',
    color: '#3a4a6b',
    jpPlaceholder: '今日あったことを日本語で…',
    enPlaceholder: 'Write about your day…',
  },
  story: {
    label: 'Story',
    icon: 'bookOpen',
    color: '#5d8e6f',
    jpPlaceholder: 'ちょっとしたエピソードや小話を日本語で…',
    enPlaceholder: 'Tell a short story or anecdote…',
  },
};

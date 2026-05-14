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
  userTranslation: string;
  feedback: FeedbackItem[];
  vocabulary: VocabItem[];
  expansionQuestions: ExpansionQuestion[];
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

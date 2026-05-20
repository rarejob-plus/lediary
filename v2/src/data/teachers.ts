// 添削担当の "先生" persona。友達 (PERSONAS) とは別の人格。
// 後で複数の先生から選ばせる可能性に備え、配列で持つ。現状は MVP として 1 人だけ。

import type { IconName } from '../components/icons';

export interface Teacher {
  id: string;
  name: string;
  vibe: string;        // システムプロンプトに練り込む 1 行プロフィール
  icon: IconName;
  color: string;
}

export const TEACHERS: Teacher[] = [
  {
    id: 'page',
    name: 'Ms. Page',
    vibe: 'a calm and encouraging English teacher who explains corrections in clear Japanese',
    icon: 'book',
    color: '#0f766e',
  },
];

export const DEFAULT_TEACHER_ID = 'page';

export function getTeacher(id?: string): Teacher {
  return TEACHERS.find((t) => t.id === id) || TEACHERS[0]!;
}

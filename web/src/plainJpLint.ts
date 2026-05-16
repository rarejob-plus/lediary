// 和文和訳ヒント検出: クライアント側で完結する軽量解析。LLM は一切使わない。
// 「英語に乗せにくい日本語パターン」をルールベースで検出し、書き換えの気づきを与える。
// 主語省略の検出はルールでは精度が出ないため別途 LLM 経路に分ける。

export type LintType = 'abstract' | 'long-sentence' | 'nested-mod' | 'subject-missing';

export interface LintIssue {
  type: LintType;
  message: string;     // バッジに乗せる短い説明
  snippet: string;     // 該当箇所の抜粋（textarea には触れず、視覚提示用）
  /** 元 JP テキスト内の開始 / 終了 index (textarea ハイライト用)。-1 なら未確定。 */
  start: number;
  end: number;
}

/** 1 文を句点 / 改行で割って [{text, start}] を返す。 */
function splitSentences(text: string): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = [];
  let start = 0;
  const re = /[^。！？\n]+[。！？]?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const s = m[0];
    if (s.trim()) out.push({ text: s, start });
    start = m.index + s.length;
  }
  return out;
}

/** 抽象構文 / 曖昧表現の検出: 「〜感じ」「〜こと」「〜になる」「〜化する」「〜という」など。 */
const ABSTRACT_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /([ぁ-んァ-ヶー一-龥]{1,8})感じ/g, label: '「〜感じ」' },
  { re: /([ぁ-んァ-ヶー一-龥]{1,8})こと(?:が|を|に|で)/g, label: '抽象名詞「こと」' },
  { re: /([ぁ-んァ-ヶー一-龥]{1,6})(?:に)?なる(?![ぁ-んァ-ヶー一-龥])/g, label: '「〜になる」' },
  { re: /([ぁ-んァ-ヶー一-龥]{1,6})化する/g, label: '「〜化する」' },
  { re: /([ぁ-んァ-ヶー一-龥]{1,6})という(?![ぁ-んァ-ヶー一-龥])/g, label: '「〜という」' },
  { re: /([ぁ-んァ-ヶー一-龥]{1,6})もの(?:が|を|に|で)/g, label: '抽象名詞「もの」' },
];

function detectAbstract(text: string): LintIssue[] {
  const out: LintIssue[] = [];
  for (const { re, label } of ABSTRACT_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      out.push({
        type: 'abstract',
        message: label,
        snippet: m[0],
        start: m.index,
        end: m.index + m[0].length,
      });
    }
  }
  return out;
}

/** 長すぎる文の検出。1 文 60 字超を黄信号、90 字超を赤信号扱い（type は同じ）。 */
function detectLongSentence(text: string): LintIssue[] {
  const out: LintIssue[] = [];
  for (const s of splitSentences(text)) {
    const len = s.text.trim().length;
    if (len >= 60) {
      out.push({
        type: 'long-sentence',
        message: len >= 90 ? `1 文が長すぎる (${len}字)` : `1 文が長め (${len}字)`,
        snippet: s.text.trim().slice(0, 32) + (s.text.length > 32 ? '…' : ''),
        start: s.start,
        end: s.start + s.text.length,
      });
    }
  }
  return out;
}

/** 連体修飾の入れ子 / 連続検出。読点を挟まず助詞「が/の」が複数現れる節を粗く拾う。 */
function detectNestedModifier(text: string): LintIssue[] {
  const out: LintIssue[] = [];
  for (const s of splitSentences(text)) {
    // 読点で分割した「節」ごとに「が」「の」の連続をカウント
    let cursor = s.start;
    for (const clause of s.text.split('、')) {
      const gaCount = (clause.match(/が/g) || []).length;
      const noCount = (clause.match(/の/g) || []).length;
      // 「〜が〜の〜が〜」のような構造を 3 個以上の「が/の」連続で検出
      if (gaCount + noCount >= 4 && clause.trim().length >= 20) {
        out.push({
          type: 'nested-mod',
          message: '修飾が入れ子になっている',
          snippet: clause.trim().slice(0, 32) + (clause.length > 32 ? '…' : ''),
          start: cursor,
          end: cursor + clause.length,
        });
      }
      cursor += clause.length + 1; // 「、」分
    }
  }
  return out;
}

export function lintPlainJp(text: string): LintIssue[] {
  if (!text || !text.trim()) return [];
  return [
    ...detectAbstract(text),
    ...detectLongSentence(text),
    ...detectNestedModifier(text),
  ].sort((a, b) => a.start - b.start);
}

export const LINT_TYPE_META: Record<LintType, { label: string; color: string }> = {
  abstract:        { label: '抽象表現',  color: 'var(--ld-accent)' },
  'long-sentence': { label: '長文',      color: '#c47832' },
  'nested-mod':    { label: '修飾入れ子', color: '#7a6cb3' },
  'subject-missing': { label: '主語省略', color: '#b94248' },
};

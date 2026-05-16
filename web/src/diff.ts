// 単語レベル diff: original / corrected を比較し、token 列 ({type, text}) で返す。
// CorrectionCard の「diff 表示」モード用 (handoff §4.7)。
// LCS テーブルベース。語数は通常 ≤ 50 程度なので O(n·m) で十分。

export type DiffOp = 'eq' | 'del' | 'ins';
export interface DiffToken { type: DiffOp; text: string; }

function tokenize(s: string): string[] {
  // 空白を保ったまま単語に分割。空白 run も 1 トークンとして残し、レイアウトを保つ。
  const out: string[] = [];
  const re = /(\s+|[^\s]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) out.push(m[0]);
  return out;
}

function eq(a: string, b: string): boolean {
  // 比較は case-insensitive、両端の句読点を寛容に。
  const norm = (s: string) => s.toLowerCase().replace(/[\.,!?;:"']+$/g, '').replace(/^[\.,!?;:"']+/, '');
  return norm(a) === norm(b);
}

export function diffWords(original: string, corrected: string): DiffToken[] {
  const A = tokenize(original);
  const B = tokenize(corrected);
  const n = A.length;
  const m = B.length;

  // LCS DP
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (eq(A[i]!, B[j]!)) dp[i]![j] = dp[i + 1]![j + 1]! + 1;
      else dp[i]![j] = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  // バックトレース
  const out: DiffToken[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (eq(A[i]!, B[j]!)) {
      out.push({ type: 'eq', text: A[i]! });
      i++; j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ type: 'del', text: A[i]! });
      i++;
    } else {
      out.push({ type: 'ins', text: B[j]! });
      j++;
    }
  }
  while (i < n) { out.push({ type: 'del', text: A[i++]! }); }
  while (j < m) { out.push({ type: 'ins', text: B[j++]! }); }
  return out;
}

/** HTML 用に diff token を escape しつつ <del> / <ins> / 素テキストにする。 */
export function renderDiffHtml(tokens: DiffToken[]): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  return tokens.map((t) => {
    if (t.type === 'eq') return esc(t.text);
    if (t.type === 'del') return /^\s+$/.test(t.text) ? esc(t.text) : `<del class="ld-diff__del">${esc(t.text)}</del>`;
    return /^\s+$/.test(t.text) ? esc(t.text) : `<ins class="ld-diff__ins">${esc(t.text)}</ins>`;
  }).join('');
}

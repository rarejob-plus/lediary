// 発音採点: Web Speech API (webkitSpeechRecognition) で英文を文字起こしし、
// 期待テキストと単語単位で diff してスコア (0-100) を返す。
//
// 既存の diff lib (../diff) を流用して word-level LCS 比較。
// score = matched 単語数 / 期待単語数 × 100。
//
// 注: ブラウザサポート — Chrome / Edge / Safari (Mac, iOS PWA) / Android Chrome。
// Firefox は未対応。未対応時は recognize() が null を返すので呼び出し側で fallback 表示。

import type { DiffToken } from '../diff';

// SpeechRecognition は標準型に無い。最小限の型を定義。
interface SpeechRecognitionAlternative { transcript: string; confidence: number; }
interface SpeechRecognitionResultItem { 0: SpeechRecognitionAlternative; length: number; isFinal: boolean; }
interface SpeechRecognitionResults { length: number; [index: number]: SpeechRecognitionResultItem; }
interface SpeechRecognitionEvent { results: SpeechRecognitionResults; resultIndex: number; }
interface SpeechRecognitionErrorEvent { error: string; message?: string; }
interface SpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}
interface SpeechRecognitionCtor { new (): SpeechRecognition; }

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function isSpeechRecognitionSupported(): boolean {
  return getSpeechRecognitionCtor() !== null;
}

export interface RecognitionResult {
  transcript: string;
  confidence: number;
}

/** 録音セッションをユーザ側 (録音ボタン) から手動停止できるよう、開始時に
 *  controller を返す。終了は: (1) controller.stop() の手動呼び出し,
 *  (2) 無音 silenceMs 継続, (3) 全体 maxMs ハードタイムアウトのいずれか早い方。
 *  continuous=true + interimResults=true で発話途中のポーズで切れる問題を回避する。 */
export type RecognitionErrorReason =
  | 'no-speech'      // 発話を全く検出できなかった
  | 'audio-capture'  // マイクへのアクセス失敗
  | 'not-allowed'    // 権限なし
  | 'network'        // ネットワーク不通 (Chrome は Google STT に依存)
  | 'aborted'        // 中断
  | 'unknown';

export interface RecognitionController {
  /** 即座に録音停止 (これまで受け取った final transcript を解決)。 */
  stop(): void;
  /** 結果。stop 後 / auto-end 後に解決。transcript が無いケースでは reason を返す。 */
  result: Promise<RecognitionResult | { reason: RecognitionErrorReason } | null>;
}

export function recognizeStreaming(opts: { maxMs?: number; silenceMs?: number; startupGraceMs?: number } = {}): RecognitionController {
  const maxMs = opts.maxMs ?? 30_000;
  const silenceMs = opts.silenceMs ?? 2_500;        // 発話開始後の無音許容
  const startupGraceMs = opts.startupGraceMs ?? 12_000; // 発話開始までの猶予 (録音 → 話し出すまで)
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) {
    return { stop: () => {}, result: Promise.resolve(null) };
  }
  let settled = false;
  let resolveFn: (v: RecognitionResult | { reason: RecognitionErrorReason } | null) => void = () => {};
  const result = new Promise<RecognitionResult | { reason: RecognitionErrorReason } | null>((res) => { resolveFn = res; });
  const r = new Ctor();
  r.lang = 'en-US';
  r.continuous = true;
  r.interimResults = true;
  r.maxAlternatives = 1;

  let finalTranscript = '';
  let interimTranscript = '';   // 最新の interim 全文 (final が来なかった時の fallback)
  let lastConfidence = 0;
  let firstSpeechHeard = false;
  let lastError: RecognitionErrorReason | null = null;
  let silenceTimer: number | null = null;
  // 「発話開始までの猶予」用タイマー。最初の音声が届いたらキャンセル。
  const graceTimer = window.setTimeout(() => finish(), startupGraceMs);
  const hardTimer = window.setTimeout(() => finish(), maxMs);

  const startSilenceCountdown = () => {
    if (silenceTimer) window.clearTimeout(silenceTimer);
    silenceTimer = window.setTimeout(() => finish(), silenceMs);
  };

  // r.stop() を呼んでから onend で最後の final が届くまで少し待つ。
  // 「発話直後に手動停止 → final が間に合わず空」を避けるため、grace 800ms。
  const STOP_GRACE_MS = 800;
  const settle = () => {
    if (silenceTimer) window.clearTimeout(silenceTimer);
    window.clearTimeout(hardTimer);
    window.clearTimeout(graceTimer);
    // final があればそれ、無ければ最新 interim を fallback として使う。
    const text = finalTranscript.trim() || interimTranscript.trim();
    if (text) {
      resolveFn({ transcript: text, confidence: lastConfidence });
    } else if (lastError) {
      resolveFn({ reason: lastError });
    } else {
      resolveFn({ reason: 'no-speech' });
    }
  };

  let stopPending = false;
  const finish = () => {
    if (settled) return;
    if (stopPending) return; // 二重呼び防止
    stopPending = true;
    try { r.stop(); } catch { /* ignore */ }
    // onend が STOP_GRACE_MS 以内に届かなければ強制 settle。
    const fallback = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      settle();
    }, STOP_GRACE_MS);
    r.onend = () => {
      window.clearTimeout(fallback);
      if (settled) return;
      settled = true;
      settle();
    };
  };

  r.onresult = (e) => {
    // 何かしら届いた瞬間に grace を解除。以降は silence timer で発話終わりを待つ。
    if (!firstSpeechHeard) {
      firstSpeechHeard = true;
      window.clearTimeout(graceTimer);
    }
    // 今ある全 result から interim 文字列をフレッシュに組み立てる (差分ではなく全体)。
    let nextInterim = '';
    for (let i = 0; i < e.results.length; i++) {
      const item = e.results[i];
      if (!item || item.isFinal) continue;
      const alt = item[0];
      if (alt?.transcript) nextInterim += (nextInterim ? ' ' : '') + alt.transcript.trim();
    }
    interimTranscript = nextInterim;

    for (let i = e.resultIndex; i < e.results.length; i++) {
      const item = e.results[i];
      if (!item) continue;
      if (item.isFinal) {
        const alt = item[0];
        if (alt?.transcript) {
          finalTranscript += (finalTranscript ? ' ' : '') + alt.transcript.trim();
          lastConfidence = alt.confidence ?? lastConfidence;
        }
      }
    }
    // interim 含め何か届いたら無音カウンタリセット
    startSilenceCountdown();
  };
  r.onerror = (e) => {
    const code = (e.error || 'unknown') as RecognitionErrorReason;
    console.warn('[recognizeStreaming] error', code);
    lastError = code;
    // no-speech は finalTranscript / interim があれば成功として扱いたいので onend に任せる。
    if (code !== 'no-speech') finish();
  };
  r.onend = () => { if (!settled && !stopPending) finish(); };
  // silence timer は最初の発話が来てから始動するので、ここでは仕掛けない。
  try { r.start(); } catch (e) {
    console.warn('[recognizeStreaming] start failed', e);
    lastError = 'audio-capture';
    finish();
  }
  return { stop: finish, result };
}

/** 後方互換: 単発の録音 (旧 API)。新規呼び出しは recognizeStreaming を使う。
 *  エラー情報は捨てて null に正規化。 */
export async function recognizeOnce(timeoutMs = 15_000): Promise<RecognitionResult | null> {
  const r = await recognizeStreaming({ maxMs: timeoutMs }).result;
  if (r && 'transcript' in r) return r;
  return null;
}

export interface ScoreResult {
  score: number;             // 0-100
  matched: number;           // 一致単語数
  total: number;             // 期待単語数
  tokens: DiffToken[];       // 単語単位の diff (UI ハイライト用)
}

// 収縮形の正規化テーブル。両側に適用して「gonna ↔ going to」「I'm ↔ i am」型の
// 機械的減点を消す。順序: 長い key から先 (e.g. "y'all" → "i'm" など部分被りに注意)。
const CONTRACTIONS: Array<[RegExp, string]> = [
  // インフォーマル
  [/\bgonna\b/gi, 'going to'],
  [/\bwanna\b/gi, 'want to'],
  [/\bgotta\b/gi, 'got to'],
  [/\bkinda\b/gi, 'kind of'],
  [/\bsorta\b/gi, 'sort of'],
  [/\boutta\b/gi, 'out of'],
  [/\bgimme\b/gi, 'give me'],
  [/\blemme\b/gi, 'let me'],
  [/\by'all\b/gi, 'you all'],
  [/\bcoulda\b/gi, 'could have'],
  [/\bwoulda\b/gi, 'would have'],
  [/\bshoulda\b/gi, 'should have'],
  [/\b'cause\b/gi, 'because'],
  [/\b'em\b/gi, 'them'],
  // 標準収縮
  [/\bain't\b/gi, 'is not'],
  [/\bcan't\b/gi, 'can not'],
  [/\bcannot\b/gi, 'can not'],
  [/\bwon't\b/gi, 'will not'],
  [/\bshan't\b/gi, 'shall not'],
  [/\bn't\b/gi, ' not'],          // don't, doesn't, didn't, isn't, hasn't, hadn't, wouldn't, couldn't, shouldn't ...
  [/\b'll\b/gi, ' will'],         // I'll, you'll, we'll, they'll, he'll, she'll, it'll
  [/\b'd\b/gi, ' would'],         // I'd, you'd, we'd, they'd, he'd, she'd, it'd  (had/would 判別は諦め、would に統一)
  [/\b'm\b/gi, ' am'],            // I'm
  [/\b're\b/gi, ' are'],          // you're, we're, they're
  [/\b've\b/gi, ' have'],         // I've, you've, we've, they've, could've, would've, should've
  [/\b's\b/gi, ' is'],            // it's, he's, she's, that's, what's, here's, there's  (所有格は誤合流するが影響軽微)
];

function expandContractions(s: string): string {
  let out = s;
  for (const [re, repl] of CONTRACTIONS) out = out.replace(re, repl);
  return out;
}

/** word-level Levenshtein 距離。 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array<number>(b.length + 1);
  let cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length]!;
}

/** 単語の fuzzy 一致。同音 / STT の typo 系を救う。
 *  - 完全一致 → ok
 *  - 4-5 文字: 距離 1 まで許容 (their / there / they're の母音差等)
 *  - 6+ 文字: 距離 2 まで許容 */
function fuzzyWordEq(a: string, b: string): boolean {
  if (a === b) return true;
  if (/^\s+$/.test(a) || /^\s+$/.test(b)) return a === b;
  const minLen = Math.min(a.length, b.length);
  if (minLen < 4) return false;
  const tolerance = minLen >= 6 ? 2 : 1;
  return levenshtein(a, b) <= tolerance;
}

/** fuzzy eq を使った LCS diff (発音採点専用)。 */
function diffWordsFuzzy(A: string, B: string): DiffToken[] {
  const tokenize = (s: string): string[] => {
    const out: string[] = [];
    const re = /\s+|[\p{L}\p{N}'’]+|[^\s\p{L}\p{N}'’]+/gu;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) out.push(m[0]);
    return out;
  };
  const at = tokenize(A);
  const bt = tokenize(B);
  const n = at.length;
  const m = bt.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (fuzzyWordEq(at[i]!, bt[j]!)) dp[i]![j] = dp[i + 1]![j + 1]! + 1;
      else dp[i]![j] = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: DiffToken[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (fuzzyWordEq(at[i]!, bt[j]!)) {
      out.push({ type: 'eq', text: at[i]! });
      i++; j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ type: 'del', text: at[i]! });
      i++;
    } else {
      out.push({ type: 'ins', text: bt[j]! });
      j++;
    }
  }
  while (i < n) out.push({ type: 'del', text: at[i++]! });
  while (j < m) out.push({ type: 'ins', text: bt[j++]! });
  return out;
}

/** 期待テキスト vs 文字起こしの単語単位スコア。
 *  - 収縮形展開 + lowercase + 句読点除去で正規化 (A: gonna ↔ going to 等)
 *  - 単語比較は Levenshtein 距離 1〜2 まで許容 (B: their/there 系を救う)
 *  - score は期待単語のうち一致した割合 (0-100) */
export function scorePronunciation(expected: string, actual: string): ScoreResult {
  const normalize = (s: string) => {
    const expanded = expandContractions(
      s.replace(/[“”"]/g, '"').replace(/[‘’]/g, "'"),
    );
    return expanded
      .replace(/[.,!?;:]/g, ' ')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  };
  const tokens = diffWordsFuzzy(normalize(expected), normalize(actual));
  let matched = 0;
  let total = 0;
  for (const t of tokens) {
    if (/^\s+$/.test(t.text)) continue;
    if (t.type === 'eq') { matched++; total++; }
    else if (t.type === 'del') { total++; }
  }
  const score = total === 0 ? 0 : Math.round((matched / total) * 100);
  return { score, matched, total, tokens };
}

/** STT 書き起こしテキストをそのまま表示。間違ってる単語 (= ins) にだけ下線。
 *  - eq  → 通常表示 (正解どおり言えた)
 *  - ins → 下線付き (発話したが期待と違う = 言い間違えた語)
 *  - del → 表示しない (発話に存在しなかった = 言うべきだったが言ってない正解)
 *  色や打消しは使わず、ノイズを最小化する。 */
export function renderScoreDiffHtml(tokens: DiffToken[]): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  // del は STT 書き起こしに無い → スキップ。空白 del のせいで二重スペースになるのも避けるため
  // ここで先に del を取り除く。
  const kept = tokens.filter((t) => t.type !== 'del');
  return kept.map((t) => {
    if (/^\s+$/.test(t.text)) return esc(t.text);
    if (t.type === 'ins') return `<span class="pron-tok pron-tok--wrong">${esc(t.text)}</span>`;
    return esc(t.text);
  }).join('');
}

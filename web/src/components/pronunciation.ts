// 発音採点: Web Speech API (webkitSpeechRecognition) で英文を文字起こしし、
// 期待テキストと単語単位で diff してスコア (0-100) を返す。
//
// 既存の diff lib (../diff) を流用して word-level LCS 比較。
// score = matched 単語数 / 期待単語数 × 100。
//
// 注: ブラウザサポート — Chrome / Edge / Safari (Mac, iOS PWA) / Android Chrome。
// Firefox は未対応。未対応時は recognize() が null を返すので呼び出し側で fallback 表示。

import { diffWords, type DiffToken } from '../diff';

// SpeechRecognition は標準型に無い。最小限の型を定義。
interface SpeechRecognitionAlternative { transcript: string; confidence: number; }
interface SpeechRecognitionResultItem { 0: SpeechRecognitionAlternative; length: number; isFinal: boolean; }
interface SpeechRecognitionResults { length: number; [index: number]: SpeechRecognitionResultItem; }
interface SpeechRecognitionEvent { results: SpeechRecognitionResults; }
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

/** Web Speech API でマイクから 1 回録音 → 文字起こし。
 *  ブラウザ非対応 / マイク不許可 / 無発話などで失敗したら null を返す。 */
export function recognizeOnce(timeoutMs = 10_000): Promise<RecognitionResult | null> {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) return Promise.resolve(null);
  return new Promise<RecognitionResult | null>((resolve) => {
    const r = new Ctor();
    r.lang = 'en-US';
    r.continuous = false;
    r.interimResults = false;
    r.maxAlternatives = 1;
    let settled = false;
    const done = (v: RecognitionResult | null) => {
      if (settled) return;
      settled = true;
      try { r.stop(); } catch { /* ignore */ }
      resolve(v);
    };
    r.onresult = (e) => {
      const first = e.results?.[0]?.[0];
      if (first?.transcript) done({ transcript: first.transcript, confidence: first.confidence ?? 0 });
      else done(null);
    };
    r.onerror = (e) => {
      console.warn('[recognizeOnce] error', e.error);
      done(null);
    };
    r.onend = () => { if (!settled) done(null); };
    setTimeout(() => done(null), timeoutMs);
    try { r.start(); } catch (e) { console.warn('[recognizeOnce] start failed', e); done(null); }
  });
}

export interface ScoreResult {
  score: number;             // 0-100
  matched: number;           // 一致単語数
  total: number;             // 期待単語数
  tokens: DiffToken[];       // 単語単位の diff (UI ハイライト用)
}

/** 期待テキスト vs 文字起こしの単語単位スコア。
 *  - 単語は lowercase + 末尾句読点除去で正規化して LCS 比較。
 *  - score は期待単語のうち一致した割合 (0-100)。 */
export function scorePronunciation(expected: string, actual: string): ScoreResult {
  const normalize = (s: string) => s
    .replace(/[“”"]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[.,!?;:]/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  const tokens = diffWords(normalize(expected), normalize(actual));
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

/** diff token を HTML 文字列に展開。eq = 通常 / del = 赤線 / ins = 緑下線 (= 余分な発話)。 */
export function renderScoreDiffHtml(tokens: DiffToken[]): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  return tokens.map((t) => {
    if (/^\s+$/.test(t.text)) return esc(t.text);
    if (t.type === 'eq') return `<span class="pron-tok pron-tok--ok">${esc(t.text)}</span>`;
    if (t.type === 'del') return `<span class="pron-tok pron-tok--miss">${esc(t.text)}</span>`;
    return `<span class="pron-tok pron-tok--extra">${esc(t.text)}</span>`;
  }).join('');
}

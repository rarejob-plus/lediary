// LLM adapter: claude_code (kota's local Mac tunnel) を最優先で叩き、不調なら
// Firebase AI Logic (Gemini) にフォールバック。サーバ側プロキシは経由しない。

import { getAI, GoogleAIBackend, getGenerativeModel } from 'firebase/ai';
import type { ResponseModality } from 'firebase/ai';
import { app, auth } from './firebase';
import { getIdToken } from './auth';

const CLAUDE_CODE_URL = 'https://claude.rarejob-plus.org';
const CLAUDE_HEALTH_TIMEOUT_MS = 2_500;
const CLAUDE_CALL_TIMEOUT_MS = 60_000;
const GEMINI_MODEL = 'gemini-3.1-flash-lite';

export type LLMBackend = 'claude_code' | 'gemini_ai_logic';

export interface LLMOptions {
  // 構造化出力。指定すると claude_code は json_schema 経路、Gemini は JSON mode で叩く。
  jsonSchema?: Record<string, unknown>;
}

let lastBackend: LLMBackend | null = null;
export function lastUsedBackend(): LLMBackend | null {
  return lastBackend;
}

async function claudeCodeHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${CLAUDE_CODE_URL}/health`, {
      signal: AbortSignal.timeout(CLAUDE_HEALTH_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function callClaudeCode(
  systemPrompt: string,
  userMessage: string,
  opts: LLMOptions,
): Promise<string> {
  if (!auth.currentUser) throw new Error('not authenticated');
  // 長時間タブを開きっぱなしの保険: claude_code 経路は毎回フレッシュなトークンで叩く。
  // SDK は token 残時間 5 分未満で自動更新するが、それでも 401 を踏むケースがあるため強制。
  const idToken = await getIdToken(true);
  const body: Record<string, unknown> = { prompt: userMessage };
  if (systemPrompt) body.system_prompt = systemPrompt;
  if (opts.jsonSchema) body.json_schema = opts.jsonSchema;

  const res = await fetch(`${CLAUDE_CODE_URL}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(CLAUDE_CALL_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`claude_code ${res.status}: ${text}`);
  }
  const data = (await res.json()) as { result?: string };
  return data.result ?? '';
}

let _gemini: ReturnType<typeof getGenerativeModel> | null = null;
function geminiModel() {
  if (!_gemini) {
    const ai = getAI(app, { backend: new GoogleAIBackend() });
    _gemini = getGenerativeModel(ai, { model: GEMINI_MODEL });
  }
  return _gemini;
}

async function callGemini(systemPrompt: string, userMessage: string): Promise<string> {
  const model = geminiModel();
  // systemInstruction は generateContent 呼び出し時にも渡せるが、SDK 仕様変動を避けて
  // ここではプロンプト先頭に折り込む。LLM 動作的にはほぼ同じ。
  const combined = systemPrompt ? `${systemPrompt}\n\n---\n\n${userMessage}` : userMessage;
  const result = await model.generateContent(combined);
  return result.response.text();
}

// ─── TTS (Gemini 3.1 Flash TTS preview, Firebase AI Logic 経由) ───
// 1 フレーズ・シャドーイング用。Web Speech API より自然な音声、AudioBuffer をクライアントで
// キャッシュすればリピートはコスト 0。Free tier で動くかは preview モデル次第。
const TTS_MODEL = 'gemini-3.1-flash-tts-preview';
// voice 別にモデルインスタンスを保持 (generationConfig.speechConfig は model 構築時固定)。
const _gemTtsByVoice = new Map<string, ReturnType<typeof getGenerativeModel>>();
function ttsModel(voice: string) {
  const cached = _gemTtsByVoice.get(voice);
  if (cached) return cached;
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  const m = getGenerativeModel(ai, {
    model: TTS_MODEL,
    generationConfig: {
      // SDK の ResponseModality enum は TEXT / IMAGE のみ。AUDIO は underlying API では
      // 受け付けるため、文字列リテラルを cast で流し込む。
      responseModalities: ['AUDIO' as unknown as ResponseModality],
      // speechConfig は firebase/ai の TS 型に未定義だが、underlying API は受け付ける。
      // 型を緩めて inject する。
      ...({
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
        },
      } as Record<string, unknown>),
    },
  });
  _gemTtsByVoice.set(voice, m);
  return m;
}

/** Gemini TTS でテキスト → PCM 音声を生成し、AudioBuffer にデコードして返す。
 *  Gemini TTS の出力は L16 PCM 24kHz mono (little-endian)。 */
export async function generateTtsAudioBuffer(
  text: string,
  audioCtx: AudioContext,
  voice = 'Charon',
): Promise<AudioBuffer> {
  const model = ttsModel(voice);
  const result = await model.generateContent(text);
  // response.candidates[0].content.parts[0].inlineData.data (base64) を取り出す
  const candidates = (result.response as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> } }> }).candidates;
  const inline = candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
  if (!inline?.data) throw new Error('TTS response missing inlineData');
  const sampleRate = parseTtsSampleRate(inline.mimeType || '') || 24000;
  return pcm16leBase64ToAudioBuffer(inline.data, sampleRate, audioCtx);
}

function parseTtsSampleRate(mime: string): number | null {
  // 例: "audio/L16;rate=24000;codec=pcm"
  const m = mime.match(/rate=(\d+)/);
  return m ? parseInt(m[1]!, 10) : null;
}

function pcm16leBase64ToAudioBuffer(b64: string, sampleRate: number, audioCtx: AudioContext): AudioBuffer {
  const bin = atob(b64);
  const len = bin.length;
  const buf = new ArrayBuffer(len);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  const dv = new DataView(buf);
  const samples = len >>> 1;
  const audioBuffer = audioCtx.createBuffer(1, samples, sampleRate);
  const channel = audioBuffer.getChannelData(0);
  for (let i = 0; i < samples; i++) {
    channel[i] = dv.getInt16(i * 2, true) / 32768;
  }
  return audioBuffer;
}

export async function callLLM(
  systemPrompt: string,
  userMessage: string,
  opts: LLMOptions = {},
): Promise<string> {
  if (await claudeCodeHealthy()) {
    try {
      const text = await callClaudeCode(systemPrompt, userMessage, opts);
      lastBackend = 'claude_code';
      console.log('[LLM] claude_code');
      return text;
    } catch (err) {
      console.warn('[LLM] claude_code failed, falling back to Gemini:', err);
    }
  } else {
    console.log('[LLM] claude_code unhealthy, using Gemini');
  }
  const text = await callGemini(systemPrompt, userMessage);
  lastBackend = 'gemini_ai_logic';
  console.log('[LLM] gemini_ai_logic');
  return text;
}

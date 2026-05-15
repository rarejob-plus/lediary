// LLM adapter: claude_code (kota's local Mac tunnel) を最優先で叩き、不調なら
// Firebase AI Logic (Gemini) にフォールバック。サーバ側プロキシは経由しない。

import { getAI, GoogleAIBackend, getGenerativeModel } from 'firebase/ai';
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
  const idToken = await getIdToken();
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

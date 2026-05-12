import { onRequest, Request as FbRequest } from "firebase-functions/v2/https";
import type { Response as ExpressResponse } from "express";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getMessaging } from "firebase-admin/messaging";
import { defineSecret } from "firebase-functions/params";
import { AsyncLocalStorage } from "async_hooks";

// リクエスト単位で「最後に使われた LLM backend」を保持する store。
// callLLM が書き込み、レスポンス送信前に res.setHeader('X-LLM-Backend') で外に出す。
// AsyncLocalStorage を使うことで Cloud Run の並列リクエストでも干渉しない。
type LLMRequestStore = { backend?: string };
const llmStore = new AsyncLocalStorage<LLMRequestStore>();

initializeApp();
const db = getFirestore();
const auth = getAuth();
const geminiApiKey = defineSecret("GEMINI_API_KEY");
const unsplashAccessKey = defineSecret("UNSPLASH_ACCESS_KEY");
// Self-hosted Claude Code API (Pi behind Cloudflare Tunnel). Optional —
// only consulted when LLM_BACKEND=claude_code. Kept as Secrets so they're
// never required at deploy time when sticking with Gemini.
const claudeCodeApiUrl = defineSecret("CLAUDE_CODE_API_URL");
const claudeCodeApiKey = defineSecret("CLAUDE_CODE_API_KEY");

// 使用モデル — 環境変数 GEMINI_MODEL で上書き可能
// 切替例: firebase deploy 時に --set-env-vars=GEMINI_MODEL=gemini-2.5-flash-lite
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";

// ─── 共通: トーン規約 — lediary 全体で堅い英語を避けるための共有ルール ───
// プロンプト全体に inline 注入。token を抑えるため簡潔に。
const CASUAL_TONE_RULE = `TONE (English output ONLY): Casual spoken English of a 20-something native texting a friend. Never textbook/news/business style.
AVOID and replace:
- formal connectors: therefore→so, furthermore/moreover→also, nevertheless→but, thus/hence→so, consequently→so
- Latinate single words: acquaintance→someone I know/a friend, individual→person, purchase→buy, residence→home, vehicle→car, commence→start, utilize→use, obtain→get, consume→eat/drink, assist→help, inquire→ask, depart→leave, endeavor→try, sufficient→enough
- bookish phrases: I would like to→I wanna/I want to, due to the fact that/in order to→to, prior to→before, subsequently→then, approximately→about, regarding→about
SELF-CHECK: would a friend actually say this casually? Don't trade a natural phrase for a fancier single word.

JAPANESE TEXT RULE: This casual rule applies ONLY to generated English. For ALL Japanese fields (explanation / suggestion / reason / overall / mood / definition / note 等), use polite ですます調 (e.g. 「〜です」「〜ます」「〜でしょう」「〜ましょう」). Never use 〜だ／〜だよ／〜だね／〜じゃん／〜かも (informal sentence-final particles). Maintain a respectful coaching tone — like a knowledgeable English teacher, not a casual friend.`;

// ─── Auth helper ───

async function verifyToken(req: { headers: { authorization?: string } }): Promise<string | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    const token = await auth.verifyIdToken(authHeader.slice(7));
    return token.uid;
  } catch {
    return null;
  }
}

// ─── LLM dispatcher ───
//
// Default backend is Gemini. Set LLM_BACKEND=claude_code to route through
// the self-hosted Claude Code API (Pi via Cloudflare Tunnel). On a
// transient claude_code failure (network / 5xx / timeout) we fall back
// to Gemini so the user-facing flow stays up.

type LLMOptions = { jsonSchema?: unknown };

class ClaudeCodePermanentError extends Error {}

// claude_code の health は Cloudflare Tunnel 経由で warm ~100ms 程度なので、
// キャッシュせず毎回 fresh に叩く。これで Pi がダウンしたケースでも
// 確実に 3 秒以内にフォールバック判定が下りる（旧設計は 30s キャッシュで
// Pi 落ち直後の 30s 以内のリクエストが詰まる可能性があった）。
const CLAUDE_HEALTH_TIMEOUT_MS = 3_000;
// /v1/messages 自体のタイムアウト。Pi が応答中に hang した稀ケースの保険。
// 通常 5-15s で返るので 60s で十分すぎる余裕。
const CLAUDE_CALL_TIMEOUT_MS = 60_000;

async function claudeCodeHealthy(): Promise<boolean> {
  const url = claudeCodeApiUrl.value();
  if (!url) return false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLAUDE_HEALTH_TIMEOUT_MS);
    const res = await fetch(`${url.replace(/\/$/, "")}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

function markBackend(used: string): void {
  const store = llmStore.getStore();
  if (store) store.backend = used;
  console.log(`[LLM] used=${used}`);
}

async function callLLM(
  systemPrompt: string,
  userMessage: string,
  opts: LLMOptions = {},
): Promise<string> {
  const backend = process.env.LLM_BACKEND || "gemini";
  if (backend !== "claude_code") {
    markBackend("gemini");
    return callGemini(systemPrompt, userMessage);
  }
  if (!(await claudeCodeHealthy())) {
    console.warn(`[LLM] claude_code unhealthy, using Gemini directly`);
    markBackend("gemini_fallback");
    return callGemini(systemPrompt, userMessage);
  }
  try {
    const result = await callClaudeCode(systemPrompt, userMessage, opts);
    markBackend("claude_code");
    return result;
  } catch (err) {
    if (err instanceof ClaudeCodePermanentError) throw err;
    console.warn(
      `[LLM] claude_code transient failure, falling back to Gemini:`,
      err instanceof Error ? err.message : err,
    );
    markBackend("gemini_fallback");
    return callGemini(systemPrompt, userMessage);
  }
}

async function callGemini(systemPrompt: string, userMessage: string): Promise<string> {
  const key = geminiApiKey.value();
  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ parts: [{ text: userMessage }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 4000 },
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  const candidates = data.candidates;
  if (!candidates?.[0]?.content?.parts?.[0]?.text) {
    throw new Error("Empty response from Gemini");
  }
  return candidates[0].content.parts[0].text;
}

async function callClaudeCode(
  systemPrompt: string,
  userMessage: string,
  opts: LLMOptions,
): Promise<string> {
  const url = claudeCodeApiUrl.value();
  const apiKey = claudeCodeApiKey.value();
  if (!url || !apiKey) {
    throw new ClaudeCodePermanentError(
      "CLAUDE_CODE_API_URL or CLAUDE_CODE_API_KEY secret is not set",
    );
  }

  const body: Record<string, unknown> = { prompt: userMessage };
  if (systemPrompt) body.system_prompt = systemPrompt;
  if (opts.jsonSchema !== undefined) body.json_schema = opts.jsonSchema;
  if (process.env.CLAUDE_CODE_MODEL) body.model = process.env.CLAUDE_CODE_MODEL;

  // 60s timeout — health check は通っているはずなので通常は十分余裕。
  // hang 防止の保険として AbortController を入れる。
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLAUDE_CALL_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${url.replace(/\/$/, "")}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  if (res.status === 401 || res.status === 403) {
    throw new ClaudeCodePermanentError(
      `claude_code auth error ${res.status}: ${text}`,
    );
  }
  if (res.status === 400 || res.status === 422) {
    throw new ClaudeCodePermanentError(
      `claude_code request rejected ${res.status}: ${text}`,
    );
  }
  if (!res.ok) {
    throw new Error(`claude_code API error ${res.status}: ${text}`);
  }

  let data: {
    result?: string;
    is_error?: boolean;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`claude_code response parse error: ${(e as Error).message}`);
  }
  if (data.is_error) {
    throw new Error(`claude_code reported is_error=true: ${data.result}`);
  }
  if (!data.result) {
    throw new Error("claude_code returned empty result");
  }
  return data.result;
}

const ALLOWED_VOICES = new Set([
  "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda",
  "Orus", "Aoede", "Achird", "Callirrhoe", "Autonoe", "Enceladus", "Iapetus",
  "Umbriel", "Algieba", "Despina", "Erinome", "Gacrux", "Hadad",
  "Laomedeia", "Pulcherrima", "Achernar", "Rasalgethi", "Sadachbia",
  "Sadaltager", "Schedar", "Sulafat", "Vindemiatrix", "Zubenelgenubi",
]);

async function callGeminiTTS(text: string, voice = "Achird"): Promise<Buffer> {
  const voiceName = ALLOWED_VOICES.has(voice) ? voice : "Achird";
  const key = geminiApiKey.value();
  const prompt = `Read the following sentence clearly, with natural pauses between phrases: ${text}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
      },
    },
  };

  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini TTS error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const audioData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!audioData) {
    throw new Error("No audio data in Gemini TTS response");
  }

  // Convert base64 PCM to WAV
  const pcm = Buffer.from(audioData, "base64");
  return pcmToWav(pcm, 24000, 1, 16);
}

function pcmToWav(pcm: Buffer, sampleRate: number, channels: number, bitDepth: number): Buffer {
  const byteRate = sampleRate * channels * (bitDepth / 8);
  const blockAlign = channels * (bitDepth / 8);
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // subchunk1 size
  header.writeUInt16LE(1, 20);  // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

function parseJsonObject<T>(content: string): T {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON object found in LLM response");
  try {
    return JSON.parse(match[0]);
  } catch {
    // Try to fix common JSON issues: trailing commas, unescaped quotes
    const fixed = match[0]
      .replace(/,\s*([}\]])/g, "$1")  // trailing commas
      .replace(/[\u201c\u201d]/g, '"')  // smart quotes
      .replace(/[\u2018\u2019]/g, "'"); // smart single quotes
    return JSON.parse(fixed);
  }
}


// ─── Diary analysis ───

interface FeedbackItem { original: string; corrected: string; explanation: string }

// 英語テキストを文単位に分割。Gemini が文の途中で original を切り出してしまうのを
// 防ぐため、サーバ側で sentence にしてから番号付きで渡し、index で参照させる。
// 「Mr. Smith」のような略語による誤分割は日記ではほぼ起きないので簡易ルールで割り切る。
function splitIntoSentences(text: string): string[] {
  return text
    .trim()
    .split(/(?<=[.!?])\s+(?=\S)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// LLM が説明文に sentence index 表記 ([2], [3]) や「sentenceIndex 2」「文 [2]」
// などを漏らすことがあるので削ぎ落とす。
// 例: "[2]で「具体的には」と切り出した後、[3]で具体例が続くため" →
//      "「具体的には」と切り出した後、具体例が続くため"
function stripSentenceIndexRefs(text: string | undefined): string {
  if (!text) return "";
  // 日本語の助詞・後続表現を後で消すために共通化したパターン
  const JP_PARTICLE = "(?:を|に|が|は|の|で|と|から|まで|へ|も|や|か|ね|について|では|でも)";
  return text
    // [数字]: 後続の助詞を貪欲に消して "[2]で「..." → "「..." にする
    .replace(new RegExp(`\\s*\\[\\d+\\]\\s*${JP_PARTICLE}?\\s*`, "g"), "")
    // 「sentenceIndex 2」「sentence 2」 + 後続の "の文"/助詞
    .replace(new RegExp(`sentenceIndex\\s*\\d+\\s*(?:の文)?\\s*${JP_PARTICLE}?\\s*`, "gi"), "")
    .replace(/\bsentence\s*#?\d+\b/gi, "")
    // 「文番号 2」「文 2 番目」「文 2」 + 後続助詞
    .replace(new RegExp(`文番号\\s*\\d+\\s*${JP_PARTICLE}?\\s*`, "g"), "")
    .replace(new RegExp(`文\\s*\\d+\\s*(?:番目|つ目|番|目)?\\s*${JP_PARTICLE}?\\s*`, "g"), "")
    // 余分な空白／句読点重複の整理
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([、。,.])/g, "$1")
    .replace(/(?:^|\s)[—–-]\s*[、。]/g, "$1") // "— 、" のような孤立 dash + 句読点
    .trim();
}
interface VocabItem { word: string; definition: string; example: string }
interface ExpansionQuestion { question: string; hintJa: string; hintPhrases: string[]; afterSentence: string }

interface DiaryAnalysis {
  feedback: FeedbackItem[];
  vocabulary: VocabItem[];
  expansionQuestions: ExpansionQuestion[];
  mood?: string;
  coverKeyword?: string;
}

interface UnsplashCover {
  url: string;
  photographer: string;
  photographerUrl: string;
  downloadLocation: string;
}

// hex (#rrggbb) → 知覚輝度 0-255。基準: ITU-R BT.601。
function brightnessFromHex(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return 128; // 不明なら中間扱いで除外しない
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

async function fetchUnsplashCover(keyword: string): Promise<UnsplashCover | null> {
  if (!keyword) return null;
  const key = unsplashAccessKey.value();
  if (!key) return null;

  type Photo = { urls: { regular: string }; user: { name: string; links: { html: string } }; links: { download_location: string }; color?: string };

  // featured=true でキュレーション済み写真のみ。content_filter=high で過激なものを排除。
  // 0 件のときは featured を外して再検索する。
  async function searchPhotos(query: string): Promise<Photo[]> {
    const params = new URLSearchParams({
      query,
      per_page: "20",
      orientation: "landscape",
      content_filter: "high",
      featured: "true",
    });
    let r = await fetch(`https://api.unsplash.com/search/photos?${params}`, {
      headers: { Authorization: `Client-ID ${key}`, "Accept-Version": "v1" },
    });
    if (!r.ok) {
      console.warn("Unsplash search failed:", r.status, query, await r.text());
      return [];
    }
    let data: { results: Photo[] } = await r.json();
    if (!data.results?.length) {
      params.delete("featured");
      r = await fetch(`https://api.unsplash.com/search/photos?${params}`, {
        headers: { Authorization: `Client-ID ${key}`, "Accept-Version": "v1" },
      });
      if (!r.ok) return [];
      data = await r.json();
    }
    return data.results || [];
  }

  // Gemini が "tokyo movie theater" のような複合語を返すと Unsplash で 0 件になることがある。
  // 0 件のときは左から 1 語ずつ落として再検索（"tokyo movie theater" → "movie theater" → "theater"）。
  // 修飾語（"japanese" / "tokyo"）は前置されがちなので末尾側を残す方がヒットしやすい。
  try {
    const tokens = keyword.trim().split(/\s+/);
    let results: Photo[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const q = tokens.slice(i).join(" ");
      results = await searchPhotos(q);
      if (results.length) {
        if (i > 0) console.warn(`Unsplash fallback: "${keyword}" → "${q}"`);
        break;
      }
    }
    if (!results.length) {
      console.warn("Unsplash 0 results across all fallbacks:", keyword);
      return null;
    }

    // dominant color から明度を見て暗い・モノトーン気味のものを除外
    // 閾値 110 (0-255) より上を "暗くない" 扱い。それでも 0 件なら閾値を下げて再フィルタ。
    const scored = results.map((p) => ({ p, b: brightnessFromHex(p.color || "") }));
    let bright = scored.filter((x) => x.b >= 110);
    if (bright.length === 0) bright = scored.filter((x) => x.b >= 80);
    if (bright.length === 0) bright = scored;

    // 明るい順 → 上位 5 からランダムに選ぶ（同じ写真ばかりにならない & 一定の明るさ確保）
    bright.sort((a, b) => b.b - a.b);
    const pool = bright.slice(0, 5);
    const pick = pool[Math.floor(Math.random() * pool.length)]!.p;
    return {
      url: pick.urls.regular,
      photographer: pick.user.name,
      photographerUrl: pick.user.links.html,
      downloadLocation: pick.links.download_location,
    };
  } catch (e) {
    console.warn("Unsplash fetch error:", e);
    return null;
  }
}

// Unsplash API ガイドライン: 画像が実際に使用されたとき download エンドポイントを叩く
async function notifyUnsplashDownload(downloadLocation: string): Promise<void> {
  const key = unsplashAccessKey.value();
  if (!key || !downloadLocation) return;
  try {
    await fetch(downloadLocation, { headers: { Authorization: `Client-ID ${key}` } });
  } catch (e) {
    console.warn("Unsplash download notify failed:", e);
  }
}

async function analyzeDiary(contentJp: string, userTranslation: string, previousFeedback: FeedbackItem[], attemptCount: number, skipMoodAndCover: boolean = false): Promise<DiaryAnalysis> {
  // Progressive correction levels
  let levelInstruction: string;
  if (attemptCount <= 1) {
    levelInstruction = `CORRECTION LEVEL: Basic — Focus on clear grammatical errors, wrong tenses, missing articles, incorrect prepositions, and obviously unnatural phrasing. Do NOT nitpick style or suggest minor improvements.
Also check for abrupt topic transitions. When the diary jumps between unrelated topics without a connecting phrase, suggest adding a natural transition such as: "Anyway, on a different note,", "As for my day,", "Moving on,", "On the other hand,", "In contrast,". Choose the appropriate transition based on context — use contrast phrases ("In contrast," "On the other hand,") when the topics have an inherent contrast, and topic-shift phrases ("Anyway,", "On a different note,") when they are simply unrelated.`;
  } else if (attemptCount === 2) {
    levelInstruction = `CORRECTION LEVEL: Intermediate — The user has already fixed basic errors. Now focus on more natural phrasing, better word choices, and idiomatic expressions. Suggest ways to sound less textbook and more conversational.`;
  } else {
    levelInstruction = `CORRECTION LEVEL: Advanced — The user has already improved grammar and naturalness. Now focus on native-level refinement: varied sentence rhythm, precise vocabulary, expressive phrasing, and stylistic polish.`;
  }

  const systemPrompt = `You are an expert English writing coach for Japanese learners preparing for RareJob online English lessons.
Your task is to analyze a short Japanese diary entry (typically 3 lines) and the user's attempted English translation.

${levelInstruction}

${CASUAL_TONE_RULE}

Return a JSON object with exactly these fields:
{
  "feedback": [
    {
      "sentenceIndex": "1-based integer pointing to a single entry in the 'User's English sentences' list below",
      "corrected": "the corrected version of THAT ONE sentence",
      "explanation": "日本語で、なぜ添削後の方が良いかを具体的に説明。両方の表現のニュアンスの違い（どういう場面で使われるか、どういう印象を与えるか）を含めること"
    }
  ],
  "vocabulary": [
    {
      "word": "a useful word or phrase from the refined translation",
      "definition": "concise definition in Japanese",
      "example": "a natural example sentence using the word"
    }
  ]${skipMoodAndCover ? "" : `,
  "mood": "ONE evocative English word capturing the dominant feeling of the day (e.g., 'buoyant', 'calm', 'accomplished', 'restless', 'focused', 'introspective', 'excited', 'cozy', 'frustrated', 'hopeful', 'grateful', 'peaceful', 'nostalgic', 'energized')",
  "coverKeyword": "1-3 English words describing a CONCRETE VISUAL SUBJECT from the diary, suitable for a stock-photo search (e.g., 'cherry blossoms', 'morning coffee', 'jogging park', 'rainy window'). Prefer concrete physical things over abstract concepts."`}
}

Rules:
- feedback: Compare the user's English translation sentence by sentence against natural English standards and suggest corrections appropriate to the CORRECTION LEVEL above.

  CRITICAL — sentence-index based feedback:
  * The user's English has already been split into numbered sentences in the "User's English sentences" section below. Each feedback item points to ONE of those sentences via its 1-based index.
  * "sentenceIndex" MUST be an integer that exists in that list (1..N). NEVER invent an index outside the range.
  * The numbered list and "[N]" notation are INTERNAL only — for you to refer to sentences by their index. NEVER mention "[1]", "[2]", "[3]" etc., or words like "sentenceIndex" / "sentence 2" / "the second sentence", in the "explanation" field shown to the user. Explanations must describe the change naturally in Japanese without referencing the index notation.
  * "corrected" MUST be a rewrite of THAT ONE sentence ONLY. It is a sentence — typically a single one. NEVER include text from adjacent numbered sentences. NEVER add lead-in clauses from the previous sentence or trail-out clauses from the next sentence.
  * "corrected" is NOT an English translation of the Japanese diary — it is a polished version of the user's existing sentence.
  * "corrected" length should be roughly comparable to the source sentence — within ~1.5x. If you want to write much more than that, you are over-rewriting; trim.
  * If the user's English is empty or no sentences are listed, return an empty feedback array [].
  * If a numbered "sentence" is actually Japanese (the user left a placeholder), SKIP it — do NOT include it in feedback.

  For each valid feedback item:
  - "sentenceIndex": which numbered sentence you're correcting.
  - "corrected": the FULL improved version of that one sentence — same scope.
  - "explanation": Japanese text explaining WHY the corrected version is better — specifically describe the nuance difference between the two expressions (e.g., when each would be used, what impression each gives, what subtle meaning differs).

  All "corrected" sentences MUST follow the TONE RULES above.
  SELF-CHECK PER ITEM:
  (1) Is "sentenceIndex" a valid 1-based number that exists in the sentences list? If not, DROP it.
  (2) Does "corrected" stay within ONE sentence's worth of scope (no content from neighboring numbered sentences)? If it bleeds into other sentences, DROP it.
  (3) Is "corrected" within ~1.5x the character length of the source sentence? If much longer, you over-rewrote — DROP it or trim back.
  (4) Is the source sentence written in English (not Japanese)? If it contains Japanese characters as the core of the sentence, DROP it.
  (5) Is "corrected" MORE casual than the source? If it became stiffer (e.g., "someone I know" → "acquaintance"), DROP it.
  (6) Is "corrected" actually DIFFERENT from the source? If the only differences are whitespace, punctuation, or capitalization, DROP it. NEVER produce a feedback item where the user's sentence is already correct — only return items where there is a real, meaningful change.
- If a sentence is already correct and natural, omit it from feedback entirely. An empty feedback array [] is preferred over filler items. Quality > quantity. Do NOT pad the feedback array with no-op items just to "show work".
- AT MOST ONE feedback item per sentenceIndex. Never produce two feedback items pointing to the same sentenceIndex. If a sentence needs multiple changes, combine them into a single feedback item.
- vocabulary: Extract 3-5 useful vocabulary items ONLY from expressions used in the "corrected" sentences above. These must be words/phrases that actually appear in your corrections. Do NOT include unrelated vocabulary.${skipMoodAndCover ? "" : `
- mood: Pick ONE English word that captures the dominant feeling of the diary content (not of the writing quality). Prefer evocative single-word adjectives a learner can actually use in conversation (buoyant / calm / accomplished / restless / focused / introspective / excited / cozy / frustrated / hopeful / grateful / peaceful / nostalgic / energized / wistful / playful / drained / content). ONE single English word only — no phrases, no quotes, no punctuation. lowercase. Even when contentJp is short, always return one mood word.
- coverKeyword: Pick a SHORT English search phrase (1-3 words) for a stock photo that visually captures the diary's scene.
  PRIORITIZE PHOTOS WITH A JAPANESE LOOK & FEEL. The user is writing in Japanese about their daily life in Japan, so cover photos should preferably feel grounded in Japan — Japanese homes / streets / food / parks / people / objects — not generic Western stock. To bias the search toward Japanese photos:
  * When natural, prepend a Japan-specific qualifier or replace generic nouns with Japan-rooted ones: "japanese", "tokyo", "kyoto" / "ramen", "izakaya", "konbini", "sento", "koban", "tatami", "shrine", "sakura", "obento", "washoku", "tonkatsu", "matcha", "soba", "futon", "japanese house" 等.
  * Generic activity is fine if a Japan-specific term doesn't fit naturally — but lean Japan whenever there's a reasonable choice. E.g. "lunch" → "obento" or "ramen" if that fits; "coffee shop" → "tokyo cafe"; "park" → "japanese park" or "sakura park"; "cinema" → leave as "popcorn cinema" (no natural JP term).
  Prefer concrete nouns (places, objects, activities) over emotions. AVOID dark, scary, gloomy, horror, or moody subjects — favor bright, warm, daylight, cheerful subjects suitable as a journal cover. If the diary scene is genuinely dark (e.g., night), still pick the most positive concrete element (e.g., "tokyo lights" instead of "dark street").
  Examples: 「家族でフラワーパークに行く」→ "japanese flower park"; 「朝ジョギングしている」→ "tokyo jogging"; 「カフェで本を読んだ」→ "tokyo cafe book"; 「ラーメン食べた」→ "ramen shop"; 「コンビニ寄った」→ "konbini night"; 「映画を観に行った」→ "popcorn cinema". Always return one keyword.`}

Return ONLY the JSON object, no markdown fences or extra text.`;

  // サーバ側で文単位に分割し、Gemini には index で指してもらう。
  // こうすると original が文の途中で切れる事故が構造的に発生しない。
  const sentences = userTranslation ? splitIntoSentences(userTranslation) : [];

  let userMessage = `Japanese diary:\n${contentJp}`;
  if (sentences.length > 0) {
    userMessage += `\n\nUser's English sentences (numbered — refer to these by sentenceIndex):\n`;
    userMessage += sentences.map((s, i) => `[${i + 1}] ${s}`).join("\n");
  } else {
    userMessage += "\n\n(No translation attempt provided)";
  }
  if (previousFeedback.length > 0) {
    userMessage += "\n\nPreviously suggested corrections (DO NOT contradict these — the user applied your fixes):\n";
    for (const fb of previousFeedback) {
      userMessage += `- "${fb.original}" → "${fb.corrected}"\n`;
    }
  }

  const response = await callLLM(systemPrompt, userMessage);
  const analysis = parseJsonObject<DiaryAnalysis & { feedback: Array<FeedbackItem & { sentenceIndex?: number }> }>(response);

  if (!userTranslation) analysis.feedback = [];
  if (!analysis.feedback) analysis.feedback = [];
  if (!analysis.vocabulary) analysis.vocabulary = [];
  if (!analysis.expansionQuestions) analysis.expansionQuestions = [];

  // sentenceIndex → original を解決。範囲外 / 欠落は drop。
  // 後方互換: Gemini が稀に index ではなく original を返してきた場合も拾う。
  // explanation には [N] のような内部参照を漏らされることがあるので sanitize する。
  analysis.feedback = analysis.feedback
    .map((fb) => {
      const explanation = stripSentenceIndexRefs(fb.explanation);
      const idx = (fb as { sentenceIndex?: number }).sentenceIndex;
      if (typeof idx === "number" && Number.isInteger(idx) && idx >= 1 && idx <= sentences.length) {
        return { original: sentences[idx - 1]!, corrected: fb.corrected, explanation };
      }
      if (typeof fb.original === "string" && fb.original.length > 0) {
        return { original: fb.original, corrected: fb.corrected, explanation };
      }
      return null;
    })
    .filter((fb): fb is FeedbackItem => fb !== null);

  // No-op フィルタ: original と corrected が同じ（空白/句読点/大小文字差のみ含む）アイテムは捨てる
  const norm = (s: string) => s.toLowerCase().replace(/[\s.,!?;:'"`]+/g, " ").trim();
  analysis.feedback = analysis.feedback.filter((fb) =>
    fb.original && fb.corrected && norm(fb.original) !== norm(fb.corrected),
  );

  // Scope バックストップ: corrected が original より大幅に長い／文数が増えているアイテムは
  // 「LLM が周辺の文まで巻き込んで書き換えた」サインなので捨てる。
  // 文単位の index 指定にしても保険として残す。
  const sentenceCount = (s: string): number => (s.match(/[.!?]+/g) || []).length || 1;
  analysis.feedback = analysis.feedback.filter((fb) => {
    const oLen = fb.original.length;
    const cLen = fb.corrected.length;
    const oS = sentenceCount(fb.original);
    const cS = sentenceCount(fb.corrected);
    // 文字数比は 2.5x までを許容（短文に対する自然な言い回し変化を考慮）。
    // 文数は original より多くて +1 まで（句読点の付け忘れ修正で 1→2 になるケースだけ救う）。
    if (cLen > oLen * 2.5 + 20) return false;
    if (cS > oS + 1) return false;
    return true;
  });

  // 検証: original が userTranslation の中に substring として実在するか。
  // 句読点／空白／大小文字を無視した正規化で比較する。
  if (userTranslation) {
    const haystack = norm(userTranslation);
    analysis.feedback = analysis.feedback.filter((fb) => haystack.includes(norm(fb.original)));
  }

  // Backstop: drop feedback items whose "original" overlaps an earlier item
  // so that final-text replace() never has to choose between competing edits.
  const kept: FeedbackItem[] = [];
  for (const fb of analysis.feedback) {
    if (!fb.original) continue;
    const overlap = kept.some(
      (k) => k.original.includes(fb.original) || fb.original.includes(k.original),
    );
    if (!overlap) kept.push(fb);
  }
  analysis.feedback = kept;

  return analysis;
}


// ─── API handler ───

export const api = onRequest(
  {
    region: "asia-northeast1",
    timeoutSeconds: 300,
    secrets: [geminiApiKey, unsplashAccessKey, claudeCodeApiUrl, claudeCodeApiKey],
  },
  async (req, res) => {
    // リクエスト単位の LLM backend tracking を有効化。
    // res.json / res.send の直前で X-LLM-Backend ヘッダを自動付与する。
    const store: LLMRequestStore = {};
    await llmStore.run(store, async () => {
      // CORS / Access-Control-Expose-Headers — フロントからカスタムヘッダを読めるように
      res.setHeader("Access-Control-Expose-Headers", "X-LLM-Backend");

      const origJson = res.json.bind(res);
      res.json = (body: unknown) => {
        if (store.backend && !res.headersSent) res.setHeader("X-LLM-Backend", store.backend);
        return origJson(body);
      };
      const origSend = res.send.bind(res);
      res.send = (body: unknown) => {
        if (store.backend && !res.headersSent) res.setHeader("X-LLM-Backend", store.backend);
        return origSend(body);
      };

      await handleRequest(req, res);
    });
  }
);

async function handleRequest(req: FbRequest, res: ExpressResponse): Promise<void> {
    const path = req.path;
    const method = req.method;

    // NOTE: GET /api/diary/lesson-sheet/:id (public) はクライアント直 Firestore read に移行。
    // 詳細: lediary/web/src/pages/sheet.ts。

    // All other diary endpoints require auth
    const userId = await verifyToken(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // POST /api/diary/posts
    if (path === "/api/diary/posts" && method === "POST") {
      const { contentJp, userTranslation, date: dateParam, previousFeedback, attemptCount, textOnly, mode: modeParam } = req.body;
      if (!contentJp) {
        res.status(400).json({ error: "contentJp is required" });
        return;
      }

      const date = dateParam || new Date().toISOString().slice(0, 10);
      const mode = modeParam || "diary";
      const docID = `${userId}_${date}_${mode}`;

      // textOnly: 添削を再走させずにテキスト系フィールドだけ更新する高速パス
      if (textOnly) {
        const updates: Record<string, unknown> = {
          userTranslation: userTranslation || "",
          updatedAt: Date.now(),
        };
        // 完成 / 編集経由で日本語原文を直接更新したい場合に備え、contentJp も受け付ける
        if (typeof contentJp === "string" && contentJp.length > 0) {
          updates.contentJp = contentJp;
        }
        if (req.body.expansionQuestions) {
          updates.expansionQuestions = req.body.expansionQuestions;
        }
        if (req.body.dismissedVocab) {
          updates.dismissedVocab = req.body.dismissedVocab;
        }
        await db.collection("lediary-posts").doc(docID).update(updates);
        res.status(200).json({ id: docID, userTranslation });
        return;
      }

      const prevFb: FeedbackItem[] = previousFeedback || [];
      const attempt: number = attemptCount || 1;

      // 既存 doc を先に取得 — contentJp が同じなら mood/coverKeyword の再生成をスキップしてコスト節約
      const existingDoc = await db.collection("lediary-posts").doc(docID).get();
      const existing = existingDoc.exists ? existingDoc.data() : null;
      const createdAt = existing?.createdAt || Date.now();

      const existingMood = (existing?.mood as string | undefined) || "";
      let coverImageUrl = (existing?.coverImageUrl as string | undefined) || "";
      let coverPhotographer = (existing?.coverPhotographer as string | undefined) || "";
      let coverPhotographerUrl = (existing?.coverPhotographerUrl as string | undefined) || "";
      let coverKeyword = (existing?.coverKeyword as string | undefined) || "";

      // contentJp が変わってない & 既に mood/coverKeyword 両方ある → Gemini に再抽出を依頼しない
      const skipMoodAndCover = existing?.contentJp === contentJp && !!existingMood && !!coverKeyword;

      let analysis: DiaryAnalysis;
      try {
        analysis = await analyzeDiary(contentJp, userTranslation || "", prevFb, attempt, skipMoodAndCover);
      } catch (err) {
        console.warn("analyzeDiary failed, retrying:", err);
        analysis = await analyzeDiary(contentJp, userTranslation || "", prevFb, attempt, skipMoodAndCover);
      }

      // skip 時は既存値を引き継ぐ（プロンプトから外しているので analysis には来ない）
      const finalMood = skipMoodAndCover ? existingMood : (analysis.mood || "");
      const newKeyword = skipMoodAndCover ? coverKeyword : (analysis.coverKeyword?.trim() || "");
      if (!skipMoodAndCover && newKeyword && newKeyword !== coverKeyword) {
        const cover = await fetchUnsplashCover(newKeyword);
        if (cover) {
          coverImageUrl = cover.url;
          coverPhotographer = cover.photographer;
          coverPhotographerUrl = cover.photographerUrl;
          coverKeyword = newKeyword;
          notifyUnsplashDownload(cover.downloadLocation);
        }
      }

      const post: Record<string, unknown> = {
        userId,
        contentJp,
        userTranslation: userTranslation || "",
        feedback: analysis.feedback,
        vocabulary: analysis.vocabulary,
        expansionQuestions: analysis.expansionQuestions,
        mood: finalMood,
        coverImageUrl,
        coverPhotographer,
        coverPhotographerUrl,
        coverKeyword,
        attemptCount: attempt,
        mode,
        date,
        createdAt,
        updatedAt: Date.now(),
      };

      await db.collection("lediary-posts").doc(docID).set(post);
      post.id = docID;
      res.status(201).json(post);
      return;
    }

    // NOTE: read endpoints (`GET /diary/posts`, `GET /diary/days`, `GET /diary/posts/:id`)
    // moved to client-side Firestore SDK. See lediary/web/src/data/{entries,days}.ts.

    // NOTE: days POST/DELETE と posts DELETE/move もクライアント側 Firestore SDK に移行済。
    // 詳細: lediary/web/src/data/{days,entries}.ts。

    // NOTE: hints / expand / correct-answer / flow-check / lesson-sheet POST はクライアント側
    //  Firestore + LLM adapter (llm-diary.ts) に移行済。サーバには TTS / posts (analyzeDiary) のみ残る。

    // GET /api/diary/tts?text=... — generate speech from text (cacheable)
    if (path === "/api/diary/tts" && method === "GET") {
      const text = req.query.text as string;
      if (!text) {
        res.status(400).json({ error: "text is required" });
        return;
      }
      if (text.length > 2000) {
        res.status(400).json({ error: "text too long (max 2000 chars)" });
        return;
      }

      const voice = (req.query.voice as string) || "Orus";
      const wav = await callGeminiTTS(text, voice);
      res.set("Content-Type", "audio/wav");
      res.set("Cache-Control", "public, max-age=604800"); // 7 days
      res.send(wav);
      return;
    }

    res.status(404).json({ error: "Not found" });
}

// ─── Push notification scheduler ───
// Runs daily at 7:00 AM JST (22:00 UTC previous day)
export const sendDailyReminder = onSchedule(
  { schedule: "0 22 * * *", region: "asia-northeast1", timeZone: "Asia/Tokyo" },
  async () => {
    const now = Date.now();

    // Get all push tokens
    const tokensSnap = await db.collection("push_tokens").get();
    if (tokensSnap.empty) return;

    // Group tokens by userId
    const userTokens = new Map<string, string[]>();
    for (const doc of tokensSnap.docs) {
      const data = doc.data();
      const tokens = userTokens.get(data.userId) || [];
      tokens.push(data.token);
      userTokens.set(data.userId, tokens);
    }

    const messaging = getMessaging();

    for (const [userId, tokens] of userTokens) {
      // Count due flashcards
      const bookmarksSnap = await db.collection("rjplus_users").doc(userId).collection("bookmarks")
        .where("mastered", "!=", true)
        .get();
      const dueCount = bookmarksSnap.docs.filter(d => {
        const data = d.data();
        return !data.nextReviewAt || data.nextReviewAt <= now;
      }).length;

      if (dueCount === 0) continue;

      // Send notification
      const response = await messaging.sendEachForMulticast({
        tokens,
        notification: {
          title: "Flashcards",
          body: `${dueCount}枚のカードが復習待ちです`,
        },
        webpush: {
          fcmOptions: { link: "https://rjplus-flashcards.web.app" },
        },
      });

      // Clean up invalid tokens
      response.responses.forEach((resp, i) => {
        if (resp.error?.code === "messaging/registration-token-not-registered" ||
            resp.error?.code === "messaging/invalid-registration-token") {
          db.collection("push_tokens").doc(tokens[i]!).delete().catch(() => {});
        }
      });
    }
  }
);

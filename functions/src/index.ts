import { onRequest, Request as FbRequest } from "firebase-functions/v2/https";
import type { Response as ExpressResponse } from "express";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getMessaging } from "firebase-admin/messaging";
import { defineSecret } from "firebase-functions/params";
initializeApp();
const db = getFirestore();
const auth = getAuth();
const geminiApiKey = defineSecret("GEMINI_API_KEY");


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

// ─── (removed) LLM dispatcher — クライアント側 llm.ts へ移行 ───

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



// ─── Diary analysis ───

// NOTE: 旧 analyzeDiary / Unsplash / sentence helpers はクライアント側 llm-diary.ts / unsplash.ts に
// 移行済。サーバには TTS と sendDailyReminder scheduler のみ残る。


// ─── API handler ───

export const api = onRequest(
  {
    region: "asia-northeast1",
    timeoutSeconds: 300,
    secrets: [geminiApiKey],
  },
  async (req, res) => {
    await handleRequest(req, res);
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

    // NOTE: POST /api/diary/posts (analyzeDiary + Unsplash cover + save) もクライアント側に移行済。
    // 詳細: lediary/web/src/data/posts.ts (analyzeAndSavePost / savePostTextOnly)。
    //  サーバ側に残るのは TTS と sendDailyReminder scheduler のみ。

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

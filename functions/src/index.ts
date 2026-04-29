import { onRequest } from "firebase-functions/v2/https";
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

// ─── Gemini ───

async function callGemini(systemPrompt: string, userMessage: string): Promise<string> {
  const key = geminiApiKey.value();
  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ parts: [{ text: userMessage }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 4000 },
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent`,
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

function parseJsonArray<T>(content: string): T {
  const match = content.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("No JSON array found in LLM response");
  try {
    return JSON.parse(match[0]);
  } catch {
    const fixed = match[0]
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/[\u2018\u2019]/g, "'");
    return JSON.parse(fixed);
  }
}

// ─── Diary analysis ───

interface FeedbackItem { original: string; corrected: string; explanation: string }
interface VocabItem { word: string; definition: string; example: string }
interface ExpansionQuestion { question: string; hintJa: string; hintPhrases: string[]; afterSentence: string }
interface HintItem { japanese: string; english: string; note: string }

interface LessonSheetDiscussionTopic {
  topic: string;
  questions: string[];
}

interface LessonSheet {
  title: string;
  vocabulary: { word: string; definition: string; example: string }[];
  discussionTopics: LessonSheetDiscussionTopic[];
}

interface DiaryAnalysis {
  feedback: FeedbackItem[];
  vocabulary: VocabItem[];
  expansionQuestions: ExpansionQuestion[];
}

async function analyzeDiary(contentJp: string, userTranslation: string, previousFeedback: FeedbackItem[], attemptCount: number): Promise<DiaryAnalysis> {
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

Return a JSON object with exactly these fields:
{
  "feedback": [
    {
      "original": "the user's full sentence containing the issue",
      "corrected": "the corrected full sentence",
      "explanation": "日本語で、なぜ添削後の方が良いかを具体的に説明。両方の表現のニュアンスの違い（どういう場面で使われるか、どういう印象を与えるか）を含めること"
    }
  ],
  "vocabulary": [
    {
      "word": "a useful word or phrase from the refined translation",
      "definition": "concise definition in Japanese",
      "example": "a natural example sentence using the word"
    }
  ],
  "expansionQuestions": [
    {
      "question": "A 5W1H question to expand a specific part of the diary (Why/How/What/When/Where/Who)",
      "hintJa": "日本語での回答ヒント（1文）",
      "hintPhrases": ["useful English phrase for answering", "another helpful expression"],
      "afterSentence": "The user's sentence after which the answer should be inserted (exact match from the translation)"
    }
  ]
}

Rules:
- feedback: Compare the user's translation sentence by sentence and suggest corrections appropriate to the CORRECTION LEVEL above. For each correction: "original" must be the user's FULL sentence, "corrected" must be the corrected FULL sentence, and "explanation" must explain in Japanese WHY the corrected version is better — specifically describe the nuance difference between the two expressions (e.g., when each would be used, what impression each gives, what subtle meaning differs). ALL alternatives MUST sound natural in casual spoken English — never use formal/written words like "therefore", "furthermore", "nevertheless". If the user's translation is empty, return an empty array [].
- vocabulary: Extract 3-5 useful vocabulary items ONLY from expressions used in the "corrected" sentences above. These must be words/phrases that actually appear in your corrections. Do NOT include unrelated vocabulary.
- expansionQuestions: Generate exactly 3 questions that dig deeper into SPECIFIC parts of the diary using 5W1H (Why/How/What/When/Where/Who). Each question should target a sentence that could be expanded with more detail. "afterSentence" must exactly match one of the user's sentences — the answer will be inserted right after it. "hintPhrases" should contain 2-3 useful English phrases/collocations the learner can use to answer the question (e.g. "because I stayed up late", "I couldn't help but..."). Example: if the user wrote "I felt sleepy all day", ask "Why did you feel sleepy even though you went to bed early?" with afterSentence "I felt sleepy all day."

Return ONLY the JSON object, no markdown fences or extra text.`;

  let userMessage = `Japanese diary:\n${contentJp}`;
  if (userTranslation) {
    userMessage += `\n\nUser's English translation attempt:\n${userTranslation}`;
  } else {
    userMessage += "\n\n(No translation attempt provided)";
  }
  if (previousFeedback.length > 0) {
    userMessage += "\n\nPreviously suggested corrections (DO NOT contradict these — the user applied your fixes):\n";
    for (const fb of previousFeedback) {
      userMessage += `- "${fb.original}" → "${fb.corrected}"\n`;
    }
  }

  const response = await callGemini(systemPrompt, userMessage);
  const analysis = parseJsonObject<DiaryAnalysis>(response);

  if (!userTranslation) analysis.feedback = [];
  if (!analysis.feedback) analysis.feedback = [];
  if (!analysis.vocabulary) analysis.vocabulary = [];
  if (!analysis.expansionQuestions) analysis.expansionQuestions = [];

  return analysis;
}

async function generateHints(contentJp: string): Promise<HintItem[]> {
  const systemPrompt = `You are an English writing coach helping a Japanese learner translate their diary into natural English.
Given a Japanese diary entry, suggest useful English expressions, phrases, and words that would help the learner write their own translation.

Rules:
- Match the tone and casualness of the original Japanese diary
- Include a mix of: key vocabulary, useful phrases/collocations, and sentence patterns
- Focus on expressions the learner might not know or might get wrong
- Each Japanese concept/phrase should appear only ONCE — do not suggest multiple alternatives for the same idea
- Do NOT provide a full translation — just building blocks
- All suggestions must sound like something you'd say in casual conversation with a friend. NEVER suggest formal/written expressions like: "furthermore", "therefore", "nevertheless", "in addition", "regarding", "approximately", "I would like to", "due to the fact that", "in order to", "prior to", "subsequently". Prefer short, everyday phrases: "also", "so", "about", "I wanna", "because", "before", "then" etc.
- Think of how a 20-something native speaker would text a friend about their day — that's the register.
- Always show expressions in their base/dictionary form (e.g. "feel under the weather" not "feeling under the weather", "hit up" not "hit up a restaurant")
- Return 8-12 items

Return a JSON array:
[
  {"japanese": "日本語の部分/概念", "english": "対応する英語表現", "note": "使い方の補足（日本語、1文）"}
]

Return ONLY the JSON array, no markdown fences or extra text.`;

  const response = await callGemini(systemPrompt, contentJp);
  const hints = parseJsonArray<HintItem[]>(response);
  return hints || [];
}

// ─── Share ID ───

function generateShareId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  for (const b of bytes) {
    result += chars[b % chars.length];
  }
  return result;
}

// ─── API handler ───

export const api = onRequest(
  { region: "asia-northeast1", secrets: [geminiApiKey] },
  async (req, res) => {
    const path = req.path;
    const method = req.method;

    // Public endpoint: GET /api/diary/lesson-sheet/:id (no auth)
    const sheetMatch = path.match(/^\/api\/diary\/lesson-sheet\/([a-zA-Z0-9_-]+)$/);
    if (sheetMatch && method === "GET") {
      const shareId = sheetMatch[1];
      const doc = await db.collection("lediary-sheets").doc(shareId!).get();
      if (!doc.exists) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json(doc.data());
      return;
    }

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

      // textOnly: update translation text without re-running analysis
      if (textOnly) {
        const updates: Record<string, unknown> = {
          userTranslation: userTranslation || "",
          updatedAt: Date.now(),
        };
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

      let analysis: DiaryAnalysis;
      try {
        analysis = await analyzeDiary(contentJp, userTranslation || "", prevFb, attempt);
      } catch (err) {
        // Retry once on JSON parse failure
        console.warn("analyzeDiary failed, retrying:", err);
        analysis = await analyzeDiary(contentJp, userTranslation || "", prevFb, attempt);
      }

      // Preserve createdAt from existing doc
      const existingDoc = await db.collection("lediary-posts").doc(docID).get();
      const createdAt = existingDoc.exists ? existingDoc.data()?.createdAt || Date.now() : Date.now();

      const post: Record<string, unknown> = {
        userId,
        contentJp,
        userTranslation: userTranslation || "",
        feedback: analysis.feedback,
        vocabulary: analysis.vocabulary,
        expansionQuestions: analysis.expansionQuestions,
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

    // GET /api/diary/posts
    if (path === "/api/diary/posts" && method === "GET") {
      const snap = await db.collection("lediary-posts")
        .where("userId", "==", userId)
        .orderBy("createdAt", "desc")
        .get();
      const posts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      res.json(posts);
      return;
    }

    // GET /api/diary/posts/:id
    const postMatch = path.match(/^\/api\/diary\/posts\/(.+)$/);
    if (postMatch && method === "GET") {
      const doc = await db.collection("lediary-posts").doc(postMatch[1]).get();
      if (!doc.exists || doc.data()?.userId !== userId) {
        res.status(404).json({ error: "Post not found" });
        return;
      }
      res.json({ id: doc.id, ...doc.data() });
      return;
    }

    // DELETE /api/diary/posts/:id
    if (postMatch && method === "DELETE") {
      const doc = await db.collection("lediary-posts").doc(postMatch[1]).get();
      if (!doc.exists || doc.data()?.userId !== userId) {
        res.status(404).json({ error: "Post not found" });
        return;
      }
      await db.collection("lediary-posts").doc(postMatch[1]).delete();
      res.json({ success: true });
      return;
    }

    // POST /api/diary/hints
    if (path === "/api/diary/hints" && method === "POST") {
      const { contentJp, date: dateParam, mode: hintMode } = req.body;
      if (!contentJp || !dateParam) {
        res.status(400).json({ error: "contentJp and date are required" });
        return;
      }

      const hints = await generateHints(contentJp);

      const hm = hintMode || "diary";
      const docID = `${userId}_${dateParam}_${hm}`;
      const hintDoc = await db.collection("lediary-posts").doc(docID).get();
      const hintCreatedAt = hintDoc.exists ? {} : { createdAt: Date.now() };
      await db.collection("lediary-posts").doc(docID).set({
        userId,
        contentJp,
        mode: hm,
        date: dateParam,
        hints,
        updatedAt: Date.now(),
        ...hintCreatedAt,
      }, { merge: true });

      res.json({ hints });
      return;
    }

    // POST /api/diary/expand — generate new expansion questions only
    if (path === "/api/diary/expand" && method === "POST") {
      const { contentJp, userTranslation, date: dateParam, mode: expandMode } = req.body;
      if (!userTranslation) {
        res.status(400).json({ error: "userTranslation is required" });
        return;
      }

      const systemPrompt = `You are an expert English writing coach for Japanese learners.
Generate 3 follow-up questions to help the user expand their English diary entry with more detail.

Return a JSON object:
{
  "expansionQuestions": [
    {
      "question": "A 5W1H question to expand a specific part of the diary (Why/How/What/When/Where/Who)",
      "hintPhrases": ["useful English phrase for answering", "another helpful expression"],
      "afterSentence": "The user's sentence after which the answer should be inserted (exact match from the translation)"
    }
  ]
}

Rules:
- Generate exactly 3 questions that dig deeper into SPECIFIC parts of the diary using 5W1H.
- Each question should target a sentence that could be expanded with more detail.
- "afterSentence" must exactly match one of the user's sentences.
- "hintPhrases" should contain 2-3 useful English phrases/collocations the learner can use to answer.
- Questions should be different from what might have been asked before — look for unexplored angles.
Return ONLY the JSON object, no markdown fences or extra text.`;

      const userMessage = `Japanese diary:\n${contentJp || ""}\n\nUser's English translation:\n${userTranslation}`;
      const response = await callGemini(systemPrompt, userMessage);
      const result = parseJsonObject<{ expansionQuestions: ExpansionQuestion[] }>(response);
      const questions = result.expansionQuestions || [];

      // Save to Firestore
      const date = dateParam || new Date().toISOString().slice(0, 10);
      const em = expandMode || "diary";
      const docID = `${userId}_${date}_${em}`;
      await db.collection("lediary-posts").doc(docID).update({
        expansionQuestions: questions,
        updatedAt: Date.now(),
      });

      res.json({ expansionQuestions: questions });
      return;
    }

    // POST /api/diary/correct-answer
    if (path === "/api/diary/correct-answer" && method === "POST") {
      const { question, answer, diaryContext } = req.body;
      if (!answer) {
        res.status(400).json({ error: "answer is required" });
        return;
      }

      const systemPrompt = `You are an English writing coach. The user is answering a follow-up question about their diary entry.
Correct their English answer to be natural casual spoken English. Return a JSON object:
{"corrected": "the corrected sentence", "explanation": "日本語で簡潔に修正理由（修正なしなら空文字）"}
If the answer is already correct, return it as-is with empty explanation. Return ONLY JSON.`;

      const userMessage = `Diary context: ${diaryContext || ""}\nQuestion: ${question || ""}\nUser's answer: ${answer}`;
      const response = await callGemini(systemPrompt, userMessage);
      const result = parseJsonObject<{ corrected: string; explanation: string }>(response);
      res.json(result);
      return;
    }

    // POST /api/diary/flow-check — check sentence connections and suggest improvements
    if (path === "/api/diary/flow-check" && method === "POST") {
      const { text } = req.body;
      if (!text) {
        res.status(400).json({ error: "text is required" });
        return;
      }

      const systemPrompt = `You are an English writing coach helping a Japanese learner improve the flow and cohesion of their diary entry.
Analyze how the sentences connect to each other. Focus ONLY on transitions and connections between sentences — not grammar or vocabulary.

Return a JSON object:
{
  "suggestions": [
    {
      "between": "Quote the end of sentence A and start of sentence B where the connection is weak",
      "suggestion": "The specific connector or transition to add (e.g., 'Actually,', 'That's why', ', so')",
      "revised": "Show the two sentences naturally connected",
      "reason": "日本語で簡潔に理由"
    }
  ],
  "overall": "日本語で全体の流れについて一言コメント（良い場合は褒める）"
}

Rules:
- Return 0-3 suggestions. If the text flows well, return empty suggestions array with a positive overall comment.
- Keep suggestions practical and specific.
- "between" should quote enough text to identify the location (5-10 words from each sentence).
- Return ONLY JSON.`;

      const response = await callGemini(systemPrompt, `Diary entry:\n${text}`);
      const result = parseJsonObject<{ suggestions: Array<{ between: string; suggestion: string; revised: string; reason: string }>; overall: string }>(response);
      res.json(result);
      return;
    }

    // POST /api/diary/lesson-sheet — generate lesson sheet from diary
    if (path === "/api/diary/lesson-sheet" && method === "POST") {
      const { postId } = req.body;
      if (!postId) {
        res.status(400).json({ error: "postId is required" });
        return;
      }

      const postDoc = await db.collection("lediary-posts").doc(postId).get();
      if (!postDoc.exists) {
        res.status(404).json({ error: "Post not found" });
        return;
      }
      const postData = postDoc.data()!;
      if (postData.userId !== userId) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      // Collect corrected text: apply feedback corrections to userTranslation
      const correctedText = postData.userTranslation || "";
      const vocabulary = (postData.vocabulary || []) as VocabItem[];
      const contentJp = postData.contentJp || "";

      const systemPrompt = `You are creating lesson material for an online English conversation lesson, formatted like a RareJob Weekly News Article (WNA).
The material is based on a student's diary entry. The student wrote in Japanese, then translated to English with AI correction.

Return a JSON object with the EXACT same structure as a WNA material:
{
  "title": "A short, engaging title for this lesson (like a news article headline)",
  "vocabulary": [
    { "word": "key phrase or expression", "definition": "simple English definition", "example": "example sentence using the word" }
  ],
  "discussionTopics": [
    {
      "topic": "Topic heading (e.g., About the Diary, Going Deeper, Your Opinion)",
      "questions": ["Discussion question 1", "Discussion question 2"]
    }
  ]
}

Rules:
- "title": Create a catchy, article-style title based on the diary content (e.g., "A Quiet Lunch at a Traditional Japanese Cafe")
- "vocabulary": Pick 4-6 useful words/phrases from the diary or its corrections. Each needs a clear English definition and a natural example sentence.
- "discussionTopics": Create exactly 2 topic groups with 2-3 questions each. IMPORTANT: Do NOT ask factual questions whose answers are already in the diary (e.g., "How many times did you practice?"). Instead, use the diary as a springboard for broader, opinion-based discussion. Questions should be about the TOPICS and THEMES in the diary, not about the diary itself. Good example: diary mentions practicing English 3 times → ask "How often do you think someone should practice writing to improve?" or "What's the best way to build a daily study habit?". Order from easier to harder.
- All content must be in English only (the tutor does not speak Japanese)
- Discussion questions should feel natural for a 25-minute conversation lesson
- The diary text itself will be shown as the "Article" section, so do NOT include it in the JSON
Return ONLY the JSON object.`;

      const userMessage = `Student's diary (Japanese):\n${contentJp}\n\nStudent's English text (corrected):\n${correctedText}\n\nVocabulary learned:\n${vocabulary.map((v) => `${v.word}: ${v.definition}`).join("\n")}`;

      const response = await callGemini(systemPrompt, userMessage);
      const sheet = parseJsonObject<LessonSheet>(response);

      // Generate share ID
      const shareId = generateShareId();

      // Save to Firestore
      const sheetData = {
        shareId,
        userId,
        postId,
        title: sheet.title,
        articleBody: correctedText,
        contentJp,
        vocabulary: sheet.vocabulary,
        discussionTopics: sheet.discussionTopics,
        date: postData.date || "",
        mode: postData.mode || "diary",
        createdAt: Date.now(),
      };
      await db.collection("lediary-sheets").doc(shareId).set(sheetData);

      // Save lessonSheetId back to the diary post
      await db.collection("lediary-posts").doc(postId).update({ lessonSheetId: shareId });

      res.json(sheetData);
      return;
    }

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
);

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

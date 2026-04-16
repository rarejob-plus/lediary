import { onRequest } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
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

function parseJsonObject<T>(content: string): T {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON object found in LLM response");
  return JSON.parse(match[0]);
}

function parseJsonArray<T>(content: string): T {
  const match = content.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("No JSON array found in LLM response");
  return JSON.parse(match[0]);
}

// ─── Diary analysis ───

interface FeedbackItem { original: string; corrected: string; explanation: string }
interface VocabItem { word: string; definition: string; example: string }
interface ExpansionQuestion { question: string; hintJa: string; hintPhrases: string[]; afterSentence: string }
interface HintItem { japanese: string; english: string; note: string }

interface DiaryAnalysis {
  feedback: FeedbackItem[];
  vocabulary: VocabItem[];
  expansionQuestions: ExpansionQuestion[];
}

async function analyzeDiary(contentJp: string, userTranslation: string, previousCorrections: string[]): Promise<DiaryAnalysis> {
  const systemPrompt = `You are an expert English writing coach for Japanese learners preparing for RareJob online English lessons.
Your task is to analyze a short Japanese diary entry (typically 3 lines) and the user's attempted English translation.

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
- feedback: Compare the user's translation sentence by sentence and suggest corrections. For each correction: "original" must be the user's FULL sentence, "corrected" must be the corrected FULL sentence, and "explanation" must explain in Japanese WHY the corrected version is better — specifically describe the nuance difference between the two expressions (e.g., when each would be used, what impression each gives, what subtle meaning differs). ALL alternatives MUST sound natural in casual spoken English — never use formal/written words like "therefore", "furthermore", "nevertheless". If the user's translation is empty, return an empty array [].
- vocabulary: Extract 3-5 useful vocabulary items relevant to the diary topic. Focus on practical conversational words/phrases.
- expansionQuestions: Generate exactly 3 questions that dig deeper into SPECIFIC parts of the diary using 5W1H (Why/How/What/When/Where/Who). Each question should target a sentence that could be expanded with more detail. "afterSentence" must exactly match one of the user's sentences — the answer will be inserted right after it. "hintPhrases" should contain 2-3 useful English phrases/collocations the learner can use to answer the question (e.g. "because I stayed up late", "I couldn't help but..."). Example: if the user wrote "I felt sleepy all day", ask "Why did you feel sleepy even though you went to bed early?" with afterSentence "I felt sleepy all day."

Return ONLY the JSON object, no markdown fences or extra text.`;

  let userMessage = `Japanese diary:\n${contentJp}`;
  if (userTranslation) {
    userMessage += `\n\nUser's English translation attempt:\n${userTranslation}`;
  } else {
    userMessage += "\n\n(No translation attempt provided)";
  }
  if (previousCorrections.length > 0) {
    userMessage += "\n\nPreviously corrected phrases (DO NOT re-correct these — the user has already applied these fixes):\n";
    for (const c of previousCorrections) {
      userMessage += `- ${c}\n`;
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
- Do NOT provide a full translation — just building blocks
- All suggestions must be natural casual spoken English
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

// ─── API handler ───

export const api = onRequest(
  { region: "asia-northeast1", secrets: [geminiApiKey] },
  async (req, res) => {
    const path = req.path;
    const method = req.method;

    // All diary endpoints require auth
    const userId = await verifyToken(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // POST /api/diary/posts
    if (path === "/api/diary/posts" && method === "POST") {
      const { contentJp, userTranslation, date: dateParam, previousCorrections } = req.body;
      if (!contentJp) {
        res.status(400).json({ error: "contentJp is required" });
        return;
      }

      const analysis = await analyzeDiary(contentJp, userTranslation || "", previousCorrections || []);

      const date = dateParam || new Date().toISOString().slice(0, 10);
      const docID = `${userId}_${date}`;
      const post: Record<string, unknown> = {
        userId,
        contentJp,
        userTranslation: userTranslation || "",
        feedback: analysis.feedback,
        vocabulary: analysis.vocabulary,
        expansionQuestions: analysis.expansionQuestions,
        accumulatedCorrections: previousCorrections || [],
        date,
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
        .orderBy("date", "desc")
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
      const { contentJp, date: dateParam } = req.body;
      if (!contentJp || !dateParam) {
        res.status(400).json({ error: "contentJp and date are required" });
        return;
      }

      const hints = await generateHints(contentJp);

      const docID = `${userId}_${dateParam}`;
      await db.collection("lediary-posts").doc(docID).set({
        userId,
        contentJp,
        date: dateParam,
        hints,
        updatedAt: Date.now(),
      }, { merge: true });

      res.json({ hints });
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

    res.status(404).json({ error: "Not found" });
  }
);

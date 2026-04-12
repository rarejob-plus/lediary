package services

import "fmt"

// DiaryAnalysis represents the AI analysis result for a diary entry.
type DiaryAnalysis struct {
	ContentEn         string         `json:"contentEn"`
	Feedback          []FeedbackItem `json:"feedback"`
	Vocabulary        []VocabItem    `json:"vocabulary"`
	ExpectedQuestions []QuestionItem `json:"expectedQuestions"`
}

// FeedbackItem represents a single correction/suggestion on the user's translation.
type FeedbackItem struct {
	Original    string `json:"original"`
	Corrected   string `json:"corrected"`
	Explanation string `json:"explanation"`
}

// VocabItem represents a vocabulary word with definition and example.
type VocabItem struct {
	Word       string `json:"word"`
	Definition string `json:"definition"`
	Example    string `json:"example"`
}

// QuestionItem represents a follow-up question a tutor might ask.
type QuestionItem struct {
	Question string `json:"question"`
	HintJa   string `json:"hintJa"`
}

// HintItem represents a translation hint for a Japanese diary entry.
type HintItem struct {
	Japanese string `json:"japanese"`
	English  string `json:"english"`
	Note     string `json:"note"`
}

// GenerateHints generates English expressions/phrases/words that match the diary's tone.
func GenerateHints(contentJp string) ([]HintItem, error) {
	systemPrompt := `You are an English writing coach helping a Japanese learner translate their diary into natural English.
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

Return ONLY the JSON array, no markdown fences or extra text.`

	response, err := CallGemini(systemPrompt, contentJp)
	if err != nil {
		return nil, fmt.Errorf("hint generation failed: %w", err)
	}

	var hints []HintItem
	if err := ParseJsonArrayInto(response, &hints); err != nil {
		return nil, fmt.Errorf("failed to parse hints: %w", err)
	}
	if hints == nil {
		hints = []HintItem{}
	}
	return hints, nil
}

// AnalyzeDiary calls Gemini to analyze a Japanese diary entry and the user's English translation.
func AnalyzeDiary(contentJp, userTranslation string, previousCorrections []string) (*DiaryAnalysis, error) {
	systemPrompt := `You are an expert English writing coach for Japanese learners preparing for RareJob online English lessons.
Your task is to analyze a short Japanese diary entry (typically 3 lines) and the user's attempted English translation.

Return a JSON object with exactly these fields:
{
  "contentEn": "A polished, natural C1-level English translation of the Japanese diary. Use casual spoken English — the kind you'd hear in everyday conversation, not in a textbook.",
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
  "expectedQuestions": [
    {
      "question": "A follow-up question a RareJob tutor might ask about the diary content",
      "hintJa": "日本語での回答ヒント"
    }
  ]
}

Rules:
- contentEn: Write natural, casual spoken English at C1 level. Avoid overly formal or literary language.
- feedback: Compare the user's translation with your refined version sentence by sentence. For each correction: "original" must be the user's FULL sentence, "corrected" must be the corrected FULL sentence, and "explanation" must explain in Japanese WHY the corrected version is better — specifically describe the nuance difference between the two expressions (e.g., when each would be used, what impression each gives, what subtle meaning differs). ALL alternatives MUST sound natural in casual spoken English — never use formal/written words like "therefore", "furthermore", "nevertheless". If the user's translation is empty, return an empty array [].
- vocabulary: Extract 3-5 useful vocabulary items from your refined translation. Focus on practical conversational words/phrases.
- expectedQuestions: Generate exactly 3 follow-up questions a RareJob tutor might ask about the diary content. Include Japanese hints for answering.

Return ONLY the JSON object, no markdown fences or extra text.`

	userMessage := fmt.Sprintf("Japanese diary:\n%s", contentJp)
	if userTranslation != "" {
		userMessage += fmt.Sprintf("\n\nUser's English translation attempt:\n%s", userTranslation)
	} else {
		userMessage += "\n\n(No translation attempt provided)"
	}
	if len(previousCorrections) > 0 {
		userMessage += "\n\nPreviously corrected phrases (DO NOT re-correct these — the user has already applied these fixes):\n"
		for _, c := range previousCorrections {
			userMessage += fmt.Sprintf("- %s\n", c)
		}
	}

	response, err := CallGemini(systemPrompt, userMessage)
	if err != nil {
		return nil, fmt.Errorf("AI analysis failed: %w", err)
	}

	var analysis DiaryAnalysis
	if err := ParseJsonInto(response, &analysis); err != nil {
		return nil, fmt.Errorf("failed to parse AI response: %w", err)
	}

	// Ensure feedback is empty array (not nil) when no translation was provided
	if userTranslation == "" {
		analysis.Feedback = []FeedbackItem{}
	}
	if analysis.Feedback == nil {
		analysis.Feedback = []FeedbackItem{}
	}
	if analysis.Vocabulary == nil {
		analysis.Vocabulary = []VocabItem{}
	}
	if analysis.ExpectedQuestions == nil {
		analysis.ExpectedQuestions = []QuestionItem{}
	}

	return &analysis, nil
}

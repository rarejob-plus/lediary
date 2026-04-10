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

// AnalyzeDiary calls Gemini to analyze a Japanese diary entry and the user's English translation.
func AnalyzeDiary(contentJp, userTranslation string) (*DiaryAnalysis, error) {
	systemPrompt := `You are an expert English writing coach for Japanese learners preparing for RareJob online English lessons.
Your task is to analyze a short Japanese diary entry (typically 3 lines) and the user's attempted English translation.

Return a JSON object with exactly these fields:
{
  "contentEn": "A polished, natural C1-level English translation of the Japanese diary. Use casual spoken English — the kind you'd hear in everyday conversation, not in a textbook.",
  "feedback": [
    {
      "original": "the user's problematic phrase",
      "corrected": "the natural English alternative",
      "explanation": "Brief explanation of why the correction is better (in Japanese)"
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
- feedback: Compare the user's translation with your refined version. Point out grammar errors, unnatural expressions, and suggest better alternatives. ALL suggested alternatives MUST sound natural in casual spoken English — never use formal/written words like "therefore", "furthermore", "nevertheless", "consequently", "moreover". If the user's translation is empty, return an empty array [].
- vocabulary: Extract 3-5 useful vocabulary items from your refined translation. Focus on practical conversational words/phrases.
- expectedQuestions: Generate exactly 3 follow-up questions a RareJob tutor might ask about the diary content. Include Japanese hints for answering.

Return ONLY the JSON object, no markdown fences or extra text.`

	userMessage := fmt.Sprintf("Japanese diary:\n%s", contentJp)
	if userTranslation != "" {
		userMessage += fmt.Sprintf("\n\nUser's English translation attempt:\n%s", userTranslation)
	} else {
		userMessage += "\n\n(No translation attempt provided)"
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

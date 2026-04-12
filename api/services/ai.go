package services

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"regexp"
)

// CallGemini sends a prompt to Gemini 3 Flash Preview and returns the text response.
func CallGemini(systemPrompt, userMessage string) (string, error) {
	apiKey := os.Getenv("GEMINI_API_KEY")
	if apiKey == "" {
		return "", fmt.Errorf("GEMINI_API_KEY not set")
	}

	body := map[string]interface{}{
		"system_instruction": map[string]interface{}{
			"parts": []map[string]string{{"text": systemPrompt}},
		},
		"contents": []map[string]interface{}{
			{"parts": []map[string]string{{"text": userMessage}}},
		},
		"generationConfig": map[string]interface{}{
			"temperature":     0.7,
			"maxOutputTokens": 4000,
		},
	}

	jsonBody, _ := json.Marshal(body)
	url := "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent"
	req, _ := http.NewRequest("POST", url, bytes.NewReader(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-goog-api-key", apiKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("Gemini request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read Gemini response: %w", err)
	}
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("Gemini API error %d: %s", resp.StatusCode, string(respBody))
	}

	var result struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
		UsageMetadata struct {
			PromptTokenCount     int `json:"promptTokenCount"`
			CandidatesTokenCount int `json:"candidatesTokenCount"`
		} `json:"usageMetadata"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", fmt.Errorf("Gemini response parse error: %w", err)
	}

	if result.UsageMetadata.PromptTokenCount > 0 {
		log.Printf("[AI] Gemini tokens: %d+%d", result.UsageMetadata.PromptTokenCount, result.UsageMetadata.CandidatesTokenCount)
	}

	if len(result.Candidates) == 0 || len(result.Candidates[0].Content.Parts) == 0 {
		return "", fmt.Errorf("empty response from Gemini")
	}
	return result.Candidates[0].Content.Parts[0].Text, nil
}

// ParseJsonInto extracts the first JSON object from content and unmarshals it into target.
func ParseJsonInto(content string, target interface{}) error {
	re := regexp.MustCompile(`(?s)\{.*\}`)
	match := re.FindString(content)
	if match == "" {
		return fmt.Errorf("no JSON object found in LLM response")
	}
	return json.Unmarshal([]byte(match), target)
}

// ParseJsonArrayInto extracts the first JSON array from content and unmarshals it into target.
func ParseJsonArrayInto(content string, target interface{}) error {
	re := regexp.MustCompile(`(?s)\[.*\]`)
	match := re.FindString(content)
	if match == "" {
		return fmt.Errorf("no JSON array found in LLM response")
	}
	return json.Unmarshal([]byte(match), target)
}

package routes

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"lediary/api/db"
	"lediary/api/middleware"
	"lediary/api/services"
)

// RegisterDiaryRoutes registers /api/diary/* routes.
func RegisterDiaryRoutes(rg *gin.RouterGroup) {
	diary := rg.Group("/diary")
	diary.Use(middleware.RequireAuth())

	// GET /api/diary/posts — list user's posts
	diary.GET("/posts", func(c *gin.Context) {
		userID := middleware.GetUserID(c)
		ctx := context.Background()

		posts, err := db.ListPosts(ctx, userID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusOK, posts)
	})

	// POST /api/diary/posts — create a post with AI analysis
	diary.POST("/posts", func(c *gin.Context) {
		userID := middleware.GetUserID(c)
		ctx := context.Background()

		var body struct {
			ContentJp             string   `json:"contentJp"`
			UserTranslation       string   `json:"userTranslation"`
			Date                  string   `json:"date"`
			PreviousCorrections   []string `json:"previousCorrections"`
		}
		if err := c.ShouldBindJSON(&body); err != nil || body.ContentJp == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "contentJp is required"})
			return
		}

		// Call AI analysis
		analysis, err := services.AnalyzeDiary(body.ContentJp, body.UserTranslation, body.PreviousCorrections)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "AI analysis failed: " + err.Error()})
			return
		}

		now := time.Now()
		date := body.Date
		if date == "" {
			date = now.Format("2006-01-02")
		}
		// Convert structs to maps with lowercase keys for Firestore/JSON consistency
		feedback := make([]map[string]string, 0, len(analysis.Feedback))
		for _, f := range analysis.Feedback {
			feedback = append(feedback, map[string]string{
				"original": f.Original, "corrected": f.Corrected, "explanation": f.Explanation,
			})
		}
		vocabulary := make([]map[string]string, 0, len(analysis.Vocabulary))
		for _, v := range analysis.Vocabulary {
			vocabulary = append(vocabulary, map[string]string{
				"word": v.Word, "definition": v.Definition, "example": v.Example,
			})
		}
		expectedQuestions := make([]map[string]string, 0, len(analysis.ExpectedQuestions))
		for _, q := range analysis.ExpectedQuestions {
			expectedQuestions = append(expectedQuestions, map[string]string{
				"question": q.Question, "hintJa": q.HintJa,
			})
		}

		docID := userID + "_" + date
		post := map[string]interface{}{
			"userId":                 userID,
			"contentJp":              body.ContentJp,
			"userTranslation":        body.UserTranslation,
			"contentEn":              analysis.ContentEn,
			"feedback":               feedback,
			"vocabulary":             vocabulary,
			"expectedQuestions":      expectedQuestions,
			"accumulatedCorrections": body.PreviousCorrections,
			"date":                   date,
			"updatedAt":              now.UnixMilli(),
		}

		if err := db.SetPost(ctx, docID, post); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		post["id"] = docID
		c.JSON(http.StatusCreated, post)
	})

	// POST /api/diary/hints — generate translation hints and save to Firestore
	diary.POST("/hints", func(c *gin.Context) {
		userID := middleware.GetUserID(c)
		ctx := context.Background()

		var body struct {
			ContentJp string `json:"contentJp"`
			Date      string `json:"date"`
		}
		if err := c.ShouldBindJSON(&body); err != nil || body.ContentJp == "" || body.Date == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "contentJp and date are required"})
			return
		}

		hints, err := services.GenerateHints(body.ContentJp)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		// Convert to maps for Firestore
		hintMaps := make([]map[string]string, 0, len(hints))
		for _, h := range hints {
			hintMaps = append(hintMaps, map[string]string{
				"japanese": h.Japanese, "english": h.English, "note": h.Note,
			})
		}

		// Save hints to the post document (upsert)
		docID := userID + "_" + body.Date
		post := map[string]interface{}{
			"userId":    userID,
			"contentJp": body.ContentJp,
			"date":      body.Date,
			"hints":     hintMaps,
			"updatedAt": time.Now().UnixMilli(),
		}
		if err := db.MergePost(ctx, docID, post); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{"hints": hintMaps})
	})

	// GET /api/diary/posts/:id — get single post
	diary.GET("/posts/:id", func(c *gin.Context) {
		userID := middleware.GetUserID(c)
		postID := c.Param("id")
		ctx := context.Background()

		post, err := db.GetPost(ctx, postID)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Post not found"})
			return
		}

		// Verify ownership
		if post["userId"] != userID {
			c.JSON(http.StatusNotFound, gin.H{"error": "Post not found"})
			return
		}

		c.JSON(http.StatusOK, post)
	})

	// DELETE /api/diary/posts/:id — delete post
	diary.DELETE("/posts/:id", func(c *gin.Context) {
		userID := middleware.GetUserID(c)
		postID := c.Param("id")
		ctx := context.Background()

		// Verify ownership before deleting
		post, err := db.GetPost(ctx, postID)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Post not found"})
			return
		}
		if post["userId"] != userID {
			c.JSON(http.StatusNotFound, gin.H{"error": "Post not found"})
			return
		}

		if err := db.DeletePost(ctx, postID); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{"success": true})
	})
}

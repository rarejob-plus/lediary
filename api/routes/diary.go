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
			ContentJp       string `json:"contentJp"`
			UserTranslation string `json:"userTranslation"`
		}
		if err := c.ShouldBindJSON(&body); err != nil || body.ContentJp == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "contentJp is required"})
			return
		}

		// Call AI analysis
		analysis, err := services.AnalyzeDiary(body.ContentJp, body.UserTranslation)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "AI analysis failed: " + err.Error()})
			return
		}

		now := time.Now()
		post := map[string]interface{}{
			"userId":            userID,
			"contentJp":         body.ContentJp,
			"userTranslation":   body.UserTranslation,
			"contentEn":         analysis.ContentEn,
			"feedback":          analysis.Feedback,
			"vocabulary":        analysis.Vocabulary,
			"expectedQuestions": analysis.ExpectedQuestions,
			"date":              now.Format("2006-01-02"),
			"createdAt":         now.UnixMilli(),
		}

		id, err := db.CreatePost(ctx, post)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		post["id"] = id
		c.JSON(http.StatusCreated, post)
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

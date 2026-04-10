package routes

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"lediary/api/db"
)

// RegisterAuthRoutes registers /api/auth/* routes.
func RegisterAuthRoutes(rg *gin.RouterGroup) {
	auth := rg.Group("/auth")

	// GET /api/auth/status
	auth.GET("/status", func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if len(authHeader) < 8 || authHeader[:7] != "Bearer " {
			c.JSON(http.StatusOK, gin.H{"isLoggedIn": false})
			return
		}
		idToken := authHeader[7:]

		authClient := db.GetAuth()
		if authClient == nil {
			c.JSON(http.StatusOK, gin.H{"isLoggedIn": false})
			return
		}

		token, err := authClient.VerifyIDToken(c.Request.Context(), idToken)
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"isLoggedIn": false})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"isLoggedIn": true,
			"userId":     token.UID,
		})
	})
}

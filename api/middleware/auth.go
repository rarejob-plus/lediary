package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"lediary/api/db"
)

// RequireAuth validates a Firebase ID token from the Authorization header
// and attaches the Firebase UID as userId in the gin context.
func RequireAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if len(authHeader) < 8 || authHeader[:7] != "Bearer " {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
			c.Abort()
			return
		}
		idToken := authHeader[7:]

		authClient := db.GetAuth()
		if authClient == nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Auth not configured"})
			c.Abort()
			return
		}

		token, err := authClient.VerifyIDToken(c.Request.Context(), idToken)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token"})
			c.Abort()
			return
		}

		c.Set("userId", token.UID)
		c.Next()
	}
}

// GetUserID extracts the userId from gin context (set by RequireAuth).
func GetUserID(c *gin.Context) string {
	v, _ := c.Get("userId")
	s, _ := v.(string)
	return s
}

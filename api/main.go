package main

import (
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"lediary/api/routes"
)

func main() {
	r := gin.Default()

	// CORS
	origin := os.Getenv("CORS_ORIGIN")
	if origin == "" {
		origin = "http://localhost:5173"
	}
	origins := strings.Split(origin, ",")
	r.Use(cors.New(cors.Config{
		AllowOriginFunc: func(o string) bool {
			for _, allowed := range origins {
				if o == strings.TrimSpace(allowed) {
					return true
				}
			}
			return false
		},
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Accept", "Authorization"},
		AllowCredentials: true,
	}))

	// Health check
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	// API routes
	api := r.Group("/api")
	routes.RegisterAuthRoutes(api)
	routes.RegisterDiaryRoutes(api)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Lediary API server starting on port %s", port)
	if err := r.Run(fmt.Sprintf(":%s", port)); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

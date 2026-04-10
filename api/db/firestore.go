package db

import (
	"context"
	"log"
	"os"
	"sync"

	"cloud.google.com/go/firestore"
	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
	"google.golang.org/api/iterator"
)

var (
	client     *firestore.Client
	once       sync.Once
	authClient *auth.Client
	authOnce   sync.Once
)

const postsCollection = "lediary-posts"

// GetDB returns the singleton Firestore client.
func GetDB() *firestore.Client {
	once.Do(func() {
		projectID := os.Getenv("GOOGLE_CLOUD_PROJECT")
		if projectID == "" {
			projectID = "otokichi-app"
		}

		var err error
		client, err = firestore.NewClient(context.Background(), projectID)
		if err != nil {
			log.Fatalf("Failed to create Firestore client: %v", err)
		}
	})
	return client
}

// GetAuth returns the singleton Firebase Auth client.
func GetAuth() *auth.Client {
	authOnce.Do(func() {
		ctx := context.Background()
		app, err := firebase.NewApp(ctx, nil)
		if err != nil {
			log.Printf("Warning: Failed to initialize Firebase app: %v", err)
			return
		}
		authClient, err = app.Auth(ctx)
		if err != nil {
			log.Printf("Warning: Failed to create Firebase Auth client: %v", err)
			return
		}
	})
	return authClient
}

// GetPost returns a single lediary-posts document by ID.
func GetPost(ctx context.Context, postID string) (map[string]interface{}, error) {
	doc, err := GetDB().Collection(postsCollection).Doc(postID).Get(ctx)
	if err != nil {
		return nil, err
	}
	data := doc.Data()
	data["id"] = doc.Ref.ID
	return data, nil
}

// ListPosts returns all lediary-posts for a given user, ordered by date descending.
func ListPosts(ctx context.Context, userID string) ([]map[string]interface{}, error) {
	iter := GetDB().Collection(postsCollection).
		Where("userId", "==", userID).
		OrderBy("date", firestore.Desc).
		Documents(ctx)
	defer iter.Stop()

	var posts []map[string]interface{}
	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, err
		}
		data := doc.Data()
		data["id"] = doc.Ref.ID
		posts = append(posts, data)
	}
	if posts == nil {
		posts = []map[string]interface{}{}
	}
	return posts, nil
}

// CreatePost adds a new document to lediary-posts and returns the document ID.
func CreatePost(ctx context.Context, data map[string]interface{}) (string, error) {
	ref, _, err := GetDB().Collection(postsCollection).Add(ctx, data)
	if err != nil {
		return "", err
	}
	return ref.ID, nil
}

// UpdatePost updates fields on a lediary-posts document.
func UpdatePost(ctx context.Context, postID string, fields map[string]interface{}) error {
	updates := make([]firestore.Update, 0, len(fields))
	for k, v := range fields {
		updates = append(updates, firestore.Update{Path: k, Value: v})
	}
	_, err := GetDB().Collection(postsCollection).Doc(postID).Update(ctx, updates)
	return err
}

// DeletePost deletes a lediary-posts document.
func DeletePost(ctx context.Context, postID string) error {
	_, err := GetDB().Collection(postsCollection).Doc(postID).Delete(ctx)
	return err
}

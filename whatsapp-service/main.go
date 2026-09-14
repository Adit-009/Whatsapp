package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gorilla/mux"
	"whatsapp-service/whatsapp"
)

type SendMessageRequest struct {
	Phone   string `json:"phone"`
	Message string `json:"message"`
}

func main() {
	log.Println("[WhatsMeow Microservice] Starting service...")

	waService := whatsapp.GetService()

	// Initialize WhatsMeow client and SQLite session
	err := waService.Initialize()
	if err != nil {
		log.Fatalf("[WhatsMeow Microservice] Error initializing service: %v", err)
	}

	// Connect to WhatsApp
	err = waService.Connect()
	if err != nil {
		log.Printf("[WhatsMeow Microservice] Connection notice: %v", err)
	}

	router := mux.NewRouter()

	// CORS Middleware
	router.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusOK)
				return
			}

			next.ServeHTTP(w, r)
		})
	})

	// Routes
	router.HandleFunc("/status", handleStatus).Methods("GET", "OPTIONS")
	router.HandleFunc("/qr", handleQR).Methods("GET", "OPTIONS")
	router.HandleFunc("/send", handleSend).Methods("POST", "OPTIONS")
	router.HandleFunc("/logout", handleLogout).Methods("POST", "OPTIONS")

	server := &http.Server{
		Addr:         ":8080",
		Handler:      router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
	}

	// Graceful Shutdown Handler
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	go func() {
		log.Println("[WhatsMeow Microservice] Server listening on http://localhost:8080")
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[WhatsMeow Microservice] HTTP server error: %v", err)
		}
	}()

	<-stop
	log.Println("[WhatsMeow Microservice] Shutting down gracefully...")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	waService.Disconnect()

	if err := server.Shutdown(ctx); err != nil {
		log.Printf("[WhatsMeow Microservice] Server shutdown error: %v", err)
	}

	log.Println("[WhatsMeow Microservice] Service stopped cleanly.")
}

func handleStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	waService := whatsapp.GetService()
	isConnected := waService.IsConnected()
	isLoggedIn := waService.IsLoggedIn()

	json.NewEncoder(w).Encode(map[string]interface{}{
		"connected": isConnected,
		"logged_in": isLoggedIn,
	})
}

func handleQR(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	waService := whatsapp.GetService()

	if waService.IsConnected() {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"connected": true,
			"qr":        "",
			"message":   "Already connected to WhatsApp.",
		})
		return
	}

	qr := waService.GetQRCode()

	// If no QR available, trigger a fresh QR flow
	if qr == "" {
		waService.RestartQR()
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"connected": false,
		"qr":        qr,
	})
}

func handleSend(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	var req SendMessageRequest
	err := json.NewDecoder(r.Body).Decode(&req)
	if err != nil || req.Phone == "" || req.Message == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Invalid request. 'phone' and 'message' fields are required.",
		})
		return
	}

	msgID, err := whatsapp.GetService().SendMessage(req.Phone, req.Message)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		})
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":    true,
		"message_id": msgID,
	})
}

func handleLogout(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	err := whatsapp.GetService().Logout()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		})
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Logged out successfully.",
	})
}

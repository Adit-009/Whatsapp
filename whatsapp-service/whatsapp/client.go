package whatsapp

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/skip2/go-qrcode"
	"go.mau.fi/whatsmeow"
	waProto "go.mau.fi/whatsmeow/binary/proto"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
	_ "modernc.org/sqlite"
)

type WhatsAppService struct {
	client           *whatsmeow.Client
	container        *sqlstore.Container
	qrCodeBase64     string
	qrChan           <-chan whatsmeow.QRChannelItem
	mu               sync.RWMutex
	eventHandlers    []func(event IncomingMessageEvent)
	lastQRRestart    time.Time
	logoutInProgress bool
}

type IncomingMessageEvent struct {
	Sender    string    `json:"sender"`
	Timestamp time.Time `json:"timestamp"`
	Message   string    `json:"message"`
	MessageID string    `json:"message_id"`
}

var instance *WhatsAppService
var once sync.Once

// GetService returns the singleton instance of WhatsAppService
func GetService() *WhatsAppService {
	once.Do(func() {
		instance = &WhatsAppService{
			eventHandlers: make([]func(event IncomingMessageEvent), 0),
		}
	})
	return instance
}

// Initialize initializes SQLite database and WhatsMeow client
func (s *WhatsAppService) Initialize() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	dbLogger := waLog.Stdout("Database", "WARN", true)

	// SQLite store configuration with WAL mode and busy timeout to prevent SQLITE_BUSY errors
	dsn := "file:whatsapp.db?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)"
	container, err := sqlstore.New(context.Background(), "sqlite", dsn, dbLogger)
	if err != nil {
		return fmt.Errorf("failed to connect to SQLite: %w", err)
	}
	s.container = container

	deviceStore, err := container.GetFirstDevice(context.Background())
	if err != nil {
		return fmt.Errorf("failed to get first device: %w", err)
	}

	clientLogger := waLog.Stdout("Client", "WARN", true)
	s.client = whatsmeow.NewClient(deviceStore, clientLogger)

	// Enable auto-reconnect so session stays alive
	s.client.EnableAutoReconnect = true

	// Add Event Handlers
	s.client.AddEventHandler(s.eventHandler)

	return nil
}

// Connect starts WhatsApp connection and handles QR code login flow
func (s *WhatsAppService) Connect() error {
	s.mu.Lock()

	if s.client == nil {
		s.mu.Unlock()
		return errors.New("client not initialized")
	}

	if s.client.IsConnected() {
		s.mu.Unlock()
		return nil
	}

	// Auto-reconnect if device already logged in (session persisted in SQLite)
	if s.client.Store.ID != nil {
		s.mu.Unlock()
		log.Println("[WhatsMeow] Restoring session from SQLite...")
		err := s.client.Connect()
		if err != nil {
			log.Printf("[WhatsMeow] Failed to restore session: %v. Clearing stale session...", err)
			// Clear stale session and start fresh QR flow
			s.clearSessionAndStartQR()
			return nil
		}
		log.Println("[WhatsMeow] ✅ Session successfully restored! WhatsApp connected.")
		return nil
	}

	// New QR code session flow
	qrChan, err := s.client.GetQRChannel(context.Background())
	if err != nil {
		s.mu.Unlock()
		if errors.Is(err, whatsmeow.ErrQRStoreContainsID) {
			return s.client.Connect()
		}
		return fmt.Errorf("failed to get QR channel: %w", err)
	}
	s.qrChan = qrChan
	s.mu.Unlock()

	err = s.client.Connect()
	if err != nil {
		return fmt.Errorf("failed to connect client: %w", err)
	}

	// Listen for QR code updates in background goroutine
	s.listenForQR(qrChan)

	return nil
}

// listenForQR listens to QR channel events and updates the stored QR code
func (s *WhatsAppService) listenForQR(qrChan <-chan whatsmeow.QRChannelItem) {
	go func() {
		for evt := range qrChan {
			if evt.Event == "code" {
				log.Println("[WhatsMeow] New QR Code generated. Scan with WhatsApp.")
				png, err := qrcode.Encode(evt.Code, qrcode.Medium, 256)
				if err == nil {
					base64Str := "data:image/png;base64," + base64.StdEncoding.EncodeToString(png)
					s.mu.Lock()
					s.qrCodeBase64 = base64Str
					s.mu.Unlock()
				}
			} else {
				log.Printf("[WhatsMeow] QR Event: %s\n", evt.Event)
				if evt.Event == "success" {
					s.mu.Lock()
					s.qrCodeBase64 = ""
					s.mu.Unlock()
				} else if evt.Event == "timeout" {
					s.mu.Lock()
					s.qrCodeBase64 = ""
					s.mu.Unlock()
					log.Println("[WhatsMeow] QR timed out. Auto-restarting QR flow...")
					go func() {
						time.Sleep(2 * time.Second)
						s.RestartQR()
					}()
				}
			}
		}
	}()
}

// clearSessionAndStartQR deletes the stale device and starts a fresh QR flow
func (s *WhatsAppService) clearSessionAndStartQR() {
	s.mu.Lock()

	if s.client == nil {
		s.mu.Unlock()
		return
	}

	// Disconnect if connected
	if s.client.IsConnected() {
		s.client.Disconnect()
	}

	// Delete the stale device from SQLite so next login starts fresh
	if s.client.Store.ID != nil {
		log.Println("[WhatsMeow] Deleting stale session from database...")
		err := s.client.Store.Delete(context.Background())
		if err != nil {
			log.Printf("[WhatsMeow] Warning: failed to delete device store: %v", err)
		}
	}

	// Re-create client with a fresh device store
	deviceStore, err := s.container.GetFirstDevice(context.Background())
	if err != nil {
		log.Printf("[WhatsMeow] Error getting new device store: %v", err)
		s.mu.Unlock()
		return
	}

	clientLogger := waLog.Stdout("Client", "WARN", true)
	s.client = whatsmeow.NewClient(deviceStore, clientLogger)
	s.client.EnableAutoReconnect = true
	s.client.AddEventHandler(s.eventHandler)
	s.qrCodeBase64 = ""

	// Start new QR flow
	qrChan, err := s.client.GetQRChannel(context.Background())
	if err != nil {
		log.Printf("[WhatsMeow] Error getting QR channel: %v", err)
		s.mu.Unlock()
		return
	}
	s.mu.Unlock()

	err = s.client.Connect()
	if err != nil {
		log.Printf("[WhatsMeow] Error connecting for QR: %v", err)
		return
	}

	log.Println("[WhatsMeow] Stale session cleared. Scan the new QR code to reconnect.")
	s.listenForQR(qrChan)
}

// RestartQR triggers a fresh QR code flow if not connected (with cooldown to prevent rapid restarts)
func (s *WhatsAppService) RestartQR() {
	s.mu.Lock()
	if s.client == nil || s.client.IsConnected() || s.client.IsLoggedIn() {
		s.mu.Unlock()
		return
	}
	// Prevent rapid restarts — minimum 3 seconds between attempts
	if time.Since(s.lastQRRestart) < 3*time.Second {
		s.mu.Unlock()
		return
	}
	s.lastQRRestart = time.Now()
	s.mu.Unlock()

	log.Println("[WhatsMeow] Restarting QR code flow...")
	s.clearSessionAndStartQR()
}

// Event Handler for incoming WhatsApp events
func (s *WhatsAppService) eventHandler(rawEvt interface{}) {
	switch evt := rawEvt.(type) {
	case *events.Message:
		// Extract text message content
		var textMsg string
		if evt.Message.GetConversation() != "" {
			textMsg = evt.Message.GetConversation()
		} else if evt.Message.GetExtendedTextMessage() != nil {
			textMsg = evt.Message.GetExtendedTextMessage().GetText()
		} else {
			return // Ignore non-text messages for now
		}

		sender := evt.Info.Sender.ToNonAD().String()
		msgID := evt.Info.ID
		timestamp := evt.Info.Timestamp

		event := IncomingMessageEvent{
			Sender:    sender,
			Timestamp: timestamp,
			Message:   textMsg,
			MessageID: msgID,
		}


		// Dispatch to registered event listeners
		s.mu.RLock()
		handlers := s.eventHandlers
		s.mu.RUnlock()

		for _, handler := range handlers {
			go handler(event)
		}

	case *events.Connected:
		log.Println("[WhatsMeow] ✅ Client connected to WhatsApp servers.")

	case *events.LoggedOut:
		log.Println("[WhatsMeow] ⚠️ Client logged out event received.")
		// Only start QR flow from here if Logout() didn't already handle it
		s.mu.RLock()
		logoutHandled := s.logoutInProgress
		s.mu.RUnlock()
		if !logoutHandled {
			log.Println("[WhatsMeow] Starting fresh QR flow from LoggedOut event...")
			go s.clearSessionAndStartQR()
		} else {
			log.Println("[WhatsMeow] Logout already in progress, skipping duplicate QR flow.")
		}

	case *events.StreamReplaced:
		log.Println("[WhatsMeow] ⚠️ Stream replaced (another login detected). Will auto-reconnect...")

	case *events.Disconnected:
		log.Println("[WhatsMeow] Disconnected from WhatsApp. Auto-reconnect will handle this.")

	case *events.TemporaryBan:
		log.Printf("[WhatsMeow] ⚠️ Temporary ban: %v\n", evt)
	}
}

// OnMessage registers callback for incoming messages
func (s *WhatsAppService) OnMessage(handler func(event IncomingMessageEvent)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.eventHandlers = append(s.eventHandlers, handler)
}

// IsLoggedIn returns whether a WhatsApp session is stored
func (s *WhatsAppService) IsLoggedIn() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.client != nil && s.client.IsLoggedIn()
}

// IsConnected returns connection status
func (s *WhatsAppService) IsConnected() bool {
	s.mu.RLock()
	if s.client == nil {
		s.mu.RUnlock()
		return false
	}
	loggedIn := s.client.IsLoggedIn()
	connected := s.client.IsConnected()
	s.mu.RUnlock()

	// If device is logged in but socket dropped, attempt background reconnect
	if loggedIn && !connected {
		go func() {
			s.mu.Lock()
			defer s.mu.Unlock()
			if s.client != nil && !s.client.IsConnected() {
				log.Println("[WhatsMeow] Client logged in but disconnected. Attempting auto-reconnect...")
				_ = s.client.Connect()
			}
		}()
	}

	return connected && loggedIn
}

// GetQRCode returns the current base64 QR code image
func (s *WhatsAppService) GetQRCode() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.qrCodeBase64
}

// SendMessage sends a text message to a WhatsApp number
func (s *WhatsAppService) SendMessage(phone, message string) (string, error) {
	if !s.IsConnected() {
		return "", errors.New("WhatsApp client is not connected")
	}

	// Format JID e.g. 919876543210@s.whatsapp.net
	cleanPhone := strings.TrimPrefix(strings.ReplaceAll(phone, "+", ""), "")
	if !strings.HasSuffix(cleanPhone, "@s.whatsapp.net") {
		cleanPhone = cleanPhone + "@s.whatsapp.net"
	}

	jid, err := types.ParseJID(cleanPhone)
	if err != nil {
		return "", fmt.Errorf("invalid JID format: %w", err)
	}

	msg := &waProto.Message{
		Conversation: &message,
	}

	resp, err := s.client.SendMessage(context.Background(), jid, msg)
	if err != nil {
		return "", fmt.Errorf("failed to send message: %w", err)
	}

	return resp.ID, nil
}

// Logout deletes stored session and logs out client, then immediately starts fresh QR flow
func (s *WhatsAppService) Logout() error {
	s.mu.Lock()

	if s.client == nil {
		s.mu.Unlock()
		return errors.New("client not initialized")
	}

	// Mark logout in progress so the LoggedOut event handler doesn't duplicate the QR flow
	s.logoutInProgress = true

	if s.client.IsLoggedIn() {
		err := s.client.Logout(context.Background())
		if err != nil {
			s.logoutInProgress = false
			s.mu.Unlock()
			return fmt.Errorf("failed to logout: %w", err)
		}
	}

	s.qrCodeBase64 = ""
	s.mu.Unlock()

	log.Println("[WhatsMeow] Successfully logged out. Starting fresh QR flow immediately...")

	// Immediately start a new QR flow instead of waiting for the LoggedOut event
	s.clearSessionAndStartQR()

	s.mu.Lock()
	s.logoutInProgress = false
	s.mu.Unlock()

	return nil
}

// Disconnect gracefully disconnects WhatsApp client
func (s *WhatsAppService) Disconnect() {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.client != nil && s.client.IsConnected() {
		s.client.Disconnect()
		log.Println("[WhatsMeow] Client disconnected.")
	}
}

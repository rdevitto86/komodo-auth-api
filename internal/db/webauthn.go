package db

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/go-webauthn/webauthn/webauthn"
)

var ErrWebAuthnSessionNotFound = errors.New("webauthn session not found or expired")

const (
	webauthnRegSessionKeyPrefix   = "webauthn:reg:"
	webauthnRegSessionTTLSec      = int64(300)
	webauthnLoginSessionKeyPrefix = "webauthn:login:"
	webauthnLoginSessionTTLSec    = int64(300)
)

type WebAuthnLoginSession struct {
	SessionData *webauthn.SessionData `json:"session_data"`
	UserID      string                `json:"user_id"`
	Email       string                `json:"email"`
	ClientID    string                `json:"client_id"`
}

func (c *CacheClient) StoreWebAuthnRegistrationSession(ctx context.Context, userID string, session *webauthn.SessionData) error {
	if c.api == nil {
		return fmt.Errorf("cache client not initialized")
	}

	raw, err := json.Marshal(session)
	if err != nil {
		return fmt.Errorf("failed to marshal webauthn registration session: %w", err)
	}

	if err := c.api.Set(ctx, webauthnRegSessionKeyPrefix+userID, string(raw), webauthnRegSessionTTLSec); err != nil {
		return fmt.Errorf("failed to store webauthn registration session: %w", err)
	}
	return nil
}

func (c *CacheClient) GetWebAuthnRegistrationSession(ctx context.Context, userID string) (*webauthn.SessionData, error) {
	if c.api == nil {
		return nil, fmt.Errorf("cache client not initialized")
	}

	raw, err := c.api.Get(ctx, webauthnRegSessionKeyPrefix+userID)
	if err != nil {
		return nil, fmt.Errorf("failed to look up webauthn registration session: %w", err)
	}
	if raw == "" {
		return nil, ErrWebAuthnSessionNotFound
	}

	var session webauthn.SessionData
	if err := json.Unmarshal([]byte(raw), &session); err != nil {
		return nil, fmt.Errorf("failed to unmarshal webauthn registration session: %w", err)
	}
	return &session, nil
}

func (c *CacheClient) DeleteWebAuthnRegistrationSession(ctx context.Context, userID string) error {
	if c.api == nil {
		return fmt.Errorf("cache client not initialized")
	}
	if err := c.api.Delete(ctx, webauthnRegSessionKeyPrefix+userID); err != nil {
		return fmt.Errorf("failed to delete webauthn registration session: %w", err)
	}
	return nil
}

func (c *CacheClient) StoreWebAuthnLoginSession(ctx context.Context, challenge string, session *WebAuthnLoginSession) error {
	if c.api == nil {
		return fmt.Errorf("cache client not initialized")
	}

	raw, err := json.Marshal(session)
	if err != nil {
		return fmt.Errorf("failed to marshal webauthn login session: %w", err)
	}

	if err := c.api.Set(ctx, webauthnLoginSessionKeyPrefix+challenge, string(raw), webauthnLoginSessionTTLSec); err != nil {
		return fmt.Errorf("failed to store webauthn login session: %w", err)
	}
	return nil
}

func (c *CacheClient) GetWebAuthnLoginSession(ctx context.Context, challenge string) (*WebAuthnLoginSession, error) {
	if c.api == nil {
		return nil, fmt.Errorf("cache client not initialized")
	}

	raw, err := c.api.Get(ctx, webauthnLoginSessionKeyPrefix+challenge)
	if err != nil {
		return nil, fmt.Errorf("failed to look up webauthn login session: %w", err)
	}
	if raw == "" {
		return nil, ErrWebAuthnSessionNotFound
	}

	var session WebAuthnLoginSession
	if err := json.Unmarshal([]byte(raw), &session); err != nil {
		return nil, fmt.Errorf("failed to unmarshal webauthn login session: %w", err)
	}
	return &session, nil
}

func (c *CacheClient) DeleteWebAuthnLoginSession(ctx context.Context, challenge string) error {
	if c.api == nil {
		return fmt.Errorf("cache client not initialized")
	}
	if err := c.api.Delete(ctx, webauthnLoginSessionKeyPrefix+challenge); err != nil {
		return fmt.Errorf("failed to delete webauthn login session: %w", err)
	}
	return nil
}

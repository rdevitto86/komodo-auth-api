package db

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
)

var ErrAuthCodeNotFound = errors.New("authorization code not found or expired")

const (
	authCodeKeyPrefix = "authcode:"
	authCodeTTLSec    = int64(600)
)

type AuthCodeEntry struct {
	ClientID      string `json:"client_id"`
	RedirectURI   string `json:"redirect_uri"`
	Scope         string `json:"scope,omitempty"`
	UserID        string `json:"user_id"`
	CodeChallenge string `json:"code_challenge"`
}

func (c *CacheClient) StoreAuthCode(ctx context.Context, code string, entry *AuthCodeEntry) (bool, error) {
	if c.api == nil {
		return false, fmt.Errorf("cache client not initialized")
	}

	raw, err := json.Marshal(entry)
	if err != nil {
		return false, fmt.Errorf("failed to marshal authorization code entry: %w", err)
	}

	claimed, err := c.api.SetNX(ctx, authCodeKeyPrefix+code, string(raw), authCodeTTLSec)
	if err != nil {
		return false, fmt.Errorf("failed to store authorization code: %w", err)
	}
	return claimed, nil
}

func (c *CacheClient) GetAuthCode(ctx context.Context, code string) (*AuthCodeEntry, error) {
	if c.api == nil {
		return nil, fmt.Errorf("cache client not initialized")
	}

	raw, err := c.api.Get(ctx, authCodeKeyPrefix+code)
	if err != nil {
		return nil, fmt.Errorf("failed to look up authorization code: %w", err)
	}
	if raw == "" {
		return nil, ErrAuthCodeNotFound
	}

	var entry AuthCodeEntry
	if err := json.Unmarshal([]byte(raw), &entry); err != nil {
		return nil, fmt.Errorf("failed to unmarshal authorization code entry: %w", err)
	}
	return &entry, nil
}

func (c *CacheClient) DeleteAuthCode(ctx context.Context, code string) error {
	if c.api == nil {
		return fmt.Errorf("cache client not initialized")
	}
	if err := c.api.Delete(ctx, authCodeKeyPrefix+code); err != nil {
		return fmt.Errorf("failed to delete authorization code: %w", err)
	}
	return nil
}

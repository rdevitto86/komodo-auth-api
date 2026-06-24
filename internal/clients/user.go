package clients

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	usermodels "komodo-auth-api/internal/models/user"

	sdkhttp "github.com/rdevitto86/komodo-forge-sdk-go/http/client"
)

const maxUserCredentialsBody = 1 << 20

const pathUserFmt = "/v1/users/%s"
const pathUserPasskeysFmt = "/v1/users/%s/passkeys"
const pathUserPasskeyFmt = "/v1/users/%s/passkeys/%s"

type PasskeyCredentialDescriptor struct {
	CredentialId   string     `json:"credential_id"`
	PublicKey      string     `json:"public_key"`
	SignCount      uint32     `json:"sign_count"`
	Transports     []string   `json:"transports,omitempty"`
	Aaguid         string     `json:"aaguid,omitempty"`
	BackupEligible bool       `json:"backup_eligible"`
	BackupState    bool       `json:"backup_state"`
	CreatedAt      *time.Time `json:"created_at,omitempty"`
	LastUsedAt     *time.Time `json:"last_used_at,omitempty"`
}

type PasskeyCredentialStore interface {
	ListPasskeyCredentials(ctx context.Context, userID, bearerToken string) ([]PasskeyCredentialDescriptor, error)
	CreatePasskeyCredential(ctx context.Context, userID, bearerToken string, cred PasskeyCredentialDescriptor) error
	UpdatePasskeyCredential(ctx context.Context, userID, bearerToken string, cred PasskeyCredentialDescriptor) error
}

func (c *HttpClient) GetUserCredentials(ctx context.Context, email, bearerToken string) (*usermodels.CredentialsResponse, error) {
	url := c.UserBaseURL + usermodels.PathCredentials + "?email=" + url.QueryEscape(email)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to build user credentials request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+bearerToken)
	req.Header.Set("Accept", "application/json")

	resp, err := c.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to get user credentials: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxUserCredentialsBody))
	if err != nil {
		return nil, fmt.Errorf("failed to read user credentials response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, &sdkhttp.HTTPError{StatusCode: resp.StatusCode, Body: raw}
	}

	var result usermodels.CredentialsResponse
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal user credentials response: %w", err)
	}
	return &result, nil
}

func (c *HttpClient) GetUserByID(ctx context.Context, userID, bearerToken string) (*usermodels.User, error) {
	url := c.UserBaseURL + fmt.Sprintf(pathUserFmt, userID)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to build get user request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+bearerToken)
	req.Header.Set("Accept", "application/json")

	resp, err := c.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to get user by ID: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxUserCredentialsBody))
	if err != nil {
		return nil, fmt.Errorf("failed to read get user response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, &sdkhttp.HTTPError{StatusCode: resp.StatusCode, Body: raw}
	}

	var result usermodels.User
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal get user response: %w", err)
	}
	return &result, nil
}

func (c *HttpClient) ListPasskeyCredentials(ctx context.Context, userID, bearerToken string) ([]PasskeyCredentialDescriptor, error) {
	url := c.UserBaseURL + fmt.Sprintf(pathUserPasskeysFmt, userID)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to build list passkeys request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+bearerToken)
	req.Header.Set("Accept", "application/json")

	resp, err := c.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to list passkey credentials: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxUserCredentialsBody))
	if err != nil {
		return nil, fmt.Errorf("failed to read list passkeys response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, &sdkhttp.HTTPError{StatusCode: resp.StatusCode, Body: raw}
	}

	var result struct {
		Credentials []PasskeyCredentialDescriptor `json:"credentials"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal list passkeys response: %w", err)
	}
	return result.Credentials, nil
}

func (c *HttpClient) CreatePasskeyCredential(ctx context.Context, userID, bearerToken string, cred PasskeyCredentialDescriptor) error {
	url := c.UserBaseURL + fmt.Sprintf(pathUserPasskeysFmt, userID)

	cred.CreatedAt = nil
	cred.LastUsedAt = nil

	body, err := json.Marshal(cred)
	if err != nil {
		return fmt.Errorf("failed to marshal passkey credential: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("failed to build create passkey request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+bearerToken)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.Do(req)
	if err != nil {
		return fmt.Errorf("failed to create passkey credential: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxUserCredentialsBody))
	if err != nil {
		return fmt.Errorf("failed to read create passkey response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return &sdkhttp.HTTPError{StatusCode: resp.StatusCode, Body: raw}
	}
	return nil
}

func (c *HttpClient) UpdatePasskeyCredential(ctx context.Context, userID, bearerToken string, cred PasskeyCredentialDescriptor) error {
	url := c.UserBaseURL + fmt.Sprintf(pathUserPasskeyFmt, userID, cred.CredentialId)

	body, err := json.Marshal(cred)
	if err != nil {
		return fmt.Errorf("failed to marshal passkey credential: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPatch, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("failed to build update passkey request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+bearerToken)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.Do(req)
	if err != nil {
		return fmt.Errorf("failed to update passkey credential: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxUserCredentialsBody))
	if err != nil {
		return fmt.Errorf("failed to read update passkey response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return &sdkhttp.HTTPError{StatusCode: resp.StatusCode, Body: raw}
	}
	return nil
}

package db

import (
	"context"
	"errors"
	"testing"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
)

// ── Unit Tests: Registration session ─────────────────────────────────────────

func TestStoreAndGetWebAuthnRegistrationSession_RoundTrip(t *testing.T) {
	c := newClient(newFake())
	ctx := context.Background()

	session := &webauthn.SessionData{
		Challenge:        "challenge-123",
		RelyingPartyID:   "example.com",
		UserID:           []byte("user-123"),
		UserVerification: protocol.VerificationRequired,
	}

	if err := c.StoreWebAuthnRegistrationSession(ctx, "USER#123", session); err != nil {
		t.Fatalf("StoreWebAuthnRegistrationSession: unexpected error: %v", err)
	}

	got, err := c.GetWebAuthnRegistrationSession(ctx, "USER#123")
	if err != nil {
		t.Fatalf("GetWebAuthnRegistrationSession: unexpected error: %v", err)
	}
	if got.Challenge != session.Challenge {
		t.Errorf("expected challenge %q, got %q", session.Challenge, got.Challenge)
	}
	if got.RelyingPartyID != session.RelyingPartyID {
		t.Errorf("expected RP ID %q, got %q", session.RelyingPartyID, got.RelyingPartyID)
	}
	if string(got.UserID) != string(session.UserID) {
		t.Errorf("expected user ID %q, got %q", session.UserID, got.UserID)
	}
}

func TestGetWebAuthnRegistrationSession_MissingSession_ReturnsErrWebAuthnSessionNotFound(t *testing.T) {
	c := newClient(newFake())
	ctx := context.Background()

	_, err := c.GetWebAuthnRegistrationSession(ctx, "USER#does-not-exist")
	if !errors.Is(err, ErrWebAuthnSessionNotFound) {
		t.Fatalf("expected ErrWebAuthnSessionNotFound, got %v", err)
	}
}

func TestGetWebAuthnRegistrationSession_GetError_Propagates(t *testing.T) {
	fake := newFake()
	fake.failGet = true
	c := newClient(fake)
	ctx := context.Background()

	_, err := c.GetWebAuthnRegistrationSession(ctx, "USER#123")
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if errors.Is(err, ErrWebAuthnSessionNotFound) {
		t.Fatal("expected non-sentinel error for cache failure, got ErrWebAuthnSessionNotFound")
	}
}

func TestGetWebAuthnRegistrationSession_MalformedJSON_ReturnsError(t *testing.T) {
	fake := newFake()
	fake.store["webauthn:reg:USER#123"] = "not-json"
	c := newClient(fake)
	ctx := context.Background()

	_, err := c.GetWebAuthnRegistrationSession(ctx, "USER#123")
	if err == nil {
		t.Fatal("expected error for malformed session JSON, got nil")
	}
}

func TestDeleteWebAuthnRegistrationSession_RemovesSession(t *testing.T) {
	c := newClient(newFake())
	ctx := context.Background()

	session := &webauthn.SessionData{Challenge: "challenge-123", UserID: []byte("user-123")}
	if err := c.StoreWebAuthnRegistrationSession(ctx, "USER#123", session); err != nil {
		t.Fatalf("StoreWebAuthnRegistrationSession: unexpected error: %v", err)
	}

	if err := c.DeleteWebAuthnRegistrationSession(ctx, "USER#123"); err != nil {
		t.Fatalf("DeleteWebAuthnRegistrationSession: unexpected error: %v", err)
	}

	_, err := c.GetWebAuthnRegistrationSession(ctx, "USER#123")
	if !errors.Is(err, ErrWebAuthnSessionNotFound) {
		t.Fatalf("expected ErrWebAuthnSessionNotFound after delete, got %v", err)
	}
}

func TestWebAuthnRegistrationSession_NilCacheAPI_ReturnsError(t *testing.T) {
	c := NewFromOperations(nil)
	ctx := context.Background()

	if err := c.StoreWebAuthnRegistrationSession(ctx, "USER#123", &webauthn.SessionData{}); err == nil {
		t.Error("StoreWebAuthnRegistrationSession with nil api: expected error, got nil")
	}
	if _, err := c.GetWebAuthnRegistrationSession(ctx, "USER#123"); err == nil {
		t.Error("GetWebAuthnRegistrationSession with nil api: expected error, got nil")
	}
	if err := c.DeleteWebAuthnRegistrationSession(ctx, "USER#123"); err == nil {
		t.Error("DeleteWebAuthnRegistrationSession with nil api: expected error, got nil")
	}
}

func TestStoreWebAuthnRegistrationSession_SetError_Propagates(t *testing.T) {
	fake := newFake()
	fake.failSet = true
	c := newClient(fake)
	ctx := context.Background()

	if err := c.StoreWebAuthnRegistrationSession(ctx, "USER#123", &webauthn.SessionData{}); err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestDeleteWebAuthnRegistrationSession_DeleteOnEmptyStore_Succeeds(t *testing.T) {
	c := newClient(newFake())
	ctx := context.Background()

	if err := c.DeleteWebAuthnRegistrationSession(ctx, "USER#does-not-exist"); err != nil {
		t.Fatalf("expected nil error deleting non-existent session, got %v", err)
	}
}

// ── Unit Tests: Login session ────────────────────────────────────────────────

func sampleLoginSession() *WebAuthnLoginSession {
	return &WebAuthnLoginSession{
		SessionData: &webauthn.SessionData{
			Challenge:        "login-challenge-123",
			RelyingPartyID:   "example.com",
			UserVerification: protocol.VerificationRequired,
		},
		UserID: "USER#123",
		Email:  "user@example.com",
	}
}

func TestStoreAndGetWebAuthnLoginSession_RoundTrip(t *testing.T) {
	c := newClient(newFake())
	ctx := context.Background()

	session := sampleLoginSession()
	if err := c.StoreWebAuthnLoginSession(ctx, session.SessionData.Challenge, session); err != nil {
		t.Fatalf("StoreWebAuthnLoginSession: unexpected error: %v", err)
	}

	got, err := c.GetWebAuthnLoginSession(ctx, session.SessionData.Challenge)
	if err != nil {
		t.Fatalf("GetWebAuthnLoginSession: unexpected error: %v", err)
	}
	if got.UserID != session.UserID {
		t.Errorf("expected user ID %q, got %q", session.UserID, got.UserID)
	}
	if got.Email != session.Email {
		t.Errorf("expected email %q, got %q", session.Email, got.Email)
	}
	if got.SessionData == nil || got.SessionData.Challenge != session.SessionData.Challenge {
		t.Errorf("expected challenge %q, got %+v", session.SessionData.Challenge, got.SessionData)
	}
}

func TestGetWebAuthnLoginSession_MissingSession_ReturnsErrWebAuthnSessionNotFound(t *testing.T) {
	c := newClient(newFake())

	_, err := c.GetWebAuthnLoginSession(context.Background(), "does-not-exist")
	if !errors.Is(err, ErrWebAuthnSessionNotFound) {
		t.Fatalf("expected ErrWebAuthnSessionNotFound, got %v", err)
	}
}

func TestGetWebAuthnLoginSession_GetError_Propagates(t *testing.T) {
	fake := newFake()
	fake.failGet = true
	c := newClient(fake)

	_, err := c.GetWebAuthnLoginSession(context.Background(), "login-challenge-123")
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if errors.Is(err, ErrWebAuthnSessionNotFound) {
		t.Fatal("expected non-sentinel error for cache failure, got ErrWebAuthnSessionNotFound")
	}
}

func TestGetWebAuthnLoginSession_MalformedJSON_ReturnsError(t *testing.T) {
	fake := newFake()
	fake.store["webauthn:login:login-challenge-123"] = "not-json"
	c := newClient(fake)

	_, err := c.GetWebAuthnLoginSession(context.Background(), "login-challenge-123")
	if err == nil {
		t.Fatal("expected error for malformed session JSON, got nil")
	}
}

func TestDeleteWebAuthnLoginSession_RemovesSession(t *testing.T) {
	c := newClient(newFake())
	ctx := context.Background()

	session := sampleLoginSession()
	if err := c.StoreWebAuthnLoginSession(ctx, session.SessionData.Challenge, session); err != nil {
		t.Fatalf("StoreWebAuthnLoginSession: unexpected error: %v", err)
	}

	if err := c.DeleteWebAuthnLoginSession(ctx, session.SessionData.Challenge); err != nil {
		t.Fatalf("DeleteWebAuthnLoginSession: unexpected error: %v", err)
	}

	_, err := c.GetWebAuthnLoginSession(ctx, session.SessionData.Challenge)
	if !errors.Is(err, ErrWebAuthnSessionNotFound) {
		t.Fatalf("expected ErrWebAuthnSessionNotFound after delete, got %v", err)
	}
}

func TestStoreWebAuthnLoginSession_SetError_Propagates(t *testing.T) {
	fake := newFake()
	fake.failSet = true
	c := newClient(fake)

	if err := c.StoreWebAuthnLoginSession(context.Background(), "login-challenge-123", sampleLoginSession()); err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestWebAuthnLoginSession_NilCacheAPI_ReturnsError(t *testing.T) {
	c := NewFromOperations(nil)
	ctx := context.Background()

	if err := c.StoreWebAuthnLoginSession(ctx, "login-challenge-123", sampleLoginSession()); err == nil {
		t.Error("StoreWebAuthnLoginSession with nil api: expected error, got nil")
	}
	if _, err := c.GetWebAuthnLoginSession(ctx, "login-challenge-123"); err == nil {
		t.Error("GetWebAuthnLoginSession with nil api: expected error, got nil")
	}
	if err := c.DeleteWebAuthnLoginSession(ctx, "login-challenge-123"); err == nil {
		t.Error("DeleteWebAuthnLoginSession with nil api: expected error, got nil")
	}
}

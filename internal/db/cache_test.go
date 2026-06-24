package db

import (
	"context"
	"errors"
	"io"
	"strconv"
	"testing"
	"time"

	"github.com/rdevitto86/komodo-forge-sdk-go/testing/testutil"
)

// ── Setup ────────────────────────────────────────────────────────────────

type fakeCache struct {
	store      map[string]string
	failSet    bool
	failSetNX  bool
	failGet    bool
	failIncr   bool
	failExpire bool
	failDelete bool
}

func newFake() *fakeCache {
	return &fakeCache{store: make(map[string]string)}
}

func (f *fakeCache) Get(_ context.Context, key string) (string, error) {
	if f.failGet {
		return "", errors.New("get error")
	}
	return f.store[key], nil
}

func (f *fakeCache) Set(_ context.Context, key, value string, _ int64) error {
	if f.failSet {
		return errors.New("set error")
	}
	f.store[key] = value
	return nil
}

func (f *fakeCache) SetNX(_ context.Context, key, value string, _ int64) (bool, error) {
	if f.failSetNX {
		return false, errors.New("setnx error")
	}
	if _, exists := f.store[key]; exists {
		return false, nil
	}
	f.store[key] = value
	return true, nil
}

func (f *fakeCache) Delete(_ context.Context, key string) error {
	if f.failDelete {
		return errors.New("delete error")
	}
	delete(f.store, key)
	return nil
}

func (f *fakeCache) Exists(_ context.Context, key string) (bool, error) {
	if f.failGet {
		return false, errors.New("exists error")
	}
	_, ok := f.store[key]
	return ok, nil
}

func (f *fakeCache) Incr(_ context.Context, key string) (int64, error) {
	if f.failIncr {
		return 0, errors.New("incr error")
	}
	var n int64
	if raw, ok := f.store[key]; ok {
		parsed, err := strconv.ParseInt(raw, 10, 64)
		if err == nil {
			n = parsed
		}
	}
	n++
	f.store[key] = strconv.FormatInt(n, 10)
	return n, nil
}

func (f *fakeCache) Expire(_ context.Context, _ string, _ int64) error {
	if f.failExpire {
		return errors.New("expire error")
	}
	return nil
}

func newClient(fake *fakeCache) *CacheClient {
	return NewFromOperations(fake)
}

// ── Unit Tests ───────────────────────────────────────────────────────────────

func TestNewFromOperations_NilOps_ReturnsCacheClient(t *testing.T) {
	c := NewFromOperations(nil)
	if c == nil {
		t.Fatal("expected non-nil *CacheClient, got nil")
	}

	ctx := context.Background()
	if _, err := c.GenerateAndStoreOTP(ctx, "a@b.com"); err == nil {
		t.Error("GenerateAndStoreOTP with nil api: expected error, got nil")
	}
	if err := c.VerifyOTP(ctx, "a@b.com", "000000"); err == nil {
		t.Error("VerifyOTP with nil api: expected error, got nil")
	}
	if n, err := c.GetOTPAttempts(ctx, "a@b.com"); err != nil || n != 0 {
		t.Errorf("GetOTPAttempts with nil api: want (0, nil), got (%d, %v)", n, err)
	}
	if n, err := c.IncrOTPAttempts(ctx, "a@b.com"); err != nil || n != 0 {
		t.Errorf("IncrOTPAttempts with nil api: want (0, nil), got (%d, %v)", n, err)
	}
	c.DeleteOTPAttempts(ctx, "a@b.com") // must not panic
	if err := c.StoreRevoked(ctx, "jti-1", time.Minute); err != nil {
		t.Errorf("StoreRevoked with nil api: expected nil, got %v", err)
	}
	if revoked, err := c.IsRevoked(ctx, "jti-1"); err != nil || revoked {
		t.Errorf("IsRevoked with nil api: want (false, nil), got (%v, %v)", revoked, err)
	}
	if err := c.Reachable(ctx); err == nil {
		t.Error("Reachable with nil api: expected error, got nil")
	}
}

func TestNewFromOperations_WithFake_OTPRoundTrip(t *testing.T) {
	c := newClient(newFake())
	ctx := context.Background()

	code, err := c.GenerateAndStoreOTP(ctx, "user@example.com")
	if err != nil {
		t.Fatalf("GenerateAndStoreOTP: unexpected error: %v", err)
	}
	if len(code) != OTPCodeLen {
		t.Fatalf("expected %d-digit code, got %q", OTPCodeLen, code)
	}

	if err := c.VerifyOTP(ctx, "user@example.com", code); err != nil {
		t.Fatalf("VerifyOTP: unexpected error: %v", err)
	}
}

func TestGenerateAndStoreOTP_CooldownRejectsSecondCall(t *testing.T) {
	c := newClient(newFake())
	ctx := context.Background()

	if _, err := c.GenerateAndStoreOTP(ctx, "user@example.com"); err != nil {
		t.Fatalf("first GenerateAndStoreOTP: unexpected error: %v", err)
	}

	if _, err := c.GenerateAndStoreOTP(ctx, "user@example.com"); !errors.Is(err, ErrOTPCooldown) {
		t.Fatalf("second GenerateAndStoreOTP: expected ErrOTPCooldown, got %v", err)
	}
}

func TestAuthCode_StoreAndRetrieve(t *testing.T) {
	c := newClient(newFake())
	ctx := context.Background()

	entry := &AuthCodeEntry{
		ClientID:      "test-client",
		RedirectURI:   "https://example.com/cb",
		Scope:         "read",
		UserID:        "user-123",
		CodeChallenge: "challenge-value",
	}

	claimed, err := c.StoreAuthCode(ctx, "code-abc", entry)
	if err != nil {
		t.Fatalf("StoreAuthCode: unexpected error: %v", err)
	}
	if !claimed {
		t.Fatal("StoreAuthCode: expected claimed=true")
	}

	got, err := c.GetAuthCode(ctx, "code-abc")
	if err != nil {
		t.Fatalf("GetAuthCode: unexpected error: %v", err)
	}
	if got.ClientID != "test-client" {
		t.Errorf("expected client_id=%q, got %q", "test-client", got.ClientID)
	}
	if got.UserID != "user-123" {
		t.Errorf("expected user_id=%q, got %q", "user-123", got.UserID)
	}
	if got.CodeChallenge != "challenge-value" {
		t.Errorf("expected code_challenge=%q, got %q", "challenge-value", got.CodeChallenge)
	}
}

func TestAuthCode_DuplicateStore_ReturnsFalse(t *testing.T) {
	c := newClient(newFake())
	ctx := context.Background()

	entry := &AuthCodeEntry{
		ClientID:      "test-client",
		RedirectURI:   "https://example.com/cb",
		UserID:        "user-123",
		CodeChallenge: "challenge",
	}

	if _, err := c.StoreAuthCode(ctx, "dup-code", entry); err != nil {
		t.Fatalf("first StoreAuthCode: %v", err)
	}

	claimed, err := c.StoreAuthCode(ctx, "dup-code", entry)
	if err != nil {
		t.Fatalf("second StoreAuthCode: %v", err)
	}
	if claimed {
		t.Error("expected claimed=false for duplicate code")
	}
}

func TestAuthCode_GetNotFound_ReturnsError(t *testing.T) {
	c := newClient(newFake())
	ctx := context.Background()

	_, err := c.GetAuthCode(ctx, "nonexistent")
	if !errors.Is(err, ErrAuthCodeNotFound) {
		t.Errorf("expected ErrAuthCodeNotFound, got %v", err)
	}
}

func TestAuthCode_DeleteAndGet_ReturnsNotFound(t *testing.T) {
	c := newClient(newFake())
	ctx := context.Background()

	entry := &AuthCodeEntry{
		ClientID:      "test-client",
		RedirectURI:   "https://example.com/cb",
		UserID:        "user-123",
		CodeChallenge: "challenge",
	}

	if _, err := c.StoreAuthCode(ctx, "del-code", entry); err != nil {
		t.Fatalf("StoreAuthCode: %v", err)
	}

	if err := c.DeleteAuthCode(ctx, "del-code"); err != nil {
		t.Fatalf("DeleteAuthCode: %v", err)
	}

	_, err := c.GetAuthCode(ctx, "del-code")
	if !errors.Is(err, ErrAuthCodeNotFound) {
		t.Errorf("expected ErrAuthCodeNotFound after delete, got %v", err)
	}
}

func TestAuthCode_NilAPI_ReturnsError(t *testing.T) {
	c := NewFromOperations(nil)
	ctx := context.Background()

	entry := &AuthCodeEntry{ClientID: "c", UserID: "u", CodeChallenge: "ch"}

	if _, err := c.StoreAuthCode(ctx, "code", entry); err == nil {
		t.Error("StoreAuthCode with nil api: expected error")
	}
	if _, err := c.GetAuthCode(ctx, "code"); err == nil {
		t.Error("GetAuthCode with nil api: expected error")
	}
	if err := c.DeleteAuthCode(ctx, "code"); err == nil {
		t.Error("DeleteAuthCode with nil api: expected error")
	}
}

// ── Integration Tests ────────────────────────────────────────────────────────

func TestNew_MissingAddr_ReturnsError(t *testing.T) {
	testutil.Integration(t)
	_, err := New(CacheClientConfig{})
	if err == nil {
		t.Fatal("expected error when connecting with zero config, got nil")
	}
}

func TestNew_RealRedis_ReturnsClient(t *testing.T) {
	testutil.Integration(t)
	c := newIntegrationCacheClient(t)
	if c == nil {
		t.Fatal("expected non-nil *CacheClient")
	}
}

func TestReachable_RealRedis_ReturnsNil(t *testing.T) {
	testutil.Integration(t)
	c := newIntegrationCacheClient(t)

	if err := c.Reachable(context.Background()); err != nil {
		t.Fatalf("expected reachable redis, got error: %v", err)
	}
}

func TestReachable_ClosedRedis_ReturnsError(t *testing.T) {
	testutil.Integration(t)
	c := newIntegrationCacheClient(t)

	if api, ok := c.api.(io.Closer); ok {
		if err := api.Close(); err != nil {
			t.Fatalf("failed to close redis client: %v", err)
		}
	}

	if err := c.Reachable(context.Background()); err == nil {
		t.Fatal("expected error from closed redis connection, got nil")
	}
}

func TestOTPRoundTrip_RealRedis(t *testing.T) {
	testutil.Integration(t)
	c := newIntegrationCacheClient(t)
	ctx := context.Background()

	email := "integration-user@example.com"
	code, err := c.GenerateAndStoreOTP(ctx, email)
	if err != nil {
		t.Fatalf("GenerateAndStoreOTP: unexpected error: %v", err)
	}
	if len(code) != OTPCodeLen {
		t.Fatalf("expected %d-digit code, got %q", OTPCodeLen, code)
	}

	if err := c.VerifyOTP(ctx, email, code); err != nil {
		t.Fatalf("VerifyOTP: unexpected error: %v", err)
	}
}

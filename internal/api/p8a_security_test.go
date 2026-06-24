package api

import (
	"context"
	"net/http"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"komodo-auth-api/internal/db"
	"komodo-auth-api/internal/models"
	usermodels "komodo-auth-api/internal/models/user"
	"komodo-auth-api/internal/oauth"

	"github.com/rdevitto86/komodo-forge-sdk-go/testing/testutil"
)

// ── Component Tests: OTP single-use redemption (concurrent) ───────────────

func TestOTPVerifyHandler_Component_ConcurrentVerify_ExactlyOneSucceeds(t *testing.T) {
	testutil.Component(t)

	const (
		email       = "concurrent@example.com"
		code        = "999888"
		concurrency = 10
	)

	ec := &syncFakeEC{store: make(map[string]string)}
	ec.store["otp:"+email] = code

	httpClient := &fakeHttpClient{
		getUserCredsResult: &usermodels.CredentialsResponse{UserId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"},
	}

	svc := &Service{
		HttpClient:  httpClient,
		CacheClient: db.NewFromOperations(ec),
		JWT:         testKeys,
	}

	var (
		wg       sync.WaitGroup
		ok200    atomic.Int32
		rejected atomic.Int32
	)

	wg.Add(concurrency)
	start := make(chan struct{})

	for range concurrency {
		go func() {
			defer wg.Done()
			<-start
			rr := postRawOTPVerify(t, svc.OTPVerifyHandler, email, code)
			switch rr.Code {
			case http.StatusOK:
				ok200.Add(1)
			case http.StatusConflict, http.StatusUnauthorized:
				rejected.Add(1)
			}
		}()
	}

	close(start)
	wg.Wait()

	if ok200.Load() != 1 {
		t.Errorf("expected exactly 1 HTTP 200, got %d", ok200.Load())
	}
	if rejected.Load() != int32(concurrency-1) {
		t.Errorf("expected %d rejected requests (409 or 401), got %d", concurrency-1, rejected.Load())
	}
}

// ── Component Tests: Passkey refresh on USER audience ───────────────────────

func TestOAuthTokenHandler_Component_RefreshToken_PasskeyUserAudience_ServiceOnlyClient(t *testing.T) {
	testutil.Component(t)

	const userUUID = "550e8400-e29b-41d4-a716-446655440000"
	refreshTok := makeAZPRefreshToken(t, userUUID, "komodo-apis:user", "test-client")

	serviceOnlyRegistry, err := oauth.NewRegistry(`{"test-client":{"name":"Test","secret_hash":"9caf06bb4436cdbfa20af9121a626bc1093c4f54b31c0fa937957856135345b6","allowed_scopes":["read","write"],"allowed_audiences":["komodo-apis:service"]}}`)
	if err != nil {
		t.Fatalf("failed to create service-only registry: %v", err)
	}

	svc := &Service{
		CacheClient:    db.NewFromOperations(newFakeEC()),
		JWT:            testKeys,
		ClientRegistry: serviceOnlyRegistry,
	}

	rr := postJSON(t, svc.OAuthTokenHandler, models.TokenRequest{
		GrantType:    models.TokenRequestGrantTypeRefreshToken,
		ClientId:     "test-client",
		ClientSecret: "test-secret",
		RefreshToken: &refreshTok,
	})
	checkStatus(t, rr, http.StatusOK)

	resp := decodeJSON[models.TokenResponse](t, rr)
	accessClaims, err := testKeys.ParseClaims(resp.AccessToken)
	if err != nil {
		t.Fatalf("failed to parse access token: %v", err)
	}

	if accessClaims.Subject != userUUID {
		t.Errorf("access token sub = %q, want %q", accessClaims.Subject, userUUID)
	}

	for _, sc := range accessClaims.Scopes {
		if strings.HasPrefix(sc, "svc:") {
			t.Errorf("user-session refresh must not carry svc: scope, got %q", sc)
		}
	}

	if !slices.Contains(accessClaims.Scopes, "passkey:verified") {
		t.Errorf("user-session refresh must retain passkey:verified scope, got %v", accessClaims.Scopes)
	}
}

func TestOAuthTokenHandler_Component_RefreshToken_M2MAudience_StillEnforced(t *testing.T) {
	testutil.Component(t)

	m2mTok := makeAZPRefreshToken(t, "test-client", "komodo-apis:special", "test-client")

	serviceOnlyRegistry, err := oauth.NewRegistry(`{"test-client":{"name":"Test","secret_hash":"9caf06bb4436cdbfa20af9121a626bc1093c4f54b31c0fa937957856135345b6","allowed_scopes":["read","write"],"allowed_audiences":["komodo-apis:service"]}}`)
	if err != nil {
		t.Fatalf("failed to create service-only registry: %v", err)
	}

	svc := &Service{
		CacheClient:    db.NewFromOperations(newFakeEC()),
		JWT:            testKeys,
		ClientRegistry: serviceOnlyRegistry,
	}

	rr := postJSON(t, svc.OAuthTokenHandler, models.TokenRequest{
		GrantType:    models.TokenRequestGrantTypeRefreshToken,
		ClientId:     "test-client",
		ClientSecret: "test-secret",
		RefreshToken: &m2mTok,
	})
	checkStatus(t, rr, http.StatusBadRequest)
}

// ── Component Tests: Passkey-refresh scope retention ────────────────────────

func TestOAuthTokenHandler_Component_PasskeyRefresh_NoSvcScope_RetainsPasskeyVerified(t *testing.T) {
	testutil.Component(t)

	const userUUID = "550e8400-e29b-41d4-a716-446655440000"
	ec := newFakeEC()
	refreshTok := makeAZPRefreshToken(t, userUUID, "komodo-apis:user", "test-client")

	svc := &Service{
		CacheClient:    db.NewFromOperations(ec),
		JWT:            testKeys,
		ClientRegistry: testRegistry,
	}

	rr := postJSON(t, svc.OAuthTokenHandler, models.TokenRequest{
		GrantType:    models.TokenRequestGrantTypeRefreshToken,
		ClientId:     "test-client",
		ClientSecret: "test-secret",
		RefreshToken: &refreshTok,
	})
	checkStatus(t, rr, http.StatusOK)

	resp := decodeJSON[models.TokenResponse](t, rr)
	accessClaims, err := testKeys.ParseClaims(resp.AccessToken)
	if err != nil {
		t.Fatalf("failed to parse access token: %v", err)
	}

	for _, sc := range accessClaims.Scopes {
		if strings.HasPrefix(sc, "svc:") {
			t.Errorf("passkey-refreshed access token must not carry svc: scope, got %q", sc)
		}
	}

	if !slices.Contains(accessClaims.Scopes, "passkey:verified") {
		t.Errorf("passkey-refreshed access token must retain passkey:verified, got %v", accessClaims.Scopes)
	}
}

// ── Component Tests: OTP code not in response body ──────────────────────────

func TestOTPRequestHandler_Component_OTPCodeNotInResponseBody(t *testing.T) {
	testutil.Component(t)

	ec := newFakeEC()
	svc := &Service{
		HttpClient:  &fakeHttpClient{},
		CacheClient: db.NewFromOperations(ec),
		JWT:         testKeys,
	}

	rr := postRawOTPRequest(t, svc.OTPRequestHandler, "logtest@example.com")
	checkStatus(t, rr, http.StatusOK)

	stored := ec.store["otp:logtest@example.com"]
	if stored == "" {
		t.Fatal("expected OTP to be stored")
	}

	body := rr.Body.String()
	if strings.Contains(body, stored) {
		t.Errorf("response body must not contain the raw OTP code %q", stored)
	}
}

// ── Fake: thread-safe CacheClientCallers ────────────────────────────────────

type syncFakeEC struct {
	mu    sync.Mutex
	store map[string]string
}

func (f *syncFakeEC) Get(_ context.Context, key string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.store[key], nil
}

func (f *syncFakeEC) Set(_ context.Context, key, value string, _ int64) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.store[key] = value
	return nil
}

func (f *syncFakeEC) SetNX(_ context.Context, key, value string, _ int64) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if _, exists := f.store[key]; exists {
		return false, nil
	}
	f.store[key] = value
	return true, nil
}

func (f *syncFakeEC) Delete(_ context.Context, key string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.store, key)
	return nil
}

func (f *syncFakeEC) Incr(_ context.Context, key string) (int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.store[key] = "1"
	return 1, nil
}

func (f *syncFakeEC) Expire(_ context.Context, _ string, _ int64) error {
	return nil
}

func (f *syncFakeEC) Exists(_ context.Context, key string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	_, ok := f.store[key]
	return ok, nil
}

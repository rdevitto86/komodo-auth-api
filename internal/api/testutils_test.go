package api

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"testing"
	"time"

	"komodo-auth-api/internal/clients"
	"komodo-auth-api/internal/db"
	authjwt "komodo-auth-api/internal/jwt"
	commsmodels "komodo-auth-api/internal/models/comms"
	usermodels "komodo-auth-api/internal/models/user"
	"komodo-auth-api/internal/oauth"

	secAuth "github.com/rdevitto86/komodo-forge-sdk-go/security/oauth"
)

// ── Test lifecycle ───────────────────────────────────────────────────────────

var testKeys *authjwt.Keys
var testRegistry *oauth.Registry

func TestMain(m *testing.M) {
	privKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		panic("failed to generate RSA key: " + err.Error())
	}

	privDER, err := x509.MarshalPKCS8PrivateKey(privKey)
	if err != nil {
		panic("failed to marshal private key: " + err.Error())
	}
	pubDER, err := x509.MarshalPKIXPublicKey(&privKey.PublicKey)
	if err != nil {
		panic("failed to marshal public key: " + err.Error())
	}

	testKeys, err = authjwt.New(authjwt.Config{
		PrivateKeyPEM: string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: privDER})),
		PublicKeyPEM:  string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pubDER})),
		KID:           "test-kid",
		Issuer:        "test-issuer",
		Audience:      "test-audience",
	})
	if err != nil {
		panic("failed to initialise JWT keys: " + err.Error())
	}

	const registry = `{"test-client":{"name":"Test","secret_hash":"9caf06bb4436cdbfa20af9121a626bc1093c4f54b31c0fa937957856135345b6","allowed_scopes":["read","write"],"allowed_audiences":["komodo-apis:service","komodo-apis:user"],"allowed_redirect_uris":["https://example.com/cb"]}}`
	testRegistry, err = oauth.NewRegistry(registry)
	if err != nil {
		panic("failed to load client registry: " + err.Error())
	}

	os.Exit(m.Run())
}

// ── Service builder ──────────────────────────────────────────────────────────

func srv() *Service {
	return &Service{
		CacheClient:    db.NewFromOperations(nil),
		JWT:            testKeys,
		ClientRegistry: testRegistry,
		ScopeValidator: secAuth.New(secAuth.Config{}),
	}
}

// ── Request helpers ──────────────────────────────────────────────────────────

type handlerFn = func(http.ResponseWriter, *http.Request)

func postJSON(t *testing.T, handler handlerFn, body any) *httptest.ResponseRecorder {
	t.Helper()
	b, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("postJSON: marshal: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	handler(rr, req)
	return rr
}

func getWithQuery(t *testing.T, handler handlerFn, query string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/?"+query, nil)
	rr := httptest.NewRecorder()
	handler(rr, req)
	return rr
}

func checkStatus(t *testing.T, rr *httptest.ResponseRecorder, want int) {
	t.Helper()
	if rr.Code != want {
		t.Errorf("expected HTTP %d, got %d; body: %s", want, rr.Code, rr.Body.String())
	}
}

func decodeJSON[T any](t *testing.T, rr *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.NewDecoder(rr.Body).Decode(&v); err != nil {
		t.Fatalf("decodeJSON: %v\nbody: %s", err, rr.Body.String())
	}
	return v
}

func makeValidToken(t *testing.T) string {
	t.Helper()
	tok, err := testKeys.SignToken("test-issuer", "test-subject", "test-audience", 3600, []string{"read"})
	if err != nil {
		t.Fatalf("makeValidToken: %v", err)
	}
	return tok
}

// ── Fake: HttpClientCallers ──────────────────────────────────────────────────

type fakeHttpClient struct {
	sendEmailErr       error
	sendEmailCalls     int
	getUserCredsResult *usermodels.CredentialsResponse
	getUserCredsErr    error
	getUserByIDResult  *usermodels.User
	getUserByIDErr     error
	getUserByIDCalls   int
	listPasskeysResult []clients.PasskeyCredentialDescriptor
	listPasskeysErr    error
	createPasskeyErr   error
	createdPasskey     *clients.PasskeyCredentialDescriptor
	updatePasskeyErr   error
	updatedPasskey     *clients.PasskeyCredentialDescriptor
}

func (f *fakeHttpClient) SendEmail(_ context.Context, _ commsmodels.SendEmailJSONRequestBody) error {
	f.sendEmailCalls++
	return f.sendEmailErr
}

func (f *fakeHttpClient) GetUserCredentials(_ context.Context, _, _ string) (*usermodels.CredentialsResponse, error) {
	return f.getUserCredsResult, f.getUserCredsErr
}

func (f *fakeHttpClient) GetUserByID(_ context.Context, _, _ string) (*usermodels.User, error) {
	f.getUserByIDCalls++
	return f.getUserByIDResult, f.getUserByIDErr
}

func (f *fakeHttpClient) ListPasskeyCredentials(_ context.Context, _, _ string) ([]clients.PasskeyCredentialDescriptor, error) {
	return f.listPasskeysResult, f.listPasskeysErr
}

func (f *fakeHttpClient) CreatePasskeyCredential(_ context.Context, _, _ string, cred clients.PasskeyCredentialDescriptor) error {
	if f.createPasskeyErr != nil {
		return f.createPasskeyErr
	}
	f.createdPasskey = &cred
	return nil
}

func (f *fakeHttpClient) UpdatePasskeyCredential(_ context.Context, _, _ string, cred clients.PasskeyCredentialDescriptor) error {
	if f.updatePasskeyErr != nil {
		return f.updatePasskeyErr
	}
	f.updatedPasskey = &cred
	return nil
}

// ── Fake: CacheClientCallers ─────────────────────────────────────────────────

type fakeEC struct {
	store  map[string]string
	setErr error
	getErr error
	delErr error
}

func newFakeEC() *fakeEC { return &fakeEC{store: make(map[string]string)} }

func (f *fakeEC) Get(_ context.Context, key string) (string, error) {
	if f.getErr != nil {
		return "", f.getErr
	}
	return f.store[key], nil
}

func (f *fakeEC) Set(_ context.Context, key, value string, _ int64) error {
	if f.setErr != nil {
		return f.setErr
	}
	f.store[key] = value
	return nil
}

func (f *fakeEC) SetNX(_ context.Context, key, value string, _ int64) (bool, error) {
	if f.setErr != nil {
		return false, f.setErr
	}
	if _, exists := f.store[key]; exists {
		return false, nil
	}
	f.store[key] = value
	return true, nil
}

func (f *fakeEC) Delete(_ context.Context, key string) error {
	if f.delErr != nil {
		return f.delErr
	}
	delete(f.store, key)
	return nil
}

func (f *fakeEC) Incr(_ context.Context, key string) (int64, error) {
	var n int64
	if raw, ok := f.store[key]; ok {
		if parsed, err := strconv.ParseInt(raw, 10, 64); err == nil {
			n = parsed
		}
	}
	n++
	f.store[key] = strconv.FormatInt(n, 10)
	return n, nil
}

func (f *fakeEC) Expire(_ context.Context, _ string, _ int64) error { return nil }

func (f *fakeEC) Exists(_ context.Context, key string) (bool, error) {
	_, ok := f.store[key]
	return ok, nil
}

func (f *fakeEC) Close() error { return nil }

func (f *fakeEC) AllowDistributed(_ context.Context, _ string, _, _ float64, _ int) (bool, time.Duration, error) {
	return true, 0, nil
}

// ── Fake: keyPrefixErrEC ─────────────────────────────────────────────────────

type keyPrefixErrEC struct {
	fakeEC
	errPrefix string
	prefixErr error
}

func (f *keyPrefixErrEC) Get(ctx context.Context, key string) (string, error) {
	if f.errPrefix != "" && len(key) >= len(f.errPrefix) && key[:len(f.errPrefix)] == f.errPrefix {
		return "", f.prefixErr
	}
	return f.fakeEC.Get(ctx, key)
}

// ── Fake: BannedChecker ──────────────────────────────────────────────────────

type fakeBannedChecker struct {
	banned bool
	err    error
}

func (f *fakeBannedChecker) IsBanned(_ context.Context, _ string) (bool, error) {
	return f.banned, f.err
}

// ── Fake: failingSignAuthority ──────────────────────────────────────────────

type failingSignAuthority struct {
	base      TokenAuthority
	callCount int
	failAfter int
}

func (f *failingSignAuthority) SignToken(issuer, subject, audience string, ttl int64, scopes []string) (string, error) {
	f.callCount++
	if f.callCount > f.failAfter {
		return "", fmt.Errorf("forced sign failure")
	}
	return f.base.SignToken(issuer, subject, audience, ttl, scopes)
}

func (f *failingSignAuthority) SignTokenWithAZP(issuer, subject, audience, azp string, ttl int64, scopes []string) (string, error) {
	return "", fmt.Errorf("forced sign failure")
}

func (f *failingSignAuthority) SignRefreshToken(issuer, subject, audience, azp, familyID string, ttl int64, scopes []string) (string, error) {
	return "", fmt.Errorf("forced sign failure")
}

func (f *failingSignAuthority) ValidateAndParseClaims(token string) (*authjwt.CustomClaims, error) {
	return f.base.ValidateAndParseClaims(token)
}

func (f *failingSignAuthority) ParseClaims(token string) (*authjwt.CustomClaims, error) {
	return f.base.ParseClaims(token)
}

func (f *failingSignAuthority) VerificationKeys() []authjwt.VerificationKey {
	return f.base.VerificationKeys()
}

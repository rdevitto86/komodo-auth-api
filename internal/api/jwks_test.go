package api

import (
	"crypto/rand"
	"crypto/rsa"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	authjwt "komodo-auth-api/internal/jwt"
	"komodo-auth-api/internal/models"

	"github.com/rdevitto86/komodo-forge-sdk-go/testing/testutil"
)

type fakeAuthority struct{ keys []authjwt.VerificationKey }

func (f *fakeAuthority) SignToken(string, string, string, int64, []string) (string, error) {
	return "", nil
}
func (f *fakeAuthority) SignTokenWithAZP(string, string, string, string, int64, []string) (string, error) {
	return "", nil
}
func (f *fakeAuthority) SignRefreshToken(string, string, string, string, string, int64, []string) (string, error) {
	return "", nil
}
func (f *fakeAuthority) ValidateAndParseClaims(string) (*authjwt.CustomClaims, error) {
	return nil, nil
}
func (f *fakeAuthority) ParseClaims(string) (*authjwt.CustomClaims, error) { return nil, nil }
func (f *fakeAuthority) VerificationKeys() []authjwt.VerificationKey       { return f.keys }

// ── Unit Tests ───────────────────────────────────────────────────────────────

func TestJWKSHandler_NoAuthority_ReturnsError(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/.well-known/jwks.json", nil)
	rr := httptest.NewRecorder()
	(&Service{}).JWKSHandler(rr, req)

	if rr.Code >= 200 && rr.Code < 300 {
		t.Errorf("expected non-2xx when token authority is nil, got %d; body: %s", rr.Code, rr.Body.String())
	}
}

func TestJWKSHandler_SetsShortCacheControl(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/.well-known/jwks.json", nil)
	rr := httptest.NewRecorder()
	(&Service{JWT: testKeys}).JWKSHandler(rr, req)

	if got := rr.Header().Get("Cache-Control"); got != "public, max-age=300" {
		t.Errorf("expected Cache-Control %q, got %q", "public, max-age=300", got)
	}
}

func TestCachedJWKSBody_SameKidSet_ReturnsSameBytes(t *testing.T) {
	first, err := cachedJWKSBody(testKeys)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	second, err := cachedJWKSBody(testKeys)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if string(first) != string(second) {
		t.Errorf("expected cached body to be reused for an unchanged kid set, got different bytes")
	}
}

func TestCachedJWKSBody_KidSetChanged_Rebuilds(t *testing.T) {
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}

	first, err := cachedJWKSBody(&fakeAuthority{keys: []authjwt.VerificationKey{
		{Kid: "kid-a", Key: &priv.PublicKey},
	}})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	second, err := cachedJWKSBody(&fakeAuthority{keys: []authjwt.VerificationKey{
		{Kid: "kid-b", Key: &priv.PublicKey},
	}})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if string(first) == string(second) {
		t.Errorf("expected cached body to rebuild when the kid set changes")
	}
	if !strings.Contains(string(second), "kid-b") {
		t.Errorf("expected rebuilt body to contain new kid, got: %s", second)
	}
}

func TestBuildJWKS_BuildsRSAEntry(t *testing.T) {
	payload := buildJWKS(testKeys)
	if payload == nil || len(payload.Keys) == 0 {
		t.Fatal("expected buildJWKS to populate at least one JWK")
	}

	key := payload.Keys[0]
	if key.Kty != "RSA" {
		t.Errorf("expected kty=RSA, got %q", key.Kty)
	}
	if key.Alg != "RS256" {
		t.Errorf("expected alg=RS256, got %q", key.Alg)
	}
	if key.Kid != "test-kid" {
		t.Errorf("expected kid=test-kid, got %q", key.Kid)
	}
	if key.N == "" || key.E == "" {
		t.Error("expected non-empty N and E in JWK")
	}
}

func TestBuildJWKS_RotationOverlap_PublishesBothKids(t *testing.T) {
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	auth := &fakeAuthority{keys: []authjwt.VerificationKey{
		{Kid: "current", Key: &priv.PublicKey},
		{Kid: "previous", Key: &priv.PublicKey},
	}}

	payload := buildJWKS(auth)
	if len(payload.Keys) != 2 {
		t.Fatalf("expected JWKS to publish both keys during overlap, got %d", len(payload.Keys))
	}
	if payload.Keys[0].Kid != "current" || payload.Keys[1].Kid != "previous" {
		t.Errorf("expected kids [current, previous], got [%s, %s]", payload.Keys[0].Kid, payload.Keys[1].Kid)
	}
	for _, k := range payload.Keys {
		if k.N == "" || k.E == "" {
			t.Errorf("kid %s: expected non-empty N and E", k.Kid)
		}
	}
}

// ── Component Tests ──────────────────────────────────────────────────────────

func TestJWKSHandler_Component_CachePopulated_ReturnsKeys(t *testing.T) {
	testutil.Component(t)

	req := httptest.NewRequest(http.MethodGet, "/.well-known/jwks.json", nil)
	rr := httptest.NewRecorder()
	srv().JWKSHandler(rr, req)
	checkStatus(t, rr, http.StatusOK)

	resp := decodeJSON[models.JWKS](t, rr)
	if len(resp.Keys) == 0 {
		t.Error("expected at least one key in JWKS response")
	}
}

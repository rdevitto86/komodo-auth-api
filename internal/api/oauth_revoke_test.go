package api

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"komodo-auth-api/internal/db"
	"komodo-auth-api/internal/models"
	"komodo-auth-api/internal/oauth"

	"github.com/rdevitto86/komodo-forge-sdk-go/testing/testutil"
)

func strPtr(s string) *string { return &s }

func postRevokeWithBasicAuth(t *testing.T, body models.RevokeRequest, clientID, clientSecret string) *httptest.ResponseRecorder {
	t.Helper()
	b, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("postRevokeWithBasicAuth: marshal: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	creds := base64.StdEncoding.EncodeToString([]byte(clientID + ":" + clientSecret))
	req.Header.Set("Authorization", "Basic "+creds)
	rr := httptest.NewRecorder()
	srv().OAuthRevokeHandler(rr, req)
	return rr
}

func postRevokeWithBodyCreds(t *testing.T, token, clientID, clientSecret string) *httptest.ResponseRecorder {
	t.Helper()
	return postJSON(t, srv().OAuthRevokeHandler, models.RevokeRequest{
		Token:        token,
		ClientId:     &clientID,
		ClientSecret: &clientSecret,
	})
}

// ── Unit Tests: OAuthRevokeHandler ───────────────────────────────────────────

func TestOAuthRevokeHandler_Unit(t *testing.T) {
	t.Run("BadJSON_Returns400", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader("not-json"))
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()
		srv().OAuthRevokeHandler(rr, req)
		checkStatus(t, rr, http.StatusBadRequest)
	})

	t.Run("MissingClientAuth_Returns401", func(t *testing.T) {
		rr := postJSON(t, srv().OAuthRevokeHandler, models.RevokeRequest{Token: "some.token.value"})
		checkStatus(t, rr, http.StatusUnauthorized)
	})

	rejections := []struct {
		name         string
		token        string
		clientID     string
		clientSecret string
		wantStatus   int
	}{
		{"EmptyToken_Returns400", "", "test-client", "test-secret", http.StatusBadRequest},
		{"InvalidClientSecret_Returns401", "some.token.value", "test-client", "wrong-secret", http.StatusUnauthorized},
		{"UnknownClient_Returns401", "some.token.value", "no-such-client", "any-secret", http.StatusUnauthorized},
	}
	for _, tc := range rejections {
		t.Run(tc.name, func(t *testing.T) {
			rr := postRevokeWithBodyCreds(t, tc.token, tc.clientID, tc.clientSecret)
			checkStatus(t, rr, tc.wantStatus)
		})
	}

	t.Run("UnparseableToken_Returns200", func(t *testing.T) {
		rr := postRevokeWithBodyCreds(t, "not.a.valid.jwt", "test-client", "test-secret")
		checkStatus(t, rr, http.StatusOK)

		type revokeResp struct {
			Revoked bool `json:"revoked"`
		}
		resp := decodeJSON[revokeResp](t, rr)
		if !resp.Revoked {
			t.Error("expected revoked=true for invalid token (RFC 7009)")
		}
	})

	t.Run("BasicAuth_UnparseableToken_Returns200", func(t *testing.T) {
		rr := postRevokeWithBasicAuth(t, models.RevokeRequest{Token: "not.a.valid.jwt"}, "test-client", "test-secret")
		checkStatus(t, rr, http.StatusOK)
	})

	t.Run("ExpiredToken_Returns200", func(t *testing.T) {
		tok, err := testKeys.SignToken("test-issuer", "test-subject", "test-audience", -60, []string{})
		if err != nil {
			t.Fatalf("failed to sign token: %v", err)
		}
		rr := postRevokeWithBodyCreds(t, tok, "test-client", "test-secret")
		checkStatus(t, rr, http.StatusOK)

		type revokeResp struct {
			Revoked bool `json:"revoked"`
		}
		resp := decodeJSON[revokeResp](t, rr)
		if !resp.Revoked {
			t.Error("expected revoked=true for expired token")
		}
	})

	t.Run("ServiceToken_OwnClientCanRevoke", func(t *testing.T) {
		tok, err := testKeys.SignToken("test-issuer", "test-client", "komodo-apis:service", 3600, []string{})
		if err != nil {
			t.Fatalf("failed to sign token: %v", err)
		}
		rr := postRevokeWithBodyCreds(t, tok, "test-client", "test-secret")
		checkStatus(t, rr, http.StatusOK)
	})

	t.Run("CrossClientRevocation_Returns403", func(t *testing.T) {
		testutil.Component(t)

		otherRegistry, err := oauth.NewRegistry(`{"test-client":{"name":"Test","secret_hash":"9caf06bb4436cdbfa20af9121a626bc1093c4f54b31c0fa937957856135345b6","allowed_scopes":["read","write"],"allowed_audiences":["komodo-apis:service"]},"other-client":{"name":"Other","secret_hash":"abc","allowed_scopes":["read"],"allowed_audiences":["komodo-apis:service"]}}`)
		if err != nil {
			t.Fatalf("failed to create multi-client registry: %v", err)
		}
		svc := &Service{
			CacheClient:    db.NewFromOperations(newFakeEC()),
			JWT:            testKeys,
			ClientRegistry: otherRegistry,
		}

		tok, err := testKeys.SignToken("test-issuer", "other-client", "komodo-apis:service", 3600, []string{})
		if err != nil {
			t.Fatalf("failed to sign token for other-client: %v", err)
		}

		rr := postJSON(t, svc.OAuthRevokeHandler, models.RevokeRequest{
			Token:        tok,
			ClientId:     strPtr("test-client"),
			ClientSecret: strPtr("test-secret"),
		})
		checkStatus(t, rr, http.StatusForbidden)
	})
}

// ── Component Tests: OAuthRevokeHandler JTI ──────────────────────────────────

func srvWithFakeTokenStore(ec *fakeEC) *Service {
	return &Service{
		CacheClient:    db.NewFromOperations(ec),
		JWT:            testKeys,
		ClientRegistry: testRegistry,
	}
}

func postRevokeWithSrv(t *testing.T, svc *Service, token, clientID, clientSecret string) *httptest.ResponseRecorder {
	t.Helper()
	return postJSON(t, svc.OAuthRevokeHandler, models.RevokeRequest{
		Token:        token,
		ClientId:     &clientID,
		ClientSecret: &clientSecret,
	})
}

func TestOAuthRevokeHandler_Component_JTI(t *testing.T) {
	t.Run("SuccessfulRevoke_WritesToCache", func(t *testing.T) {
		ec := newFakeEC()
		svc := srvWithFakeTokenStore(ec)

		tok, err := testKeys.SignToken("test-issuer", "test-subject", "test-audience", 3600, []string{"read"})
		if err != nil {
			t.Fatalf("failed to sign token: %v", err)
		}
		claims, _ := testKeys.ParseClaims(tok)

		rr := postRevokeWithSrv(t, svc, tok, "test-client", "test-secret")
		checkStatus(t, rr, http.StatusOK)

		key := "revoked:jti:" + claims.ID
		if _, ok := ec.store[key]; !ok {
			t.Errorf("expected JTI %q to be written to cache, but it was not found", claims.ID)
		}
	})

	t.Run("DoubleRevoke_IsIdempotent", func(t *testing.T) {
		ec := newFakeEC()
		svc := srvWithFakeTokenStore(ec)

		tok, err := testKeys.SignToken("test-issuer", "test-subject", "test-audience", 3600, []string{"read"})
		if err != nil {
			t.Fatalf("failed to sign token: %v", err)
		}

		rr1 := postRevokeWithSrv(t, svc, tok, "test-client", "test-secret")
		checkStatus(t, rr1, http.StatusOK)

		rr2 := postRevokeWithSrv(t, svc, tok, "test-client", "test-secret")
		checkStatus(t, rr2, http.StatusOK)

		type revokeResp struct {
			Revoked bool `json:"revoked"`
		}
		resp := decodeJSON[revokeResp](t, rr2)
		if !resp.Revoked {
			t.Error("expected revoked=true on double-revoke")
		}
	})

	t.Run("AlreadyExpiredToken_NoopNoCache", func(t *testing.T) {
		ec := newFakeEC()
		svc := srvWithFakeTokenStore(ec)

		tok, err := testKeys.SignToken("test-issuer", "test-subject", "test-audience", -60, []string{})
		if err != nil {
			t.Fatalf("failed to sign token: %v", err)
		}

		rr := postRevokeWithSrv(t, svc, tok, "test-client", "test-secret")
		checkStatus(t, rr, http.StatusOK)

		if len(ec.store) != 0 {
			t.Errorf("expected no cache writes for already-expired token, got %v", ec.store)
		}
	})

	t.Run("CacheWriteFailure_Returns500", func(t *testing.T) {
		ec := newFakeEC()
		ec.setErr = errors.New("redis: connection refused")
		svc := srvWithFakeTokenStore(ec)

		tok, err := testKeys.SignToken("test-issuer", "test-subject", "test-audience", 3600, []string{"read"})
		if err != nil {
			t.Fatalf("failed to sign token: %v", err)
		}

		rr := postRevokeWithSrv(t, svc, tok, "test-client", "test-secret")
		checkStatus(t, rr, http.StatusInternalServerError)
	})
}

// ── Integration Tests: OAuthRevokeHandler ────────────────────────────────────

func TestOAuthRevokeHandler_Integration_ValidUnexpiredToken_Revoked(t *testing.T) {
	testutil.Integration(t)

	tok, err := testKeys.SignToken("test-issuer", "test-subject", "test-audience", 3600, []string{"read"})
	if err != nil {
		t.Fatalf("failed to sign token: %v", err)
	}

	rr := postRevokeWithBodyCreds(t, tok, "test-client", "test-secret")
	checkStatus(t, rr, http.StatusOK)

	type revokeResp struct {
		Revoked   bool  `json:"revoked"`
		RevokedAt int64 `json:"revoked_at"`
	}
	resp := decodeJSON[revokeResp](t, rr)
	if !resp.Revoked {
		t.Error("expected revoked=true for valid unexpired token")
	}
	if resp.RevokedAt <= 0 {
		t.Error("expected non-zero revoked_at timestamp")
	}
}

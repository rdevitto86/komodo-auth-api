package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"komodo-auth-api/internal/models"

	"github.com/rdevitto86/komodo-forge-sdk-go/testing/testutil"
)

// ── Unit Tests ───────────────────────────────────────────────────────────────

func TestOAuthIntrospectHandler_BadJSON(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader("bad-json"))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv().OAuthIntrospectHandler(rr, req)
	checkStatus(t, rr, http.StatusBadRequest)
}

func TestOAuthIntrospectHandler_EmptyToken(t *testing.T) {
	rr := postJSON(t, srv().OAuthIntrospectHandler, models.IntrospectRequest{Token: ""})
	checkStatus(t, rr, http.StatusBadRequest)
}

func TestOAuthIntrospectHandler_UnparseableToken_ActiveFalse(t *testing.T) {
	rr := postJSON(t, srv().OAuthIntrospectHandler, models.IntrospectRequest{Token: "not.a.jwt"})
	checkStatus(t, rr, http.StatusOK)

	resp := decodeJSON[models.IntrospectResponse](t, rr)
	if resp.Active {
		t.Error("expected active=false for unparseable token")
	}
}

// ── Component Tests ──────────────────────────────────────────────────────────

func TestOAuthIntrospectHandler_Component_ValidToken_ActiveTrue(t *testing.T) {
	testutil.Component(t)
	tok := makeValidToken(t)
	rr := postJSON(t, srv().OAuthIntrospectHandler, models.IntrospectRequest{Token: tok})
	checkStatus(t, rr, http.StatusOK)

	resp := decodeJSON[models.IntrospectResponse](t, rr)
	if !resp.Active {
		t.Errorf("expected active=true for valid JWT, got active=false; body: %s", rr.Body.String())
	}
	if resp.Sub == nil || *resp.Sub == "" {
		t.Error("expected non-empty sub in introspect response")
	}
}

// ── Integration Tests ────────────────────────────────────────────────────────

func TestOAuthIntrospectHandler_Integration_RevokedToken_ActiveFalse(t *testing.T) {
	testutil.Integration(t)

	redisAddr := startRedisContainer(t)
	cache := newCacheFromAddr(t, redisAddr)

	uStub := customerAPIStub(t, "d4e5f6a7-b8c9-0123-def0-123456789014")
	defer uStub.Close()
	cStub := commsStub(t)
	defer cStub.Close()

	svc := srvIntegration(t, cache, nil, uStub.URL, cStub.URL)

	tok := makeValidToken(t)

	revokeRR := postRevokeWithSrv(t, svc, tok, "test-client", "test-secret")
	checkStatus(t, revokeRR, http.StatusOK)

	introspectRR := postJSON(t, svc.OAuthIntrospectHandler, models.IntrospectRequest{Token: tok})
	checkStatus(t, introspectRR, http.StatusOK)

	resp := decodeJSON[models.IntrospectResponse](t, introspectRR)
	if resp.Active {
		t.Error("expected active=false for revoked token, got active=true")
	}
}

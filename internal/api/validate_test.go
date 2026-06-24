package api

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"komodo-auth-api/internal/db"
	"komodo-auth-api/internal/models"

	gojwt "github.com/golang-jwt/jwt/v5"
	"github.com/rdevitto86/komodo-forge-sdk-go/testing/testutil"
)

// ── Unit Tests ───────────────────────────────────────────────────────────────

func TestValidateTokenHandler_BadJSON(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader("not-json"))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv().ValidateTokenHandler(rr, req)
	checkStatus(t, rr, http.StatusOK)

	resp := decodeJSON[models.ValidateResponse](t, rr)
	if resp.Valid {
		t.Error("expected valid=false for bad JSON body")
	}
	if resp.Error == nil || *resp.Error == "" {
		t.Error("expected non-empty error message")
	}
}

func TestValidateTokenHandler_EmptyToken(t *testing.T) {
	rr := postJSON(t, srv().ValidateTokenHandler, models.ValidateRequest{Token: ""})
	checkStatus(t, rr, http.StatusOK)

	resp := decodeJSON[models.ValidateResponse](t, rr)
	if resp.Valid {
		t.Error("expected valid=false for empty token")
	}
	if resp.Error == nil || *resp.Error == "" {
		t.Error("expected non-empty error message for empty token")
	}
}

func TestValidateTokenHandler_InvalidToken(t *testing.T) {
	rr := postJSON(t, srv().ValidateTokenHandler, models.ValidateRequest{Token: "not.a.valid.jwt"})
	checkStatus(t, rr, http.StatusOK)

	resp := decodeJSON[models.ValidateResponse](t, rr)
	if resp.Valid {
		t.Error("expected valid=false for invalid token string")
	}
	if resp.Error == nil || *resp.Error == "" {
		t.Error("expected non-empty error message for invalid token")
	}
}

func TestValidateTokenHandler_ExpiredToken_ReturnsStableReason(t *testing.T) {
	tok, err := testKeys.SignToken("test-issuer", "test-subject", "test-audience", -60, []string{"read"})
	if err != nil {
		t.Fatalf("failed to sign expired token: %v", err)
	}

	rr := postJSON(t, srv().ValidateTokenHandler, models.ValidateRequest{Token: tok})
	checkStatus(t, rr, http.StatusOK)

	resp := decodeJSON[models.ValidateResponse](t, rr)
	if resp.Valid {
		t.Error("expected valid=false for expired token")
	}
	if resp.Error == nil || *resp.Error != "token has expired" {
		got := ""
		if resp.Error != nil {
			got = *resp.Error
		}
		t.Errorf("expected stable reason %q, got %q", "token has expired", got)
	}
}

func TestValidationErrorReason(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want string
	}{
		{"expired", gojwt.ErrTokenExpired, "token has expired"},
		{"not yet valid", gojwt.ErrTokenNotValidYet, "token is not yet valid"},
		{"invalid audience", gojwt.ErrTokenInvalidAudience, "token issuer or audience is invalid"},
		{"invalid issuer", gojwt.ErrTokenInvalidIssuer, "token issuer or audience is invalid"},
		{"bad signature", gojwt.ErrTokenSignatureInvalid, "token signature is invalid"},
		{"malformed", gojwt.ErrTokenMalformed, "token signature is invalid"},
		{"wrapped", fmt.Errorf("verification failed: %w", gojwt.ErrTokenExpired), "token has expired"},
		{"unknown", errors.New("boom"), "token is invalid"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := validationErrorReason(tc.err); got != tc.want {
				t.Errorf("validationErrorReason(%v) = %q, want %q", tc.err, got, tc.want)
			}
		})
	}
}

// ── Component Tests ──────────────────────────────────────────────────────────

func TestValidateTokenHandler_Component_ValidToken(t *testing.T) {
	testutil.Component(t)
	tok := makeValidToken(t)
	rr := postJSON(t, srv().ValidateTokenHandler, models.ValidateRequest{Token: tok})
	checkStatus(t, rr, http.StatusOK)

	resp := decodeJSON[models.ValidateResponse](t, rr)
	if !resp.Valid {
		errStr := ""
		if resp.Error != nil {
			errStr = *resp.Error
		}
		t.Errorf("expected valid=true for properly signed JWT; error: %s", errStr)
	}
	if resp.Sub == nil || *resp.Sub == "" {
		t.Error("expected non-empty sub field in validate response")
	}
	if resp.Error != nil && *resp.Error != "" {
		t.Errorf("expected no error for valid token, got: %q", *resp.Error)
	}
}

func TestValidateTokenHandler_Component_RevokedToken_ReturnsFalse(t *testing.T) {
	testutil.Component(t)

	ec := newFakeEC()
	svc := srvWithFakeTokenStore(ec)

	tok, err := testKeys.SignToken("test-issuer", "test-subject", "test-audience", 3600, []string{"read"})
	if err != nil {
		t.Fatalf("failed to sign token: %v", err)
	}
	claims, err := testKeys.ParseClaims(tok)
	if err != nil {
		t.Fatalf("failed to parse token: %v", err)
	}
	ec.store["revoked:jti:"+claims.ID] = "1"

	rr := postJSON(t, svc.ValidateTokenHandler, models.ValidateRequest{Token: tok})
	checkStatus(t, rr, http.StatusOK)

	resp := decodeJSON[models.ValidateResponse](t, rr)
	if resp.Valid {
		t.Error("expected valid=false for revoked token")
	}
	if resp.Error == nil || *resp.Error != "token has been revoked" {
		got := ""
		if resp.Error != nil {
			got = *resp.Error
		}
		t.Errorf("expected error %q, got %q", "token has been revoked", got)
	}
}

func TestValidateTokenHandler_Component_CacheError_StillValid(t *testing.T) {
	testutil.Component(t)

	ec := newFakeEC()
	ec.getErr = fmt.Errorf("redis unavailable")
	svc := &Service{
		CacheClient:    db.NewFromOperations(ec),
		JWT:            testKeys,
		ClientRegistry: testRegistry,
	}

	tok := makeValidToken(t)
	rr := postJSON(t, svc.ValidateTokenHandler, models.ValidateRequest{Token: tok})
	checkStatus(t, rr, http.StatusOK)

	resp := decodeJSON[models.ValidateResponse](t, rr)
	if !resp.Valid {
		t.Error("expected valid=true when revocation check fails (proceeds)")
	}
}

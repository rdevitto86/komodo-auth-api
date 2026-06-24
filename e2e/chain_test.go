//go:build e2e

package e2e

import (
	"encoding/json"
	"net/http"
	"os"
	"testing"

	"github.com/rdevitto86/komodo-forge-sdk-go/testing/testutil"
)

func TestV1Chain_OTPRequestToRevoke(t *testing.T) {
	testutil.E2E(t)

	clientID := os.Getenv("TEST_CLIENT_ID")
	clientSecret := os.Getenv("TEST_CLIENT_SECRET")

	const testEmail = "e2e-chain@example.com"

	otpRes := post(t, "/v1/otp/request", map[string]any{"email": testEmail}, nil)
	defer otpRes.Body.Close()
	checkStatus(t, otpRes, http.StatusOK)

	code := readOTPFromRedis(t, testEmail)
	if code == "" {
		t.Fatal("OTP key empty in Redis after successful request")
	}

	verifyRes := post(t, "/v1/otp/verify", map[string]any{
		"email": testEmail,
		"code":  code,
	}, nil)
	defer verifyRes.Body.Close()
	checkStatus(t, verifyRes, http.StatusOK)

	var tok struct {
		AccessToken string `json:"access_token"`
		TokenType   string `json:"token_type"`
		Scope       string `json:"scope"`
	}
	decodeJSON(t, verifyRes, &tok)

	if tok.AccessToken == "" {
		t.Fatal("expected non-empty access_token after OTP verify")
	}
	if tok.Scope != "otp:verified" {
		t.Errorf("expected scope=otp:verified, got %q", tok.Scope)
	}

	if clientID == "" || clientSecret == "" {
		t.Skip("TEST_CLIENT_ID / TEST_CLIENT_SECRET not set — skipping client_credentials leg")
	}

	ccRes := post(t, "/v1/oauth/token", map[string]any{
		"grant_type":    "client_credentials",
		"client_id":     clientID,
		"client_secret": clientSecret,
	}, nil)
	defer ccRes.Body.Close()
	checkStatus(t, ccRes, http.StatusOK)

	var ccTok struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(ccRes.Body).Decode(&ccTok); err != nil {
		t.Fatalf("decode client_credentials token: %v", err)
	}
	if ccTok.AccessToken == "" {
		t.Fatal("expected non-empty access_token from client_credentials")
	}

	authHdr := map[string]string{"Authorization": "Bearer " + ccTok.AccessToken}

	introspectRes := postToURL(t, makePrivateURL("/v1/oauth/introspect"),
		map[string]any{"token": ccTok.AccessToken},
		authHdr,
	)
	defer introspectRes.Body.Close()
	checkStatus(t, introspectRes, http.StatusOK)

	var ir struct {
		Active bool `json:"active"`
	}
	decodeJSON(t, introspectRes, &ir)
	if !ir.Active {
		t.Fatal("expected active=true before revocation")
	}

	revokeRes := post(t, "/v1/oauth/revoke",
		map[string]any{
			"token":         ccTok.AccessToken,
			"client_id":     clientID,
			"client_secret": clientSecret,
		},
		authHdr,
	)
	defer revokeRes.Body.Close()
	checkStatus(t, revokeRes, http.StatusOK)

	reIntrospectRes := postToURL(t, makePrivateURL("/v1/oauth/introspect"),
		map[string]any{"token": ccTok.AccessToken},
		authHdr,
	)
	defer reIntrospectRes.Body.Close()

	switch reIntrospectRes.StatusCode {
	case http.StatusOK:
		var rr struct {
			Active bool `json:"active"`
		}
		decodeJSON(t, reIntrospectRes, &rr)
		if rr.Active {
			t.Fatal("expected active=false after revocation")
		}
	case http.StatusUnauthorized:
	default:
		t.Fatalf("expected 200 (active=false) or 401 after revocation, got %d", reIntrospectRes.StatusCode)
	}
}

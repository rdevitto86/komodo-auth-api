//go:build e2e

package e2e

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"testing"
)

func TestHealth(t *testing.T) {
	res := get(t, "/health", nil)
	defer res.Body.Close()
	checkStatus(t, res, http.StatusOK)
}

func TestJWKS(t *testing.T) {
	res := get(t, "/.well-known/jwks.json", nil)
	defer res.Body.Close()
	checkStatus(t, res, http.StatusOK)

	var body struct {
		Keys []map[string]any `json:"keys"`
	}
	decodeJSON(t, res, &body)
	if len(body.Keys) == 0 {
		t.Fatal("JWKS response contains no keys")
	}
}

func TestOAuthToken_ClientCredentials(t *testing.T) {
	clientID := os.Getenv("TEST_CLIENT_ID")
	clientSecret := os.Getenv("TEST_CLIENT_SECRET")
	if clientID == "" || clientSecret == "" {
		t.Skip("TEST_CLIENT_ID / TEST_CLIENT_SECRET not set — register a client in LocalStack secrets to enable")
	}

	body := map[string]any{
		"grant_type":    "client_credentials",
		"client_id":     clientID,
		"client_secret": clientSecret,
	}
	res := post(t, "/v1/oauth/token", body, nil)
	defer res.Body.Close()
	checkStatus(t, res, http.StatusOK)

	var tok struct {
		AccessToken string `json:"access_token"`
		TokenType   string `json:"token_type"`
		ExpiresIn   int    `json:"expires_in"`
	}
	decodeJSON(t, res, &tok)
	if tok.AccessToken == "" {
		t.Fatal("expected non-empty access_token in token response")
	}
	if tok.TokenType == "" {
		t.Fatal("expected non-empty token_type in token response")
	}
}

func TestOAuthToken_MissingGrantType(t *testing.T) {
	res := post(t, "/v1/oauth/token", map[string]any{"client_id": "x"}, nil)
	defer res.Body.Close()
	checkStatus(t, res, http.StatusBadRequest)
}

func TestOAuthToken_UnknownGrantType(t *testing.T) {
	res := post(t, "/v1/oauth/token", map[string]any{
		"grant_type": "magic_beans",
		"client_id":  "x",
	}, nil)
	defer res.Body.Close()
	checkStatus(t, res, http.StatusBadRequest)
}

func TestOAuthIntrospect_NoAuth(t *testing.T) {
	res := post(t, "/v1/oauth/introspect", map[string]any{"token": "fake-token"}, nil)
	defer res.Body.Close()
	checkStatus(t, res, http.StatusUnauthorized)
}

func TestOAuthRevoke_NoBody(t *testing.T) {
	res := post(t, "/v1/oauth/revoke", map[string]any{}, nil)
	defer res.Body.Close()
	checkStatus(t, res, http.StatusBadRequest)
}

func TestOAuthIntrospect_WithClientToken(t *testing.T) {
	clientID := os.Getenv("TEST_CLIENT_ID")
	clientSecret := os.Getenv("TEST_CLIENT_SECRET")
	testJWT := os.Getenv("TEST_JWT")
	if clientID == "" || clientSecret == "" || testJWT == "" {
		t.Skip("TEST_CLIENT_ID / TEST_CLIENT_SECRET / TEST_JWT not set")
	}

	clientToken := issueClientToken(t, clientID, clientSecret)

	res := post(t, "/v1/oauth/introspect",
		map[string]any{"token": testJWT},
		map[string]string{"Authorization": "Bearer " + clientToken},
	)
	defer res.Body.Close()
	checkStatus(t, res, http.StatusOK)

	var result struct {
		Active bool `json:"active"`
	}
	decodeJSON(t, res, &result)
	if !result.Active {
		t.Fatal("expected active=true for a valid TEST_JWT")
	}
}

func issueClientToken(t *testing.T, clientID, clientSecret string) string {
	t.Helper()
	body := map[string]any{
		"grant_type":    "client_credentials",
		"client_id":     clientID,
		"client_secret": clientSecret,
	}
	res := post(t, "/v1/oauth/token", body, nil)
	defer res.Body.Close()
	checkStatus(t, res, http.StatusOK)

	var tok struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(res.Body).Decode(&tok); err != nil {
		t.Fatalf("decode client token: %v", err)
	}
	return tok.AccessToken
}

func TestOTPFlow_RequestAndVerify(t *testing.T) {
	const testEmail = "e2e-otp-test@example.com"

	res := post(t, "/v1/otp/request", map[string]any{"email": testEmail}, nil)
	defer res.Body.Close()
	checkStatus(t, res, http.StatusOK)

	code := readOTPFromRedis(t, testEmail)
	if code == "" {
		t.Fatal("OTP key was empty in Redis after a successful request")
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
		t.Fatal("expected non-empty access_token in OTP verify response")
	}
	if tok.Scope != "otp:verified" {
		t.Errorf("expected scope=otp:verified, got %q", tok.Scope)
	}
}

func TestOTPVerify_BannedEmail(t *testing.T) {
	if os.Getenv("TEST_BANNED_CHECK") != "1" {
		t.Skip("TEST_BANNED_CHECK not set — requires komodo-banned-customers DynamoDB table")
	}

	const bannedEmail = "banned-e2e@example.com"

	// PK format mirrors BannedCustomersClient: "EMAIL#<email>".
	item := fmt.Sprintf(
		`{"PK":{"S":"EMAIL#%s"},"reason":{"S":"e2e-test"},"banned_at":{"S":"2024-01-01T00:00:00Z"},"banned_by":{"S":"e2e"}}`,
		bannedEmail,
	)
	seedDynamoDBItem(t, "komodo-banned-customers", item)

	res := post(t, "/v1/otp/request", map[string]any{"email": bannedEmail}, nil)
	defer res.Body.Close()
	checkStatus(t, res, http.StatusForbidden)
}

func TestOAuthIntrospect(t *testing.T) {
	clientID := os.Getenv("TEST_CLIENT_ID")
	clientSecret := os.Getenv("TEST_CLIENT_SECRET")
	if clientID == "" || clientSecret == "" {
		t.Skip("TEST_CLIENT_ID / TEST_CLIENT_SECRET not set")
	}

	token := issueClientToken(t, clientID, clientSecret)

	res := postToURL(t, makePrivateURL("/v1/oauth/introspect"),
		map[string]any{"token": token},
		map[string]string{"Authorization": "Bearer " + token},
	)
	defer res.Body.Close()
	checkStatus(t, res, http.StatusOK)

	var result struct {
		Active bool `json:"active"`
	}
	decodeJSON(t, res, &result)
	if !result.Active {
		t.Fatal("expected active=true for a freshly issued client_credentials token")
	}
}

func TestTokenValidate(t *testing.T) {
	clientID := os.Getenv("TEST_CLIENT_ID")
	clientSecret := os.Getenv("TEST_CLIENT_SECRET")
	if clientID == "" || clientSecret == "" {
		t.Skip("TEST_CLIENT_ID / TEST_CLIENT_SECRET not set")
	}

	token := issueClientToken(t, clientID, clientSecret)

	res := postToURL(t, makePrivateURL("/v1/token/validate"),
		map[string]any{"token": token},
		map[string]string{"Authorization": "Bearer " + token},
	)
	defer res.Body.Close()
	checkStatus(t, res, http.StatusOK)
}

func TestOAuthRevoke(t *testing.T) {
	clientID := os.Getenv("TEST_CLIENT_ID")
	clientSecret := os.Getenv("TEST_CLIENT_SECRET")
	if clientID == "" || clientSecret == "" {
		t.Skip("TEST_CLIENT_ID / TEST_CLIENT_SECRET not set")
	}

	token := issueClientToken(t, clientID, clientSecret)

	revokeRes := post(t, "/v1/oauth/revoke",
		map[string]any{"token": token},
		map[string]string{"Authorization": "Bearer " + token},
	)
	defer revokeRes.Body.Close()
	checkStatus(t, revokeRes, http.StatusOK)

	introspectRes := postToURL(t, makePrivateURL("/v1/oauth/introspect"),
		map[string]any{"token": token},
		map[string]string{"Authorization": "Bearer " + token},
	)
	defer introspectRes.Body.Close()

	if introspectRes.StatusCode == http.StatusOK {
		var result struct {
			Active bool `json:"active"`
		}
		decodeJSON(t, introspectRes, &result)
		if result.Active {
			t.Fatal("expected active=false after revocation")
		}
	} else if introspectRes.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 200 (active=false) or 401 after revocation, got %d", introspectRes.StatusCode)
	}
}

func seedDynamoDBItem(t *testing.T, table, itemJSON string) {
	t.Helper()

	awslocal, err := exec.LookPath("awslocal")
	if err != nil {
		t.Skip("awslocal not found in PATH — skipping DynamoDB seed step")
	}

	cmd := exec.Command(awslocal, "dynamodb", "put-item",
		"--table-name", table,
		"--item", itemJSON,
	)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("awslocal dynamodb put-item: %v\noutput: %s", err, out)
	}
}

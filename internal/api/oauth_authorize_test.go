package api

import (
	"net/http"
	"net/url"
	"strings"
	"testing"

	"komodo-auth-api/internal/db"

	"github.com/rdevitto86/komodo-forge-sdk-go/testing/testutil"
)

func authCodeSrv() *Service {
	s := srv()
	s.authCodeGrantEnabled = true
	return s
}

func authCodeSrvWithEC(ec *fakeEC) *Service {
	s := &Service{
		CacheClient:          db.NewFromOperations(ec),
		JWT:                  testKeys,
		ClientRegistry:       testRegistry,
		authCodeGrantEnabled: true,
	}
	return s
}

// ── Unit Tests ───────────────────────────────────────────────────────────────

func TestOAuthAuthorizeHandler_Disabled(t *testing.T) {
	rr := getWithQuery(
		t,
		srv().OAuthAuthorizeHandler,
		"response_type=code&client_id=test-client&redirect_uri=https://example.com/cb",
	)
	checkStatus(t, rr, http.StatusNotImplemented)

	if loc := rr.Header().Get("Location"); loc != "" {
		t.Errorf("disabled authorize endpoint must not redirect, got Location %q", loc)
	}
}

func TestOAuthAuthorizeHandler_MissingClientID(t *testing.T) {
	rr := getWithQuery(
		t,
		authCodeSrv().OAuthAuthorizeHandler,
		"response_type=code&redirect_uri=https://example.com/cb",
	)
	checkStatus(t, rr, http.StatusBadRequest)

	if ct := rr.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Errorf("expected text/html content-type for direct error, got %q", ct)
	}
}

func TestOAuthAuthorizeHandler_UnknownClientID(t *testing.T) {
	rr := getWithQuery(
		t,
		authCodeSrv().OAuthAuthorizeHandler,
		"response_type=code&client_id=no-such-client&redirect_uri=https://example.com/cb",
	)
	checkStatus(t, rr, http.StatusBadRequest)

	if ct := rr.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Errorf("expected text/html content-type for direct error, got %q", ct)
	}
}

func TestOAuthAuthorizeHandler_MissingRedirectURI(t *testing.T) {
	rr := getWithQuery(
		t,
		authCodeSrv().OAuthAuthorizeHandler,
		"response_type=code&client_id=test-client",
	)
	checkStatus(t, rr, http.StatusBadRequest)

	if ct := rr.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Errorf("expected text/html content-type for direct error, got %q", ct)
	}
}

func TestOAuthAuthorizeHandler_InvalidRedirectURI(t *testing.T) {
	rr := getWithQuery(
		t,
		authCodeSrv().OAuthAuthorizeHandler,
		"response_type=code&client_id=test-client&redirect_uri=not-a-url",
	)
	checkStatus(t, rr, http.StatusBadRequest)

	if ct := rr.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Errorf("expected text/html content-type for direct error, got %q", ct)
	}
}

func TestOAuthAuthorizeHandler_MissingResponseType(t *testing.T) {
	rr := getWithQuery(
		t,
		authCodeSrv().OAuthAuthorizeHandler,
		"client_id=test-client&redirect_uri=https://example.com/cb&state=xyz",
	)
	checkStatus(t, rr, http.StatusFound)

	loc := rr.Header().Get("Location")
	u, err := url.Parse(loc)
	if err != nil {
		t.Fatalf("invalid Location header %q: %v", loc, err)
	}
	if got := u.Query().Get("error"); got != "invalid_request" {
		t.Errorf("expected error=invalid_request, got %q", got)
	}
	if got := u.Query().Get("state"); got != "xyz" {
		t.Errorf("expected state=xyz preserved in redirect, got %q", got)
	}
}

func TestOAuthAuthorizeHandler_UnsupportedResponseType(t *testing.T) {
	rr := getWithQuery(
		t,
		authCodeSrv().OAuthAuthorizeHandler,
		"response_type=token&client_id=test-client&redirect_uri=https://example.com/cb&state=abc",
	)
	checkStatus(t, rr, http.StatusFound)

	loc := rr.Header().Get("Location")
	u, err := url.Parse(loc)
	if err != nil {
		t.Fatalf("invalid Location header %q: %v", loc, err)
	}
	if got := u.Query().Get("error"); got != "unsupported_response_type" {
		t.Errorf("expected error=unsupported_response_type, got %q", got)
	}
	if got := u.Query().Get("state"); got != "abc" {
		t.Errorf("expected state=abc preserved in redirect, got %q", got)
	}
}

// ── Component Tests: OAuthAuthorizeHandler ──────────────────────────────────

func TestOAuthAuthorizeHandler_Component_MissingCodeChallenge(t *testing.T) {
	testutil.Component(t)

	rr := getWithQuery(
		t,
		authCodeSrv().OAuthAuthorizeHandler,
		"response_type=code&client_id=test-client&redirect_uri=https://example.com/cb&state=abc",
	)
	checkStatus(t, rr, http.StatusFound)

	loc := rr.Header().Get("Location")
	u, err := url.Parse(loc)
	if err != nil {
		t.Fatalf("invalid Location header %q: %v", loc, err)
	}
	if got := u.Query().Get("error"); got != "invalid_request" {
		t.Errorf("expected error=invalid_request, got %q", got)
	}
}

func TestOAuthAuthorizeHandler_Component_WrongChallengeMethod(t *testing.T) {
	testutil.Component(t)

	rr := getWithQuery(
		t,
		authCodeSrv().OAuthAuthorizeHandler,
		"response_type=code&client_id=test-client&redirect_uri=https://example.com/cb&code_challenge=abc&code_challenge_method=plain&state=abc",
	)
	checkStatus(t, rr, http.StatusFound)

	loc := rr.Header().Get("Location")
	u, err := url.Parse(loc)
	if err != nil {
		t.Fatalf("invalid Location header %q: %v", loc, err)
	}
	if got := u.Query().Get("error"); got != "invalid_request" {
		t.Errorf("expected error=invalid_request, got %q", got)
	}
}

func TestOAuthAuthorizeHandler_Component_MissingUserID(t *testing.T) {
	testutil.Component(t)

	rr := getWithQuery(
		t,
		authCodeSrv().OAuthAuthorizeHandler,
		"response_type=code&client_id=test-client&redirect_uri=https://example.com/cb&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256&state=abc",
	)
	checkStatus(t, rr, http.StatusFound)

	loc := rr.Header().Get("Location")
	u, err := url.Parse(loc)
	if err != nil {
		t.Fatalf("invalid Location header %q: %v", loc, err)
	}
	if got := u.Query().Get("error"); got != "invalid_request" {
		t.Errorf("expected error=invalid_request, got %q", got)
	}
}

func TestOAuthAuthorizeHandler_Component_UnregisteredRedirectURI(t *testing.T) {
	testutil.Component(t)

	rr := getWithQuery(
		t,
		authCodeSrv().OAuthAuthorizeHandler,
		"response_type=code&client_id=test-client&redirect_uri=https://evil.com/cb",
	)
	checkStatus(t, rr, http.StatusBadRequest)

	if ct := rr.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Errorf("expected text/html content-type for direct error, got %q", ct)
	}
}

func TestOAuthAuthorizeHandler_Component_HappyPath_IssuesCode(t *testing.T) {
	testutil.Component(t)

	ec := newFakeEC()
	svc := authCodeSrvWithEC(ec)

	rr := getWithQuery(
		t,
		svc.OAuthAuthorizeHandler,
		"response_type=code&client_id=test-client&redirect_uri=https://example.com/cb&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256&scope=read&state=xyz&user_id=user-123",
	)
	checkStatus(t, rr, http.StatusFound)

	loc := rr.Header().Get("Location")
	u, err := url.Parse(loc)
	if err != nil {
		t.Fatalf("invalid Location header %q: %v", loc, err)
	}

	if !strings.HasPrefix(loc, "https://example.com/cb") {
		t.Errorf("redirect should start with registered redirect_uri, got %q", loc)
	}

	code := u.Query().Get("code")
	if code == "" {
		t.Error("expected code parameter in redirect")
	}

	if got := u.Query().Get("state"); got != "xyz" {
		t.Errorf("expected state=xyz, got %q", got)
	}

	if u.Query().Get("error") != "" {
		t.Errorf("expected no error parameter, got %q", u.Query().Get("error"))
	}

	stored := ec.store["authcode:"+code]
	if stored == "" {
		t.Error("expected authorization code to be stored in cache")
	}
}

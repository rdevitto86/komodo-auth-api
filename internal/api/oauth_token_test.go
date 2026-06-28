package api

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strings"
	"testing"

	"komodo-auth-api/internal/db"
	"komodo-auth-api/internal/models"
	usermodels "komodo-auth-api/internal/models/user"
	"komodo-auth-api/internal/oauth"

	secAuth "github.com/rdevitto86/komodo-forge-sdk-go/security/oauth"
	"github.com/rdevitto86/komodo-forge-sdk-go/testing/testutil"
)

const (
	testCodeVerifier  = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
	testCodeChallenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
)

// ── Setup ────────────────────────────────────────────────────────────────────

func rawPostRequest(t *testing.T, target, body string) (*http.Request, *httptest.ResponseRecorder) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, target, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	return req, httptest.NewRecorder()
}

func postForm(handler handlerFn, form url.Values) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rr := httptest.NewRecorder()
	handler(rr, req)
	return rr
}

// ── Unit Tests: OAuthTokenHandler ────────────────────────────────────────────

func TestOAuthTokenHandler_Unit(t *testing.T) {
	t.Run("BadJSON_Returns400", func(t *testing.T) {
		req, rr := rawPostRequest(t, "/", "not-json")
		srv().OAuthTokenHandler(rr, req)
		checkStatus(t, rr, http.StatusBadRequest)
	})

	t.Run("InvalidGrantType_Non2xx", func(t *testing.T) {
		rr := postJSON(t, srv().OAuthTokenHandler, models.TokenRequest{
			GrantType: models.TokenRequestGrantType("password"),
		})
		if rr.Code >= 200 && rr.Code < 300 {
			t.Errorf("expected non-2xx for invalid grant type, got %d; body: %s", rr.Code, rr.Body.String())
		}
	})

	unparseable := "this.is.not.a.valid.jwt"
	code := "some-code"
	cases := []struct {
		name       string
		req        models.TokenRequest
		wantStatus int
	}{
		{"MissingGrantType_Returns400", models.TokenRequest{ClientId: "test-client", ClientSecret: "test-secret"}, http.StatusBadRequest},
		{"ClientCredentials_MissingClientID_Returns401", models.TokenRequest{GrantType: models.TokenRequestGrantTypeClientCredentials, ClientSecret: "test-secret"}, http.StatusUnauthorized},
		{"ClientCredentials_MissingClientSecret_Returns401", models.TokenRequest{GrantType: models.TokenRequestGrantTypeClientCredentials, ClientId: "test-client"}, http.StatusUnauthorized},
		{"RefreshToken_Missing_Returns400", models.TokenRequest{GrantType: models.TokenRequestGrantTypeRefreshToken}, http.StatusBadRequest},
		{"RefreshToken_Unparseable_Returns401", models.TokenRequest{GrantType: models.TokenRequestGrantTypeRefreshToken, RefreshToken: &unparseable}, http.StatusUnauthorized},
		{"AuthorizationCode_NotImplemented", models.TokenRequest{GrantType: models.TokenRequestGrantTypeAuthorizationCode, Code: &code}, http.StatusNotImplemented},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rr := postJSON(t, srv().OAuthTokenHandler, tc.req)
			checkStatus(t, rr, tc.wantStatus)
		})
	}
}

// ── Component Tests: OAuthTokenHandler ───────────────────────────────────────

func TestOAuthTokenHandler_Component_ClientCredentials_Rejections(t *testing.T) {
	testutil.Component(t)

	invalidScope := "invalid scope!@#"
	notPermitted := "admin"
	cases := []struct {
		name       string
		req        models.TokenRequest
		wantStatus int
	}{
		{"UnknownClient_Returns401", models.TokenRequest{GrantType: models.TokenRequestGrantTypeClientCredentials, ClientId: "no-such-client", ClientSecret: "whatever"}, http.StatusUnauthorized},
		{"WrongSecret_Returns401", models.TokenRequest{GrantType: models.TokenRequestGrantTypeClientCredentials, ClientId: "test-client", ClientSecret: "wrong-secret"}, http.StatusUnauthorized},
		{"InvalidScope_Returns400", models.TokenRequest{GrantType: models.TokenRequestGrantTypeClientCredentials, ClientId: "test-client", ClientSecret: "test-secret", Scope: &invalidScope}, http.StatusBadRequest},
		{"ScopeNotPermitted_Returns403", models.TokenRequest{GrantType: models.TokenRequestGrantTypeClientCredentials, ClientId: "test-client", ClientSecret: "test-secret", Scope: &notPermitted}, http.StatusForbidden},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rr := postJSON(t, srv().OAuthTokenHandler, tc.req)
			checkStatus(t, rr, tc.wantStatus)
		})
	}
}

func TestOAuthTokenHandler_Component_ClientCredentials_Valid_NoScope(t *testing.T) {
	testutil.Component(t)
	rr := postJSON(t, srv().OAuthTokenHandler, models.TokenRequest{
		GrantType:    models.TokenRequestGrantTypeClientCredentials,
		ClientId:     "test-client",
		ClientSecret: "test-secret",
	})
	checkStatus(t, rr, http.StatusOK)

	resp := decodeJSON[models.TokenResponse](t, rr)
	if resp.AccessToken == "" {
		t.Error("expected non-empty accessToken in response")
	}
	if resp.TokenType != "Bearer" {
		t.Errorf("expected tokenType=Bearer, got %q", resp.TokenType)
	}
	if resp.ExpiresIn <= 0 {
		t.Errorf("expected positive expiresIn, got %d", resp.ExpiresIn)
	}
}

func TestOAuthTokenHandler_Component_ClientCredentials_Valid_WithScope(t *testing.T) {
	testutil.Component(t)
	scope := "read"
	rr := postJSON(t, srv().OAuthTokenHandler, models.TokenRequest{
		GrantType:    models.TokenRequestGrantTypeClientCredentials,
		ClientId:     "test-client",
		ClientSecret: "test-secret",
		Scope:        &scope,
	})
	checkStatus(t, rr, http.StatusOK)

	resp := decodeJSON[models.TokenResponse](t, rr)
	if resp.AccessToken == "" {
		t.Error("expected non-empty accessToken in response")
	}
	if resp.Scope == nil || *resp.Scope != "read" {
		t.Errorf("expected scope=read, got %v", resp.Scope)
	}
}

func TestOAuthTokenHandler_Component_ClientCredentials_WithOfflineAccess_IssuesRefreshToken(t *testing.T) {
	testutil.Component(t)
	if err := testRegistry.Reload(`{"test-client":{"name":"Test","secret_hash":"9caf06bb4436cdbfa20af9121a626bc1093c4f54b31c0fa937957856135345b6","allowed_scopes":["read","offline_access"],"allowed_audiences":["komodo-apis:service","komodo-apis:user"]}}`); err != nil {
		t.Fatalf("failed to reload client registry: %v", err)
	}
	t.Cleanup(func() {
		testRegistry.Reload(`{"test-client":{"name":"Test","secret_hash":"9caf06bb4436cdbfa20af9121a626bc1093c4f54b31c0fa937957856135345b6","allowed_scopes":["read","write"],"allowed_audiences":["komodo-apis:service","komodo-apis:user"]}}`) //nolint:errcheck
	})

	scope := "read offline_access"
	rr := postJSON(t, srv().OAuthTokenHandler, models.TokenRequest{
		GrantType:    models.TokenRequestGrantTypeClientCredentials,
		ClientId:     "test-client",
		ClientSecret: "test-secret",
		Scope:        &scope,
	})
	checkStatus(t, rr, http.StatusOK)

	resp := decodeJSON[models.TokenResponse](t, rr)
	if resp.AccessToken == "" {
		t.Error("expected non-empty accessToken")
	}
	if resp.RefreshToken == nil || *resp.RefreshToken == "" {
		t.Error("expected non-empty refreshToken when offline_access scope is requested")
	}
}

func TestOAuthTokenHandler_Component_ClientCredentials_WithoutOfflineAccess_NoRefreshToken(t *testing.T) {
	testutil.Component(t)
	scope := "read"
	rr := postJSON(t, srv().OAuthTokenHandler, models.TokenRequest{
		GrantType:    models.TokenRequestGrantTypeClientCredentials,
		ClientId:     "test-client",
		ClientSecret: "test-secret",
		Scope:        &scope,
	})
	checkStatus(t, rr, http.StatusOK)

	resp := decodeJSON[models.TokenResponse](t, rr)
	if resp.RefreshToken != nil && *resp.RefreshToken != "" {
		t.Error("expected no refreshToken when offline_access scope is not requested")
	}
}

func TestOAuthTokenHandler_Component_ClientCredentials_SignAccessTokenError_Returns500(t *testing.T) {
	testutil.Component(t)

	svc := &Service{
		CacheClient:    db.NewFromOperations(nil),
		JWT:            &failingSignAuthority{base: testKeys, failAfter: 0},
		ClientRegistry: testRegistry,
		ScopeValidator: secAuth.New(secAuth.Config{}),
	}

	rr := postJSON(t, svc.OAuthTokenHandler, models.TokenRequest{
		GrantType:    models.TokenRequestGrantTypeClientCredentials,
		ClientId:     "test-client",
		ClientSecret: "test-secret",
	})
	checkStatus(t, rr, http.StatusInternalServerError)
}

func TestOAuthTokenHandler_Component_ClientCredentials_SignRefreshTokenError_Returns500(t *testing.T) {
	testutil.Component(t)

	if err := testRegistry.Reload(`{"test-client":{"name":"Test","secret_hash":"9caf06bb4436cdbfa20af9121a626bc1093c4f54b31c0fa937957856135345b6","allowed_scopes":["read","offline_access"],"allowed_audiences":["komodo-apis:service","komodo-apis:user"]}}`); err != nil {
		t.Fatalf("failed to reload client registry: %v", err)
	}
	t.Cleanup(func() {
		testRegistry.Reload(`{"test-client":{"name":"Test","secret_hash":"9caf06bb4436cdbfa20af9121a626bc1093c4f54b31c0fa937957856135345b6","allowed_scopes":["read","write"],"allowed_audiences":["komodo-apis:service","komodo-apis:user"]}}`) //nolint:errcheck
	})

	svc := &Service{
		CacheClient:    db.NewFromOperations(nil),
		JWT:            &failingSignAuthority{base: testKeys, failAfter: 1},
		ClientRegistry: testRegistry,
		ScopeValidator: secAuth.New(secAuth.Config{}),
	}

	scope := "read offline_access"
	rr := postJSON(t, svc.OAuthTokenHandler, models.TokenRequest{
		GrantType:    models.TokenRequestGrantTypeClientCredentials,
		ClientId:     "test-client",
		ClientSecret: "test-secret",
		Scope:        &scope,
	})
	checkStatus(t, rr, http.StatusInternalServerError)
}

func TestOAuthTokenHandler_Component_RefreshToken_AccessTokenRejected(t *testing.T) {
	testutil.Component(t)
	accessTok := makeValidToken(t)

	rr := postJSON(t, srv().OAuthTokenHandler, models.TokenRequest{
		GrantType:    models.TokenRequestGrantTypeRefreshToken,
		RefreshToken: &accessTok,
	})
	checkStatus(t, rr, http.StatusUnauthorized)
}

func TestOAuthTokenHandler_Component_RefreshToken_RotatesAndRevokesOld(t *testing.T) {
	testutil.Component(t)
	ec := newFakeEC()
	svc := srvWithFakeTokenStore(ec)

	oldRefresh, err := testKeys.SignTokenWithAZP("test-issuer", "test-client", "komodo-apis:service", "test-client", 86400, []string{"offline_access"})
	if err != nil {
		t.Fatalf("failed to sign refresh token: %v", err)
	}
	oldClaims, err := testKeys.ParseClaims(oldRefresh)
	if err != nil {
		t.Fatalf("failed to parse signed refresh token: %v", err)
	}

	rr := postJSON(t, svc.OAuthTokenHandler, models.TokenRequest{
		GrantType:    models.TokenRequestGrantTypeRefreshToken,
		ClientId:     "test-client",
		ClientSecret: "test-secret",
		RefreshToken: &oldRefresh,
	})
	checkStatus(t, rr, http.StatusOK)

	resp := decodeJSON[models.TokenResponse](t, rr)
	if resp.RefreshToken == nil || *resp.RefreshToken == "" {
		t.Fatal("expected a rotated refresh token in the response")
	}
	if *resp.RefreshToken == oldRefresh {
		t.Error("expected the rotated refresh token to differ from the presented one")
	}

	newClaims, err := testKeys.ParseClaims(*resp.RefreshToken)
	if err != nil {
		t.Fatalf("failed to parse rotated refresh token: %v", err)
	}
	if !slices.Contains(newClaims.Scopes, "offline_access") {
		t.Error("expected rotated refresh token to retain offline_access scope")
	}
	if newClaims.Subject != oldClaims.Subject {
		t.Errorf("expected rotated refresh token subject %q, got %q", oldClaims.Subject, newClaims.Subject)
	}

	if _, ok := ec.store["revoked:jti:"+oldClaims.ID]; !ok {
		t.Errorf("expected old refresh token JTI %q to be revoked after rotation", oldClaims.ID)
	}
}

func TestOAuthTokenHandler_Component_RefreshToken_Rejections(t *testing.T) {
	testutil.Component(t)

	mismatchedAZP, err := testKeys.SignTokenWithAZP("test-issuer", "other-client", "komodo-apis:service", "other-client", 86400, []string{"offline_access"})
	if err != nil {
		t.Fatalf("failed to sign mismatched-azp token: %v", err)
	}
	wrongAudience, err := testKeys.SignTokenWithAZP("test-issuer", "test-client", "some-other-aud", "test-client", 86400, []string{"offline_access"})
	if err != nil {
		t.Fatalf("failed to sign wrong-audience token: %v", err)
	}
	unparseable := "not.a.valid.jwt"

	cases := []struct {
		name         string
		refreshToken string
		clientSecret string
		wantStatus   int
	}{
		{"InvalidClientSecret_Returns401", "anything.non.empty", "wrong-secret", http.StatusUnauthorized},
		{"UnparseableWithValidCreds_Returns401", unparseable, "test-secret", http.StatusUnauthorized},
		{"AZPMismatch_Returns401", mismatchedAZP, "test-secret", http.StatusUnauthorized},
		{"AudienceNotPermitted_Returns400", wrongAudience, "test-secret", http.StatusBadRequest},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rr := postJSON(t, srv().OAuthTokenHandler, models.TokenRequest{
				GrantType:    models.TokenRequestGrantTypeRefreshToken,
				ClientId:     "test-client",
				ClientSecret: tc.clientSecret,
				RefreshToken: &tc.refreshToken,
			})
			checkStatus(t, rr, tc.wantStatus)
		})
	}
}

func TestOAuthTokenHandler_Component_RefreshToken_RevokedToken_Rejected(t *testing.T) {
	testutil.Component(t)
	ec := newFakeEC()
	svc := srvWithFakeTokenStore(ec)

	refreshTok, err := testKeys.SignTokenWithAZP("test-issuer", "test-client", "komodo-apis:service", "test-client", 86400, []string{"offline_access"})
	if err != nil {
		t.Fatalf("failed to sign refresh token: %v", err)
	}
	claims, err := testKeys.ParseClaims(refreshTok)
	if err != nil {
		t.Fatalf("failed to parse signed refresh token: %v", err)
	}
	ec.store["revoked:jti:"+claims.ID] = "1"

	rr := postJSON(t, svc.OAuthTokenHandler, models.TokenRequest{
		GrantType:    models.TokenRequestGrantTypeRefreshToken,
		ClientId:     "test-client",
		ClientSecret: "test-secret",
		RefreshToken: &refreshTok,
	})
	checkStatus(t, rr, http.StatusUnauthorized)
}

func TestOAuthTokenHandler_Component_RefreshToken_ExpiredToken_Rejected(t *testing.T) {
	testutil.Component(t)

	const userUUID = "550e8400-e29b-41d4-a716-446655440003"
	expiredTok, err := testKeys.SignTokenWithAZP("test-issuer", userUUID, "komodo-apis:user", "test-client", -86400, []string{"offline_access"})
	if err != nil {
		t.Fatalf("failed to sign expired refresh token: %v", err)
	}

	rr := postJSON(t, srv().OAuthTokenHandler, models.TokenRequest{
		GrantType:    models.TokenRequestGrantTypeRefreshToken,
		ClientId:     "test-client",
		ClientSecret: "test-secret",
		RefreshToken: &expiredTok,
	})
	checkStatus(t, rr, http.StatusUnauthorized)

	body := rr.Body.String()
	if body == "" {
		t.Error("expected non-empty error response body")
	}
}

func makeUserRefreshToken(t *testing.T, subject string, extraScopes ...string) string {
	t.Helper()
	scopes := append([]string{"offline_access"}, extraScopes...)
	tok, err := testKeys.SignTokenWithAZP("test-issuer", subject, "komodo-apis:service", "test-client", 86400, scopes)
	if err != nil {
		t.Fatalf("makeUserRefreshToken: %v", err)
	}
	return tok
}

func srvWithBanCheck(httpClient *fakeHttpClient, banned bool, bannedErr error) *Service {
	return &Service{
		CacheClient:    db.NewFromOperations(nil),
		JWT:            testKeys,
		ClientRegistry: testRegistry,
		HttpClient:     httpClient,
		BannedChecker:  &fakeBannedChecker{banned: banned, err: bannedErr},
	}
}

func TestOAuthTokenHandler_Component_RefreshToken_BanCheck_UserBanned_Returns403(t *testing.T) {
	testutil.Component(t)

	const userUUID = "550e8400-e29b-41d4-a716-446655440002"
	refreshTok := makeAZPRefreshToken(t, userUUID, "komodo-apis:user", "test-client")

	httpClient := &fakeHttpClient{
		getUserByIDResult: &usermodels.User{
			UserId: userUUID,
			Email:  "banned@example.com",
		},
	}
	svc := srvWithBanCheck(httpClient, true, nil)

	rr := postJSON(t, svc.OAuthTokenHandler, models.TokenRequest{
		GrantType:    models.TokenRequestGrantTypeRefreshToken,
		ClientId:     "test-client",
		ClientSecret: "test-secret",
		RefreshToken: &refreshTok,
	})
	checkStatus(t, rr, http.StatusForbidden)
}

func TestOAuthTokenHandler_Component_RefreshToken_BanCheck_UserNotBanned_Returns200(t *testing.T) {
	testutil.Component(t)

	const userUUID = "test-client"
	ec := newFakeEC()
	refreshTok := makeUserRefreshToken(t, userUUID)

	httpClient := &fakeHttpClient{
		getUserByIDResult: &usermodels.User{
			UserId: userUUID,
			Email:  "active@example.com",
		},
	}

	svc := &Service{
		CacheClient:    db.NewFromOperations(ec),
		JWT:            testKeys,
		ClientRegistry: testRegistry,
		HttpClient:     httpClient,
		BannedChecker:  &fakeBannedChecker{banned: false, err: nil},
	}

	rr := postJSON(t, svc.OAuthTokenHandler, models.TokenRequest{
		GrantType:    models.TokenRequestGrantTypeRefreshToken,
		ClientId:     "test-client",
		ClientSecret: "test-secret",
		RefreshToken: &refreshTok,
	})
	checkStatus(t, rr, http.StatusOK)
}

func TestOAuthTokenHandler_Component_RefreshToken_BanCheck_ServiceToken_Skipped(t *testing.T) {
	testutil.Component(t)

	svcRefreshTok := makeUserRefreshToken(t, "test-client", "svc:test-client")

	httpClient := &fakeHttpClient{}

	svc := &Service{
		CacheClient:    db.NewFromOperations(nil),
		JWT:            testKeys,
		ClientRegistry: testRegistry,
		HttpClient:     httpClient,
		BannedChecker:  &fakeBannedChecker{banned: true, err: nil},
	}

	rr := postJSON(t, svc.OAuthTokenHandler, models.TokenRequest{
		GrantType:    models.TokenRequestGrantTypeRefreshToken,
		ClientId:     "test-client",
		ClientSecret: "test-secret",
		RefreshToken: &svcRefreshTok,
	})

	if httpClient.getUserByIDCalls != 0 {
		t.Errorf("expected GetUserByID to be skipped for service-scoped tokens, got %d calls", httpClient.getUserByIDCalls)
	}
	checkStatus(t, rr, http.StatusOK)
}

func TestOAuthTokenHandler_Component_RefreshToken_BanCheck_LookupError_FailOpen(t *testing.T) {
	testutil.Component(t)

	const userUUID = "test-client"
	ec := newFakeEC()
	refreshTok := makeUserRefreshToken(t, userUUID)

	httpClient := &fakeHttpClient{
		getUserByIDErr: fmt.Errorf("customer-api unavailable"),
	}

	svc := &Service{
		CacheClient:    db.NewFromOperations(ec),
		JWT:            testKeys,
		ClientRegistry: testRegistry,
		HttpClient:     httpClient,
		BannedChecker:  &fakeBannedChecker{banned: true, err: nil},
	}

	rr := postJSON(t, svc.OAuthTokenHandler, models.TokenRequest{
		GrantType:    models.TokenRequestGrantTypeRefreshToken,
		ClientId:     "test-client",
		ClientSecret: "test-secret",
		RefreshToken: &refreshTok,
	})
	checkStatus(t, rr, http.StatusOK)
}

// ── Component Tests: OAuthTokenHandler azp / Phase-5a ────────────────────────

func makeAZPRefreshToken(t *testing.T, subject, audience, azp string, extraScopes ...string) string {
	t.Helper()
	scopes := append([]string{"offline_access"}, extraScopes...)
	tok, err := testKeys.SignTokenWithAZP("test-issuer", subject, audience, azp, 86400, scopes)
	if err != nil {
		t.Fatalf("makeAZPRefreshToken: %v", err)
	}
	return tok
}

func TestOAuthTokenHandler_Component_RefreshToken_UserToken_HappyPath(t *testing.T) {
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
	if resp.AccessToken == "" {
		t.Fatal("expected non-empty access_token")
	}

	accessClaims, err := testKeys.ParseClaims(resp.AccessToken)
	if err != nil {
		t.Fatalf("failed to parse issued access token: %v", err)
	}
	if accessClaims.Subject != userUUID {
		t.Errorf("access token sub = %q, want user UUID %q", accessClaims.Subject, userUUID)
	}

	if resp.RefreshToken == nil || *resp.RefreshToken == "" {
		t.Fatal("expected rotated refresh token")
	}
	rotatedClaims, err := testKeys.ParseClaims(*resp.RefreshToken)
	if err != nil {
		t.Fatalf("failed to parse rotated refresh token: %v", err)
	}
	if rotatedClaims.Subject != userUUID {
		t.Errorf("rotated refresh token sub = %q, want user UUID %q", rotatedClaims.Subject, userUUID)
	}
	if rotatedClaims.Azp != "test-client" {
		t.Errorf("rotated refresh token azp = %q, want %q", rotatedClaims.Azp, "test-client")
	}
	if !slices.Contains(rotatedClaims.Scopes, "offline_access") {
		t.Error("expected rotated refresh token to retain offline_access scope")
	}
}

func TestOAuthTokenHandler_Component_RefreshToken_AZPMismatch_Returns401(t *testing.T) {
	testutil.Component(t)

	const userUUID = "550e8400-e29b-41d4-a716-446655440000"
	mismatchedTok := makeAZPRefreshToken(t, userUUID, "komodo-apis:user", "other-client")

	rr := postJSON(t, srv().OAuthTokenHandler, models.TokenRequest{
		GrantType:    models.TokenRequestGrantTypeRefreshToken,
		ClientId:     "test-client",
		ClientSecret: "test-secret",
		RefreshToken: &mismatchedTok,
	})
	checkStatus(t, rr, http.StatusUnauthorized)
}

func TestOAuthTokenHandler_Component_RefreshToken_M2MClientCredentials_HappyPath(t *testing.T) {
	testutil.Component(t)

	ec := newFakeEC()
	m2mTok := makeAZPRefreshToken(t, "test-client", "komodo-apis:service", "test-client")

	svc := &Service{
		CacheClient:    db.NewFromOperations(ec),
		JWT:            testKeys,
		ClientRegistry: testRegistry,
	}

	rr := postJSON(t, svc.OAuthTokenHandler, models.TokenRequest{
		GrantType:    models.TokenRequestGrantTypeRefreshToken,
		ClientId:     "test-client",
		ClientSecret: "test-secret",
		RefreshToken: &m2mTok,
	})
	checkStatus(t, rr, http.StatusOK)

	resp := decodeJSON[models.TokenResponse](t, rr)
	if resp.AccessToken == "" {
		t.Fatal("expected non-empty access_token for M2M refresh")
	}
	accessClaims, err := testKeys.ParseClaims(resp.AccessToken)
	if err != nil {
		t.Fatalf("failed to parse issued access token: %v", err)
	}
	if accessClaims.Subject != "test-client" {
		t.Errorf("M2M access token sub = %q, want %q", accessClaims.Subject, "test-client")
	}
}

func TestOAuthTokenHandler_Component_RefreshToken_UserToken_NoServiceScope(t *testing.T) {
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
			t.Errorf("user access token must not carry service scope, got %q", sc)
		}
	}
	if !slices.Contains(accessClaims.Scopes, "passkey:verified") {
		t.Errorf("user access token missing passkey:verified scope, got %v", accessClaims.Scopes)
	}
}

func TestOAuthTokenHandler_Component_RefreshToken_M2MToken_RetainsServiceScope(t *testing.T) {
	testutil.Component(t)

	ec := newFakeEC()
	m2mTok := makeAZPRefreshToken(t, "test-client", "komodo-apis:service", "test-client")

	svc := &Service{
		CacheClient:    db.NewFromOperations(ec),
		JWT:            testKeys,
		ClientRegistry: testRegistry,
	}

	rr := postJSON(t, svc.OAuthTokenHandler, models.TokenRequest{
		GrantType:    models.TokenRequestGrantTypeRefreshToken,
		ClientId:     "test-client",
		ClientSecret: "test-secret",
		RefreshToken: &m2mTok,
	})
	checkStatus(t, rr, http.StatusOK)

	resp := decodeJSON[models.TokenResponse](t, rr)
	accessClaims, err := testKeys.ParseClaims(resp.AccessToken)
	if err != nil {
		t.Fatalf("failed to parse access token: %v", err)
	}

	hasSvcScope := slices.ContainsFunc(accessClaims.Scopes, func(sc string) bool {
		return strings.HasPrefix(sc, "svc:")
	})
	if !hasSvcScope {
		t.Errorf("M2M access token should carry svc: scope, got %v", accessClaims.Scopes)
	}
}

func TestOAuthTokenHandler_Component_RefreshToken_EmptyAZP_Rejected(t *testing.T) {
	testutil.Component(t)

	legacyTok, err := testKeys.SignToken("test-issuer", "test-client", "komodo-apis:service", 86400, []string{"offline_access"})
	if err != nil {
		t.Fatalf("failed to sign legacy refresh token: %v", err)
	}

	rr := postJSON(t, srv().OAuthTokenHandler, models.TokenRequest{
		GrantType:    models.TokenRequestGrantTypeRefreshToken,
		ClientId:     "test-client",
		ClientSecret: "test-secret",
		RefreshToken: &legacyTok,
	})
	checkStatus(t, rr, http.StatusUnauthorized)
}

func TestOAuthTokenHandler_Component_RefreshToken_UserAudience_BypassesClientGate(t *testing.T) {
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
	if resp.AccessToken == "" {
		t.Fatal("expected non-empty access_token for user-session refresh")
	}
	accessClaims, err := testKeys.ParseClaims(resp.AccessToken)
	if err != nil {
		t.Fatalf("failed to parse access token: %v", err)
	}
	if accessClaims.Subject != userUUID {
		t.Errorf("access token sub = %q, want %q", accessClaims.Subject, userUUID)
	}
}

// ── Component Tests: OAuthTokenHandler Phase-5b family revocation ───────────

func TestOAuthTokenHandler_Component_RefreshToken_ReuseDetection_RevokesFamily(t *testing.T) {
	testutil.Component(t)

	ec := newFakeEC()
	svc := srvWithFakeTokenStore(ec)

	tok, err := testKeys.SignRefreshToken("test-issuer", "test-client", "komodo-apis:service", "test-client", "family-123", 86400, []string{"offline_access"})
	if err != nil {
		t.Fatalf("failed to sign refresh token: %v", err)
	}
	claims, err := testKeys.ParseClaims(tok)
	if err != nil {
		t.Fatalf("failed to parse refresh token: %v", err)
	}

	ec.store["revoked:jti:"+claims.ID] = "1"

	rr := postJSON(t, svc.OAuthTokenHandler, models.TokenRequest{
		GrantType:    models.TokenRequestGrantTypeRefreshToken,
		ClientId:     "test-client",
		ClientSecret: "test-secret",
		RefreshToken: &tok,
	})
	checkStatus(t, rr, http.StatusUnauthorized)

	if _, ok := ec.store["revoked_family:family-123"]; !ok {
		t.Error("expected family to be revoked on reuse detection")
	}
}

func TestOAuthTokenHandler_Component_RefreshToken_FamilyRevoked_Rejected(t *testing.T) {
	testutil.Component(t)

	ec := newFakeEC()
	svc := srvWithFakeTokenStore(ec)

	tok, err := testKeys.SignRefreshToken("test-issuer", "test-client", "komodo-apis:service", "test-client", "family-456", 86400, []string{"offline_access"})
	if err != nil {
		t.Fatalf("failed to sign refresh token: %v", err)
	}

	ec.store["revoked_family:family-456"] = "1"

	rr := postJSON(t, svc.OAuthTokenHandler, models.TokenRequest{
		GrantType:    models.TokenRequestGrantTypeRefreshToken,
		ClientId:     "test-client",
		ClientSecret: "test-secret",
		RefreshToken: &tok,
	})
	checkStatus(t, rr, http.StatusUnauthorized)
}

func TestOAuthTokenHandler_Component_RefreshToken_FamilyID_Propagated(t *testing.T) {
	testutil.Component(t)

	ec := newFakeEC()
	svc := srvWithFakeTokenStore(ec)

	tok, err := testKeys.SignRefreshToken("test-issuer", "test-client", "komodo-apis:service", "test-client", "family-789", 86400, []string{"offline_access"})
	if err != nil {
		t.Fatalf("failed to sign refresh token: %v", err)
	}

	rr := postJSON(t, svc.OAuthTokenHandler, models.TokenRequest{
		GrantType:    models.TokenRequestGrantTypeRefreshToken,
		ClientId:     "test-client",
		ClientSecret: "test-secret",
		RefreshToken: &tok,
	})
	checkStatus(t, rr, http.StatusOK)

	resp := decodeJSON[models.TokenResponse](t, rr)
	if resp.RefreshToken == nil || *resp.RefreshToken == "" {
		t.Fatal("expected rotated refresh token")
	}
	rotatedClaims, err := testKeys.ParseClaims(*resp.RefreshToken)
	if err != nil {
		t.Fatalf("failed to parse rotated refresh token: %v", err)
	}
	if rotatedClaims.FamilyId != "family-789" {
		t.Errorf("expected family_id %q to propagate through rotation, got %q", "family-789", rotatedClaims.FamilyId)
	}
}

// ── Component Tests: Cache-error deny paths ─────────────────────────────────

func TestOAuthTokenHandler_Component_RefreshToken_CacheError_IsRevoked_Returns500(t *testing.T) {
	testutil.Component(t)

	ec := newFakeEC()
	ec.getErr = fmt.Errorf("redis unavailable")

	tok, err := testKeys.SignRefreshToken("test-issuer", "test-client", "komodo-apis:service", "test-client", "family-err", 86400, []string{"offline_access"})
	if err != nil {
		t.Fatalf("failed to sign refresh token: %v", err)
	}

	svc := &Service{
		CacheClient:    db.NewFromOperations(ec),
		JWT:            testKeys,
		ClientRegistry: testRegistry,
	}

	rr := postJSON(t, svc.OAuthTokenHandler, models.TokenRequest{
		GrantType:    models.TokenRequestGrantTypeRefreshToken,
		ClientId:     "test-client",
		ClientSecret: "test-secret",
		RefreshToken: &tok,
	})
	checkStatus(t, rr, http.StatusInternalServerError)
}

func TestOAuthTokenHandler_Component_RefreshToken_GetUserByIDError_FailsOpen(t *testing.T) {
	testutil.Component(t)

	const userUUID = "550e8400-e29b-41d4-a716-446655440099"
	ec := newFakeEC()
	refreshTok := makeAZPRefreshToken(t, userUUID, "komodo-apis:user", "test-client")

	httpClient := &fakeHttpClient{
		getUserByIDErr: fmt.Errorf("customer-api unavailable"),
	}

	svc := &Service{
		CacheClient:    db.NewFromOperations(ec),
		JWT:            testKeys,
		ClientRegistry: testRegistry,
		HttpClient:     httpClient,
		BannedChecker:  &fakeBannedChecker{banned: true, err: nil},
	}

	rr := postJSON(t, svc.OAuthTokenHandler, models.TokenRequest{
		GrantType:    models.TokenRequestGrantTypeRefreshToken,
		ClientId:     "test-client",
		ClientSecret: "test-secret",
		RefreshToken: &refreshTok,
	})
	checkStatus(t, rr, http.StatusOK)
}

func TestOAuthTokenHandler_Component_AuthorizationCode_Enabled_EmptyCodeVerifier_Returns400(t *testing.T) {
	testutil.Component(t)

	svc := srv()
	svc.authCodeGrantEnabled = true

	emptyVerifier := ""
	code := "auth-code-123"
	redirectURI := "https://example.com/cb"
	rr := postJSON(t, svc.OAuthTokenHandler, models.TokenRequest{
		GrantType:    models.TokenRequestGrantTypeAuthorizationCode,
		ClientId:     "test-client",
		Code:         &code,
		CodeVerifier: &emptyVerifier,
		RedirectUri:  &redirectURI,
	})
	checkStatus(t, rr, http.StatusBadRequest)
}

func TestOAuthTokenHandler_Component_AuthorizationCode_Enabled_NoCodeVerifier_Returns400(t *testing.T) {
	testutil.Component(t)

	svc := srv()
	svc.authCodeGrantEnabled = true

	code := "auth-code-123"
	redirectURI := "https://example.com/cb"
	rr := postJSON(t, svc.OAuthTokenHandler, models.TokenRequest{
		GrantType:   models.TokenRequestGrantTypeAuthorizationCode,
		ClientId:    "test-client",
		Code:        &code,
		RedirectUri: &redirectURI,
	})
	checkStatus(t, rr, http.StatusBadRequest)
}

// ── Component Tests: OAuthTokenHandler authorization_code ───────────────────

func storeTestAuthCode(t *testing.T, ec *fakeEC, code string, entry *db.AuthCodeEntry) {
	t.Helper()
	cache := db.NewFromOperations(ec)
	claimed, err := cache.StoreAuthCode(t.Context(), code, entry)
	if err != nil {
		t.Fatalf("failed to store test auth code: %v", err)
	}
	if !claimed {
		t.Fatal("failed to claim test auth code slot")
	}
}

func TestOAuthTokenHandler_Component_AuthorizationCode_HappyPath(t *testing.T) {
	testutil.Component(t)

	ec := newFakeEC()
	svc := &Service{
		CacheClient:          db.NewFromOperations(ec),
		JWT:                  testKeys,
		ClientRegistry:       testRegistry,
		authCodeGrantEnabled: true,
	}

	codeChallenge := testCodeChallenge
	storeTestAuthCode(t, ec, "test-code-1", &db.AuthCodeEntry{
		ClientID:      "test-client",
		RedirectURI:   "https://example.com/cb",
		Scope:         "read",
		UserID:        "user-uuid-123",
		CodeChallenge: codeChallenge,
	})

	verifier := testCodeVerifier
	code := "test-code-1"
	redirectURI := "https://example.com/cb"
	rr := postJSON(t, svc.OAuthTokenHandler, models.TokenRequest{
		GrantType:    models.TokenRequestGrantTypeAuthorizationCode,
		ClientId:     "test-client",
		Code:         &code,
		CodeVerifier: &verifier,
		RedirectUri:  &redirectURI,
	})
	checkStatus(t, rr, http.StatusOK)

	resp := decodeJSON[models.TokenResponse](t, rr)
	if resp.AccessToken == "" {
		t.Fatal("expected non-empty access_token")
	}
	if resp.TokenType != "Bearer" {
		t.Errorf("expected tokenType=Bearer, got %q", resp.TokenType)
	}
	if resp.ExpiresIn <= 0 {
		t.Errorf("expected positive expiresIn, got %d", resp.ExpiresIn)
	}
	if resp.RefreshToken == nil || *resp.RefreshToken == "" {
		t.Fatal("expected non-empty refresh_token")
	}
	if resp.Scope == nil || *resp.Scope != "read" {
		t.Errorf("expected scope=read, got %v", resp.Scope)
	}

	accessClaims, err := testKeys.ParseClaims(resp.AccessToken)
	if err != nil {
		t.Fatalf("failed to parse access token: %v", err)
	}
	if accessClaims.Subject != "user-uuid-123" {
		t.Errorf("access token sub = %q, want %q", accessClaims.Subject, "user-uuid-123")
	}

	refreshClaims, err := testKeys.ParseClaims(*resp.RefreshToken)
	if err != nil {
		t.Fatalf("failed to parse refresh token: %v", err)
	}
	if refreshClaims.Subject != "user-uuid-123" {
		t.Errorf("refresh token sub = %q, want %q", refreshClaims.Subject, "user-uuid-123")
	}
	if refreshClaims.Azp != "test-client" {
		t.Errorf("refresh token azp = %q, want %q", refreshClaims.Azp, "test-client")
	}

	if _, ok := ec.store["authcode:test-code-1"]; ok {
		t.Error("expected authorization code to be deleted after exchange")
	}
}

func TestOAuthTokenHandler_Component_AuthorizationCode_WrongVerifier_Rejected(t *testing.T) {
	testutil.Component(t)

	ec := newFakeEC()
	svc := &Service{
		CacheClient:          db.NewFromOperations(ec),
		JWT:                  testKeys,
		ClientRegistry:       testRegistry,
		authCodeGrantEnabled: true,
	}

	storeTestAuthCode(t, ec, "test-code-wrong-verifier", &db.AuthCodeEntry{
		ClientID:      "test-client",
		RedirectURI:   "https://example.com/cb",
		Scope:         "read",
		UserID:        "user-uuid-123",
		CodeChallenge: testCodeChallenge,
	})

	wrongVerifier := "this-is-a-completely-wrong-verifier-value"
	code := "test-code-wrong-verifier"
	redirectURI := "https://example.com/cb"
	rr := postJSON(t, svc.OAuthTokenHandler, models.TokenRequest{
		GrantType:    models.TokenRequestGrantTypeAuthorizationCode,
		ClientId:     "test-client",
		Code:         &code,
		CodeVerifier: &wrongVerifier,
		RedirectUri:  &redirectURI,
	})
	checkStatus(t, rr, http.StatusUnauthorized)
}

func TestOAuthTokenHandler_Component_AuthorizationCode_SingleUseReplay_Rejected(t *testing.T) {
	testutil.Component(t)

	ec := newFakeEC()
	svc := &Service{
		CacheClient:          db.NewFromOperations(ec),
		JWT:                  testKeys,
		ClientRegistry:       testRegistry,
		authCodeGrantEnabled: true,
	}

	storeTestAuthCode(t, ec, "test-code-replay", &db.AuthCodeEntry{
		ClientID:      "test-client",
		RedirectURI:   "https://example.com/cb",
		Scope:         "read",
		UserID:        "user-uuid-123",
		CodeChallenge: testCodeChallenge,
	})

	verifier := testCodeVerifier
	code := "test-code-replay"
	redirectURI := "https://example.com/cb"

	rr1 := postJSON(t, svc.OAuthTokenHandler, models.TokenRequest{
		GrantType:    models.TokenRequestGrantTypeAuthorizationCode,
		ClientId:     "test-client",
		Code:         &code,
		CodeVerifier: &verifier,
		RedirectUri:  &redirectURI,
	})
	checkStatus(t, rr1, http.StatusOK)

	rr2 := postJSON(t, svc.OAuthTokenHandler, models.TokenRequest{
		GrantType:    models.TokenRequestGrantTypeAuthorizationCode,
		ClientId:     "test-client",
		Code:         &code,
		CodeVerifier: &verifier,
		RedirectUri:  &redirectURI,
	})
	checkStatus(t, rr2, http.StatusUnauthorized)
}

func TestOAuthTokenHandler_Component_AuthorizationCode_DisabledFlag_Returns501(t *testing.T) {
	testutil.Component(t)

	svc := srv()

	verifier := testCodeVerifier
	code := "auth-code-123"
	redirectURI := "https://example.com/cb"
	rr := postJSON(t, svc.OAuthTokenHandler, models.TokenRequest{
		GrantType:    models.TokenRequestGrantTypeAuthorizationCode,
		ClientId:     "test-client",
		Code:         &code,
		CodeVerifier: &verifier,
		RedirectUri:  &redirectURI,
	})
	checkStatus(t, rr, http.StatusNotImplemented)
}

func TestOAuthTokenHandler_Component_AuthorizationCode_RedirectURIMismatch_Rejected(t *testing.T) {
	testutil.Component(t)

	ec := newFakeEC()
	svc := &Service{
		CacheClient:          db.NewFromOperations(ec),
		JWT:                  testKeys,
		ClientRegistry:       testRegistry,
		authCodeGrantEnabled: true,
	}

	storeTestAuthCode(t, ec, "test-code-redirect", &db.AuthCodeEntry{
		ClientID:      "test-client",
		RedirectURI:   "https://example.com/cb",
		Scope:         "read",
		UserID:        "user-uuid-123",
		CodeChallenge: testCodeChallenge,
	})

	verifier := testCodeVerifier
	code := "test-code-redirect"
	wrongRedirect := "https://evil.com/cb"
	rr := postJSON(t, svc.OAuthTokenHandler, models.TokenRequest{
		GrantType:    models.TokenRequestGrantTypeAuthorizationCode,
		ClientId:     "test-client",
		Code:         &code,
		CodeVerifier: &verifier,
		RedirectUri:  &wrongRedirect,
	})
	checkStatus(t, rr, http.StatusUnauthorized)
}

func TestOAuthTokenHandler_Component_AuthorizationCode_UnknownClientID_Rejected(t *testing.T) {
	testutil.Component(t)

	ec := newFakeEC()
	svc := &Service{
		CacheClient:          db.NewFromOperations(ec),
		JWT:                  testKeys,
		ClientRegistry:       testRegistry,
		authCodeGrantEnabled: true,
	}

	verifier := testCodeVerifier
	code := "test-code-unknown-client"
	redirectURI := "https://example.com/cb"
	rr := postJSON(t, svc.OAuthTokenHandler, models.TokenRequest{
		GrantType:    models.TokenRequestGrantTypeAuthorizationCode,
		ClientId:     "nonexistent-client",
		Code:         &code,
		CodeVerifier: &verifier,
		RedirectUri:  &redirectURI,
	})
	checkStatus(t, rr, http.StatusUnauthorized)
}

func TestOAuthTokenHandler_Component_AuthorizationCode_ClientIDMismatch_Rejected(t *testing.T) {
	testutil.Component(t)

	ec := newFakeEC()

	if err := testRegistry.Reload(`{"test-client":{"name":"Test","secret_hash":"9caf06bb4436cdbfa20af9121a626bc1093c4f54b31c0fa937957856135345b6","allowed_scopes":["read","write"],"allowed_audiences":["komodo-apis:service","komodo-apis:user"],"allowed_redirect_uris":["https://example.com/cb"]},"other-client":{"name":"Other","secret_hash":"9caf06bb4436cdbfa20af9121a626bc1093c4f54b31c0fa937957856135345b6","allowed_scopes":["read"],"allowed_audiences":["komodo-apis:service"],"allowed_redirect_uris":["https://other.com/cb"]}}`); err != nil {
		t.Fatalf("failed to reload registry: %v", err)
	}
	t.Cleanup(func() {
		testRegistry.Reload(`{"test-client":{"name":"Test","secret_hash":"9caf06bb4436cdbfa20af9121a626bc1093c4f54b31c0fa937957856135345b6","allowed_scopes":["read","write"],"allowed_audiences":["komodo-apis:service","komodo-apis:user"],"allowed_redirect_uris":["https://example.com/cb"]}}`) //nolint:errcheck
	})

	svc := &Service{
		CacheClient:          db.NewFromOperations(ec),
		JWT:                  testKeys,
		ClientRegistry:       testRegistry,
		authCodeGrantEnabled: true,
	}

	storeTestAuthCode(t, ec, "test-code-client-mismatch", &db.AuthCodeEntry{
		ClientID:      "test-client",
		RedirectURI:   "https://example.com/cb",
		Scope:         "read",
		UserID:        "user-uuid-123",
		CodeChallenge: testCodeChallenge,
	})

	verifier := testCodeVerifier
	code := "test-code-client-mismatch"
	redirectURI := "https://example.com/cb"
	rr := postJSON(t, svc.OAuthTokenHandler, models.TokenRequest{
		GrantType:    models.TokenRequestGrantTypeAuthorizationCode,
		ClientId:     "other-client",
		Code:         &code,
		CodeVerifier: &verifier,
		RedirectUri:  &redirectURI,
	})
	checkStatus(t, rr, http.StatusUnauthorized)
}

func TestOAuthTokenHandler_Component_AuthorizationCode_ExpiredCode_Rejected(t *testing.T) {
	testutil.Component(t)

	ec := newFakeEC()
	svc := &Service{
		CacheClient:          db.NewFromOperations(ec),
		JWT:                  testKeys,
		ClientRegistry:       testRegistry,
		authCodeGrantEnabled: true,
	}

	verifier := testCodeVerifier
	code := "nonexistent-code"
	redirectURI := "https://example.com/cb"
	rr := postJSON(t, svc.OAuthTokenHandler, models.TokenRequest{
		GrantType:    models.TokenRequestGrantTypeAuthorizationCode,
		ClientId:     "test-client",
		Code:         &code,
		CodeVerifier: &verifier,
		RedirectUri:  &redirectURI,
	})
	checkStatus(t, rr, http.StatusUnauthorized)
}

func TestOAuthTokenHandler_Component_RefreshToken_BanCheck_NilUser_FailsOpen(t *testing.T) {
	testutil.Component(t)

	const userUUID = "550e8400-e29b-41d4-a716-446655440098"
	ec := newFakeEC()
	refreshTok := makeAZPRefreshToken(t, userUUID, "komodo-apis:user", "test-client")

	httpClient := &fakeHttpClient{
		getUserByIDResult: nil,
		getUserByIDErr:    nil,
	}

	svc := &Service{
		CacheClient:    db.NewFromOperations(ec),
		JWT:            testKeys,
		ClientRegistry: testRegistry,
		HttpClient:     httpClient,
		BannedChecker:  &fakeBannedChecker{banned: true, err: nil},
	}

	rr := postJSON(t, svc.OAuthTokenHandler, models.TokenRequest{
		GrantType:    models.TokenRequestGrantTypeRefreshToken,
		ClientId:     "test-client",
		ClientSecret: "test-secret",
		RefreshToken: &refreshTok,
	})
	checkStatus(t, rr, http.StatusOK)
}

func TestOAuthTokenHandler_Component_RefreshToken_BanCheck_BannedCheckError_FailsOpen(t *testing.T) {
	testutil.Component(t)

	const userUUID = "550e8400-e29b-41d4-a716-446655440097"
	ec := newFakeEC()
	refreshTok := makeAZPRefreshToken(t, userUUID, "komodo-apis:user", "test-client")

	httpClient := &fakeHttpClient{
		getUserByIDResult: &usermodels.User{
			UserId: userUUID,
			Email:  "user@example.com",
		},
	}

	svc := &Service{
		CacheClient:    db.NewFromOperations(ec),
		JWT:            testKeys,
		ClientRegistry: testRegistry,
		HttpClient:     httpClient,
		BannedChecker:  &fakeBannedChecker{banned: false, err: fmt.Errorf("dynamodb unavailable")},
	}

	rr := postJSON(t, svc.OAuthTokenHandler, models.TokenRequest{
		GrantType:    models.TokenRequestGrantTypeRefreshToken,
		ClientId:     "test-client",
		ClientSecret: "test-secret",
		RefreshToken: &refreshTok,
	})
	checkStatus(t, rr, http.StatusOK)
}

func TestOAuthTokenHandler_Component_RefreshToken_CacheError_IsFamilyRevoked_Returns500(t *testing.T) {
	testutil.Component(t)

	ec := &keyPrefixErrEC{
		fakeEC:    fakeEC{store: make(map[string]string)},
		errPrefix: "revoked_family:",
		prefixErr: fmt.Errorf("redis unavailable"),
	}

	tok, err := testKeys.SignRefreshToken("test-issuer", "test-client", "komodo-apis:service", "test-client", "family-err-2", 86400, []string{"offline_access"})
	if err != nil {
		t.Fatalf("failed to sign refresh token: %v", err)
	}

	svc := &Service{
		CacheClient:    db.NewFromOperations(ec),
		JWT:            testKeys,
		ClientRegistry: testRegistry,
	}

	rr := postJSON(t, svc.OAuthTokenHandler, models.TokenRequest{
		GrantType:    models.TokenRequestGrantTypeRefreshToken,
		ClientId:     "test-client",
		ClientSecret: "test-secret",
		RefreshToken: &tok,
	})
	checkStatus(t, rr, http.StatusInternalServerError)
}

func TestOAuthTokenHandler_Component_RefreshToken_SignAccessTokenError_Returns500(t *testing.T) {
	testutil.Component(t)

	refreshTok, err := testKeys.SignTokenWithAZP("test-issuer", "test-client", "komodo-apis:service", "test-client", 86400, []string{"offline_access"})
	if err != nil {
		t.Fatalf("failed to sign refresh token: %v", err)
	}

	ec := newFakeEC()
	svc := &Service{
		CacheClient:    db.NewFromOperations(ec),
		JWT:            &failingSignAuthority{base: testKeys, failAfter: 0},
		ClientRegistry: testRegistry,
		ScopeValidator: secAuth.New(secAuth.Config{}),
	}

	rr := postJSON(t, svc.OAuthTokenHandler, models.TokenRequest{
		GrantType:    models.TokenRequestGrantTypeRefreshToken,
		ClientId:     "test-client",
		ClientSecret: "test-secret",
		RefreshToken: &refreshTok,
	})
	checkStatus(t, rr, http.StatusInternalServerError)
}

func TestOAuthTokenHandler_Component_RefreshToken_SignRefreshTokenError_Returns500(t *testing.T) {
	testutil.Component(t)

	refreshTok, err := testKeys.SignTokenWithAZP("test-issuer", "test-client", "komodo-apis:service", "test-client", 86400, []string{"offline_access"})
	if err != nil {
		t.Fatalf("failed to sign refresh token: %v", err)
	}

	ec := newFakeEC()
	svc := &Service{
		CacheClient:    db.NewFromOperations(ec),
		JWT:            &failingSignAuthority{base: testKeys, failAfter: 1},
		ClientRegistry: testRegistry,
		ScopeValidator: secAuth.New(secAuth.Config{}),
	}

	rr := postJSON(t, svc.OAuthTokenHandler, models.TokenRequest{
		GrantType:    models.TokenRequestGrantTypeRefreshToken,
		ClientId:     "test-client",
		ClientSecret: "test-secret",
		RefreshToken: &refreshTok,
	})
	checkStatus(t, rr, http.StatusInternalServerError)
}

// ── Integration Tests: OAuthTokenHandler ─────────────────────────────────────

func TestOAuthTokenHandler_Integration_RefreshToken_ValidNonRevoked(t *testing.T) {
	testutil.Integration(t)

	const userUUID = "550e8400-e29b-41d4-a716-446655440000"

	redisAddr := startRedisContainer(t)
	cache := newCacheFromAddr(t, redisAddr)

	uStub := customerAPIStub(t, userUUID)
	defer uStub.Close()
	cStub := commsStub(t)
	defer cStub.Close()

	svc := srvIntegration(t, cache, nil, uStub.URL, cStub.URL)

	refreshTok := makeAZPRefreshToken(t, userUUID, "komodo-apis:user", "test-client")

	rr := postJSON(t, svc.OAuthTokenHandler, models.TokenRequest{
		GrantType:    models.TokenRequestGrantTypeRefreshToken,
		ClientId:     "test-client",
		ClientSecret: "test-secret",
		RefreshToken: &refreshTok,
	})
	checkStatus(t, rr, http.StatusOK)

	resp := decodeJSON[models.TokenResponse](t, rr)
	if resp.AccessToken == "" {
		t.Error("expected non-empty access token in refresh response")
	}
	if resp.TokenType != "Bearer" {
		t.Errorf("expected token type Bearer, got %q", resp.TokenType)
	}
	if resp.ExpiresIn <= 0 {
		t.Errorf("expected positive expires_in, got %d", resp.ExpiresIn)
	}
}

// ── Component Tests: OAuthTokenHandler form-encoded ──────────────────────────

func TestOAuthTokenHandler_Component_FormEncoded_ClientCredentials(t *testing.T) {
	testutil.Component(t)

	rr := postForm(srv().OAuthTokenHandler, url.Values{
		"grant_type":    {"client_credentials"},
		"client_id":     {"test-client"},
		"client_secret": {"test-secret"},
		"scope":         {"read"},
	})
	checkStatus(t, rr, http.StatusOK)

	if body := rr.Body.String(); !strings.Contains(body, `"access_token"`) {
		t.Errorf("expected snake_case access_token in response body, got: %s", body)
	}

	resp := decodeJSON[models.TokenResponse](t, rr)
	if resp.AccessToken == "" {
		t.Fatal("expected a non-empty access_token from a form-encoded request")
	}

	claims, err := testKeys.ParseClaims(resp.AccessToken)
	if err != nil {
		t.Fatalf("failed to parse issued token: %v", err)
	}
	if !slices.Contains(claims.Scopes, "svc:test-client") {
		t.Errorf("expected svc:test-client scope on M2M token, got %v", claims.Scopes)
	}
}

func TestOAuthTokenHandler_Component_FormEncoded_BasicAuthCredentials(t *testing.T) {
	testutil.Component(t)

	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(url.Values{
		"grant_type": {"client_credentials"},
	}.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.SetBasicAuth("test-client", "test-secret")
	rr := httptest.NewRecorder()
	srv().OAuthTokenHandler(rr, req)

	checkStatus(t, rr, http.StatusOK)
}

package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/rdevitto86/komodo-forge-sdk-go/security/jwt"
)

// ── Unit Tests ───────────────────────────────────────────────────────────────

func TestJWTConfig_MapsSecrets(t *testing.T) {
	secrets := map[string]string{
		jwt.JWT_PRIVATE_KEY: "private-pem",
		jwt.JWT_PUBLIC_KEY:  "public-pem",
		jwt.JWT_KID:         "kid-1",
		jwt.JWT_ISSUER:      "komodo-auth-api",
		jwt.JWT_AUDIENCE:    "komodo-apis",
	}

	cfg := jwtConfig(secrets)

	if cfg.PrivateKeyPEM != "private-pem" {
		t.Errorf("PrivateKeyPEM: expected %q, got %q", "private-pem", cfg.PrivateKeyPEM)
	}
	if cfg.PublicKeyPEM != "public-pem" {
		t.Errorf("PublicKeyPEM: expected %q, got %q", "public-pem", cfg.PublicKeyPEM)
	}
	if cfg.KID != "kid-1" {
		t.Errorf("KID: expected %q, got %q", "kid-1", cfg.KID)
	}
	if cfg.Issuer != "komodo-auth-api" {
		t.Errorf("Issuer: expected %q, got %q", "komodo-auth-api", cfg.Issuer)
	}
	if cfg.Audience != "komodo-apis" {
		t.Errorf("Audience: expected %q, got %q", "komodo-apis", cfg.Audience)
	}
}

func TestJWTConfig_MissingKeys_YieldEmptyFields(t *testing.T) {
	cfg := jwtConfig(map[string]string{})

	if cfg.PrivateKeyPEM != "" || cfg.PublicKeyPEM != "" || cfg.KID != "" || cfg.Issuer != "" || cfg.Audience != "" {
		t.Errorf("expected all-empty config for empty secrets, got %+v", cfg)
	}
}

var registeredRoutes = []struct {
	method string
	path   string
}{
	{http.MethodGet, "/health"},
	{http.MethodGet, "/health/ready"},
	{http.MethodPost, "/v1/oauth/introspect"},
	{http.MethodPost, "/v1/token/validate"},
	{http.MethodGet, "/v1/clients"},
	{http.MethodGet, "/v1/clients/some-id"},
}

// ── Component Tests ───────────────────────────────────────────────────────────

func TestNewMux_Component_AllRoutesRegistered(t *testing.T) {
	mux := newMux(nil)
	for _, r := range registeredRoutes {
		req := httptest.NewRequest(r.method, r.path, nil)
		_, pattern := mux.Handler(req)
		if pattern == "" {
			t.Errorf("route not registered: %s %s", r.method, r.path)
		}
	}
}

func TestNewMux_Component_WrongMethod_Returns405(t *testing.T) {
	mux := newMux(nil)
	cases := []struct {
		wrongMethod string
		path        string
	}{
		{http.MethodPost, "/health"},
		{http.MethodPost, "/health/ready"},
		{http.MethodGet, "/v1/oauth/introspect"},
		{http.MethodGet, "/v1/token/validate"},
		{http.MethodPost, "/v1/clients"},
		{http.MethodPost, "/v1/clients/some-id"},
	}
	for _, c := range cases {
		req := httptest.NewRequest(c.wrongMethod, c.path, nil)
		rr := httptest.NewRecorder()
		mux.ServeHTTP(rr, req)
		if rr.Code != http.StatusMethodNotAllowed {
			t.Errorf("%s %s: expected 405, got %d", c.wrongMethod, c.path, rr.Code)
		}
	}
}

func TestNewMux_Component_UnknownPath_Returns404(t *testing.T) {
	mux := newMux(nil)
	req := httptest.NewRequest(http.MethodGet, "/no/such/route", nil)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Errorf("expected 404 for unknown path, got %d", rr.Code)
	}
}

func TestNewMux_Component_HealthReady_CarriesRequestID(t *testing.T) {
	mux := newMux(nil)
	req := httptest.NewRequest(http.MethodGet, "/health/ready", nil)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Header().Get("X-Request-ID") == "" {
		t.Error("expected /health/ready to carry X-Request-ID from RequestIDMiddleware")
	}
}

func TestNewMux_Component_MiddlewareDistinction(t *testing.T) {
	mux := newMux(nil)

	clientMWRoutes := []struct {
		method string
		path   string
	}{
		{http.MethodPost, "/v1/oauth/introspect"},
		{http.MethodGet, "/v1/clients"},
		{http.MethodGet, "/v1/clients/some-id"},
	}
	for _, r := range clientMWRoutes {
		req := httptest.NewRequest(r.method, r.path, nil)
		_, pattern := mux.Handler(req)
		if pattern == "" {
			t.Errorf("%s %s (clientMW) not registered", r.method, r.path)
		}
	}

	validateReq := httptest.NewRequest(http.MethodPost, "/v1/token/validate", nil)
	_, validatePattern := mux.Handler(validateReq)
	if validatePattern == "" {
		t.Error("token/validate route (internalMW) not registered")
	}
}

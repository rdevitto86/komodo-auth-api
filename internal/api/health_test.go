package api

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"komodo-auth-api/internal/db"

	"github.com/rdevitto86/komodo-forge-sdk-go/testing/testutil"
)

// ── Unit Tests: HealthProbe ──────────────────────────────────────────────────

func probePort(t *testing.T, serverURL string) string {
	t.Helper()
	idx := strings.LastIndex(serverURL, ":")
	if idx < 0 {
		t.Fatalf("could not parse port from %q", serverURL)
	}
	return serverURL[idx+1:]
}

func TestHealthProbe_NoPort_Returns1(t *testing.T) {
	if code := HealthProbe(""); code != 1 {
		t.Errorf("expected exit code 1 for empty addr, got %d", code)
	}
	if code := HealthProbe("  "); code != 1 {
		t.Errorf("expected exit code 1 for blank addr, got %d", code)
	}
}

func TestHealthProbe_Healthy_Returns0(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	if code := HealthProbe(probePort(t, srv.URL)); code != 0 {
		t.Errorf("expected exit code 0 for healthy server, got %d", code)
	}
}

func TestHealthProbe_Non2xx_Returns1(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	if code := HealthProbe(probePort(t, srv.URL)); code != 1 {
		t.Errorf("expected exit code 1 for 500 response, got %d", code)
	}
}

func TestHealthProbe_ConnectionRefused_Returns1(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	port := probePort(t, srv.URL)
	srv.Close()

	if code := HealthProbe(port); code != 1 {
		t.Errorf("expected exit code 1 when connection refused, got %d", code)
	}
}

type fakeReadyEC struct {
	existsErr error
}

func (f *fakeReadyEC) Get(_ context.Context, _ string) (string, error)   { return "", nil }
func (f *fakeReadyEC) Set(_ context.Context, _, _ string, _ int64) error { return nil }
func (f *fakeReadyEC) SetNX(_ context.Context, _, _ string, _ int64) (bool, error) {
	return true, nil
}
func (f *fakeReadyEC) Delete(_ context.Context, _ string) error          { return nil }
func (f *fakeReadyEC) Incr(_ context.Context, _ string) (int64, error)   { return 0, nil }
func (f *fakeReadyEC) Expire(_ context.Context, _ string, _ int64) error { return nil }
func (f *fakeReadyEC) Exists(_ context.Context, _ string) (bool, error) {
	return f.existsErr == nil, f.existsErr
}

// ── Component Tests ───────────────────────────────────────────────────────────

func TestHealthHandler_Component_NoChecks_Returns200(t *testing.T) {
	testutil.Component(t)

	h := HealthReadyHandler()
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rr := httptest.NewRecorder()
	h(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
}

func TestHealthHandler_Component_AllChecksPass_Returns200(t *testing.T) {
	testutil.Component(t)

	pass := func(_ context.Context) error { return nil }
	h := HealthReadyHandler(pass, pass)
	req := httptest.NewRequest(http.MethodGet, "/health/ready", nil)
	rr := httptest.NewRecorder()
	h(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
}

func TestHealthHandler_Component_CheckFails_Returns503WithJSON(t *testing.T) {
	testutil.Component(t)

	fail := func(_ context.Context) error { return errors.New("failed to reach redis: connection refused") }
	h := HealthReadyHandler(fail)
	req := httptest.NewRequest(http.MethodGet, "/health/ready", nil)
	rr := httptest.NewRecorder()
	h(rr, req)

	if rr.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503, got %d", rr.Code)
	}
	if ct := rr.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("expected Content-Type application/json, got %q", ct)
	}
	body := rr.Body.String()
	if !strings.Contains(body, "unavailable") {
		t.Errorf("expected body to contain 'unavailable', got: %s", body)
	}
	if strings.Contains(body, "redis") || strings.Contains(body, "connection refused") {
		t.Errorf("response body must not leak internal details, got: %s", body)
	}
}

func TestHealthHandler_Component_RedisReachable_Returns200(t *testing.T) {
	testutil.Component(t)

	cache := db.NewFromOperations(&fakeReadyEC{existsErr: nil})
	h := HealthReadyHandler(cache.Reachable)
	req := httptest.NewRequest(http.MethodGet, "/health/ready", nil)
	rr := httptest.NewRecorder()
	h(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
}

func TestHealthHandler_Component_RedisUnreachable_Returns503(t *testing.T) {
	testutil.Component(t)

	cache := db.NewFromOperations(&fakeReadyEC{existsErr: errors.New("dial tcp: connection refused")})
	h := HealthReadyHandler(cache.Reachable)
	req := httptest.NewRequest(http.MethodGet, "/health/ready", nil)
	rr := httptest.NewRecorder()
	h(rr, req)

	if rr.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503, got %d", rr.Code)
	}
	body := rr.Body.String()
	if !strings.Contains(body, "unavailable") {
		t.Errorf("expected body to contain 'unavailable', got: %s", body)
	}
	if strings.Contains(body, "redis") || strings.Contains(body, "connection refused") {
		t.Errorf("response body must not leak internal details, got: %s", body)
	}
}

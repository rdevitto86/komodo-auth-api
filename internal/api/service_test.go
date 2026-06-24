package api

import (
	"net/http/httptest"
	"testing"

	"komodo-auth-api/internal/clients"
	"komodo-auth-api/internal/db"
)

// ── Unit Tests ───────────────────────────────────────────────────────────────

func TestNew_Wiring(t *testing.T) {
	svc, err := New(ServiceConfig{
		HttpClient: clients.HttpClientConfig{},
	})
	if err != nil {
		t.Fatalf("New returned unexpected error: %v", err)
	}
	if svc == nil {
		t.Fatal("New returned nil *Service")
	}
	if svc.HttpClient == nil {
		t.Error("Service.HttpClient is nil; expected a wired client")
	}
	if svc.CacheClient == nil {
		t.Error("Service.CacheClient is nil; expected a no-op client")
	}
	if svc.HttpReachability == nil {
		t.Error("Service.HttpReachability is nil; expected the same wired HTTP client")
	}
	if svc.BannedReachability != nil {
		t.Error("Service.BannedReachability should be nil when BannedCustomers config is not provided")
	}
}

func TestNew_BannedCustomers_WiresReachability(t *testing.T) {
	svc, err := New(ServiceConfig{
		HttpClient:      clients.HttpClientConfig{},
		BannedCustomers: &clients.BannedCustomersConfig{},
	})
	if err != nil {
		t.Fatalf("New returned unexpected error: %v", err)
	}
	if svc.BannedChecker == nil {
		t.Error("Service.BannedChecker is nil; expected a wired client")
	}
	if svc.BannedReachability == nil {
		t.Error("Service.BannedReachability is nil; expected the same wired banned-customers client")
	}
}

func TestWriteJSON_EncodeError_DoesNotPanic(t *testing.T) {
	rr := httptest.NewRecorder()
	writeJSON(rr, make(chan int))
	if rr.Body.Len() != 0 {
		t.Errorf("expected no body written for unencodable value, got %q", rr.Body.String())
	}
}

func TestNew_CacheClientConfig_NonNumericDB(t *testing.T) {
	svc, err := New(ServiceConfig{
		HttpClient: clients.HttpClientConfig{},
		CacheClient: &db.CacheClientConfig{
			Endpoint: "localhost:6379",
			DB:       "not-a-number",
		},
	})
	if err == nil {
		t.Fatal("expected error when CacheClientConfig.DB is non-numeric, got nil")
	}
	if svc != nil {
		t.Errorf("expected nil *Service on cache init failure, got %+v", svc)
	}
}

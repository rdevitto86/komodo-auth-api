package clients

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	sdkhttp "github.com/rdevitto86/komodo-forge-sdk-go/http/client"
)

// ── Unit Tests ──────────────────────────────────────────────────────────────

func TestNew_ValidConfig_ReturnsClient(t *testing.T) {
	cfg := HttpClientConfig{
		ClientConfig: sdkhttp.ClientConfig{
			Timeout: 5 * time.Second,
		},
	}

	client, err := New(cfg)

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if client == nil {
		t.Fatal("expected non-nil client")
	}
}

func TestNew_EmptyConfig_HandledGracefully(t *testing.T) {
	// New()'s nil-guard branch is currently unreachable — sdkhttp.NewClient never returns nil for any config; update both if that changes.
	client, err := New(HttpClientConfig{})

	if err != nil {
		t.Fatalf("expected no error for zero config, got %v", err)
	}
	if client == nil {
		t.Fatal("expected non-nil client for zero config")
	}
}

func TestCommsReachable_Returns2xx_Nil(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer ts.Close()

	c := &HttpClient{Client: sdkhttp.NewClient(sdkhttp.ClientConfig{}), CommsBaseURL: ts.URL}

	if err := c.CommsReachable(context.Background()); err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
}

func TestCommsReachable_Non2xx_ReturnsError(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer ts.Close()

	c := &HttpClient{Client: sdkhttp.NewClient(sdkhttp.ClientConfig{}), CommsBaseURL: ts.URL}

	if err := c.CommsReachable(context.Background()); err == nil {
		t.Fatal("expected error for non-2xx response, got nil")
	}
}

func TestUserReachable_Returns2xx_Nil(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer ts.Close()

	c := &HttpClient{Client: sdkhttp.NewClient(sdkhttp.ClientConfig{}), UserBaseURL: ts.URL}

	if err := c.UserReachable(context.Background()); err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
}

func TestUserReachable_EmptyBaseURL_ReturnsError(t *testing.T) {
	c := &HttpClient{Client: sdkhttp.NewClient(sdkhttp.ClientConfig{})}

	if err := c.UserReachable(context.Background()); err == nil {
		t.Fatal("expected error when UserBaseURL is unconfigured, got nil")
	}
}

func TestCommsReachable_Unreachable_ReturnsError(t *testing.T) {
	c := &HttpClient{Client: sdkhttp.NewClient(sdkhttp.ClientConfig{}), CommsBaseURL: "http://127.0.0.1:1"}

	if err := c.CommsReachable(context.Background()); err == nil {
		t.Fatal("expected error for unreachable comms endpoint, got nil")
	}
}

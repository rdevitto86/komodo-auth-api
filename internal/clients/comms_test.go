package clients

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	commsmodels "komodo-auth-api/internal/models/comms"

	openapi_types "github.com/oapi-codegen/runtime/types"
	sdkhttp "github.com/rdevitto86/komodo-forge-sdk-go/http/client"
)

// ── Unit Tests ──────────────────────────────────────────────────────────────

func TestSendEmail_ValidBody_ReturnsNil(t *testing.T) {
	done := make(chan struct{})

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer close(done)
		w.WriteHeader(http.StatusOK)
	}))
	defer ts.Close()

	c := &HttpClient{Client: sdkhttp.NewClient(sdkhttp.ClientConfig{}), CommsBaseURL: ts.URL}
	body := commsmodels.SendEmailJSONRequestBody{
		TemplateId: "welcome",
		To:         openapi_types.Email("user@example.com"),
	}

	err := c.SendEmail(context.Background(), body)
	if err != nil {
		t.Fatalf("expected nil return, got %v", err)
	}

	select {
	case <-done:
	case <-time.After(100 * time.Millisecond):
	}
}

func TestSendEmail_SemaphoreFull_DropsGracefully(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(50 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
	}))
	defer ts.Close()

	c := &HttpClient{Client: sdkhttp.NewClient(sdkhttp.ClientConfig{}), CommsBaseURL: ts.URL}

	body := commsmodels.SendEmailJSONRequestBody{
		TemplateId: "otp",
		To:         openapi_types.Email("user@example.com"),
	}

	for range maxConcurrentEmails {
		_ = c.SendEmail(context.Background(), body)
	}

	err := c.SendEmail(context.Background(), body)
	if err != nil {
		t.Fatalf("expected nil return when semaphore is full, got %v", err)
	}

	time.Sleep(100 * time.Millisecond)
}

func TestSendEmail_Upstream5xx_DoesNotPanic(t *testing.T) {
	done := make(chan struct{})

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer close(done)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer ts.Close()

	c := &HttpClient{Client: sdkhttp.NewClient(sdkhttp.ClientConfig{}), CommsBaseURL: ts.URL}
	body := commsmodels.SendEmailJSONRequestBody{
		TemplateId: "welcome",
		To:         openapi_types.Email("user@example.com"),
	}

	err := c.SendEmail(context.Background(), body)
	if err != nil {
		t.Fatalf("expected nil return on 5xx, got %v", err)
	}

	select {
	case <-done:
	case <-time.After(100 * time.Millisecond):
	}
}

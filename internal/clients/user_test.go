package clients

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	sdkhttp "github.com/rdevitto86/komodo-forge-sdk-go/http/client"
)

// ── Unit Tests ──────────────────────────────────────────────────────────────

func TestGetUserCredentials_200_ParsesResponse(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"user_id":"USER#123","email_verified":true,"auth_methods":["password"]}`))
	}))
	defer ts.Close()

	c := &HttpClient{Client: sdkhttp.NewClient(sdkhttp.ClientConfig{}), UserBaseURL: ts.URL}

	result, err := c.GetUserCredentials(context.Background(), "user@example.com", "token")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if result == nil {
		t.Fatal("expected non-nil result")
	}
	if result.UserId != "USER#123" {
		t.Errorf("expected UserId %q, got %q", "USER#123", result.UserId)
	}
}

func TestGetUserCredentials_404_ReturnsError(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer ts.Close()

	c := &HttpClient{Client: sdkhttp.NewClient(sdkhttp.ClientConfig{}), UserBaseURL: ts.URL}

	result, err := c.GetUserCredentials(context.Background(), "missing@example.com", "token")
	if err == nil {
		t.Fatal("expected error for 404 response")
	}
	if result != nil {
		t.Errorf("expected nil result on error, got %+v", result)
	}
}

func TestGetUserCredentials_MalformedJSON_ReturnsError(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{bad json`))
	}))
	defer ts.Close()

	c := &HttpClient{Client: sdkhttp.NewClient(sdkhttp.ClientConfig{}), UserBaseURL: ts.URL}

	result, err := c.GetUserCredentials(context.Background(), "user@example.com", "token")
	if err == nil {
		t.Fatal("expected error for malformed JSON")
	}
	if result != nil {
		t.Errorf("expected nil result on error, got %+v", result)
	}
}

func TestGetUserCredentials_EmailIsURLEncoded(t *testing.T) {
	var capturedEmail string

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedEmail = r.URL.Query().Get("email")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"user_id":"USER#456","email_verified":false,"auth_methods":[]}`))
	}))
	defer ts.Close()

	c := &HttpClient{Client: sdkhttp.NewClient(sdkhttp.ClientConfig{}), UserBaseURL: ts.URL}

	input := "user+tag@example.com"
	_, err := c.GetUserCredentials(context.Background(), input, "token")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if capturedEmail != input {
		t.Errorf("expected decoded email %q in query, got %q", input, capturedEmail)
	}
}

// ── Unit Tests: GetUserByID ──────────────────────────────────────────────────

func TestGetUserByID_200_ParsesResponse(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("expected GET, got %s", r.Method)
		}
		if auth := r.Header.Get("Authorization"); auth != "Bearer token" {
			t.Errorf("expected bearer token header, got %q", auth)
		}
		if !strings.Contains(r.URL.Path, "user-abc-123") {
			t.Errorf("expected user ID in path, got %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"user_id":"user-abc-123","email":"test@example.com"}`))
	}))
	defer ts.Close()

	c := &HttpClient{Client: sdkhttp.NewClient(sdkhttp.ClientConfig{}), UserBaseURL: ts.URL}

	result, err := c.GetUserByID(context.Background(), "user-abc-123", "token")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if result == nil {
		t.Fatal("expected non-nil result")
	}
	if result.UserId != "user-abc-123" {
		t.Errorf("expected UserId %q, got %q", "user-abc-123", result.UserId)
	}
}

func TestGetUserByID_404_ReturnsError(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer ts.Close()

	c := &HttpClient{Client: sdkhttp.NewClient(sdkhttp.ClientConfig{}), UserBaseURL: ts.URL}

	result, err := c.GetUserByID(context.Background(), "missing-user", "token")
	if err == nil {
		t.Fatal("expected error for 404 response")
	}
	if result != nil {
		t.Errorf("expected nil result on error, got %+v", result)
	}
}

func TestGetUserByID_500_ReturnsError(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer ts.Close()

	c := &HttpClient{Client: sdkhttp.NewClient(sdkhttp.ClientConfig{}), UserBaseURL: ts.URL}

	result, err := c.GetUserByID(context.Background(), "user-xyz", "token")
	if err == nil {
		t.Fatal("expected error for 500 response")
	}
	if result != nil {
		t.Errorf("expected nil result on error, got %+v", result)
	}
}

func TestGetUserByID_MalformedJSON_ReturnsError(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{bad json`))
	}))
	defer ts.Close()

	c := &HttpClient{Client: sdkhttp.NewClient(sdkhttp.ClientConfig{}), UserBaseURL: ts.URL}

	result, err := c.GetUserByID(context.Background(), "user-xyz", "token")
	if err == nil {
		t.Fatal("expected error for malformed JSON")
	}
	if result != nil {
		t.Errorf("expected nil result on error, got %+v", result)
	}
}

// ── Unit Tests: ListPasskeyCredentials ───────────────────────────────────────

func TestListPasskeyCredentials_200_ParsesCredentials(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("expected GET, got %s", r.Method)
		}
		if auth := r.Header.Get("Authorization"); auth != "Bearer token" {
			t.Errorf("expected bearer token header, got %q", auth)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"credentials":[{"credential_id":"abc","public_key":"pk","transports":["internal"]}]}`))
	}))
	defer ts.Close()

	c := &HttpClient{Client: sdkhttp.NewClient(sdkhttp.ClientConfig{}), UserBaseURL: ts.URL}

	creds, err := c.ListPasskeyCredentials(context.Background(), "user-123", "token")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(creds) != 1 || creds[0].CredentialId != "abc" {
		t.Fatalf("expected one credential with id 'abc', got %+v", creds)
	}
}

func TestListPasskeyCredentials_500_ReturnsError(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer ts.Close()

	c := &HttpClient{Client: sdkhttp.NewClient(sdkhttp.ClientConfig{}), UserBaseURL: ts.URL}

	if _, err := c.ListPasskeyCredentials(context.Background(), "user-123", "token"); err == nil {
		t.Fatal("expected error for 500 response")
	}
}

func TestListPasskeyCredentials_MalformedJSON_ReturnsError(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{bad json`))
	}))
	defer ts.Close()

	c := &HttpClient{Client: sdkhttp.NewClient(sdkhttp.ClientConfig{}), UserBaseURL: ts.URL}

	if _, err := c.ListPasskeyCredentials(context.Background(), "user-123", "token"); err == nil {
		t.Fatal("expected error for malformed JSON")
	}
}

// ── Unit Tests: CreatePasskeyCredential ──────────────────────────────────────

func TestCreatePasskeyCredential_201_Succeeds(t *testing.T) {
	var capturedMethod string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedMethod = r.Method
		w.WriteHeader(http.StatusCreated)
	}))
	defer ts.Close()

	c := &HttpClient{Client: sdkhttp.NewClient(sdkhttp.ClientConfig{}), UserBaseURL: ts.URL}

	err := c.CreatePasskeyCredential(context.Background(), "user-123", "token", PasskeyCredentialDescriptor{
		CredentialId: "abc",
		PublicKey:    "pk",
	})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if capturedMethod != http.MethodPost {
		t.Errorf("expected POST, got %s", capturedMethod)
	}
}

func TestCreatePasskeyCredential_409_ReturnsError(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusConflict)
	}))
	defer ts.Close()

	c := &HttpClient{Client: sdkhttp.NewClient(sdkhttp.ClientConfig{}), UserBaseURL: ts.URL}

	if err := c.CreatePasskeyCredential(context.Background(), "user-123", "token", PasskeyCredentialDescriptor{CredentialId: "abc"}); err == nil {
		t.Fatal("expected error for 409 response")
	}
}

// ── Unit Tests: UpdatePasskeyCredential ──────────────────────────────────────

func TestUpdatePasskeyCredential_200_Succeeds(t *testing.T) {
	var capturedMethod, capturedPath string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedMethod = r.Method
		capturedPath = r.URL.Path
		w.WriteHeader(http.StatusOK)
	}))
	defer ts.Close()

	c := &HttpClient{Client: sdkhttp.NewClient(sdkhttp.ClientConfig{}), UserBaseURL: ts.URL}

	err := c.UpdatePasskeyCredential(context.Background(), "user-123", "token", PasskeyCredentialDescriptor{CredentialId: "cred-xyz"})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if capturedMethod != http.MethodPatch {
		t.Errorf("expected PATCH, got %s", capturedMethod)
	}
	if !strings.Contains(capturedPath, "cred-xyz") {
		t.Errorf("expected credential id in path, got %q", capturedPath)
	}
}

func TestUpdatePasskeyCredential_404_ReturnsError(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer ts.Close()

	c := &HttpClient{Client: sdkhttp.NewClient(sdkhttp.ClientConfig{}), UserBaseURL: ts.URL}

	if err := c.UpdatePasskeyCredential(context.Background(), "user-123", "token", PasskeyCredentialDescriptor{CredentialId: "cred-xyz"}); err == nil {
		t.Fatal("expected error for 404 response")
	}
}

func TestUpdatePasskeyCredential_MalformedURL_ReturnsError(t *testing.T) {
	c := &HttpClient{Client: sdkhttp.NewClient(sdkhttp.ClientConfig{}), UserBaseURL: "http://[::1]:namedport"}

	err := c.UpdatePasskeyCredential(context.Background(), "user-123", "token", PasskeyCredentialDescriptor{CredentialId: "cred-xyz"})
	if err == nil {
		t.Fatal("expected error for malformed URL")
	}
}

func TestCreatePasskeyCredential_MalformedURL_ReturnsError(t *testing.T) {
	c := &HttpClient{Client: sdkhttp.NewClient(sdkhttp.ClientConfig{}), UserBaseURL: "http://[::1]:namedport"}

	err := c.CreatePasskeyCredential(context.Background(), "user-123", "token", PasskeyCredentialDescriptor{CredentialId: "cred-xyz"})
	if err == nil {
		t.Fatal("expected error for malformed URL")
	}
}

func TestGetUserByID_MalformedURL_ReturnsError(t *testing.T) {
	c := &HttpClient{Client: sdkhttp.NewClient(sdkhttp.ClientConfig{}), UserBaseURL: "http://[::1]:namedport"}

	_, err := c.GetUserByID(context.Background(), "user-123", "token")
	if err == nil {
		t.Fatal("expected error for malformed URL")
	}
}

package api

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/rdevitto86/komodo-forge-sdk-go/api/idempotency"
	mw "github.com/rdevitto86/komodo-forge-sdk-go/api/middleware"
	"github.com/rdevitto86/komodo-forge-sdk-go/testing/testutil"
)

// ── Setup ────────────────────────────────────────────────────────────────────

func otpRequestWithKey(t *testing.T, handler http.Handler, email, idempotencyKey string) *httptest.ResponseRecorder {
	t.Helper()
	body := fmt.Sprintf(`{"email":%q}`, email)
	req := httptest.NewRequest(http.MethodPost, "/v1/otp/request", bytes.NewReader([]byte(body)))
	req.Header.Set("Content-Type", "application/json")
	if idempotencyKey != "" {
		req.Header.Set("Idempotency-Key", idempotencyKey)
	}
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	return rr
}

// ── Component Tests: Idempotency ─────────────────────────────────────────────

func TestOTPRequestHandler_Component_Idempotency_DuplicateKeyRejected(t *testing.T) {
	testutil.Component(t)
	idempotency.SetStore(idempotency.NewStore("local", 300))

	fake := &fakeHttpClient{}
	s, _ := srvWithFakeEC(t, fake)
	handler := mw.Chain(s.OTPRequestHandler, mw.IdempotencyMiddleware)

	const key = "retry-key-12345"

	first := otpRequestWithKey(t, handler, otpTestEmail, key)
	checkStatus(t, first, http.StatusOK)
	if fake.sendEmailCalls != 1 {
		t.Fatalf("expected 1 SendEmail call after first request, got %d", fake.sendEmailCalls)
	}

	second := otpRequestWithKey(t, handler, otpTestEmail, key)
	checkStatus(t, second, http.StatusConflict)
	if second.Header().Get("Idempotency-Replayed") != "true" {
		t.Error("expected Idempotency-Replayed: true header on duplicate request")
	}
	if fake.sendEmailCalls != 1 {
		t.Fatalf("expected SendEmail not called again on duplicate, got %d total calls", fake.sendEmailCalls)
	}
}

func TestOTPRequestHandler_Component_Idempotency_DifferentKeysBothSucceed(t *testing.T) {
	testutil.Component(t)
	idempotency.SetStore(idempotency.NewStore("local", 300))

	fake := &fakeHttpClient{}
	s, _ := srvWithFakeEC(t, fake)
	handler := mw.Chain(s.OTPRequestHandler, mw.IdempotencyMiddleware)

	first := otpRequestWithKey(t, handler, otpTestEmail, "first-key-1234")
	checkStatus(t, first, http.StatusOK)

	second := otpRequestWithKey(t, handler, "other-"+otpTestEmail, "second-key-5678")
	checkStatus(t, second, http.StatusOK)

	if fake.sendEmailCalls != 2 {
		t.Fatalf("expected 2 SendEmail calls for distinct idempotency keys, got %d", fake.sendEmailCalls)
	}
}

func TestOTPRequestHandler_Component_Idempotency_MissingKeyRejected(t *testing.T) {
	testutil.Component(t)
	idempotency.SetStore(idempotency.NewStore("local", 300))

	fake := &fakeHttpClient{}
	s, _ := srvWithFakeEC(t, fake)
	handler := mw.Chain(s.OTPRequestHandler, mw.IdempotencyMiddleware)

	rr := otpRequestWithKey(t, handler, otpTestEmail, "")
	checkStatus(t, rr, http.StatusBadRequest)
}

// ── Component Tests: MaxContentLength ────────────────────────────────────────

func TestOTPRequestHandler_Component_MaxContentLength_OversizedBodyRejected(t *testing.T) {
	testutil.Component(t)

	fake := &fakeHttpClient{}
	s, _ := srvWithFakeEC(t, fake)
	handler := mw.MaxContentLengthMiddleware(16)(http.HandlerFunc(s.OTPRequestHandler))

	body := fmt.Sprintf(`{"email":%q}`, otpTestEmail)
	req := httptest.NewRequest(http.MethodPost, "/v1/otp/request", bytes.NewReader([]byte(body)))
	req.Header.Set("Content-Type", "application/json")
	req.ContentLength = int64(len(body))
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	checkStatus(t, rr, http.StatusRequestEntityTooLarge)
}

func TestOTPRequestHandler_Component_MaxContentLength_WithinLimitSucceeds(t *testing.T) {
	testutil.Component(t)

	fake := &fakeHttpClient{}
	s, _ := srvWithFakeEC(t, fake)
	handler := mw.MaxContentLengthMiddleware(4096)(http.HandlerFunc(s.OTPRequestHandler))

	body := fmt.Sprintf(`{"email":%q}`, otpTestEmail)
	req := httptest.NewRequest(http.MethodPost, "/v1/otp/request", bytes.NewReader([]byte(body)))
	req.Header.Set("Content-Type", "application/json")
	req.ContentLength = int64(len(body))
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	checkStatus(t, rr, http.StatusOK)
}

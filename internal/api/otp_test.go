package api

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"komodo-auth-api/internal/clients"
	"komodo-auth-api/internal/db"
	"komodo-auth-api/internal/models"
	usermodels "komodo-auth-api/internal/models/user"
	"komodo-auth-api/internal/testutil/mocks"

	"github.com/rdevitto86/komodo-forge-sdk-go/testing/testutil"

	awsEC "github.com/rdevitto86/komodo-forge-sdk-go/db/redis"
	"go.uber.org/mock/gomock"
)

func postRawOTPRequest(t *testing.T, handler handlerFn, email string) *httptest.ResponseRecorder {
	t.Helper()
	body := fmt.Sprintf(`{"email":%q}`, email)
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader([]byte(body)))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	handler(rr, req)
	return rr
}

func postRawOTPVerify(t *testing.T, handler handlerFn, email, code string) *httptest.ResponseRecorder {
	t.Helper()
	body := fmt.Sprintf(`{"email":%q,"code":%q}`, email, code)
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader([]byte(body)))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	handler(rr, req)
	return rr
}

// ── Unit Tests: OTPRequestHandler ────────────────────────────────────────────

func TestOTPRequestHandler_Unit(t *testing.T) {
	t.Run("BadJSON_Returns400", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/otp/request", strings.NewReader("not-json"))
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()
		srv().OTPRequestHandler(rr, req)
		checkStatus(t, rr, http.StatusBadRequest)
	})

	cases := []struct {
		name  string
		email string
	}{
		{"MissingEmail", ""},
		{"InvalidEmail_NoAtSign", "notanemail"},
		{"InvalidEmail_Hyphenated", "not-an-email"},
	}
	for _, tc := range cases {
		t.Run(tc.name+"_Returns400", func(t *testing.T) {
			rr := postRawOTPRequest(t, srv().OTPRequestHandler, tc.email)
			checkStatus(t, rr, http.StatusBadRequest)
		})
	}
}

// ── Unit Tests: OTPVerifyHandler ─────────────────────────────────────────────

func TestOTPVerifyHandler_Unit(t *testing.T) {
	t.Run("BadJSON_Returns400", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/otp/verify", strings.NewReader("not-json"))
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()
		srv().OTPVerifyHandler(rr, req)
		checkStatus(t, rr, http.StatusBadRequest)
	})

	cases := []struct {
		name  string
		email string
		code  string
	}{
		{"MissingEmail", "", "123456"},
		{"InvalidEmail_NoAtSign", "notanemail", "123456"},
		{"MissingCode", "user@example.com", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name+"_Returns400", func(t *testing.T) {
			rr := postRawOTPVerify(t, srv().OTPVerifyHandler, tc.email, tc.code)
			checkStatus(t, rr, http.StatusBadRequest)
		})
	}
}

// ── Integration Tests ────────────────────────────────────────────────────────

func TestOTPRequestHandler_Integration_ValidEmail_Succeeds(t *testing.T) {
	testutil.Integration(t)

	redisAddr := startRedisContainer(t)
	cache := newCacheFromAddr(t, redisAddr)

	uStub := userAPIStub(t, "f0e1d2c3-b4a5-9678-90ab-cdef01234567")
	defer uStub.Close()
	cStub := commsStub(t)
	defer cStub.Close()

	svc := srvIntegration(t, cache, nil, uStub.URL, cStub.URL)

	rr := postJSON(t, svc.OTPRequestHandler, models.OTPRequest{Email: "integration-test@example.com"})
	checkStatus(t, rr, http.StatusOK)

	type otpReqResp struct {
		Message string `json:"message"`
	}
	resp := decodeJSON[otpReqResp](t, rr)
	if resp.Message == "" {
		t.Error("expected non-empty message in OTP request response")
	}
}

func TestOTPVerify_Integration_RoundTrip(t *testing.T) {
	testutil.Integration(t)

	redisAddr := startRedisContainer(t)

	rc, err := awsEC.New(awsEC.Config{Addr: redisAddr})
	if err != nil {
		t.Fatalf("failed to connect to Redis at %s: %v", redisAddr, err)
	}
	defer rc.Close()

	const (
		testEmail = "integration-roundtrip@example.com"
		testCode  = "888999"
	)

	ctx := context.Background()
	if err := rc.Set(ctx, "otp:"+testEmail, testCode, 300); err != nil {
		t.Fatalf("failed to seed OTP key: %v", err)
	}
	if err := rc.Set(ctx, "otp:attempts:"+testEmail, "0", 300); err != nil {
		t.Fatalf("failed to seed attempts key: %v", err)
	}

	svc := &Service{
		HttpClient: &fakeHttpClient{
			getUserCredsResult: &usermodels.CredentialsResponse{UserId: "f0e1d2c3-b4a5-9678-90ab-cdef01234567"},
		},
		CacheClient: db.NewFromOperations(rc),
		JWT:         testKeys,
	}

	rr := postRawOTPVerify(t, svc.OTPVerifyHandler, testEmail, testCode)
	checkStatus(t, rr, http.StatusOK)

	resp := decodeJSON[models.TokenResponse](t, rr)
	if resp.AccessToken == "" {
		t.Error("expected non-empty access_token in round-trip verify response")
	}
	if resp.TokenType != "Bearer" {
		t.Errorf("expected token_type=Bearer, got %q", resp.TokenType)
	}
	if resp.Scope == nil || *resp.Scope != "otp:verified" {
		t.Errorf("expected scope=otp:verified, got %v", resp.Scope)
	}
}

func TestOTPVerify_Integration_AttemptCounter(t *testing.T) {
	testutil.Integration(t)

	redisAddr := startRedisContainer(t)

	rc, err := awsEC.New(awsEC.Config{Addr: redisAddr})
	if err != nil {
		t.Fatalf("failed to connect to Redis at %s: %v", redisAddr, err)
	}
	defer rc.Close()

	const (
		testEmail = "attempt-counter@example.com"
		realCode  = "111222"
		wrongCode = "000000"
	)

	ctx := context.Background()
	if err := rc.Set(ctx, "otp:"+testEmail, realCode, 300); err != nil {
		t.Fatalf("failed to seed OTP key: %v", err)
	}
	if err := rc.Set(ctx, "otp:attempts:"+testEmail, "0", 300); err != nil {
		t.Fatalf("failed to seed attempts key: %v", err)
	}

	svc := &Service{
		HttpClient:  &fakeHttpClient{},
		CacheClient: db.NewFromOperations(rc),
		JWT:         testKeys,
	}

	var lastRR *httptest.ResponseRecorder
	for i := 0; i < db.MaxOTPAttempts; i++ {
		lastRR = postRawOTPVerify(t, svc.OTPVerifyHandler, testEmail, wrongCode)
		checkStatus(t, lastRR, http.StatusUnauthorized)
	}

	rr := postRawOTPVerify(t, svc.OTPVerifyHandler, testEmail, wrongCode)
	checkStatus(t, rr, http.StatusTooManyRequests)
}

const (
	otpTestEmail = "fallback@example.com"
	otpTestCode  = "123456"
	otpKeyPrefix = "otp:"
)

func srvWithFakeEC(t *testing.T, httpClient clients.HttpClientCallers) (*Service, *fakeEC) {
	t.Helper()
	ec := newFakeEC()
	ec.store[otpKeyPrefix+otpTestEmail] = otpTestCode
	svc := &Service{
		HttpClient:  httpClient,
		CacheClient: db.NewFromOperations(ec),
		JWT:         testKeys,
	}
	return svc, ec
}

// ── Component Tests: OTPRequestHandler ──────────────────────────────────────

func TestOTPRequestHandler_Component_Cooldown_Returns429(t *testing.T) {
	testutil.Component(t)

	ec := newFakeEC()
	ec.store["otp:cooldown:cooldown@example.com"] = "1"

	svc := &Service{
		HttpClient:  &fakeHttpClient{},
		CacheClient: db.NewFromOperations(ec),
		JWT:         testKeys,
	}

	rr := postRawOTPRequest(t, svc.OTPRequestHandler, "cooldown@example.com")
	checkStatus(t, rr, http.StatusTooManyRequests)
}

func TestOTPRequestHandler_Component_GenerateError_Returns500(t *testing.T) {
	testutil.Component(t)

	ec := newFakeEC()
	ec.setErr = fmt.Errorf("redis unavailable")

	svc := &Service{
		HttpClient:  &fakeHttpClient{},
		CacheClient: db.NewFromOperations(ec),
		JWT:         testKeys,
	}

	rr := postRawOTPRequest(t, svc.OTPRequestHandler, "err@example.com")
	checkStatus(t, rr, http.StatusInternalServerError)
}

func TestOTPRequestHandler_Component_SendEmailError_StillReturns200(t *testing.T) {
	testutil.Component(t)

	ec := newFakeEC()
	svc := &Service{
		HttpClient:  &fakeHttpClient{sendEmailErr: fmt.Errorf("comms-api unavailable")},
		CacheClient: db.NewFromOperations(ec),
		JWT:         testKeys,
	}

	rr := postRawOTPRequest(t, svc.OTPRequestHandler, "email-err@example.com")
	checkStatus(t, rr, http.StatusOK)
}

// ── Component Tests: OTPVerifyHandler ────────────────────────────────────────

func TestOTPVerifyHandler_Component(t *testing.T) {
	testutil.Component(t)

	credsCases := []struct {
		name       string
		creds      *usermodels.CredentialsResponse
		err        error
		wantStatus int
	}{
		{"UserAPI_5xx_FailsVerify", nil, errors.New("user-api: 500 Internal Server Error"), http.StatusServiceUnavailable},
		{"UserAPI_404_FailsVerify", nil, fmt.Errorf("user-api: 404 Not Found"), http.StatusServiceUnavailable},
		{"UserAPI_NetworkError_FailsVerify", nil, errors.New("dial tcp: connection refused"), http.StatusServiceUnavailable},
		{"UserAPI_NilCredsNoError_AccountNotFound", nil, nil, http.StatusUnauthorized},
	}
	for _, tc := range credsCases {
		t.Run(tc.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			mockHTTP := mocks.NewMockHttpClientCallers(ctrl)
			mockHTTP.EXPECT().
				GetUserCredentials(gomock.Any(), gomock.Any(), gomock.Any()).
				Return(tc.creds, tc.err)

			s, _ := srvWithFakeEC(t, mockHTTP)
			rr := postRawOTPVerify(t, s.OTPVerifyHandler, otpTestEmail, otpTestCode)
			checkStatus(t, rr, tc.wantStatus)
		})
	}

	t.Run("UserAPI_ValidCreds_UsesUserId", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		mockHTTP := mocks.NewMockHttpClientCallers(ctrl)
		mockHTTP.EXPECT().
			GetUserCredentials(gomock.Any(), gomock.Any(), gomock.Any()).
			Return(&usermodels.CredentialsResponse{UserId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"}, nil)

		s, _ := srvWithFakeEC(t, mockHTTP)
		rr := postRawOTPVerify(t, s.OTPVerifyHandler, otpTestEmail, otpTestCode)
		checkStatus(t, rr, http.StatusOK)

		resp := decodeJSON[models.TokenResponse](t, rr)
		if resp.AccessToken == "" {
			t.Fatal("expected non-empty accessToken when user-api returns valid creds")
		}
	})

	t.Run("NilHttpClient_FailsVerify", func(t *testing.T) {
		ec := newFakeEC()
		ec.store[otpKeyPrefix+otpTestEmail] = otpTestCode
		svc := &Service{
			CacheClient: db.NewFromOperations(ec),
			JWT:         testKeys,
		}
		rr := postRawOTPVerify(t, svc.OTPVerifyHandler, otpTestEmail, otpTestCode)
		checkStatus(t, rr, http.StatusServiceUnavailable)
	})
}

func TestOTPVerifyHandler_Component_OTPAlreadyRedeemed_Returns409(t *testing.T) {
	testutil.Component(t)

	ec := newFakeEC()
	ec.store[otpKeyPrefix+otpTestEmail] = otpTestCode
	ec.store["otp:redeemed:"+otpTestEmail] = "1"

	ctrl := gomock.NewController(t)
	mockHTTP := mocks.NewMockHttpClientCallers(ctrl)
	mockHTTP.EXPECT().
		GetUserCredentials(gomock.Any(), gomock.Any(), gomock.Any()).
		Return(&usermodels.CredentialsResponse{UserId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"}, nil).
		AnyTimes()

	svc := &Service{
		HttpClient:  mockHTTP,
		CacheClient: db.NewFromOperations(ec),
		JWT:         testKeys,
	}

	rr := postRawOTPVerify(t, svc.OTPVerifyHandler, otpTestEmail, otpTestCode)
	checkStatus(t, rr, http.StatusConflict)
}

func TestOTPVerifyHandler_Component_IncrError_StillProcesses(t *testing.T) {
	testutil.Component(t)

	ec := newFakeEC()
	ec.store[otpKeyPrefix+otpTestEmail] = otpTestCode

	ctrl := gomock.NewController(t)
	mockHTTP := mocks.NewMockHttpClientCallers(ctrl)
	mockHTTP.EXPECT().
		GetUserCredentials(gomock.Any(), gomock.Any(), gomock.Any()).
		Return(&usermodels.CredentialsResponse{UserId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"}, nil)

	svc := &Service{
		HttpClient:  mockHTTP,
		CacheClient: db.NewFromOperations(ec),
		JWT:         testKeys,
	}

	rr := postRawOTPVerify(t, svc.OTPVerifyHandler, otpTestEmail, otpTestCode)
	checkStatus(t, rr, http.StatusOK)
}

func TestOTPVerifyHandler_Component_OTPNotFound_Returns401(t *testing.T) {
	testutil.Component(t)

	ec := newFakeEC()

	svc := &Service{
		HttpClient:  &fakeHttpClient{getUserCredsResult: &usermodels.CredentialsResponse{UserId: "user-123"}},
		CacheClient: db.NewFromOperations(ec),
		JWT:         testKeys,
	}

	rr := postRawOTPVerify(t, svc.OTPVerifyHandler, "missing@example.com", "123456")
	checkStatus(t, rr, http.StatusUnauthorized)
}

func TestOTPVerifyHandler_Component_WrongCode_Returns401(t *testing.T) {
	testutil.Component(t)

	ec := newFakeEC()
	ec.store[otpKeyPrefix+"wrong@example.com"] = "111111"

	svc := &Service{
		HttpClient:  &fakeHttpClient{getUserCredsResult: &usermodels.CredentialsResponse{UserId: "user-123"}},
		CacheClient: db.NewFromOperations(ec),
		JWT:         testKeys,
	}

	rr := postRawOTPVerify(t, svc.OTPVerifyHandler, "wrong@example.com", "999999")
	checkStatus(t, rr, http.StatusUnauthorized)
}

func TestOTPVerifyHandler_Component_CacheGetError_Returns500(t *testing.T) {
	testutil.Component(t)

	ec := newFakeEC()
	ec.getErr = fmt.Errorf("redis connection lost")

	svc := &Service{
		HttpClient:  &fakeHttpClient{getUserCredsResult: &usermodels.CredentialsResponse{UserId: "user-123"}},
		CacheClient: db.NewFromOperations(ec),
		JWT:         testKeys,
	}

	rr := postRawOTPVerify(t, svc.OTPVerifyHandler, "cache-err@example.com", "123456")
	checkStatus(t, rr, http.StatusInternalServerError)
}

func TestOTPVerifyHandler_Component_MaxAttempts_Returns429(t *testing.T) {
	testutil.Component(t)

	const email = "maxed@example.com"
	ec := newFakeEC()
	ec.store[otpKeyPrefix+email] = otpTestCode
	ec.store["otp:attempts:"+email] = "5"

	svc := &Service{
		HttpClient:  &fakeHttpClient{getUserCredsResult: &usermodels.CredentialsResponse{UserId: "user-123"}},
		CacheClient: db.NewFromOperations(ec),
		JWT:         testKeys,
	}

	rr := postRawOTPVerify(t, svc.OTPVerifyHandler, email, otpTestCode)
	checkStatus(t, rr, http.StatusTooManyRequests)
}

func TestOTPVerifyHandler_Component_SignTokenError_Returns500(t *testing.T) {
	testutil.Component(t)

	const email = "sign-err@example.com"
	ec := newFakeEC()
	ec.store[otpKeyPrefix+email] = otpTestCode

	ctrl := gomock.NewController(t)
	mockHTTP := mocks.NewMockHttpClientCallers(ctrl)
	mockHTTP.EXPECT().
		GetUserCredentials(gomock.Any(), gomock.Any(), gomock.Any()).
		Return(&usermodels.CredentialsResponse{UserId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"}, nil)

	svc := &Service{
		HttpClient:  mockHTTP,
		CacheClient: db.NewFromOperations(ec),
		JWT:         &failingSignAuthority{base: testKeys, failAfter: 1},
	}

	rr := postRawOTPVerify(t, svc.OTPVerifyHandler, email, otpTestCode)
	checkStatus(t, rr, http.StatusInternalServerError)
}

// ── Unit Tests: OTPRequestHandler banned-checker ─────────────────────────────

func TestOTPRequestHandler_BannedChecker(t *testing.T) {
	cases := []struct {
		name       string
		banned     bool
		err        error
		wantStatus int
	}{
		{"BannedEmail_Returns403", true, nil, http.StatusForbidden},
		{"BannedCheckError_FailsOpen", false, errors.New("connection timeout"), http.StatusOK},
		{"NotBanned_Proceeds", false, nil, http.StatusOK},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			mockBanned := mocks.NewMockBannedChecker(ctrl)
			mockBanned.EXPECT().IsBanned(gomock.Any(), gomock.Any()).Return(tc.banned, tc.err)

			ec := newFakeEC()
			svc := &Service{
				HttpClient:    &fakeHttpClient{},
				CacheClient:   db.NewFromOperations(ec),
				BannedChecker: mockBanned,
			}
			rr := postRawOTPRequest(t, svc.OTPRequestHandler, "user@example.com")
			checkStatus(t, rr, tc.wantStatus)
		})
	}

	t.Run("NilBannedChecker_Skips", func(t *testing.T) {
		ec := newFakeEC()
		svc := &Service{
			HttpClient:    &fakeHttpClient{},
			CacheClient:   db.NewFromOperations(ec),
			BannedChecker: nil,
		}
		rr := postRawOTPRequest(t, svc.OTPRequestHandler, "any@example.com")
		checkStatus(t, rr, http.StatusOK)
	})
}

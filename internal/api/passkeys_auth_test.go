package api

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"komodo-auth-api/internal/clients"
	"komodo-auth-api/internal/db"
	usermodels "komodo-auth-api/internal/models/user"
	authwebauthn "komodo-auth-api/internal/webauthn"

	"github.com/fxamacker/cbor/v2"
	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	mw "github.com/rdevitto86/komodo-forge-sdk-go/api/middleware"
)

// ── Setup ────────────────────────────────────────────────────────────────────

const loginTestRPID = "example.com"
const loginTestOrigin = "https://example.com"
const loginTestUserID = "660f9511-f3ac-52e5-b827-557766551111"

type loginAuthenticator struct {
	priv      *ecdsa.PrivateKey
	credID    []byte
	publicKey []byte
}

func newLoginAuthenticator(t *testing.T) *loginAuthenticator {
	t.Helper()

	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("ecdsa.GenerateKey: unexpected error: %v", err)
	}

	pubBytes, err := priv.PublicKey.Bytes()
	if err != nil {
		t.Fatalf("PublicKey.Bytes: unexpected error: %v", err)
	}
	x := pubBytes[1:33]
	y := pubBytes[33:65]

	type ec2Key struct {
		KeyType   int64  `cbor:"1,keyasint"`
		Algorithm int64  `cbor:"3,keyasint"`
		Curve     int64  `cbor:"-1,keyasint"`
		XCoord    []byte `cbor:"-2,keyasint"`
		YCoord    []byte `cbor:"-3,keyasint"`
	}

	pubKey, err := cbor.Marshal(ec2Key{
		KeyType:   2,
		Algorithm: -7,
		Curve:     1,
		XCoord:    x,
		YCoord:    y,
	})
	if err != nil {
		t.Fatalf("cbor.Marshal: unexpected error: %v", err)
	}

	return &loginAuthenticator{
		priv:      priv,
		credID:    []byte("login-cred-id"),
		publicKey: pubKey,
	}
}

func (a *loginAuthenticator) descriptor(signCount uint32) clients.PasskeyCredentialDescriptor {
	return clients.PasskeyCredentialDescriptor{
		CredentialId:   base64.RawURLEncoding.EncodeToString(a.credID),
		PublicKey:      base64.StdEncoding.EncodeToString(a.publicKey),
		SignCount:      signCount,
		Transports:     []string{"internal"},
		BackupEligible: false,
		BackupState:    false,
	}
}

func authenticatorDataBytes(rpID string, signCount uint32, userPresent, userVerified bool) []byte {
	rpIDHash := sha256.Sum256([]byte(rpID))

	var flags byte
	if userPresent {
		flags |= 0x01
	}
	if userVerified {
		flags |= 0x04
	}

	buf := make([]byte, 0, 37)
	buf = append(buf, rpIDHash[:]...)
	buf = append(buf, flags)
	buf = append(buf, byte(signCount>>24), byte(signCount>>16), byte(signCount>>8), byte(signCount))
	return buf
}

func (a *loginAuthenticator) sign(challenge string, signCount uint32) ([]byte, error) {
	clientData := protocol.CollectedClientData{
		Type:      protocol.AssertCeremony,
		Challenge: challenge,
		Origin:    loginTestOrigin,
	}
	clientDataJSON, err := json.Marshal(clientData)
	if err != nil {
		return nil, err
	}

	authData := authenticatorDataBytes(loginTestRPID, signCount, true, true)

	clientDataHash := sha256.Sum256(clientDataJSON)
	signedData := append(append([]byte{}, authData...), clientDataHash[:]...)
	digest := sha256.Sum256(signedData)

	sig, err := ecdsa.SignASN1(rand.Reader, a.priv, digest[:])
	if err != nil {
		return nil, err
	}

	body := protocol.CredentialAssertionResponse{
		PublicKeyCredential: protocol.PublicKeyCredential{
			Credential: protocol.Credential{
				ID:   base64.RawURLEncoding.EncodeToString(a.credID),
				Type: "public-key",
			},
			RawID: protocol.URLEncodedBase64(a.credID),
		},
		AssertionResponse: protocol.AuthenticatorAssertionResponse{
			AuthenticatorResponse: protocol.AuthenticatorResponse{
				ClientDataJSON: protocol.URLEncodedBase64(clientDataJSON),
			},
			AuthenticatorData: protocol.URLEncodedBase64(authData),
			Signature:         protocol.URLEncodedBase64(sig),
		},
	}

	return json.Marshal(body)
}

func assertRefreshTokenAZP(t *testing.T, tokenStr, wantAZP string) {
	t.Helper()
	claims, err := testKeys.ParseClaims(tokenStr)
	if err != nil {
		t.Fatalf("failed to parse refresh token: %v", err)
	}
	if claims.Azp != wantAZP {
		t.Errorf("refresh token azp = %q, want %q", claims.Azp, wantAZP)
	}
}

func svcWithLoginDeps(t *testing.T, httpClient clients.HttpClientCallers, wa *webauthn.WebAuthn) (*Service, *fakeEC) {
	t.Helper()
	ec := newFakeEC()
	svc := &Service{
		HttpClient:     httpClient,
		CacheClient:    db.NewFromOperations(ec),
		JWT:            testKeys,
		WebAuthn:       wa,
		ClientRegistry: testRegistry,
	}
	return svc, ec
}

func newTestLoginWebAuthn(t *testing.T) *webauthn.WebAuthn {
	t.Helper()
	wa, err := authwebauthn.New(authwebauthn.Config{
		RPID:    loginTestRPID,
		Origins: loginTestOrigin,
	})
	if err != nil {
		t.Fatalf("authwebauthn.New: unexpected error: %v", err)
	}
	return wa
}

func userCreds(userID string) *usermodels.CredentialsResponse {
	return &usermodels.CredentialsResponse{UserId: userID}
}

func okHandler() http.Handler {
	return http.HandlerFunc(func(wtr http.ResponseWriter, _ *http.Request) {
		wtr.WriteHeader(http.StatusOK)
	})
}

// ── Unit Tests: descriptorsToCredentials ─────────────────────────────────────

func TestDescriptorsToCredentials(t *testing.T) {
	t.Run("ValidDescriptors", func(t *testing.T) {
		id := base64.RawURLEncoding.EncodeToString([]byte("cred-id"))
		pubKey := base64.StdEncoding.EncodeToString([]byte("pubkey-bytes"))
		aaguid := base64.StdEncoding.EncodeToString([]byte("aaguid-bytes"))

		creds, err := descriptorsToCredentials([]clients.PasskeyCredentialDescriptor{
			{
				CredentialId:   id,
				PublicKey:      pubKey,
				SignCount:      4,
				Transports:     []string{"internal", "hybrid"},
				Aaguid:         aaguid,
				BackupEligible: true,
				BackupState:    true,
			},
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(creds) != 1 {
			t.Fatalf("expected 1 credential, got %d", len(creds))
		}
		if string(creds[0].ID) != "cred-id" {
			t.Errorf("expected credential ID %q, got %q", "cred-id", creds[0].ID)
		}
		if string(creds[0].PublicKey) != "pubkey-bytes" {
			t.Errorf("expected public key %q, got %q", "pubkey-bytes", creds[0].PublicKey)
		}
		if creds[0].Authenticator.SignCount != 4 {
			t.Errorf("expected sign count 4, got %d", creds[0].Authenticator.SignCount)
		}
		if !creds[0].Flags.BackupEligible || !creds[0].Flags.BackupState {
			t.Error("expected backup flags to be propagated")
		}
		if len(creds[0].Transport) != 2 {
			t.Errorf("expected 2 transports, got %d", len(creds[0].Transport))
		}
	})

	t.Run("InvalidCredentialIDBase64_ReturnsError", func(t *testing.T) {
		_, err := descriptorsToCredentials([]clients.PasskeyCredentialDescriptor{
			{CredentialId: "not-valid-base64!!!"},
		})
		if err == nil {
			t.Fatal("expected error for invalid credential ID base64, got nil")
		}
	})

	t.Run("InvalidPublicKeyBase64_ReturnsError", func(t *testing.T) {
		_, err := descriptorsToCredentials([]clients.PasskeyCredentialDescriptor{
			{
				CredentialId: base64.RawURLEncoding.EncodeToString([]byte("cred-id")),
				PublicKey:    "not-valid-base64!!!",
			},
		})
		if err == nil {
			t.Fatal("expected error for invalid public key base64, got nil")
		}
	})

	t.Run("InvalidAaguidBase64_ReturnsError", func(t *testing.T) {
		_, err := descriptorsToCredentials([]clients.PasskeyCredentialDescriptor{
			{
				CredentialId: base64.RawURLEncoding.EncodeToString([]byte("cred-id")),
				PublicKey:    base64.StdEncoding.EncodeToString([]byte("pubkey")),
				Aaguid:       "not-valid-base64!!!",
			},
		})
		if err == nil {
			t.Fatal("expected error for invalid aaguid base64, got nil")
		}
	})
}

// ── Component Tests: PasskeyLoginBeginHandler ────────────────────────────────

func TestPasskeyLoginBeginHandler_Component(t *testing.T) {
	t.Run("NilWebAuthn_Returns500", func(t *testing.T) {
		svc, _ := svcWithLoginDeps(t, &fakeHttpClient{}, nil)
		req := httptest.NewRequest(http.MethodPost, "/v1/passkeys/login/begin", strings.NewReader(`{"email":"user@example.com","client_id":"test-client"}`))
		rr := httptest.NewRecorder()
		svc.PasskeyLoginBeginHandler(rr, req)
		checkStatus(t, rr, http.StatusInternalServerError)
	})

	t.Run("MissingClientID_Returns400", func(t *testing.T) {
		wa := newTestLoginWebAuthn(t)
		svc, _ := svcWithLoginDeps(t, &fakeHttpClient{}, wa)
		req := httptest.NewRequest(http.MethodPost, "/v1/passkeys/login/begin", strings.NewReader(`{"email":"user@example.com","client_id":""}`))
		rr := httptest.NewRecorder()
		svc.PasskeyLoginBeginHandler(rr, req)
		checkStatus(t, rr, http.StatusBadRequest)
	})

	t.Run("UnknownClientID_Returns401", func(t *testing.T) {
		wa := newTestLoginWebAuthn(t)
		svc, _ := svcWithLoginDeps(t, &fakeHttpClient{}, wa)
		req := httptest.NewRequest(http.MethodPost, "/v1/passkeys/login/begin", strings.NewReader(`{"email":"user@example.com","client_id":"no-such-client"}`))
		rr := httptest.NewRecorder()
		svc.PasskeyLoginBeginHandler(rr, req)
		checkStatus(t, rr, http.StatusUnauthorized)
	})

	t.Run("InvalidBody_Returns400", func(t *testing.T) {
		wa := newTestLoginWebAuthn(t)
		svc, _ := svcWithLoginDeps(t, &fakeHttpClient{}, wa)
		req := httptest.NewRequest(http.MethodPost, "/v1/passkeys/login/begin", strings.NewReader(`not-json`))
		rr := httptest.NewRecorder()
		svc.PasskeyLoginBeginHandler(rr, req)
		checkStatus(t, rr, http.StatusBadRequest)
	})

	t.Run("MissingEmail_Returns400", func(t *testing.T) {
		wa := newTestLoginWebAuthn(t)
		svc, _ := svcWithLoginDeps(t, &fakeHttpClient{}, wa)
		req := httptest.NewRequest(http.MethodPost, "/v1/passkeys/login/begin", strings.NewReader(`{"email":""}`))
		rr := httptest.NewRecorder()
		svc.PasskeyLoginBeginHandler(rr, req)
		checkStatus(t, rr, http.StatusBadRequest)
	})

	t.Run("UserNotFound_Returns404", func(t *testing.T) {
		wa := newTestLoginWebAuthn(t)
		fake := &fakeHttpClient{getUserCredsResult: nil}
		svc, _ := svcWithLoginDeps(t, fake, wa)
		req := httptest.NewRequest(http.MethodPost, "/v1/passkeys/login/begin", strings.NewReader(`{"email":"missing@example.com","client_id":"test-client"}`))
		rr := httptest.NewRecorder()
		svc.PasskeyLoginBeginHandler(rr, req)
		checkStatus(t, rr, http.StatusNotFound)
	})

	t.Run("GetUserCredentialsError_Returns503", func(t *testing.T) {
		wa := newTestLoginWebAuthn(t)
		fake := &fakeHttpClient{getUserCredsErr: errors.New("customer-api: 500")}
		svc, _ := svcWithLoginDeps(t, fake, wa)
		req := httptest.NewRequest(http.MethodPost, "/v1/passkeys/login/begin", strings.NewReader(`{"email":"user@example.com","client_id":"test-client"}`))
		rr := httptest.NewRecorder()
		svc.PasskeyLoginBeginHandler(rr, req)
		checkStatus(t, rr, http.StatusServiceUnavailable)
	})

	t.Run("ListPasskeysError_Returns503", func(t *testing.T) {
		wa := newTestLoginWebAuthn(t)
		fake := &fakeHttpClient{
			getUserCredsResult: userCreds(loginTestUserID),
			listPasskeysErr:    errors.New("customer-api: 500"),
		}
		svc, _ := svcWithLoginDeps(t, fake, wa)
		req := httptest.NewRequest(http.MethodPost, "/v1/passkeys/login/begin", strings.NewReader(`{"email":"user@example.com","client_id":"test-client"}`))
		rr := httptest.NewRecorder()
		svc.PasskeyLoginBeginHandler(rr, req)
		checkStatus(t, rr, http.StatusServiceUnavailable)
	})

	t.Run("NoPasskeysRegistered_Returns404", func(t *testing.T) {
		wa := newTestLoginWebAuthn(t)
		fake := &fakeHttpClient{
			getUserCredsResult: userCreds(loginTestUserID),
			listPasskeysResult: nil,
		}
		svc, _ := svcWithLoginDeps(t, fake, wa)
		req := httptest.NewRequest(http.MethodPost, "/v1/passkeys/login/begin", strings.NewReader(`{"email":"user@example.com","client_id":"test-client"}`))
		rr := httptest.NewRecorder()
		svc.PasskeyLoginBeginHandler(rr, req)
		checkStatus(t, rr, http.StatusNotFound)
	})

	t.Run("InvalidCredentialDescriptor_Returns500", func(t *testing.T) {
		wa := newTestLoginWebAuthn(t)
		fake := &fakeHttpClient{
			getUserCredsResult: userCreds(loginTestUserID),
			listPasskeysResult: []clients.PasskeyCredentialDescriptor{
				{CredentialId: "dGVzdA", PublicKey: "not-valid-base64!!!@@@"},
			},
		}
		svc, _ := svcWithLoginDeps(t, fake, wa)
		req := httptest.NewRequest(http.MethodPost, "/v1/passkeys/login/begin", strings.NewReader(`{"email":"user@example.com","client_id":"test-client"}`))
		rr := httptest.NewRecorder()
		svc.PasskeyLoginBeginHandler(rr, req)
		checkStatus(t, rr, http.StatusInternalServerError)
	})

	t.Run("StoreSessionError_Returns500", func(t *testing.T) {
		wa := newTestLoginWebAuthn(t)
		auth := newLoginAuthenticator(t)
		fake := &fakeHttpClient{
			getUserCredsResult: userCreds(loginTestUserID),
			listPasskeysResult: []clients.PasskeyCredentialDescriptor{auth.descriptor(0)},
		}
		svc, ec := svcWithLoginDeps(t, fake, wa)
		ec.setErr = errors.New("redis unavailable")
		req := httptest.NewRequest(http.MethodPost, "/v1/passkeys/login/begin", strings.NewReader(`{"email":"user@example.com","client_id":"test-client"}`))
		rr := httptest.NewRecorder()
		svc.PasskeyLoginBeginHandler(rr, req)
		checkStatus(t, rr, http.StatusInternalServerError)
	})

	t.Run("HappyPath_Returns200AndStoresSession", func(t *testing.T) {
		wa := newTestLoginWebAuthn(t)
		auth := newLoginAuthenticator(t)
		fake := &fakeHttpClient{
			getUserCredsResult: userCreds(loginTestUserID),
			listPasskeysResult: []clients.PasskeyCredentialDescriptor{auth.descriptor(0)},
		}
		svc, ec := svcWithLoginDeps(t, fake, wa)
		req := httptest.NewRequest(http.MethodPost, "/v1/passkeys/login/begin", strings.NewReader(`{"email":"user@example.com","client_id":"test-client"}`))
		rr := httptest.NewRecorder()
		svc.PasskeyLoginBeginHandler(rr, req)
		checkStatus(t, rr, http.StatusOK)

		assertion := decodeJSON[protocol.CredentialAssertion](t, rr)
		if assertion.Response.UserVerification != protocol.VerificationRequired {
			t.Errorf("expected user verification required, got %q", assertion.Response.UserVerification)
		}
		if len(assertion.Response.AllowedCredentials) != 1 {
			t.Errorf("expected 1 allowed credential, got %d", len(assertion.Response.AllowedCredentials))
		}

		found := false
		for k := range ec.store {
			if strings.HasPrefix(k, "webauthn:login:") {
				found = true
			}
		}
		if !found {
			t.Error("expected login session to be stored in cache")
		}
	})
}

// ── Component Tests: PasskeyLoginCompleteHandler ─────────────────────────────

func TestPasskeyLoginCompleteHandler_Component(t *testing.T) {
	t.Run("NilWebAuthn_Returns500", func(t *testing.T) {
		svc, _ := svcWithLoginDeps(t, &fakeHttpClient{}, nil)
		req := httptest.NewRequest(http.MethodPost, "/v1/passkeys/login/complete", strings.NewReader(`{}`))
		rr := httptest.NewRecorder()
		svc.PasskeyLoginCompleteHandler(rr, req)
		checkStatus(t, rr, http.StatusInternalServerError)
	})

	t.Run("InvalidAssertionBody_Returns400", func(t *testing.T) {
		wa := newTestLoginWebAuthn(t)
		svc, _ := svcWithLoginDeps(t, &fakeHttpClient{}, wa)
		req := httptest.NewRequest(http.MethodPost, "/v1/passkeys/login/complete", strings.NewReader(`not-json`))
		rr := httptest.NewRecorder()
		svc.PasskeyLoginCompleteHandler(rr, req)
		checkStatus(t, rr, http.StatusBadRequest)
	})

	t.Run("SessionNotFound_Returns400", func(t *testing.T) {
		wa := newTestLoginWebAuthn(t)
		auth := newLoginAuthenticator(t)
		svc, _ := svcWithLoginDeps(t, &fakeHttpClient{}, wa)

		body, err := auth.sign("nonexistent-challenge", 1)
		if err != nil {
			t.Fatalf("sign: unexpected error: %v", err)
		}

		req := httptest.NewRequest(http.MethodPost, "/v1/passkeys/login/complete", strings.NewReader(string(body)))
		rr := httptest.NewRecorder()
		svc.PasskeyLoginCompleteHandler(rr, req)
		checkStatus(t, rr, http.StatusBadRequest)
	})

	t.Run("SessionLoadError_Returns500", func(t *testing.T) {
		wa := newTestLoginWebAuthn(t)
		auth := newLoginAuthenticator(t)
		svc, ec := svcWithLoginDeps(t, &fakeHttpClient{}, wa)
		ec.getErr = errors.New("redis: connection refused")

		body, err := auth.sign("some-challenge", 1)
		if err != nil {
			t.Fatalf("sign: unexpected error: %v", err)
		}

		req := httptest.NewRequest(http.MethodPost, "/v1/passkeys/login/complete", strings.NewReader(string(body)))
		rr := httptest.NewRecorder()
		svc.PasskeyLoginCompleteHandler(rr, req)
		checkStatus(t, rr, http.StatusInternalServerError)
	})

	t.Run("CeremonyFailure_Returns401", func(t *testing.T) {
		wa := newTestLoginWebAuthn(t)
		auth := newLoginAuthenticator(t)
		fake := &fakeHttpClient{
			getUserCredsResult: userCreds(loginTestUserID),
			listPasskeysResult: []clients.PasskeyCredentialDescriptor{auth.descriptor(0)},
		}
		svc, _ := svcWithLoginDeps(t, fake, wa)

		beginReq := httptest.NewRequest(http.MethodPost, "/v1/passkeys/login/begin", strings.NewReader(`{"email":"user@example.com","client_id":"test-client"}`))
		beginRR := httptest.NewRecorder()
		svc.PasskeyLoginBeginHandler(beginRR, beginReq)
		checkStatus(t, beginRR, http.StatusOK)
		assertion := decodeJSON[protocol.CredentialAssertion](t, beginRR)

		body, err := auth.sign(assertion.Response.Challenge.String(), 0)
		if err != nil {
			t.Fatalf("sign: unexpected error: %v", err)
		}

		var raw map[string]any
		if err := json.Unmarshal(body, &raw); err != nil {
			t.Fatalf("unmarshal: unexpected error: %v", err)
		}
		resp := raw["response"].(map[string]any)
		resp["signature"] = base64.RawURLEncoding.EncodeToString([]byte("tampered-signature-bytes"))
		tampered, err := json.Marshal(raw)
		if err != nil {
			t.Fatalf("marshal: unexpected error: %v", err)
		}

		req := httptest.NewRequest(http.MethodPost, "/v1/passkeys/login/complete", strings.NewReader(string(tampered)))
		rr := httptest.NewRecorder()
		svc.PasskeyLoginCompleteHandler(rr, req)
		checkStatus(t, rr, http.StatusUnauthorized)
	})

	t.Run("HappyPath_IssuesTokenAndPersistsCredential", func(t *testing.T) {
		wa := newTestLoginWebAuthn(t)
		auth := newLoginAuthenticator(t)
		fake := &fakeHttpClient{
			getUserCredsResult: userCreds(loginTestUserID),
			listPasskeysResult: []clients.PasskeyCredentialDescriptor{auth.descriptor(0)},
		}
		svc, ec := svcWithLoginDeps(t, fake, wa)

		beginReq := httptest.NewRequest(http.MethodPost, "/v1/passkeys/login/begin", strings.NewReader(`{"email":"user@example.com","client_id":"test-client"}`))
		beginRR := httptest.NewRecorder()
		svc.PasskeyLoginBeginHandler(beginRR, beginReq)
		checkStatus(t, beginRR, http.StatusOK)
		assertion := decodeJSON[protocol.CredentialAssertion](t, beginRR)

		body, err := auth.sign(assertion.Response.Challenge.String(), 1)
		if err != nil {
			t.Fatalf("sign: unexpected error: %v", err)
		}

		req := httptest.NewRequest(http.MethodPost, "/v1/passkeys/login/complete", strings.NewReader(string(body)))
		rr := httptest.NewRecorder()
		svc.PasskeyLoginCompleteHandler(rr, req)
		checkStatus(t, rr, http.StatusOK)

		tok := decodeJSON[map[string]any](t, rr)
		if tok["access_token"] == "" || tok["access_token"] == nil {
			t.Error("expected non-empty access_token")
		}
		if tok["refresh_token"] == "" || tok["refresh_token"] == nil {
			t.Error("expected non-empty refresh_token")
		}
		if tok["scope"] != "passkey:verified" {
			t.Errorf("expected scope %q, got %v", "passkey:verified", tok["scope"])
		}

		accessTokenStr, _ := tok["access_token"].(string)
		claims, err := testKeys.ParseClaims(accessTokenStr)
		if err != nil {
			t.Fatalf("failed to parse issued access token: %v", err)
		}
		if claims.Subject != loginTestUserID {
			t.Errorf("JWT sub = %q, want bare UUID %q", claims.Subject, loginTestUserID)
		}

		refreshTokenStr, _ := tok["refresh_token"].(string)
		assertRefreshTokenAZP(t, refreshTokenStr, "test-client")

		if fake.updatedPasskey == nil {
			t.Fatal("expected passkey credential to be persisted")
		}
		if fake.updatedPasskey.SignCount != 1 {
			t.Errorf("expected sign count 1, got %d", fake.updatedPasskey.SignCount)
		}

		for k := range ec.store {
			if strings.HasPrefix(k, "webauthn:login:") {
				t.Errorf("expected login session %q to be deleted (single-use)", k)
			}
		}
	})

	t.Run("SignCountRegression_LogsAndAllows", func(t *testing.T) {
		wa := newTestLoginWebAuthn(t)
		auth := newLoginAuthenticator(t)
		fake := &fakeHttpClient{
			getUserCredsResult: userCreds(loginTestUserID),
			listPasskeysResult: []clients.PasskeyCredentialDescriptor{auth.descriptor(5)},
		}
		svc, _ := svcWithLoginDeps(t, fake, wa)

		beginReq := httptest.NewRequest(http.MethodPost, "/v1/passkeys/login/begin", strings.NewReader(`{"email":"user@example.com","client_id":"test-client"}`))
		beginRR := httptest.NewRecorder()
		svc.PasskeyLoginBeginHandler(beginRR, beginReq)
		checkStatus(t, beginRR, http.StatusOK)
		assertion := decodeJSON[protocol.CredentialAssertion](t, beginRR)

		body, err := auth.sign(assertion.Response.Challenge.String(), 3)
		if err != nil {
			t.Fatalf("sign: unexpected error: %v", err)
		}

		req := httptest.NewRequest(http.MethodPost, "/v1/passkeys/login/complete", strings.NewReader(string(body)))
		rr := httptest.NewRecorder()
		svc.PasskeyLoginCompleteHandler(rr, req)
		checkStatus(t, rr, http.StatusOK)

		if fake.updatedPasskey == nil {
			t.Fatal("expected passkey credential to be persisted despite sign-count regression")
		}
		if fake.updatedPasskey.SignCount != 3 {
			t.Errorf("expected sign count 3, got %d", fake.updatedPasskey.SignCount)
		}
	})

	t.Run("SyncedPasskeyZeroSignCount_NotTreatedAsRegression", func(t *testing.T) {
		wa := newTestLoginWebAuthn(t)
		auth := newLoginAuthenticator(t)
		fake := &fakeHttpClient{
			getUserCredsResult: userCreds(loginTestUserID),
			listPasskeysResult: []clients.PasskeyCredentialDescriptor{auth.descriptor(5)},
		}
		svc, _ := svcWithLoginDeps(t, fake, wa)

		beginReq := httptest.NewRequest(http.MethodPost, "/v1/passkeys/login/begin", strings.NewReader(`{"email":"user@example.com","client_id":"test-client"}`))
		beginRR := httptest.NewRecorder()
		svc.PasskeyLoginBeginHandler(beginRR, beginReq)
		checkStatus(t, beginRR, http.StatusOK)
		assertion := decodeJSON[protocol.CredentialAssertion](t, beginRR)

		body, err := auth.sign(assertion.Response.Challenge.String(), 0)
		if err != nil {
			t.Fatalf("sign: unexpected error: %v", err)
		}

		req := httptest.NewRequest(http.MethodPost, "/v1/passkeys/login/complete", strings.NewReader(string(body)))
		rr := httptest.NewRecorder()
		svc.PasskeyLoginCompleteHandler(rr, req)
		checkStatus(t, rr, http.StatusOK)

		if fake.updatedPasskey == nil {
			t.Fatal("expected passkey credential to be persisted")
		}
		if fake.updatedPasskey.SignCount != 0 {
			t.Errorf("expected sign count 0, got %d", fake.updatedPasskey.SignCount)
		}
	})

	t.Run("BannedUser_Returns403", func(t *testing.T) {
		wa := newTestLoginWebAuthn(t)
		auth := newLoginAuthenticator(t)
		fake := &fakeHttpClient{
			getUserCredsResult: userCreds(loginTestUserID),
			listPasskeysResult: []clients.PasskeyCredentialDescriptor{auth.descriptor(0)},
		}
		svc, _ := svcWithLoginDeps(t, fake, wa)
		svc.BannedChecker = &fakeBannedChecker{banned: true}

		beginReq := httptest.NewRequest(http.MethodPost, "/v1/passkeys/login/begin", strings.NewReader(`{"email":"user@example.com","client_id":"test-client"}`))
		beginRR := httptest.NewRecorder()
		svc.PasskeyLoginBeginHandler(beginRR, beginReq)
		checkStatus(t, beginRR, http.StatusOK)
		assertion := decodeJSON[protocol.CredentialAssertion](t, beginRR)

		body, err := auth.sign(assertion.Response.Challenge.String(), 1)
		if err != nil {
			t.Fatalf("sign: unexpected error: %v", err)
		}

		req := httptest.NewRequest(http.MethodPost, "/v1/passkeys/login/complete", strings.NewReader(string(body)))
		rr := httptest.NewRecorder()
		svc.PasskeyLoginCompleteHandler(rr, req)
		checkStatus(t, rr, http.StatusForbidden)
	})

	t.Run("ReplayDetected_Returns409", func(t *testing.T) {
		wa := newTestLoginWebAuthn(t)
		auth := newLoginAuthenticator(t)
		fake := &fakeHttpClient{
			getUserCredsResult: userCreds(loginTestUserID),
			listPasskeysResult: []clients.PasskeyCredentialDescriptor{auth.descriptor(0)},
		}
		svc, _ := svcWithLoginDeps(t, fake, wa)

		beginReq := httptest.NewRequest(http.MethodPost, "/v1/passkeys/login/begin", strings.NewReader(`{"email":"user@example.com","client_id":"test-client"}`))
		beginRR := httptest.NewRecorder()
		svc.PasskeyLoginBeginHandler(beginRR, beginReq)
		checkStatus(t, beginRR, http.StatusOK)
		assertion := decodeJSON[protocol.CredentialAssertion](t, beginRR)

		body, err := auth.sign(assertion.Response.Challenge.String(), 1)
		if err != nil {
			t.Fatalf("sign: unexpected error: %v", err)
		}

		completeReq1 := httptest.NewRequest(http.MethodPost, "/v1/passkeys/login/complete", strings.NewReader(string(body)))
		rr1 := httptest.NewRecorder()
		svc.PasskeyLoginCompleteHandler(rr1, completeReq1)
		checkStatus(t, rr1, http.StatusOK)

		completeReq2 := httptest.NewRequest(http.MethodPost, "/v1/passkeys/login/complete", strings.NewReader(string(body)))
		rr2 := httptest.NewRecorder()
		svc.PasskeyLoginCompleteHandler(rr2, completeReq2)
		if rr2.Code != http.StatusBadRequest && rr2.Code != http.StatusConflict {
			t.Errorf("expected 400 or 409 on replay, got %d", rr2.Code)
		}
	})

	t.Run("ListPasskeysError_Returns503", func(t *testing.T) {
		wa := newTestLoginWebAuthn(t)
		auth := newLoginAuthenticator(t)
		fake := &fakeHttpClient{
			getUserCredsResult: userCreds(loginTestUserID),
			listPasskeysResult: []clients.PasskeyCredentialDescriptor{auth.descriptor(0)},
		}
		svc, _ := svcWithLoginDeps(t, fake, wa)

		beginReq := httptest.NewRequest(http.MethodPost, "/v1/passkeys/login/begin", strings.NewReader(`{"email":"user@example.com","client_id":"test-client"}`))
		beginRR := httptest.NewRecorder()
		svc.PasskeyLoginBeginHandler(beginRR, beginReq)
		checkStatus(t, beginRR, http.StatusOK)
		assertion := decodeJSON[protocol.CredentialAssertion](t, beginRR)

		fake.listPasskeysErr = errors.New("customer-api: 500")
		fake.listPasskeysResult = nil

		body, err := auth.sign(assertion.Response.Challenge.String(), 1)
		if err != nil {
			t.Fatalf("sign: unexpected error: %v", err)
		}

		req := httptest.NewRequest(http.MethodPost, "/v1/passkeys/login/complete", strings.NewReader(string(body)))
		rr := httptest.NewRecorder()
		svc.PasskeyLoginCompleteHandler(rr, req)
		checkStatus(t, rr, http.StatusServiceUnavailable)
	})

	t.Run("UpdatePasskeyError_Returns503", func(t *testing.T) {
		wa := newTestLoginWebAuthn(t)
		auth := newLoginAuthenticator(t)
		fake := &fakeHttpClient{
			getUserCredsResult: userCreds(loginTestUserID),
			listPasskeysResult: []clients.PasskeyCredentialDescriptor{auth.descriptor(0)},
			updatePasskeyErr:   errors.New("customer-api: 500"),
		}
		svc, _ := svcWithLoginDeps(t, fake, wa)

		beginReq := httptest.NewRequest(http.MethodPost, "/v1/passkeys/login/begin", strings.NewReader(`{"email":"user@example.com","client_id":"test-client"}`))
		beginRR := httptest.NewRecorder()
		svc.PasskeyLoginBeginHandler(beginRR, beginReq)
		checkStatus(t, beginRR, http.StatusOK)
		assertion := decodeJSON[protocol.CredentialAssertion](t, beginRR)

		body, err := auth.sign(assertion.Response.Challenge.String(), 1)
		if err != nil {
			t.Fatalf("sign: unexpected error: %v", err)
		}

		req := httptest.NewRequest(http.MethodPost, "/v1/passkeys/login/complete", strings.NewReader(string(body)))
		rr := httptest.NewRecorder()
		svc.PasskeyLoginCompleteHandler(rr, req)
		checkStatus(t, rr, http.StatusServiceUnavailable)
	})
}

// ── Unit Tests: PasskeyAuthMiddleware ────────────────────────────────────────

func TestPasskeyAuthMiddleware_NoAuthHeader_Returns401(t *testing.T) {
	mw := PasskeyAuthMiddleware(testKeys)
	handler := mw(okHandler())

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	checkStatus(t, rr, http.StatusUnauthorized)
}

func TestPasskeyAuthMiddleware_MalformedAuthHeader_Returns401(t *testing.T) {
	mw := PasskeyAuthMiddleware(testKeys)
	handler := mw(okHandler())

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "NotBearer sometoken")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	checkStatus(t, rr, http.StatusUnauthorized)
}

func TestPasskeyAuthMiddleware_InvalidToken_Returns401(t *testing.T) {
	mw := PasskeyAuthMiddleware(testKeys)
	handler := mw(okHandler())

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer not-a-real-token")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	checkStatus(t, rr, http.StatusUnauthorized)
}

func TestPasskeyAuthMiddleware_ValidToken_CallsNext(t *testing.T) {
	tok, err := testKeys.SignToken("test-issuer", loginTestUserID, "test-audience", 3600, []string{"otp:verified"})
	if err != nil {
		t.Fatalf("SignToken: unexpected error: %v", err)
	}

	mw := PasskeyAuthMiddleware(testKeys)
	handler := mw(okHandler())

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	checkStatus(t, rr, http.StatusOK)
}

func TestPasskeyAuthMiddleware_ExpiredToken_Returns401(t *testing.T) {
	tok, err := testKeys.SignToken("test-issuer", loginTestUserID, "test-audience", -60, []string{"otp:verified"})
	if err != nil {
		t.Fatalf("SignToken: unexpected error: %v", err)
	}

	mw := PasskeyAuthMiddleware(testKeys)
	handler := mw(okHandler())

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	checkStatus(t, rr, http.StatusUnauthorized)
}

// ── Unit Tests: Auth boundary (PasskeyAuthMiddleware + RequireAnyScope) ──────

func TestRequireAnyScope_MissingScope_Returns403(t *testing.T) {
	tok, err := testKeys.SignToken("test-issuer", loginTestUserID, "test-audience", 3600, []string{"other:scope"})
	if err != nil {
		t.Fatalf("SignToken: unexpected error: %v", err)
	}

	handler := PasskeyAuthMiddleware(testKeys)(mw.RequireAnyScope("otp:verified", "passkey:verified")(okHandler()))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	checkStatus(t, rr, http.StatusForbidden)
}

func TestRequireAnyScope_NoScopes_Returns403(t *testing.T) {
	tok, err := testKeys.SignToken("test-issuer", loginTestUserID, "test-audience", 3600, []string{})
	if err != nil {
		t.Fatalf("SignToken: unexpected error: %v", err)
	}

	handler := PasskeyAuthMiddleware(testKeys)(mw.RequireAnyScope("otp:verified", "passkey:verified")(okHandler()))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	checkStatus(t, rr, http.StatusForbidden)
}

func TestRequireAnyScope_OneOfMultipleScopes_CallsNext(t *testing.T) {
	for _, scope := range []string{"otp:verified", "passkey:verified"} {
		t.Run(scope, func(t *testing.T) {
			tok, err := testKeys.SignToken("test-issuer", loginTestUserID, "test-audience", 3600, []string{scope})
			if err != nil {
				t.Fatalf("SignToken: unexpected error: %v", err)
			}

			handler := PasskeyAuthMiddleware(testKeys)(mw.RequireAnyScope("otp:verified", "passkey:verified")(okHandler()))

			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req.Header.Set("Authorization", "Bearer "+tok)
			rr := httptest.NewRecorder()
			handler.ServeHTTP(rr, req)

			checkStatus(t, rr, http.StatusOK)
		})
	}
}

func TestRequireAnyScope_NoScopes_Panics(t *testing.T) {
	defer func() {
		r := recover()
		if r == nil {
			t.Fatal("expected panic, got none")
		}
		if r != "at least one scope is required" {
			t.Fatalf("unexpected panic value: %v", r)
		}
	}()

	mw.RequireAnyScope()
}

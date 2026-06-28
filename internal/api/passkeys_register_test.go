package api

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"komodo-auth-api/internal/clients"
	"komodo-auth-api/internal/db"
	authwebauthn "komodo-auth-api/internal/webauthn"

	"github.com/fxamacker/cbor/v2"
	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/protocol/webauthncose"
	"github.com/go-webauthn/webauthn/webauthn"
	mw "github.com/rdevitto86/komodo-forge-sdk-go/api/middleware"
	ctxKeys "github.com/rdevitto86/komodo-forge-sdk-go/http/context"
	"github.com/rdevitto86/komodo-forge-sdk-go/testing/testutil"
)

// ── Setup ────────────────────────────────────────────────────────────────

func newTestWebAuthn(t *testing.T) *webauthn.WebAuthn {
	t.Helper()
	wa, err := authwebauthn.New(authwebauthn.Config{
		RPID:    "example.com",
		Origins: "https://example.com",
	})
	if err != nil {
		t.Fatalf("authwebauthn.New: unexpected error: %v", err)
	}
	return wa
}

func passkeyAuthedRequest(method, path, body, sub string) *http.Request {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	ctx := ctxKeys.WithUserID(req.Context(), sub)
	return req.WithContext(ctx)
}

func svcWithPasskeyDeps(t *testing.T, httpClient clients.HttpClientCallers, wa *webauthn.WebAuthn) (*Service, *fakeEC) {
	t.Helper()
	ec := newFakeEC()
	svc := &Service{
		HttpClient:  httpClient,
		CacheClient: db.NewFromOperations(ec),
		JWT:         testKeys,
		WebAuthn:    wa,
	}
	return svc, ec
}

func makeExistingPasskeys(n int) []clients.PasskeyCredentialDescriptor {
	out := make([]clients.PasskeyCredentialDescriptor, 0, n)
	for i := range n {
		out = append(out, clients.PasskeyCredentialDescriptor{
			CredentialId: base64.RawURLEncoding.EncodeToString([]byte("cred-id-" + string(rune('a'+i)))),
			PublicKey:    base64.StdEncoding.EncodeToString([]byte("pubkey")),
			Transports:   []string{"internal"},
		})
	}
	return out
}

// ── Component Tests: PasskeyRegisterBeginHandler ────────────────────────────

const regTestUserID = "550e8400-e29b-41d4-a716-446655440000"

func TestPasskeyRegisterBeginHandler_Component(t *testing.T) {
	t.Run("NilWebAuthn_Returns500", func(t *testing.T) {
		svc, _ := svcWithPasskeyDeps(t, &fakeHttpClient{}, nil)
		req := passkeyAuthedRequest(http.MethodPost, "/v1/passkeys/register/begin", "", regTestUserID)
		rr := httptest.NewRecorder()
		svc.PasskeyRegisterBeginHandler(rr, req)
		checkStatus(t, rr, http.StatusInternalServerError)
	})

	t.Run("MissingUserSubject_Returns401", func(t *testing.T) {
		wa := newTestWebAuthn(t)
		svc, _ := svcWithPasskeyDeps(t, &fakeHttpClient{}, wa)
		req := httptest.NewRequest(http.MethodPost, "/v1/passkeys/register/begin", nil)
		rr := httptest.NewRecorder()
		svc.PasskeyRegisterBeginHandler(rr, req)
		checkStatus(t, rr, http.StatusUnauthorized)
	})

	t.Run("ListPasskeysError_Returns503", func(t *testing.T) {
		wa := newTestWebAuthn(t)
		fake := &fakeHttpClient{listPasskeysErr: errors.New("customer-api: 500 Internal Server Error")}
		svc, _ := svcWithPasskeyDeps(t, fake, wa)
		req := passkeyAuthedRequest(http.MethodPost, "/v1/passkeys/register/begin", "", regTestUserID)
		rr := httptest.NewRecorder()
		svc.PasskeyRegisterBeginHandler(rr, req)
		checkStatus(t, rr, http.StatusServiceUnavailable)
	})

	t.Run("MaxPasskeysReached_Returns409", func(t *testing.T) {
		wa := newTestWebAuthn(t)
		fake := &fakeHttpClient{listPasskeysResult: makeExistingPasskeys(maxPasskeysPerUser)}
		svc, _ := svcWithPasskeyDeps(t, fake, wa)
		req := passkeyAuthedRequest(http.MethodPost, "/v1/passkeys/register/begin", "", regTestUserID)
		rr := httptest.NewRecorder()
		svc.PasskeyRegisterBeginHandler(rr, req)
		checkStatus(t, rr, http.StatusConflict)
	})

	t.Run("HappyPath_Returns200AndStoresSession", func(t *testing.T) {
		wa := newTestWebAuthn(t)
		fake := &fakeHttpClient{listPasskeysResult: makeExistingPasskeys(2)}
		svc, ec := svcWithPasskeyDeps(t, fake, wa)
		req := passkeyAuthedRequest(http.MethodPost, "/v1/passkeys/register/begin", "", regTestUserID)
		rr := httptest.NewRecorder()
		svc.PasskeyRegisterBeginHandler(rr, req)
		checkStatus(t, rr, http.StatusOK)

		creation := decodeJSON[protocol.CredentialCreation](t, rr)
		if creation.Response.User.Name != regTestUserID {
			t.Errorf("expected user name %q, got %q", regTestUserID, creation.Response.User.Name)
		}
		if len(creation.Response.CredentialExcludeList) != 2 {
			t.Errorf("expected 2 excluded credentials, got %d", len(creation.Response.CredentialExcludeList))
		}

		if _, ok := ec.store["webauthn:reg:"+regTestUserID]; !ok {
			t.Error("expected registration session to be stored in cache")
		}
	})

	t.Run("StoreSessionError_Returns500", func(t *testing.T) {
		wa := newTestWebAuthn(t)
		fake := &fakeHttpClient{}
		svc, ec := svcWithPasskeyDeps(t, fake, wa)
		ec.setErr = errors.New("redis unavailable")

		req := passkeyAuthedRequest(http.MethodPost, "/v1/passkeys/register/begin", "", regTestUserID)
		rr := httptest.NewRecorder()
		svc.PasskeyRegisterBeginHandler(rr, req)
		checkStatus(t, rr, http.StatusInternalServerError)
	})

	t.Run("ExistingPasskeyWithInvalidCredID_SkippedGracefully", func(t *testing.T) {
		wa := newTestWebAuthn(t)
		fake := &fakeHttpClient{
			listPasskeysResult: []clients.PasskeyCredentialDescriptor{
				{CredentialId: "not-valid-base64!!!"},
			},
		}
		svc, _ := svcWithPasskeyDeps(t, fake, wa)
		req := passkeyAuthedRequest(http.MethodPost, "/v1/passkeys/register/begin", "", regTestUserID)
		rr := httptest.NewRecorder()
		svc.PasskeyRegisterBeginHandler(rr, req)
		checkStatus(t, rr, http.StatusOK)
	})

	t.Run("HappyPath_CredentialParametersRestrictedToES256AndRS256", func(t *testing.T) {
		wa := newTestWebAuthn(t)
		fake := &fakeHttpClient{}
		svc, _ := svcWithPasskeyDeps(t, fake, wa)
		req := passkeyAuthedRequest(http.MethodPost, "/v1/passkeys/register/begin", "", regTestUserID)
		rr := httptest.NewRecorder()
		svc.PasskeyRegisterBeginHandler(rr, req)
		checkStatus(t, rr, http.StatusOK)

		creation := decodeJSON[protocol.CredentialCreation](t, rr)
		if len(creation.Response.Parameters) != 2 {
			t.Fatalf("expected 2 credential parameters, got %d: %+v", len(creation.Response.Parameters), creation.Response.Parameters)
		}

		algs := make(map[webauthncose.COSEAlgorithmIdentifier]bool)
		for _, p := range creation.Response.Parameters {
			if p.Type != protocol.PublicKeyCredentialType {
				t.Errorf("expected credential type %q, got %q", protocol.PublicKeyCredentialType, p.Type)
			}
			algs[p.Algorithm] = true
		}
		if !algs[webauthncose.AlgES256] {
			t.Error("expected ES256 in credential parameters")
		}
		if !algs[webauthncose.AlgRS256] {
			t.Error("expected RS256 in credential parameters")
		}
		if len(algs) != 2 {
			t.Errorf("expected exactly ES256 and RS256, got %v", algs)
		}
	})

}

// ── Component Tests: PasskeyRegisterCompleteHandler ─────────────────────────

func TestPasskeyRegisterCompleteHandler_Component(t *testing.T) {
	t.Run("NilWebAuthn_Returns500", func(t *testing.T) {
		svc, _ := svcWithPasskeyDeps(t, &fakeHttpClient{}, nil)
		req := passkeyAuthedRequest(http.MethodPost, "/v1/passkeys/register/complete", "{}", regTestUserID)
		rr := httptest.NewRecorder()
		svc.PasskeyRegisterCompleteHandler(rr, req)
		checkStatus(t, rr, http.StatusInternalServerError)
	})

	t.Run("MissingUserSubject_Returns401", func(t *testing.T) {
		wa := newTestWebAuthn(t)
		svc, _ := svcWithPasskeyDeps(t, &fakeHttpClient{}, wa)
		req := httptest.NewRequest(http.MethodPost, "/v1/passkeys/register/complete", strings.NewReader("{}"))
		rr := httptest.NewRecorder()
		svc.PasskeyRegisterCompleteHandler(rr, req)
		checkStatus(t, rr, http.StatusUnauthorized)
	})

	t.Run("NoRegistrationSession_Returns400", func(t *testing.T) {
		wa := newTestWebAuthn(t)
		svc, _ := svcWithPasskeyDeps(t, &fakeHttpClient{}, wa)
		req := passkeyAuthedRequest(http.MethodPost, "/v1/passkeys/register/complete", "{}", regTestUserID)
		rr := httptest.NewRecorder()
		svc.PasskeyRegisterCompleteHandler(rr, req)
		checkStatus(t, rr, http.StatusBadRequest)
	})

	t.Run("SessionLoadError_Returns500", func(t *testing.T) {
		wa := newTestWebAuthn(t)
		svc, ec := svcWithPasskeyDeps(t, &fakeHttpClient{}, wa)
		ec.getErr = errors.New("redis: connection refused")

		req := passkeyAuthedRequest(http.MethodPost, "/v1/passkeys/register/complete", "{}", regTestUserID)
		rr := httptest.NewRecorder()
		svc.PasskeyRegisterCompleteHandler(rr, req)
		checkStatus(t, rr, http.StatusInternalServerError)
	})

	t.Run("SessionFoundButInvalidCeremonyResponse_Returns400", func(t *testing.T) {
		wa := newTestWebAuthn(t)
		fake := &fakeHttpClient{}
		svc, ec := svcWithPasskeyDeps(t, fake, wa)

		req := passkeyAuthedRequest(http.MethodPost, "/v1/passkeys/register/begin", "", regTestUserID)
		beginRR := httptest.NewRecorder()
		svc.PasskeyRegisterBeginHandler(beginRR, req)
		checkStatus(t, beginRR, http.StatusOK)

		if _, ok := ec.store["webauthn:reg:"+regTestUserID]; !ok {
			t.Fatal("expected registration session to be stored after begin")
		}

		completeReq := passkeyAuthedRequest(http.MethodPost, "/v1/passkeys/register/complete", "not-json", regTestUserID)
		rr := httptest.NewRecorder()
		svc.PasskeyRegisterCompleteHandler(rr, completeReq)
		checkStatus(t, rr, http.StatusBadRequest)
	})
}

// ── Component Tests: Auth boundary (Authenticate + RequireAnyScope) ───────

func TestPasskeyRegisterHandlers_AuthBoundary(t *testing.T) {
	wa := newTestWebAuthn(t)
	svc, _ := svcWithPasskeyDeps(t, &fakeHttpClient{}, wa)

	chain := func(next http.HandlerFunc) http.Handler {
		return PasskeyAuthMiddleware(svc.JWT)(mw.RequireAnyScope("otp:verified", "passkey:verified")(next))
	}

	t.Run("NoToken_Returns401", func(t *testing.T) {
		handler := chain(svc.PasskeyRegisterBeginHandler)
		req := httptest.NewRequest(http.MethodPost, "/v1/passkeys/register/begin", nil)
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		checkStatus(t, rr, http.StatusUnauthorized)
	})

	t.Run("InsufficientScope_Returns403", func(t *testing.T) {
		tok, err := testKeys.SignToken("test-issuer", regTestUserID, "test-audience", 3600, []string{"read"})
		if err != nil {
			t.Fatalf("SignToken: unexpected error: %v", err)
		}

		handler := chain(svc.PasskeyRegisterBeginHandler)
		req := httptest.NewRequest(http.MethodPost, "/v1/passkeys/register/begin", nil)
		req.Header.Set("Authorization", "Bearer "+tok)
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		checkStatus(t, rr, http.StatusForbidden)
	})

	t.Run("ValidTokenWithScope_ReachesHandler", func(t *testing.T) {
		tok, err := testKeys.SignToken("test-issuer", regTestUserID, "test-audience", 3600, []string{"otp:verified"})
		if err != nil {
			t.Fatalf("SignToken: unexpected error: %v", err)
		}

		handler := chain(svc.PasskeyRegisterBeginHandler)
		req := httptest.NewRequest(http.MethodPost, "/v1/passkeys/register/begin", nil)
		req.Header.Set("Authorization", "Bearer "+tok)
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		checkStatus(t, rr, http.StatusOK)
	})
}

// ── Unit Tests: helpers ──────────────────────────────────────────────────

func TestPasskeyUserID(t *testing.T) {
	tests := []struct {
		name       string
		sub        string
		wantUserID string
		wantOK     bool
	}{
		{name: "BareUUID", sub: "550e8400-e29b-41d4-a716-446655440000", wantUserID: "550e8400-e29b-41d4-a716-446655440000", wantOK: true},
		{name: "AnyNonEmptyString", sub: "some-other-value", wantUserID: "some-other-value", wantOK: true},
		{name: "EmptySubject", sub: "", wantUserID: "", wantOK: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			ctx := ctxKeys.WithUserID(req.Context(), tt.sub)
			req = req.WithContext(ctx)

			sub, userID, ok := passkeyUserID(req)
			if ok != tt.wantOK {
				t.Errorf("ok = %v, want %v", ok, tt.wantOK)
			}
			if userID != tt.wantUserID {
				t.Errorf("userID = %q, want %q", userID, tt.wantUserID)
			}
			if sub != tt.sub {
				t.Errorf("sub = %q, want %q", sub, tt.sub)
			}
		})
	}
}

func TestDescriptorToCredentialDescriptor(t *testing.T) {
	t.Run("ValidDescriptor", func(t *testing.T) {
		id := base64.RawURLEncoding.EncodeToString([]byte("credential-id"))
		desc, err := descriptorToCredentialDescriptor(clients.PasskeyCredentialDescriptor{
			CredentialId: id,
			Transports:   []string{"internal", "hybrid"},
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if string(desc.CredentialID) != "credential-id" {
			t.Errorf("expected decoded credential ID %q, got %q", "credential-id", desc.CredentialID)
		}
		if desc.Type != protocol.PublicKeyCredentialType {
			t.Errorf("expected type %q, got %q", protocol.PublicKeyCredentialType, desc.Type)
		}
		if len(desc.Transport) != 2 {
			t.Errorf("expected 2 transports, got %d", len(desc.Transport))
		}
	})

	t.Run("InvalidBase64_ReturnsError", func(t *testing.T) {
		_, err := descriptorToCredentialDescriptor(clients.PasskeyCredentialDescriptor{
			CredentialId: "not-valid-base64!!!",
		})
		if err == nil {
			t.Fatal("expected error for invalid base64 credential ID, got nil")
		}
	})
}

// ── Component Tests: PasskeyRegisterComplete transport handling ─────────────

func buildRegistrationAttestation(t *testing.T, rpID, origin, challenge string, transports []string) ([]byte, *ecdsa.PrivateKey) {
	t.Helper()

	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("ecdsa.GenerateKey: %v", err)
	}

	pubBytes, err := priv.PublicKey.Bytes()
	if err != nil {
		t.Fatalf("PublicKey.Bytes: %v", err)
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

	coseKey, err := cbor.Marshal(ec2Key{
		KeyType:   2,
		Algorithm: -7,
		Curve:     1,
		XCoord:    x,
		YCoord:    y,
	})
	if err != nil {
		t.Fatalf("cbor.Marshal cose key: %v", err)
	}

	credID := []byte("reg-test-cred-id-001")

	rpIDHash := sha256.Sum256([]byte(rpID))
	var flags byte = 0x01 | 0x04 | 0x40

	authData := make([]byte, 0, 37+2+2+16+len(credID)+len(coseKey))
	authData = append(authData, rpIDHash[:]...)
	authData = append(authData, flags)
	authData = append(authData, 0, 0, 0, 0)
	authData = append(authData, make([]byte, 16)...)

	credIDLen := make([]byte, 2)
	binary.BigEndian.PutUint16(credIDLen, uint16(len(credID)))
	authData = append(authData, credIDLen...)
	authData = append(authData, credID...)
	authData = append(authData, coseKey...)

	type attObj struct {
		Fmt      string         `cbor:"fmt"`
		AttStmt  map[string]any `cbor:"attStmt"`
		AuthData []byte         `cbor:"authData"`
	}
	attestationObj, err := cbor.Marshal(attObj{
		Fmt:      "none",
		AttStmt:  map[string]any{},
		AuthData: authData,
	})
	if err != nil {
		t.Fatalf("cbor.Marshal attestation object: %v", err)
	}

	clientData := protocol.CollectedClientData{
		Type:      protocol.CreateCeremony,
		Challenge: challenge,
		Origin:    origin,
	}
	clientDataJSON, err := json.Marshal(clientData)
	if err != nil {
		t.Fatalf("json.Marshal clientData: %v", err)
	}

	rawCredID := base64.RawURLEncoding.EncodeToString(credID)

	type attResponse struct {
		ClientDataJSON    string   `json:"clientDataJSON"`
		AttestationObject string   `json:"attestationObject"`
		Transports        []string `json:"transports,omitempty"`
	}
	type regResp struct {
		ID       string      `json:"id"`
		RawID    string      `json:"rawId"`
		Type     string      `json:"type"`
		Response attResponse `json:"response"`
	}

	body := regResp{
		ID:    rawCredID,
		RawID: rawCredID,
		Type:  "public-key",
		Response: attResponse{
			ClientDataJSON:    base64.RawURLEncoding.EncodeToString(clientDataJSON),
			AttestationObject: base64.RawURLEncoding.EncodeToString(attestationObj),
			Transports:        transports,
		},
	}

	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("json.Marshal registration response: %v", err)
	}
	return raw, priv
}

func TestPasskeyRegisterCompleteHandler_Component_NonEmptyTransports_NoPrependedEmpty(t *testing.T) {
	testutil.Component(t)

	wa := newTestWebAuthn(t)
	fake := &fakeHttpClient{}
	svc, ec := svcWithPasskeyDeps(t, fake, wa)

	beginReq := passkeyAuthedRequest(http.MethodPost, "/v1/passkeys/register/begin", "", regTestUserID)
	beginRR := httptest.NewRecorder()
	svc.PasskeyRegisterBeginHandler(beginRR, beginReq)
	checkStatus(t, beginRR, http.StatusOK)

	creation := decodeJSON[protocol.CredentialCreation](t, beginRR)
	challenge := creation.Response.Challenge.String()

	regBody, _ := buildRegistrationAttestation(t, "example.com", "https://example.com", challenge, []string{"internal", "hybrid"})

	completeReq := passkeyAuthedRequest(http.MethodPost, "/v1/passkeys/register/complete", string(regBody), regTestUserID)
	completeRR := httptest.NewRecorder()
	svc.PasskeyRegisterCompleteHandler(completeRR, completeReq)
	checkStatus(t, completeRR, http.StatusCreated)

	if fake.createdPasskey == nil {
		t.Fatal("expected CreatePasskeyCredential to be called")
	}

	transports := fake.createdPasskey.Transports
	if len(transports) != 2 {
		t.Fatalf("expected 2 transports, got %d: %v", len(transports), transports)
	}
	for i, tr := range transports {
		if tr == "" {
			t.Errorf("transport[%d] is empty string — indicates the old make()+append bug", i)
		}
	}
	if transports[0] != "internal" || transports[1] != "hybrid" {
		t.Errorf("expected transports [internal, hybrid], got %v", transports)
	}

	if _, ok := ec.store["session:claimed:reg:"+regTestUserID]; !ok {
		t.Error("expected session claim to be set in cache")
	}
}

func TestPasskeyRegisterCompleteHandler_Component_CreatePasskeyError_Returns503(t *testing.T) {
	testutil.Component(t)

	wa := newTestWebAuthn(t)
	fake := &fakeHttpClient{createPasskeyErr: errors.New("customer-api: 500")}
	svc, _ := svcWithPasskeyDeps(t, fake, wa)

	beginReq := passkeyAuthedRequest(http.MethodPost, "/v1/passkeys/register/begin", "", regTestUserID)
	beginRR := httptest.NewRecorder()
	svc.PasskeyRegisterBeginHandler(beginRR, beginReq)
	checkStatus(t, beginRR, http.StatusOK)

	creation := decodeJSON[protocol.CredentialCreation](t, beginRR)
	challenge := creation.Response.Challenge.String()

	regBody, _ := buildRegistrationAttestation(t, "example.com", "https://example.com", challenge, nil)

	completeReq := passkeyAuthedRequest(http.MethodPost, "/v1/passkeys/register/complete", string(regBody), regTestUserID)
	completeRR := httptest.NewRecorder()
	svc.PasskeyRegisterCompleteHandler(completeRR, completeReq)
	checkStatus(t, completeRR, http.StatusServiceUnavailable)
}

func TestPasskeyRegisterCompleteHandler_Component_ReplayDetected_Returns409(t *testing.T) {
	testutil.Component(t)

	wa := newTestWebAuthn(t)
	fake := &fakeHttpClient{}
	svc, ec := svcWithPasskeyDeps(t, fake, wa)

	beginReq := passkeyAuthedRequest(http.MethodPost, "/v1/passkeys/register/begin", "", regTestUserID)
	beginRR := httptest.NewRecorder()
	svc.PasskeyRegisterBeginHandler(beginRR, beginReq)
	checkStatus(t, beginRR, http.StatusOK)

	creation := decodeJSON[protocol.CredentialCreation](t, beginRR)
	challenge := creation.Response.Challenge.String()

	regBody, _ := buildRegistrationAttestation(t, "example.com", "https://example.com", challenge, nil)

	ec.store["session:claimed:reg:"+regTestUserID] = "1"

	completeReq := passkeyAuthedRequest(http.MethodPost, "/v1/passkeys/register/complete", string(regBody), regTestUserID)
	completeRR := httptest.NewRecorder()
	svc.PasskeyRegisterCompleteHandler(completeRR, completeReq)
	checkStatus(t, completeRR, http.StatusConflict)
}

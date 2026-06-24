package jwt

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"testing"

	gojwt "github.com/golang-jwt/jwt/v5"
)

// ── Unit Tests ───────────────────────────────────────────────────────────────

func testConfig(tb testing.TB) Config {
	tb.Helper()
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		tb.Fatalf("generate RSA key: %v", err)
	}
	privDER, err := x509.MarshalPKCS8PrivateKey(priv)
	if err != nil {
		tb.Fatalf("marshal private key: %v", err)
	}
	pubDER, err := x509.MarshalPKIXPublicKey(&priv.PublicKey)
	if err != nil {
		tb.Fatalf("marshal public key: %v", err)
	}
	return Config{
		PrivateKeyPEM: string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: privDER})),
		PublicKeyPEM:  string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pubDER})),
		KID:           "test-kid",
		Issuer:        "test-issuer",
		Audience:      "test-audience",
	}
}

func TestNew_ErrorPaths(t *testing.T) {
	valid := testConfig(t)

	ecKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate EC key: %v", err)
	}
	ecPubDER, err := x509.MarshalPKIXPublicKey(&ecKey.PublicKey)
	if err != nil {
		t.Fatalf("marshal EC public key: %v", err)
	}
	ecPubPEM := string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: ecPubDER}))

	cases := []struct {
		name string
		cfg  Config
	}{
		{"missing private key", Config{PublicKeyPEM: valid.PublicKeyPEM}},
		{"missing public key", Config{PrivateKeyPEM: valid.PrivateKeyPEM}},
		{"unparseable private key", Config{PrivateKeyPEM: "not-pem", PublicKeyPEM: valid.PublicKeyPEM}},
		{"non-RSA public key", Config{PrivateKeyPEM: valid.PrivateKeyPEM, PublicKeyPEM: ecPubPEM}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := New(tc.cfg); err == nil {
				t.Fatalf("expected error for %s", tc.name)
			}
		})
	}
}

func TestSignToken_RoundTrip(t *testing.T) {
	keys, err := New(testConfig(t))
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	tok, err := keys.SignToken("test-issuer", "subject-123", "test-audience", 3600, []string{"read", "write"})
	if err != nil {
		t.Fatalf("SignToken: %v", err)
	}

	claims, err := keys.ValidateAndParseClaims(tok)
	if err != nil {
		t.Fatalf("ValidateAndParseClaims: %v", err)
	}
	if claims.Subject != "subject-123" {
		t.Errorf("expected subject=subject-123, got %q", claims.Subject)
	}
	if claims.ID == "" {
		t.Error("expected a non-empty jti on the issued token")
	}
	if len(claims.Scopes) != 2 {
		t.Errorf("expected 2 scopes, got %v", claims.Scopes)
	}
}

// ── Benchmarks ───────────────────────────────────────────────────────────────

func BenchmarkSignToken(b *testing.B) {
	keys, err := New(testConfig(b))
	if err != nil {
		b.Fatalf("New: %v", err)
	}
	b.ResetTimer()
	for range b.N {
		if _, err := keys.SignToken("test-issuer", "subject-123", "test-audience", 3600, []string{"read", "write"}); err != nil {
			b.Fatalf("SignToken: %v", err)
		}
	}
}

func TestSignToken_StampsKID(t *testing.T) {
	keys, err := New(testConfig(t))
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	vks := keys.VerificationKeys()
	if len(vks) != 1 {
		t.Fatalf("expected exactly one verification key before rotation, got %d", len(vks))
	}
	if vks[0].Kid != "test-kid" {
		t.Errorf("expected kid=test-kid, got %q", vks[0].Kid)
	}
	if vks[0].Key == nil {
		t.Error("expected a non-nil public key for JWKS publication")
	}
}

func TestReload_OverlapWindow_AcceptsBothKeys(t *testing.T) {
	keys, err := New(testConfig(t))
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	oldTok, err := keys.SignToken("test-issuer", "subject", "test-audience", 3600, nil)
	if err != nil {
		t.Fatalf("SignToken (old): %v", err)
	}

	newCfg := testConfig(t)
	newCfg.KID = "test-kid-2"
	newCfg.Issuer = "test-issuer"
	newCfg.Audience = "test-audience"
	if err := keys.Reload(newCfg); err != nil {
		t.Fatalf("Reload: %v", err)
	}

	if _, err := keys.ValidateAndParseClaims(oldTok); err != nil {
		t.Errorf("expected old-key token to remain valid in the overlap window, got %v", err)
	}
	newTok, err := keys.SignToken("test-issuer", "subject", "test-audience", 3600, nil)
	if err != nil {
		t.Fatalf("SignToken (new): %v", err)
	}
	if _, err := keys.ValidateAndParseClaims(newTok); err != nil {
		t.Errorf("expected new-key token to verify, got %v", err)
	}

	vks := keys.VerificationKeys()
	if len(vks) != 2 {
		t.Fatalf("expected two verification keys during overlap, got %d", len(vks))
	}
	if vks[0].Kid != "test-kid-2" || vks[1].Kid != "test-kid" {
		t.Errorf("expected [test-kid-2, test-kid], got [%s, %s]", vks[0].Kid, vks[1].Kid)
	}
}

func TestReload_SameKID_DoesNotOpenOverlap(t *testing.T) {
	cfg := testConfig(t)
	keys, err := New(cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	if err := keys.Reload(cfg); err != nil {
		t.Fatalf("Reload: %v", err)
	}
	if len(keys.VerificationKeys()) != 1 {
		t.Errorf("expected no overlap window after a same-kid reload, got %d keys", len(keys.VerificationKeys()))
	}
}

func TestValidateToken_WrongAudience(t *testing.T) {
	keys, err := New(testConfig(t))
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	tok, err := keys.SignToken("test-issuer", "subject", "wrong-audience", 3600, nil)
	if err != nil {
		t.Fatalf("SignToken: %v", err)
	}

	if ok, err := keys.ValidateToken(tok); ok || err == nil {
		t.Error("expected validation to fail for a mismatched audience")
	}
}

func TestValidateToken_Expired(t *testing.T) {
	keys, err := New(testConfig(t))
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	tok, err := keys.SignToken("test-issuer", "subject", "test-audience", -60, nil)
	if err != nil {
		t.Fatalf("SignToken: %v", err)
	}

	if ok, err := keys.ValidateToken(tok); ok || err == nil {
		t.Error("expected validation to fail for an expired token")
	}
}

func TestReload_SwapsSigningKey(t *testing.T) {
	keys, err := New(testConfig(t))
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	oldTok, err := keys.SignToken("test-issuer", "subject", "test-audience", 3600, nil)
	if err != nil {
		t.Fatalf("SignToken (old): %v", err)
	}

	newCfg := testConfig(t)
	newCfg.Issuer = "test-issuer"
	newCfg.Audience = "test-audience"
	if err := keys.Reload(newCfg); err != nil {
		t.Fatalf("Reload: %v", err)
	}

	if _, err := keys.ValidateAndParseClaims(oldTok); err == nil {
		t.Error("expected a token signed by the rotated-out key to fail verification")
	}

	newTok, err := keys.SignToken("test-issuer", "subject", "test-audience", 3600, nil)
	if err != nil {
		t.Fatalf("SignToken (new): %v", err)
	}
	if _, err := keys.ValidateAndParseClaims(newTok); err != nil {
		t.Errorf("expected a token signed by the new key to verify, got %v", err)
	}
}

func TestReload_RejectsBadMaterialAndKeepsCurrent(t *testing.T) {
	keys, err := New(testConfig(t))
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	if err := keys.Reload(Config{PrivateKeyPEM: "garbage", PublicKeyPEM: "garbage"}); err == nil {
		t.Fatal("expected Reload to reject unparseable material")
	}

	// The active key must be unchanged — signing and verifying still works.
	tok, err := keys.SignToken("test-issuer", "subject", "test-audience", 3600, nil)
	if err != nil {
		t.Fatalf("SignToken after failed reload: %v", err)
	}
	if _, err := keys.ValidateAndParseClaims(tok); err != nil {
		t.Errorf("expected active key to survive a failed reload, got %v", err)
	}
}

func TestParseClaims_DoesNotEnforceAudience(t *testing.T) {
	keys, err := New(testConfig(t))
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	tok, err := keys.SignToken("test-issuer", "subject", "some-other-audience", 3600, nil)
	if err != nil {
		t.Fatalf("SignToken: %v", err)
	}

	claims, err := keys.ParseClaims(tok)
	if err != nil {
		t.Fatalf("ParseClaims should not enforce audience: %v", err)
	}
	if claims.Subject != "subject" {
		t.Errorf("expected subject=subject, got %q", claims.Subject)
	}
}

func TestParseClaims_RejectsNonRS256Signature(t *testing.T) {
	cfg := testConfig(t)
	keys, err := New(cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	priv, err := gojwt.ParseRSAPrivateKeyFromPEM([]byte(cfg.PrivateKeyPEM))
	if err != nil {
		t.Fatalf("ParseRSAPrivateKeyFromPEM: %v", err)
	}

	for _, method := range []*gojwt.SigningMethodRSA{gojwt.SigningMethodRS384, gojwt.SigningMethodRS512} {
		t.Run(method.Alg(), func(t *testing.T) {
			claims := CustomClaims{
				RegisteredClaims: gojwt.RegisteredClaims{
					Subject: "subject",
					Issuer:  cfg.Issuer,
				},
			}
			token := gojwt.NewWithClaims(method, claims)
			token.Header["kid"] = cfg.KID

			signed, err := token.SignedString(priv)
			if err != nil {
				t.Fatalf("SignedString: %v", err)
			}

			if _, err := keys.ParseClaims(signed); err == nil {
				t.Errorf("expected ParseClaims to reject a %s-signed token", method.Alg())
			}
		})
	}
}

package jwt

import (
	"crypto/rsa"
	"fmt"
	"sync/atomic"
	"time"

	gojwt "github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

type CustomClaims struct {
	Scopes   []string `json:"scp,omitempty"`
	Azp      string   `json:"azp,omitempty"`
	FamilyId string   `json:"family_id,omitempty"`
	gojwt.RegisteredClaims
}

type VerificationKey struct {
	Kid string
	Key *rsa.PublicKey
}

type keyset struct {
	privateKey *rsa.PrivateKey
	publicKey  *rsa.PublicKey
	kid        string
	iss        string
	aud        string
}
type Keys struct {
	active   atomic.Pointer[keyset]
	previous atomic.Pointer[keyset]
}

type Config struct {
	PrivateKeyPEM string
	PublicKeyPEM  string
	KID           string
	Issuer        string
	Audience      string
}

func parse(cfg Config) (*keyset, error) {
	if cfg.PrivateKeyPEM == "" || cfg.PublicKeyPEM == "" {
		return nil, fmt.Errorf("JWT keys not fully configured")
	}

	priv, err := gojwt.ParseRSAPrivateKeyFromPEM([]byte(cfg.PrivateKeyPEM))
	if err != nil {
		return nil, fmt.Errorf("failed to parse private key: %w", err)
	}

	pub, err := gojwt.ParseRSAPublicKeyFromPEM([]byte(cfg.PublicKeyPEM))
	if err != nil {
		return nil, fmt.Errorf("failed to parse public key: %w", err)
	}

	return &keyset{
		privateKey: priv,
		publicKey:  pub,
		kid:        cfg.KID,
		iss:        cfg.Issuer,
		aud:        cfg.Audience,
	}, nil
}

func New(cfg Config) (*Keys, error) {
	ks, err := parse(cfg)
	if err != nil {
		return nil, err
	}
	k := &Keys{}
	k.active.Store(ks)
	return k, nil
}

func (k *Keys) Reload(cfg Config) error {
	ks, err := parse(cfg)
	if err != nil {
		return err
	}
	if cur := k.active.Load(); cur != nil && cur.kid != ks.kid {
		k.previous.Store(cur)
	}
	k.active.Store(ks)
	return nil
}

func (k *Keys) VerificationKeys() []VerificationKey {
	out := make([]VerificationKey, 0, 2)
	if act := k.active.Load(); act != nil {
		out = append(out, VerificationKey{Kid: act.kid, Key: act.publicKey})
	}
	if prev := k.previous.Load(); prev != nil {
		out = append(out, VerificationKey{Kid: prev.kid, Key: prev.publicKey})
	}
	return out
}

func (k *Keys) SignToken(issuer string, subject string, audience string, ttl int64, scopes []string) (string, error) {
	return k.SignTokenWithAZP(issuer, subject, audience, "", ttl, scopes)
}

func (k *Keys) SignTokenWithAZP(issuer, subject, audience, azp string, ttl int64, scopes []string) (string, error) {
	return k.SignRefreshToken(issuer, subject, audience, azp, "", ttl, scopes)
}

func (k *Keys) SignRefreshToken(issuer, subject, audience, azp, familyID string, ttl int64, scopes []string) (string, error) {
	ks := k.active.Load()

	claims := CustomClaims{
		Scopes:   scopes,
		Azp:      azp,
		FamilyId: familyID,
		RegisteredClaims: gojwt.RegisteredClaims{
			Subject:   subject,
			Issuer:    issuer,
			Audience:  gojwt.ClaimStrings{audience},
			ExpiresAt: gojwt.NewNumericDate(time.Now().Add(time.Duration(ttl) * time.Second)),
			IssuedAt:  gojwt.NewNumericDate(time.Now()),
			NotBefore: gojwt.NewNumericDate(time.Now()),
			ID:        uuid.NewString(),
		},
	}

	token := gojwt.NewWithClaims(gojwt.SigningMethodRS256, claims)
	token.Header["kid"] = ks.kid
	return token.SignedString(ks.privateKey)
}

func (k *Keys) keyForToken(t *gojwt.Token) (any, error) {
	if _, ok := t.Method.(*gojwt.SigningMethodRSA); !ok {
		return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
	}

	kid, _ := t.Header["kid"].(string)
	act := k.active.Load()
	if act != nil && (kid == "" || kid == act.kid) {
		return act.publicKey, nil
	}
	if prev := k.previous.Load(); prev != nil && kid == prev.kid {
		return prev.publicKey, nil
	}
	return nil, fmt.Errorf("no verification key for kid %q", kid)
}

func (k *Keys) ValidateToken(tokenString string) (bool, error) {
	if _, err := k.parseValidated(tokenString); err != nil {
		return false, err
	}
	return true, nil
}

func (k *Keys) ValidateAndParseClaims(tokenString string) (*CustomClaims, error) {
	return k.parseValidated(tokenString)
}

func (k *Keys) ParseClaims(tokenString string) (*CustomClaims, error) {
	token, err := gojwt.ParseWithClaims(tokenString, &CustomClaims{}, k.keyForToken, gojwt.WithValidMethods([]string{"RS256"}))
	if err != nil {
		return nil, fmt.Errorf("failed to parse token: %w", err)
	}

	claims, ok := token.Claims.(*CustomClaims)
	if !ok {
		return nil, fmt.Errorf("invalid claims type")
	}
	return claims, nil
}

func (k *Keys) parseValidated(tokenString string) (*CustomClaims, error) {
	ks := k.active.Load()

	if ks.iss == "" {
		return nil, fmt.Errorf("missing jwt issuer")
	}
	if ks.aud == "" {
		return nil, fmt.Errorf("missing jwt audience")
	}

	token, err := gojwt.ParseWithClaims(
		tokenString,
		&CustomClaims{},
		k.keyForToken,
		gojwt.WithIssuer(ks.iss),
		gojwt.WithAudience(ks.aud),
		gojwt.WithValidMethods([]string{"RS256"}),
	)
	if err != nil {
		return nil, fmt.Errorf("verification failed: %w", err)
	}
	if !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}

	claims, ok := token.Claims.(*CustomClaims)
	if !ok {
		return nil, fmt.Errorf("invalid claims type")
	}
	return claims, nil
}

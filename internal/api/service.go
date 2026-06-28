package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"komodo-auth-api/internal/clients"
	"komodo-auth-api/internal/db"
	"komodo-auth-api/internal/jwt"
	"komodo-auth-api/internal/oauth"

	"github.com/go-webauthn/webauthn/webauthn"
	logger "github.com/rdevitto86/komodo-forge-sdk-go/logging/runtime"
	secAuth "github.com/rdevitto86/komodo-forge-sdk-go/security/oauth"
)

//go:generate go tool mockgen -package=mocks -destination=../testutil/mocks/token_authority.go komodo-auth-api/internal/api TokenAuthority

type TokenAuthority interface {
	SignToken(issuer, subject, audience string, ttl int64, scopes []string) (string, error)
	SignTokenWithAZP(issuer, subject, audience, azp string, ttl int64, scopes []string) (string, error)
	SignRefreshToken(issuer, subject, audience, azp, familyID string, ttl int64, scopes []string) (string, error)
	ValidateAndParseClaims(token string) (*jwt.CustomClaims, error)
	ParseClaims(token string) (*jwt.CustomClaims, error)
	VerificationKeys() []jwt.VerificationKey
}

type HttpReachabilityCheckers interface {
	CommsReachable(ctx context.Context) error
	CustomerReachable(ctx context.Context) error
}

type TableReachabilityChecker interface {
	Reachable(ctx context.Context) error
}

type Service struct {
	HttpClient           clients.HttpClientCallers
	HttpReachability     HttpReachabilityCheckers
	CacheClient          db.CacheClientCallers
	BannedChecker        clients.BannedChecker
	BannedReachability   TableReachabilityChecker
	JWT                  TokenAuthority
	ClientRegistry       *oauth.Registry
	ScopeValidator       *secAuth.Validator
	WebAuthn             *webauthn.WebAuthn
	authCodeGrantEnabled bool
	svcJWTMu             sync.Mutex
	svcJWT               string
	svcJWTExpiry         time.Time
}

type ServiceConfig struct {
	HttpClient           clients.HttpClientConfig
	CacheClient          *db.CacheClientConfig
	BannedCustomers      *clients.BannedCustomersConfig
	JWT                  TokenAuthority
	ClientRegistry       *oauth.Registry
	WebAuthn             *webauthn.WebAuthn
	AuthCodeGrantEnabled bool
}

func New(cfg ServiceConfig) (*Service, error) {
	httpClient, err := clients.New(cfg.HttpClient)
	if err != nil {
		return nil, fmt.Errorf("failed to create http client: %w", err)
	}

	cache := db.CacheClientCallers(db.NewFromOperations(nil))
	if cfg.CacheClient != nil {
		c, err := db.New(*cfg.CacheClient)
		if err != nil {
			return nil, fmt.Errorf("failed to create cache client: %w", err)
		}
		cache = c
	}

	svc := &Service{
		HttpClient:           httpClient,
		HttpReachability:     httpClient,
		CacheClient:          cache,
		JWT:                  cfg.JWT,
		ClientRegistry:       cfg.ClientRegistry,
		ScopeValidator:       secAuth.New(secAuth.Config{}),
		WebAuthn:             cfg.WebAuthn,
		authCodeGrantEnabled: cfg.AuthCodeGrantEnabled,
	}

	if cfg.BannedCustomers != nil {
		banned := clients.NewBannedCustomers(*cfg.BannedCustomers)
		svc.BannedChecker = banned
		svc.BannedReachability = banned
	}
	return svc, nil
}

func writeJSON(wtr http.ResponseWriter, v any) {
	if err := json.NewEncoder(wtr).Encode(v); err != nil {
		logger.Error("failed to encode response body", err)
	}
}

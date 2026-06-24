package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"time"

	"komodo-auth-api/internal/api"
	"komodo-auth-api/internal/clients"
	"komodo-auth-api/internal/db"
	authjwt "komodo-auth-api/internal/jwt"
	"komodo-auth-api/internal/oauth"

	sdkapi "github.com/rdevitto86/komodo-forge-sdk-go/api"
	"github.com/rdevitto86/komodo-forge-sdk-go/api/handlers/health"
	mw "github.com/rdevitto86/komodo-forge-sdk-go/api/middleware"
	srv "github.com/rdevitto86/komodo-forge-sdk-go/api/server"
	"github.com/rdevitto86/komodo-forge-sdk-go/auth"
	sdkaws "github.com/rdevitto86/komodo-forge-sdk-go/aws"
	awsSM "github.com/rdevitto86/komodo-forge-sdk-go/aws/secretsmanager"
	sdklog "github.com/rdevitto86/komodo-forge-sdk-go/logging"
	logger "github.com/rdevitto86/komodo-forge-sdk-go/logging/runtime"
	"github.com/rdevitto86/komodo-forge-sdk-go/security/jwt"
	"github.com/rdevitto86/komodo-forge-sdk-go/security/os/host"
)

const (
	AWS_ELASTICACHE_ENDPOINT = "AWS_ELASTICACHE_ENDPOINT"
	AWS_ELASTICACHE_PASSWORD = "AWS_ELASTICACHE_PASSWORD"
	AWS_ELASTICACHE_DB       = "AWS_ELASTICACHE_DB"
	REGISTERED_CLIENTS       = "REGISTERED_CLIENTS"
)

var secretKeys = []string{
	jwt.JWT_PUBLIC_KEY,
	jwt.JWT_PRIVATE_KEY,
	jwt.JWT_AUDIENCE,
	jwt.JWT_ISSUER,
	jwt.JWT_KID,
	REGISTERED_CLIENTS,
	AWS_ELASTICACHE_ENDPOINT,
	AWS_ELASTICACHE_PASSWORD,
	AWS_ELASTICACHE_DB,
}

var rotatingSecretNames = []string{
	jwt.JWT_PRIVATE_KEY,
	jwt.JWT_PUBLIC_KEY,
	jwt.JWT_KID,
	jwt.JWT_ISSUER,
	jwt.JWT_AUDIENCE,
	REGISTERED_CLIENTS,
}

const keyRotationPollInterval = 24 * time.Hour // daily rotation check

type bootstrapResult struct {
	jwtKeys        *authjwt.Keys
	clientRegistry *oauth.Registry
	cacheConfig    db.CacheClientConfig
	sm             *awsSM.Client
}

func jwtConfig(secrets map[string]string) authjwt.Config {
	return authjwt.Config{
		PrivateKeyPEM: secrets[jwt.JWT_PRIVATE_KEY],
		PublicKeyPEM:  secrets[jwt.JWT_PUBLIC_KEY],
		KID:           secrets[jwt.JWT_KID],
		Issuer:        secrets[jwt.JWT_ISSUER],
		Audience:      secrets[jwt.JWT_AUDIENCE],
	}
}

func loadDependencies(ctx context.Context) (*bootstrapResult, error) {
	if err := logger.Init(logger.Config{
		Level:  os.Getenv(sdklog.LOG_LEVEL),
		Format: logger.FormatJSON,
		Redact: logger.RedactStrict,
	}); err != nil {
		fmt.Fprintf(os.Stderr, "failed to initialize logger: %v\n", err)
		os.Exit(1)
	}

	smCfg := awsSM.Config{
		Region:     os.Getenv(sdkaws.AWS_REGION),
		Endpoint:   os.Getenv(sdkaws.AWS_ENDPOINT),
		SecretPath: os.Getenv(sdkaws.AWS_SECRET_PATH),
		Keys:       secretKeys,
	}

	sm, err := awsSM.New(ctx, smCfg)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize secrets manager: %w", err)
	}

	secrets, err := sm.GetSecrets(ctx, smCfg.Keys)
	if err != nil {
		sm.Close()
		return nil, fmt.Errorf("failed to fetch secrets: %w", err)
	}

	keys, err := authjwt.New(jwtConfig(secrets))
	if err != nil {
		sm.Close()
		return nil, fmt.Errorf("failed to initialize jwt keys: %w", err)
	}

	registry, err := oauth.NewRegistry(secrets[REGISTERED_CLIENTS])
	if err != nil {
		sm.Close()
		return nil, fmt.Errorf("failed to load client registry: %w", err)
	}

	return &bootstrapResult{
		jwtKeys:        keys,
		clientRegistry: registry,
		cacheConfig: db.CacheClientConfig{
			Endpoint: secrets[AWS_ELASTICACHE_ENDPOINT],
			Password: secrets[AWS_ELASTICACHE_PASSWORD],
			DB:       secrets[AWS_ELASTICACHE_DB],
		},
		sm: sm,
	}, nil
}

type jwtVerifierAdapter struct {
	ta api.TokenAuthority
}

func (a *jwtVerifierAdapter) Verify(_ context.Context, token string) (*auth.Claims, error) {
	claims, err := a.ta.ValidateAndParseClaims(token)
	if err != nil {
		return nil, fmt.Errorf("failed to validate token: %w", err)
	}
	c := &auth.Claims{
		Subject: claims.Subject,
		Scopes:  claims.Scopes,
		JTI:     claims.ID,
		Issuer:  claims.Issuer,
	}
	if claims.Audience != nil {
		c.Audience = claims.Audience
	}
	if claims.IssuedAt != nil {
		c.IssuedAt = claims.IssuedAt.Time
	}
	if claims.ExpiresAt != nil {
		c.ExpiresAt = claims.ExpiresAt.Time
	}
	return c, nil
}

func newMux(svc *api.Service) *http.ServeMux {
	internalMW := []func(http.Handler) http.Handler{
		mw.RequestIDMiddleware,
		mw.TelemetryMiddleware,
	}

	authMW := func(next http.Handler) http.Handler { return next }
	if svc != nil && svc.JWT != nil {
		authMW = mw.Middleware(&jwtVerifierAdapter{ta: svc.JWT})
	}
	clientMW := append(internalMW, mw.ClientTypeMiddleware, authMW)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", health.HealthHandler)

	var readyChecks []func(context.Context) error
	if svc != nil {
		readyChecks = append(readyChecks, svc.CacheClient.Reachable)
	}

	mux.Handle("GET /health/ready", mw.Chain(api.HealthReadyHandler(readyChecks...), internalMW...))

	mux.Handle("POST /v1/oauth/introspect", mw.Chain(http.HandlerFunc(svc.OAuthIntrospectHandler), clientMW...))

	mux.Handle("POST /v1/token/validate", mw.Chain(http.HandlerFunc(svc.ValidateTokenHandler), internalMW...))
	mux.Handle("GET /v1/clients", mw.Chain(http.HandlerFunc(svc.ListClientsHandler), clientMW...))
	mux.Handle("GET /v1/clients/{id}", mw.Chain(http.HandlerFunc(svc.GetClientHandler), clientMW...))

	return mux
}

func main() {
	if len(os.Args) > 1 && os.Args[1] == "-healthcheck" {
		os.Exit(api.HealthProbe(os.Getenv(sdkapi.PORT_PRIVATE)))
	}

	ctx := context.Background()

	if err := host.DisableCoreDumps(); err != nil {
		logger.Warn("failed to disable core dumps", logger.AttrError(err))
	}

	deps, err := loadDependencies(ctx)
	if err != nil {
		logger.Fatal("failed to bootstrap auth api (private)", err)
	}
	defer deps.sm.Close()

	deps.sm.Watch(ctx, keyRotationPollInterval, rotatingSecretNames, func(secrets map[string]string) {
		if err := deps.jwtKeys.Reload(jwtConfig(secrets)); err != nil {
			logger.Error("failed to reload rotated signing key", err)
		} else {
			logger.Info("reloaded rotated signing key")
		}

		if err := deps.clientRegistry.Reload(secrets[REGISTERED_CLIENTS]); err != nil {
			logger.Error("failed to reload client registry", err)
			return
		}
		logger.Info("reloaded client registry")
	})

	svc, err := api.New(api.ServiceConfig{
		HttpClient:     clients.HttpClientConfig{},
		CacheClient:    &deps.cacheConfig,
		JWT:            deps.jwtKeys,
		ClientRegistry: deps.clientRegistry,
	})
	if err != nil {
		logger.Fatal("failed to initialize auth-api service", err)
	}

	logger.Info("successfully bootstrapped auth api (private)")

	httpServer := &http.Server{
		Handler:           newMux(svc),
		ReadTimeout:       5 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
		ReadHeaderTimeout: 2 * time.Second,
		MaxHeaderBytes:    1 << 20, // 1MB
	}

	srv.Run(httpServer, os.Getenv(sdkapi.PORT_PRIVATE), 30*time.Second)
}

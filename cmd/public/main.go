package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"time"

	"komodo-auth-api/internal/api"
	"komodo-auth-api/internal/clients"
	"komodo-auth-api/internal/db"
	authjwt "komodo-auth-api/internal/jwt"
	"komodo-auth-api/internal/oauth"
	authwebauthn "komodo-auth-api/internal/webauthn"

	sdkapi "github.com/rdevitto86/komodo-forge-sdk-go/api"
	"github.com/rdevitto86/komodo-forge-sdk-go/api/handlers/health"
	"github.com/rdevitto86/komodo-forge-sdk-go/api/idempotency"
	mw "github.com/rdevitto86/komodo-forge-sdk-go/api/middleware"
	srv "github.com/rdevitto86/komodo-forge-sdk-go/api/server"
	sdkaws "github.com/rdevitto86/komodo-forge-sdk-go/aws"
	awsddb "github.com/rdevitto86/komodo-forge-sdk-go/aws/dynamodb"
	awsSM "github.com/rdevitto86/komodo-forge-sdk-go/aws/secretsmanager"
	sdkhttp "github.com/rdevitto86/komodo-forge-sdk-go/http"
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
	WEBAUTHN_RP_ID           = "WEBAUTHN_RP_ID"
	WEBAUTHN_ORIGINS         = "WEBAUTHN_ORIGINS"
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
	WEBAUTHN_RP_ID,
	WEBAUTHN_ORIGINS,
}

var envPassthrough = []string{
	sdkhttp.IP_WHITELIST,
	sdkhttp.IP_BLACKLIST,
	sdkhttp.MAX_CONTENT_LENGTH,
	sdkhttp.IDEMPOTENCY_TTL_SEC,
	sdkhttp.RATE_LIMIT_RPS,
	sdkhttp.RATE_LIMIT_BURST,
	sdkhttp.BUCKET_TTL_SECOND,
}

var rotatingSecretNames = []string{
	jwt.JWT_PRIVATE_KEY,
	jwt.JWT_PUBLIC_KEY,
	jwt.JWT_KID,
	jwt.JWT_ISSUER,
	jwt.JWT_AUDIENCE,
	REGISTERED_CLIENTS,
}

const keyRotationPollInterval = 24 * time.Hour

func configureIdempotencyStore() {
	ttl, err := strconv.ParseInt(os.Getenv(sdkhttp.IDEMPOTENCY_TTL_SEC), 10, 64)
	if err != nil || ttl <= 0 {
		ttl = idempotency.DEFAULT_IDEM_TTL_SEC
	}
	idempotency.SetStore(idempotency.NewStore("local", ttl))
}

type bootstrapResult struct {
	jwtKeys        *authjwt.Keys
	clientRegistry *oauth.Registry
	cacheConfig    db.CacheClientConfig
	webAuthnConfig authwebauthn.Config
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
		Keys:       append(append([]string{}, secretKeys...), envPassthrough...),
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

	for _, k := range envPassthrough {
		if v, ok := secrets[k]; ok {
			os.Setenv(k, v)
		}
	}

	configureIdempotencyStore()

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
		webAuthnConfig: authwebauthn.Config{
			RPID:    secrets[WEBAUTHN_RP_ID],
			Origins: secrets[WEBAUTHN_ORIGINS],
		},
		sm: sm,
	}, nil
}

func newMux(svc *api.Service) *http.ServeMux {
	readyMW := []func(http.Handler) http.Handler{
		mw.RequestIDMiddleware,
		mw.TelemetryMiddleware,
	}

	oauthMW := []func(http.Handler) http.Handler{
		mw.RequestIDMiddleware,
		mw.TelemetryMiddleware,
		mw.RateLimiterMiddleware,
		mw.IPAccessMiddleware,
		mw.CORSMiddleware,
		mw.SecurityHeadersMiddleware,
		mw.NormalizationMiddleware,
		mw.SanitizationMiddleware,
		mw.RuleValidationMiddleware,
	}

	otpRequestMW := append(append([]func(http.Handler) http.Handler{}, oauthMW...),
		mw.IdempotencyMiddleware,
	)

	var passkeyMW []func(http.Handler) http.Handler
	if svc != nil {
		passkeyMW = append(append([]func(http.Handler) http.Handler{}, oauthMW...),
			api.PasskeyAuthMiddleware(svc.JWT),
			mw.RequireAnyScope("otp:verified", "passkey:verified"),
		)
	}

	withMaxBytes := mw.MaxContentLengthMiddleware(0)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", health.HealthHandler)

	var readyChecks []func(context.Context) error
	if svc != nil {
		readyChecks = append(readyChecks, svc.CacheClient.Reachable)
		if svc.BannedReachability != nil {
			readyChecks = append(readyChecks, svc.BannedReachability.Reachable)
		}
		if svc.HttpReachability != nil {
			readyChecks = append(readyChecks, svc.HttpReachability.CommsReachable, svc.HttpReachability.UserReachable)
		}
	}

	mux.Handle("GET /health/ready", mw.Chain(api.HealthReadyHandler(readyChecks...), readyMW...))
	mux.Handle("GET /.well-known/jwks.json", mw.Chain(http.HandlerFunc(svc.JWKSHandler), readyMW...))

	mux.Handle("POST /v1/oauth/token", withMaxBytes(mw.Chain(http.HandlerFunc(svc.OAuthTokenHandler), oauthMW...)))
	mux.Handle("GET /v1/oauth/authorize", mw.Chain(http.HandlerFunc(svc.OAuthAuthorizeHandler), oauthMW...))
	mux.Handle("POST /v1/oauth/revoke", withMaxBytes(mw.Chain(http.HandlerFunc(svc.OAuthRevokeHandler), oauthMW...)))

	mux.Handle("POST /v1/otp/request", withMaxBytes(mw.Chain(http.HandlerFunc(svc.OTPRequestHandler), otpRequestMW...)))
	mux.Handle("POST /v1/otp/verify", withMaxBytes(mw.Chain(http.HandlerFunc(svc.OTPVerifyHandler), oauthMW...)))

	mux.Handle("POST /v1/passkeys/register/begin", withMaxBytes(mw.Chain(http.HandlerFunc(svc.PasskeyRegisterBeginHandler), passkeyMW...)))
	mux.Handle("POST /v1/passkeys/register/complete", withMaxBytes(mw.Chain(http.HandlerFunc(svc.PasskeyRegisterCompleteHandler), passkeyMW...)))

	mux.Handle("POST /v1/passkeys/login/begin", withMaxBytes(mw.Chain(http.HandlerFunc(svc.PasskeyLoginBeginHandler), oauthMW...)))
	mux.Handle("POST /v1/passkeys/login/complete", withMaxBytes(mw.Chain(http.HandlerFunc(svc.PasskeyLoginCompleteHandler), oauthMW...)))

	return mux
}

func main() {
	if len(os.Args) > 1 && os.Args[1] == "-healthcheck" {
		os.Exit(api.HealthProbe(os.Getenv(sdkapi.PORT)))
	}

	ctx := context.Background()

	if err := host.DisableCoreDumps(); err != nil {
		logger.Warn("failed to disable core dumps", logger.AttrError(err))
	}

	deps, err := loadDependencies(ctx)
	if err != nil {
		logger.Fatal("failed to bootstrap auth api (public)", err)
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

	ddb, err := awsddb.New(ctx, awsddb.Config{
		Region:   os.Getenv(sdkaws.AWS_REGION),
		Endpoint: os.Getenv(sdkaws.AWS_ENDPOINT),
	})
	if err != nil {
		logger.Fatal("failed to initialize dynamodb client", err)
	}

	wa, err := authwebauthn.New(deps.webAuthnConfig)
	if err != nil {
		logger.Fatal("failed to initialize webauthn relying party", err)
	}

	svc, err := api.New(api.ServiceConfig{
		HttpClient: clients.HttpClientConfig{
			CommsBaseURL: os.Getenv("COMMUNICATIONS_API_URL"),
			UserBaseURL:  os.Getenv("USER_API_PRIVATE_URL"),
		},
		CacheClient: &deps.cacheConfig,
		BannedCustomers: &clients.BannedCustomersConfig{
			TableName: os.Getenv("BANNED_CUSTOMERS_TABLE"),
			DynamoDB:  ddb,
		},
		JWT:                  deps.jwtKeys,
		ClientRegistry:       deps.clientRegistry,
		WebAuthn:             wa,
		AuthCodeGrantEnabled: os.Getenv("ENABLE_AUTH_CODE_GRANT") == "true",
	})
	if err != nil {
		logger.Fatal("failed to initialize auth-api service", err)
	}

	logger.Info("successfully bootstrapped auth api (public)")

	httpServer := &http.Server{
		Handler:           newMux(svc),
		ReadTimeout:       5 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
		ReadHeaderTimeout: 2 * time.Second,
		MaxHeaderBytes:    1 << 20, // 1MB
	}

	srv.Run(httpServer, os.Getenv(sdkapi.PORT), 30*time.Second)
}

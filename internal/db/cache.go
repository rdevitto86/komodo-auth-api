package db

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/go-webauthn/webauthn/webauthn"
	awsEC "github.com/rdevitto86/komodo-forge-sdk-go/db/redis"
)

var (
	ErrOTPNotFound        = errors.New("OTP code not found or expired")
	ErrOTPInvalid         = errors.New("invalid OTP code")
	ErrOTPCooldown        = errors.New("received OTP request too soon, try again shortly")
	ErrOTPAlreadyRedeemed = errors.New("OTP has already been redeemed")
	otpMax                = big.NewInt(1_000_000)
)

const (
	OTPCodeLen         = 6
	MaxOTPAttempts     = 5
	OTPCooldownSeconds = 60

	otpKeyPrefix    = "otp:"
	otpTTLSec       = int64(300)
	otpAttemptsKey  = "otp:attempts:"
	otpCooldownKey  = "otp:cooldown:"
	otpRedeemedKey  = "otp:redeemed:"
	otpCooldownTTL  = int64(OTPCooldownSeconds)
	otpRedeemedTTL  = int64(300)
	sessionClaimKey = "session:claimed:"
	sessionClaimTTL = int64(300)

	revokedKey       = "revoked:jti:"
	revokedFamilyKey = "revoked_family:"
	sentinel         = "1"
)

const healthSentinel = "health:ready"

//go:generate go tool mockgen -package=mocks -destination=../testutil/mocks/cache_client_callers.go komodo-auth-api/internal/db CacheClientCallers

type CacheClientCallers interface {
	GenerateAndStoreOTP(ctx context.Context, email string) (string, error)
	VerifyOTP(ctx context.Context, email, code string) error
	GetOTPAttempts(ctx context.Context, email string) (int64, error)
	IncrOTPAttempts(ctx context.Context, email string) (int64, error)
	DeleteOTPAttempts(ctx context.Context, email string)
	ClaimSession(ctx context.Context, sessionID string) (bool, error)
	StoreRevoked(ctx context.Context, jti string, remaining time.Duration) error
	IsRevoked(ctx context.Context, jti string) (bool, error)
	StoreRevokedFamily(ctx context.Context, familyID string, ttl time.Duration) error
	IsFamilyRevoked(ctx context.Context, familyID string) (bool, error)
	StoreWebAuthnRegistrationSession(ctx context.Context, userID string, session *webauthn.SessionData) error
	GetWebAuthnRegistrationSession(ctx context.Context, userID string) (*webauthn.SessionData, error)
	DeleteWebAuthnRegistrationSession(ctx context.Context, userID string) error
	StoreWebAuthnLoginSession(ctx context.Context, challenge string, session *WebAuthnLoginSession) error
	GetWebAuthnLoginSession(ctx context.Context, challenge string) (*WebAuthnLoginSession, error)
	DeleteWebAuthnLoginSession(ctx context.Context, challenge string) error
	StoreAuthCode(ctx context.Context, code string, entry *AuthCodeEntry) (bool, error)
	GetAuthCode(ctx context.Context, code string) (*AuthCodeEntry, error)
	DeleteAuthCode(ctx context.Context, code string) error
	Reachable(ctx context.Context) error
}

type CacheClientOperations interface {
	Get(ctx context.Context, key string) (string, error)
	Set(ctx context.Context, key, value string, ttl int64) error
	SetNX(ctx context.Context, key, value string, ttl int64) (bool, error)
	Delete(ctx context.Context, key string) error
	Incr(ctx context.Context, key string) (int64, error)
	Expire(ctx context.Context, key string, ttl int64) error
	Exists(ctx context.Context, key string) (bool, error)
}

type CacheClientConfig struct {
	Endpoint string
	Password string
	DB       string
}

type CacheClient struct {
	api CacheClientOperations
}

func New(cfg CacheClientConfig) (*CacheClient, error) {
	c, err := awsEC.NewFromDBString(cfg.Endpoint, cfg.Password, cfg.DB)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to cache: %w", err)
	}
	return &CacheClient{api: c}, nil
}

func NewFromOperations(ops CacheClientOperations) *CacheClient {
	return &CacheClient{api: ops}
}

func (c *CacheClient) Reachable(ctx context.Context) error {
	if c.api == nil {
		return fmt.Errorf("cache unavailable")
	}
	if _, err := c.api.Exists(ctx, healthSentinel); err != nil {
		return fmt.Errorf("failed to reach redis: %w", err)
	}
	return nil
}

func (c *CacheClient) ClaimSession(ctx context.Context, sessionID string) (bool, error) {
	if c.api == nil {
		return false, fmt.Errorf("cache client not initialized")
	}
	claimed, err := c.api.SetNX(ctx, sessionClaimKey+sessionID, sentinel, sessionClaimTTL)
	if err != nil {
		return false, fmt.Errorf("failed to claim session: %w", err)
	}
	return claimed, nil
}

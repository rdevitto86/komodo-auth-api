package db

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"fmt"
	"strconv"
)

func (c *CacheClient) GenerateAndStoreOTP(ctx context.Context, email string) (string, error) {
	if c.api == nil {
		return "", fmt.Errorf("cache client not initialized")
	}

	claimed, err := c.api.SetNX(ctx, otpCooldownKey+email, sentinel, otpCooldownTTL)
	if err != nil {
		return "", fmt.Errorf("failed to claim OTP cooldown: %w", err)
	}
	if !claimed {
		return "", ErrOTPCooldown
	}

	_ = c.api.Delete(ctx, otpRedeemedKey+email)

	code, err := generateOTPCode()
	if err != nil {
		return "", fmt.Errorf("failed to generate OTP code: %w", err)
	}

	if err := c.api.Set(ctx, otpKeyPrefix+email, code, otpTTLSec); err != nil {
		return "", fmt.Errorf("failed to store OTP: %w", err)
	}

	return code, nil
}

func (c *CacheClient) VerifyOTP(ctx context.Context, email, code string) error {
	if c.api == nil {
		return fmt.Errorf("cache client not initialized")
	}

	stored, err := c.api.Get(ctx, otpKeyPrefix+email)
	if err != nil {
		return fmt.Errorf("failed to look up OTP: %w", err)
	}
	if stored == "" {
		return ErrOTPNotFound
	}
	if subtle.ConstantTimeCompare([]byte(stored), []byte(code)) != 1 {
		return ErrOTPInvalid
	}

	claimed, err := c.api.SetNX(ctx, otpRedeemedKey+email, sentinel, otpRedeemedTTL)
	if err != nil {
		return fmt.Errorf("failed to claim OTP redemption: %w", err)
	}
	if !claimed {
		return ErrOTPAlreadyRedeemed
	}

	if err := c.api.Delete(ctx, otpKeyPrefix+email); err != nil {
		return fmt.Errorf("failed to delete OTP after use: %w", err)
	}
	return nil
}

func (c *CacheClient) GetOTPAttempts(ctx context.Context, email string) (int64, error) {
	if c.api == nil {
		return 0, nil
	}

	raw, err := c.api.Get(ctx, otpAttemptsKey+email)
	if err != nil {
		return 0, fmt.Errorf("failed to read OTP attempt count: %w", err)
	}
	if raw == "" {
		return 0, nil
	}

	count, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("failed to parse OTP attempt count: %w", err)
	}
	return count, nil
}

func (c *CacheClient) IncrOTPAttempts(ctx context.Context, email string) (int64, error) {
	if c.api == nil {
		return 0, nil
	}

	otpActive, existsErr := c.api.Exists(ctx, otpKeyPrefix+email)
	if existsErr != nil {
		return 0, fmt.Errorf("failed to check OTP existence: %w", existsErr)
	}
	if !otpActive {
		return 0, nil
	}

	key := otpAttemptsKey + email
	count, err := c.api.Incr(ctx, key)
	if err != nil {
		return 0, fmt.Errorf("failed to increment OTP attempts: %w", err)
	}
	if count == 1 {
		if err := c.api.Expire(ctx, key, otpTTLSec); err != nil {
			return count, fmt.Errorf("failed to set OTP attempts TTL: %w", err)
		}
	}
	return count, nil
}

func (c *CacheClient) DeleteOTPAttempts(ctx context.Context, email string) {
	if c.api == nil {
		return
	}
	c.api.Delete(ctx, otpAttemptsKey+email) //nolint:errcheck
}

func generateOTPCode() (string, error) {
	n, err := rand.Int(rand.Reader, otpMax)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

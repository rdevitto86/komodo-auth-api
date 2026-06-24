package db

import (
	"context"
	"fmt"
	"time"

	logger "github.com/rdevitto86/komodo-forge-sdk-go/logging/runtime"
)

func (c *CacheClient) StoreRevoked(ctx context.Context, jti string, remaining time.Duration) error {
	if jti == "" {
		return fmt.Errorf("received empty JTI")
	}
	if remaining <= 0 || c.api == nil {
		return nil
	}

	ttlSec := max(int64(remaining.Seconds()), 1)
	if err := c.api.Set(ctx, revokedKey+jti, sentinel, ttlSec); err != nil {
		return fmt.Errorf("failed to store revoked JTI %q: %w", jti, err)
	}

	logger.Debug("stored revoked JTI", logger.Attr("jti", jti))
	return nil
}

func (c *CacheClient) IsRevoked(ctx context.Context, jti string) (bool, error) {
	if jti == "" || c.api == nil {
		return false, nil
	}

	val, err := c.api.Get(ctx, revokedKey+jti)
	if err != nil {
		return false, fmt.Errorf("failed to check revocation for JTI %q: %w", jti, err)
	}
	return val != "", nil
}

func (c *CacheClient) StoreRevokedFamily(ctx context.Context, familyID string, ttl time.Duration) error {
	if familyID == "" {
		return fmt.Errorf("received empty family ID")
	}
	if ttl <= 0 || c.api == nil {
		return nil
	}

	ttlSec := max(int64(ttl.Seconds()), 1)
	if err := c.api.Set(ctx, revokedFamilyKey+familyID, sentinel, ttlSec); err != nil {
		return fmt.Errorf("failed to store revoked family %q: %w", familyID, err)
	}

	logger.Debug("stored revoked family", logger.Attr("family_id", familyID))
	return nil
}

func (c *CacheClient) IsFamilyRevoked(ctx context.Context, familyID string) (bool, error) {
	if familyID == "" || c.api == nil {
		return false, nil
	}

	val, err := c.api.Get(ctx, revokedFamilyKey+familyID)
	if err != nil {
		return false, fmt.Errorf("failed to check family revocation for %q: %w", familyID, err)
	}
	return val != "", nil
}

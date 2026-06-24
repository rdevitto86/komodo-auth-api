package db

import (
	"context"
	"testing"
	"time"
)

// ── Unit Tests ───────────────────────────────────────────────────────────────

func TestStoreRevoked_EmptyJTI_ReturnsError(t *testing.T) {
	c := newClient(newFake())
	if err := c.StoreRevoked(context.Background(), "", time.Minute); err == nil {
		t.Fatal("expected error when JTI is empty")
	}
}

func TestStoreRevoked_NonPositiveDuration_ReturnsNil(t *testing.T) {
	type test struct {
		name string
		d    time.Duration
	}

	tests := []test{
		{"zero", 0},
		{"negative", -time.Second},
	}
	c := newClient(newFake())
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if err := c.StoreRevoked(context.Background(), "some-jti", tc.d); err != nil {
				t.Fatalf("expected nil for %s duration, got: %v", tc.name, err)
			}
		})
	}
}

func TestStoreRevoked_NilCache_ReturnsNil(t *testing.T) {
	c := NewFromOperations(nil)
	if err := c.StoreRevoked(context.Background(), "jti-abc", time.Minute); err != nil {
		t.Fatalf("expected nil when cache is nil, got: %v", err)
	}
}

func TestStoreRevoked_ValidJTI_WritesRevokedKey(t *testing.T) {
	fake := newFake()
	c := newClient(fake)
	if err := c.StoreRevoked(context.Background(), "jti-456", 5*time.Minute); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	want := revokedKey + "jti-456"
	if got := fake.store[want]; got != sentinel {
		t.Fatalf("expected store[%q] = %q, got %q", want, sentinel, got)
	}
}

func TestStoreRevoked_SubSecondDuration_WritesKey(t *testing.T) {
	fake := newFake()
	c := newClient(fake)
	if err := c.StoreRevoked(context.Background(), "jti-sub", 500*time.Millisecond); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if _, ok := fake.store[revokedKey+"jti-sub"]; !ok {
		t.Fatalf("expected key to be written for sub-second duration")
	}
}

func TestStoreRevoked_CacheError_ReturnsError(t *testing.T) {
	fake := newFake()
	fake.failSet = true
	c := newClient(fake)
	if err := c.StoreRevoked(context.Background(), "jti-err", time.Minute); err == nil {
		t.Fatal("expected error from cache Set failure")
	}
}

func TestIsRevoked_EmptyJTI_ReturnsFalseNoError(t *testing.T) {
	c := newClient(newFake())
	revoked, err := c.IsRevoked(context.Background(), "")
	if err != nil {
		t.Fatalf("expected no error for empty JTI, got: %v", err)
	}
	if revoked {
		t.Fatal("expected false for empty JTI")
	}
}

func TestIsRevoked_NilCache_ReturnsFalseNoError(t *testing.T) {
	c := NewFromOperations(nil)
	revoked, err := c.IsRevoked(context.Background(), "jti-abc")
	if err != nil {
		t.Fatalf("expected nil error when cache is nil, got: %v", err)
	}
	if revoked {
		t.Fatal("expected false when cache is nil")
	}
}

func TestIsRevoked_CacheMiss_ReturnsFalse(t *testing.T) {
	c := newClient(newFake())
	revoked, err := c.IsRevoked(context.Background(), "jti-unknown")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if revoked {
		t.Fatal("expected false on cache miss")
	}
}

func TestIsRevoked_RevokedJTI_ReturnsTrue(t *testing.T) {
	fake := newFake()
	fake.store[revokedKey+"jti-bad"] = sentinel
	c := newClient(fake)
	revoked, err := c.IsRevoked(context.Background(), "jti-bad")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !revoked {
		t.Fatal("expected true for known-revoked JTI")
	}
}

func TestIsRevoked_CacheError_ReturnsError(t *testing.T) {
	fake := newFake()
	fake.failGet = true
	c := newClient(fake)
	if _, err := c.IsRevoked(context.Background(), "jti-err"); err == nil {
		t.Fatal("expected error from cache Get failure")
	}
}

// ── Unit Tests: StoreRevokedFamily ──────────────────────────────────────────

func TestStoreRevokedFamily_EmptyFamilyID_ReturnsError(t *testing.T) {
	c := newClient(newFake())
	if err := c.StoreRevokedFamily(context.Background(), "", time.Minute); err == nil {
		t.Fatal("expected error when family ID is empty")
	}
}

func TestStoreRevokedFamily_NonPositiveDuration_ReturnsNil(t *testing.T) {
	c := newClient(newFake())
	for _, d := range []time.Duration{0, -time.Second} {
		if err := c.StoreRevokedFamily(context.Background(), "family-1", d); err != nil {
			t.Fatalf("expected nil for duration %v, got: %v", d, err)
		}
	}
}

func TestStoreRevokedFamily_NilCache_ReturnsNil(t *testing.T) {
	c := NewFromOperations(nil)
	if err := c.StoreRevokedFamily(context.Background(), "family-1", time.Minute); err != nil {
		t.Fatalf("expected nil when cache is nil, got: %v", err)
	}
}

func TestStoreRevokedFamily_ValidID_WritesKey(t *testing.T) {
	fake := newFake()
	c := newClient(fake)
	if err := c.StoreRevokedFamily(context.Background(), "family-abc", 5*time.Minute); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := revokedFamilyKey + "family-abc"
	if got := fake.store[want]; got != sentinel {
		t.Fatalf("expected store[%q] = %q, got %q", want, sentinel, got)
	}
}

func TestStoreRevokedFamily_CacheError_ReturnsError(t *testing.T) {
	fake := newFake()
	fake.failSet = true
	c := newClient(fake)
	if err := c.StoreRevokedFamily(context.Background(), "family-err", time.Minute); err == nil {
		t.Fatal("expected error from cache Set failure")
	}
}

// ── Unit Tests: IsFamilyRevoked ─────────────────────────────────────────────

func TestIsFamilyRevoked_EmptyFamilyID_ReturnsFalseNoError(t *testing.T) {
	c := newClient(newFake())
	revoked, err := c.IsFamilyRevoked(context.Background(), "")
	if err != nil {
		t.Fatalf("expected no error for empty family ID, got: %v", err)
	}
	if revoked {
		t.Fatal("expected false for empty family ID")
	}
}

func TestIsFamilyRevoked_NilCache_ReturnsFalseNoError(t *testing.T) {
	c := NewFromOperations(nil)
	revoked, err := c.IsFamilyRevoked(context.Background(), "family-1")
	if err != nil {
		t.Fatalf("expected nil error when cache is nil, got: %v", err)
	}
	if revoked {
		t.Fatal("expected false when cache is nil")
	}
}

func TestIsFamilyRevoked_CacheMiss_ReturnsFalse(t *testing.T) {
	c := newClient(newFake())
	revoked, err := c.IsFamilyRevoked(context.Background(), "family-unknown")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if revoked {
		t.Fatal("expected false on cache miss")
	}
}

func TestIsFamilyRevoked_RevokedFamily_ReturnsTrue(t *testing.T) {
	fake := newFake()
	fake.store[revokedFamilyKey+"family-bad"] = sentinel
	c := newClient(fake)
	revoked, err := c.IsFamilyRevoked(context.Background(), "family-bad")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !revoked {
		t.Fatal("expected true for known-revoked family")
	}
}

func TestIsFamilyRevoked_CacheError_ReturnsError(t *testing.T) {
	fake := newFake()
	fake.failGet = true
	c := newClient(fake)
	if _, err := c.IsFamilyRevoked(context.Background(), "family-err"); err == nil {
		t.Fatal("expected error from cache Get failure")
	}
}

// ── Unit Tests: ClaimSession ────────────────────────────────────────────────

func TestClaimSession_NilCache_ReturnsError(t *testing.T) {
	c := NewFromOperations(nil)
	_, err := c.ClaimSession(context.Background(), "sess-1")
	if err == nil {
		t.Fatal("expected error when cache is nil")
	}
}

func TestClaimSession_FirstClaim_ReturnsTrue(t *testing.T) {
	c := newClient(newFake())
	claimed, err := c.ClaimSession(context.Background(), "sess-1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !claimed {
		t.Fatal("expected first claim to return true")
	}
}

func TestClaimSession_SecondClaim_ReturnsFalse(t *testing.T) {
	c := newClient(newFake())
	ctx := context.Background()
	if _, err := c.ClaimSession(ctx, "sess-1"); err != nil {
		t.Fatalf("first claim: unexpected error: %v", err)
	}
	claimed, err := c.ClaimSession(ctx, "sess-1")
	if err != nil {
		t.Fatalf("second claim: unexpected error: %v", err)
	}
	if claimed {
		t.Fatal("expected second claim to return false")
	}
}

func TestClaimSession_SetNXError_ReturnsError(t *testing.T) {
	fake := newFake()
	fake.failSetNX = true
	c := newClient(fake)
	_, err := c.ClaimSession(context.Background(), "sess-1")
	if err == nil {
		t.Fatal("expected error from SetNX failure")
	}
}

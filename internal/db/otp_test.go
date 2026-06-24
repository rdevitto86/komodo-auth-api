package db

import (
	"context"
	"errors"
	"testing"
	"unicode"
)

// ── Unit Tests ───────────────────────────────────────────────────────────────

func TestGenerateOTPCode_Format(t *testing.T) {
	const iterations = 100
	for i := range iterations {
		code, err := generateOTPCode()
		if err != nil {
			t.Fatalf("iteration %d: unexpected error: %v", i, err)
		}
		if len(code) != OTPCodeLen {
			t.Fatalf("iteration %d: expected length %d, got %d (code=%q)", i, OTPCodeLen, len(code), code)
		}
		for _, ch := range code {
			if !unicode.IsDigit(ch) {
				t.Fatalf("iteration %d: non-digit character %q in code %q", i, ch, code)
			}
		}
	}
}

func TestGenerateOTPCode_Range(t *testing.T) {
	const iterations = 100
	for i := range iterations {
		code, err := generateOTPCode()
		if err != nil {
			t.Fatalf("iteration %d: unexpected error: %v", i, err)
		}
		var n int
		for _, ch := range code {
			n = n*10 + int(ch-'0')
		}
		if n < 0 || n > 999_999 {
			t.Fatalf("iteration %d: code %q out of range [0, 999999]", i, code)
		}
	}
}

func TestErrOTP_Distinct(t *testing.T) {
	if ErrOTPNotFound == ErrOTPInvalid {
		t.Fatal("ErrOTPNotFound and ErrOTPInvalid must be distinct error values")
	}
}

func TestIncrOTPAttempts_FirstCall_ReturnsOne(t *testing.T) {
	fake := newFake()
	fake.store["otp:user@example.com"] = "123456"
	c := newClient(fake)
	count, err := c.IncrOTPAttempts(context.Background(), "user@example.com")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected count=1, got %d", count)
	}
}

func TestIncrOTPAttempts_SecondCall_ReturnsTwo(t *testing.T) {
	fake := newFake()
	fake.store["otp:user@example.com"] = "123456"
	c := newClient(fake)
	if _, err := c.IncrOTPAttempts(context.Background(), "user@example.com"); err != nil {
		t.Fatalf("first call: unexpected error: %v", err)
	}
	count, err := c.IncrOTPAttempts(context.Background(), "user@example.com")
	if err != nil {
		t.Fatalf("second call: unexpected error: %v", err)
	}
	if count != 2 {
		t.Fatalf("expected count=2, got %d", count)
	}
}

func TestIncrOTPAttempts_IncrError_Propagates(t *testing.T) {
	fake := newFake()
	fake.store["otp:user@example.com"] = "123456"
	fake.failIncr = true
	c := newClient(fake)
	_, err := c.IncrOTPAttempts(context.Background(), "user@example.com")
	if err == nil {
		t.Fatal("expected error from failing Incr, got nil")
	}
}

func TestIncrOTPAttempts_NoActiveOTP_ReturnsZero(t *testing.T) {
	c := newClient(newFake())
	count, err := c.IncrOTPAttempts(context.Background(), "user@example.com")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected count=0 when no OTP exists, got %d", count)
	}
}

// ── Unit Tests: OTP attempts & verify ────────────────────────────────────────

func TestGetOTPAttempts_NoKey_ReturnsZero(t *testing.T) {
	c := newClient(newFake())
	n, err := c.GetOTPAttempts(context.Background(), "user@example.com")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if n != 0 {
		t.Fatalf("expected 0 attempts for missing key, got %d", n)
	}
}

func TestGetOTPAttempts_StoredCount_ReturnsCount(t *testing.T) {
	fake := newFake()
	fake.store[otpAttemptsKey+"user@example.com"] = "3"
	c := newClient(fake)
	n, err := c.GetOTPAttempts(context.Background(), "user@example.com")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if n != 3 {
		t.Fatalf("expected 3 attempts, got %d", n)
	}
}

func TestGetOTPAttempts_GetError_Propagates(t *testing.T) {
	fake := newFake()
	fake.failGet = true
	c := newClient(fake)
	if _, err := c.GetOTPAttempts(context.Background(), "user@example.com"); err == nil {
		t.Fatal("expected error from failing Get, got nil")
	}
}

func TestGetOTPAttempts_NonNumeric_ReturnsError(t *testing.T) {
	fake := newFake()
	fake.store[otpAttemptsKey+"user@example.com"] = "not-a-number"
	c := newClient(fake)
	if _, err := c.GetOTPAttempts(context.Background(), "user@example.com"); err == nil {
		t.Fatal("expected parse error for non-numeric attempt count, got nil")
	}
}

func TestVerifyOTP_NoStored_ReturnsErrOTPNotFound(t *testing.T) {
	c := newClient(newFake())
	if err := c.VerifyOTP(context.Background(), "user@example.com", "123456"); !errors.Is(err, ErrOTPNotFound) {
		t.Fatalf("expected ErrOTPNotFound, got %v", err)
	}
}

func TestVerifyOTP_WrongCode_ReturnsErrOTPInvalid(t *testing.T) {
	fake := newFake()
	fake.store[otpKeyPrefix+"user@example.com"] = "123456"
	c := newClient(fake)
	if err := c.VerifyOTP(context.Background(), "user@example.com", "000000"); !errors.Is(err, ErrOTPInvalid) {
		t.Fatalf("expected ErrOTPInvalid, got %v", err)
	}
}

func TestVerifyOTP_GetError_Propagates(t *testing.T) {
	fake := newFake()
	fake.failGet = true
	c := newClient(fake)
	err := c.VerifyOTP(context.Background(), "user@example.com", "123456")
	if err == nil {
		t.Fatal("expected error from failing Get, got nil")
	}
	if errors.Is(err, ErrOTPNotFound) || errors.Is(err, ErrOTPInvalid) {
		t.Fatalf("expected non-sentinel error for cache failure, got %v", err)
	}
}

func TestVerifyOTP_DeleteError_Propagates(t *testing.T) {
	fake := newFake()
	fake.store[otpKeyPrefix+"user@example.com"] = "123456"
	fake.failDelete = true
	c := newClient(fake)
	if err := c.VerifyOTP(context.Background(), "user@example.com", "123456"); err == nil {
		t.Fatal("expected error when deleting redeemed OTP fails, got nil")
	}
}

// ── Benchmarks ───────────────────────────────────────────────────────────────

func BenchmarkVerifyOTP(b *testing.B) {
	const email, code = "bench@example.com", "123456"
	fake := newFake()
	c := newClient(fake)
	ctx := context.Background()
	for range b.N {
		b.StopTimer()
		fake.store = map[string]string{otpKeyPrefix + email: code}
		b.StartTimer()
		if err := c.VerifyOTP(ctx, email, code); err != nil {
			b.Fatalf("VerifyOTP: %v", err)
		}
	}
}

func TestGenerateAndStoreOTP_CooldownClaimError_Propagates(t *testing.T) {
	fake := newFake()
	fake.failSetNX = true
	c := newClient(fake)
	if _, err := c.GenerateAndStoreOTP(context.Background(), "user@example.com"); err == nil {
		t.Fatal("expected error when claiming cooldown fails, got nil")
	}
}

func TestGenerateAndStoreOTP_StoreError_Propagates(t *testing.T) {
	fake := newFake()
	fake.failSet = true
	c := newClient(fake)
	if _, err := c.GenerateAndStoreOTP(context.Background(), "user@example.com"); err == nil {
		t.Fatal("expected error when storing OTP fails, got nil")
	}
}

func TestDeleteOTPAttempts_RemovesKey(t *testing.T) {
	fake := newFake()
	fake.store[otpAttemptsKey+"user@example.com"] = "2"
	c := newClient(fake)
	c.DeleteOTPAttempts(context.Background(), "user@example.com")
	if _, ok := fake.store[otpAttemptsKey+"user@example.com"]; ok {
		t.Fatal("expected attempts key to be removed")
	}
}

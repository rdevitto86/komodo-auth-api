package webauthn

import (
	"testing"
)

// ── Unit Tests ───────────────────────────────────────────────────────────────

func TestNew_ErrorsWhenConfigEmpty(t *testing.T) {
	wa, err := New(Config{})
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if wa != nil {
		t.Errorf("expected nil webauthn instance, got %v", wa)
	}
}

func TestNew_ErrorsWhenOriginsEmpty(t *testing.T) {
	wa, err := New(Config{RPID: "example.com"})
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if wa != nil {
		t.Errorf("expected nil webauthn instance, got %v", wa)
	}
}

func TestNew_ErrorsWhenRPIDEmpty(t *testing.T) {
	wa, err := New(Config{Origins: "https://example.com"})
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if wa != nil {
		t.Errorf("expected nil webauthn instance, got %v", wa)
	}
}

func TestNew_CustomRPIDAndOrigins(t *testing.T) {
	wa, err := New(Config{
		RPID:    "example.com",
		Origins: "https://example.com, https://www.example.com",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if wa.Config.RPID != "example.com" {
		t.Errorf("expected RPID %q, got %q", "example.com", wa.Config.RPID)
	}

	want := []string{"https://example.com", "https://www.example.com"}
	if len(wa.Config.RPOrigins) != len(want) {
		t.Fatalf("expected %d origins, got %d (%v)", len(want), len(wa.Config.RPOrigins), wa.Config.RPOrigins)
	}
	for i, o := range want {
		if wa.Config.RPOrigins[i] != o {
			t.Errorf("origin %d: expected %q, got %q", i, o, wa.Config.RPOrigins[i])
		}
	}
}

func TestNew_BlankOriginsEntriesAreSkipped(t *testing.T) {
	wa, err := New(Config{
		RPID:    "example.com",
		Origins: "https://example.com,, ,https://www.example.com",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	want := []string{"https://example.com", "https://www.example.com"}
	if len(wa.Config.RPOrigins) != len(want) {
		t.Fatalf("expected %d origins, got %d (%v)", len(want), len(wa.Config.RPOrigins), wa.Config.RPOrigins)
	}
}

func TestNew_AppliesCeremonyDefaults(t *testing.T) {
	wa, err := New(Config{RPID: "example.com", Origins: "https://example.com"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if wa.Config.AttestationPreference != "none" {
		t.Errorf("expected attestation preference %q, got %q", "none", wa.Config.AttestationPreference)
	}
	if wa.Config.AuthenticatorSelection.UserVerification != "required" {
		t.Errorf("expected user verification %q, got %q", "required", wa.Config.AuthenticatorSelection.UserVerification)
	}
	if wa.Config.AuthenticatorSelection.ResidentKey != "preferred" {
		t.Errorf("expected resident key %q, got %q", "preferred", wa.Config.AuthenticatorSelection.ResidentKey)
	}
}

func TestRegistrationUser_Accessors(t *testing.T) {
	u := &RegistrationUser{
		ID:          []byte("user-123"),
		Name:        "user-123",
		DisplayName: "user-123",
	}

	if string(u.WebAuthnID()) != "user-123" {
		t.Errorf("expected WebAuthnID %q, got %q", "user-123", u.WebAuthnID())
	}
	if u.WebAuthnName() != "user-123" {
		t.Errorf("expected WebAuthnName %q, got %q", "user-123", u.WebAuthnName())
	}
	if u.WebAuthnDisplayName() != "user-123" {
		t.Errorf("expected WebAuthnDisplayName %q, got %q", "user-123", u.WebAuthnDisplayName())
	}
	if u.WebAuthnCredentials() != nil {
		t.Errorf("expected nil credentials, got %v", u.WebAuthnCredentials())
	}
}

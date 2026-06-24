package oauth

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"testing"
)

func newTestRegistry(t *testing.T, records map[string]ClientRecord) *Registry {
	t.Helper()
	raw, err := json.Marshal(records)
	if err != nil {
		t.Fatalf("failed to marshal test registry: %v", err)
	}
	reg, err := NewRegistry(string(raw))
	if err != nil {
		t.Fatalf("failed to construct test registry: %v", err)
	}
	return reg
}

func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

// ── Unit Tests ───────────────────────────────────────────────────────────────

func TestHasScope_EmptyAllowedList_FailsClosed(t *testing.T) {
	r := ClientRecord{AllowedScopes: []string{}}
	if r.HasScope("read:orders write:orders") {
		t.Fatal("empty AllowedScopes must grant nothing (fail closed)")
	}
}

func TestHasScope_NilAllowedList_FailsClosed(t *testing.T) {
	r := ClientRecord{}
	if r.HasScope("anything") {
		t.Fatal("nil AllowedScopes must grant nothing (fail closed)")
	}
}

func TestHasScope_ExplicitWildcard_GrantsAny(t *testing.T) {
	r := ClientRecord{AllowedScopes: []string{"*"}}
	if !r.HasScope("read:orders write:anything") {
		t.Fatal("explicit \"*\" entry should grant any scope")
	}
}

func TestHasScope_SingleScope_Match(t *testing.T) {
	r := ClientRecord{AllowedScopes: []string{"read:orders"}}
	if !r.HasScope("read:orders") {
		t.Fatal("expected HasScope to return true for allowed scope")
	}
}

func TestHasScope_SingleScope_NoMatch(t *testing.T) {
	r := ClientRecord{AllowedScopes: []string{"read:orders"}}
	if r.HasScope("write:orders") {
		t.Fatal("expected HasScope to return false for disallowed scope")
	}
}

func TestHasScope_MultiScope_AllMatch(t *testing.T) {
	r := ClientRecord{AllowedScopes: []string{"read:orders", "write:orders", "read:profile"}}
	if !r.HasScope("read:orders write:orders") {
		t.Fatal("expected HasScope to return true when all requested scopes are allowed")
	}
}

func TestHasScope_MultiScope_PartialFail(t *testing.T) {
	r := ClientRecord{AllowedScopes: []string{"read:orders"}}
	if r.HasScope("read:orders write:orders") {
		t.Fatal("expected HasScope to return false when any requested scope is not allowed")
	}
}

func TestNewRegistry_Empty(t *testing.T) {
	if _, err := NewRegistry(""); err == nil {
		t.Fatal("expected error when registry JSON is empty")
	}
}

func TestNewRegistry_MalformedJSON(t *testing.T) {
	if _, err := NewRegistry(`{not valid json}`); err == nil {
		t.Fatal("expected error for malformed JSON")
	}
}

func TestNewRegistry_ValidJSON(t *testing.T) {
	payload := map[string]ClientRecord{
		"client-a": {Name: "Client A", SecretHash: sha256Hex("s3cr3t"), AllowedScopes: []string{"read:orders"}},
	}
	raw, _ := json.Marshal(payload)

	reg, err := NewRegistry(string(raw))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if _, ok := reg.Get("client-a"); !ok {
		t.Fatal("expected client-a to be present in registry")
	}
}

func TestValidateAndGet_UninitializedRegistry(t *testing.T) {
	reg := &Registry{}
	_, ok := reg.ValidateAndGet("any", "any")
	if ok {
		t.Fatal("expected false for an uninitialized registry")
	}
}

func TestValidateAndGet_WrongSecret(t *testing.T) {
	reg := newTestRegistry(t, map[string]ClientRecord{
		"client-a": {Name: "A", SecretHash: sha256Hex("correct"), AllowedScopes: []string{"read:orders"}},
	})
	_, ok := reg.ValidateAndGet("client-a", "wrong")
	if ok {
		t.Fatal("expected false for wrong secret")
	}
}

func TestValidateAndGet_UnknownClient(t *testing.T) {
	reg := newTestRegistry(t, map[string]ClientRecord{
		"client-a": {Name: "A", SecretHash: sha256Hex("s3cr3t"), AllowedScopes: []string{"read"}},
	})
	_, ok := reg.ValidateAndGet("no-such-client", "s3cr3t")
	if ok {
		t.Fatal("expected false for unknown client ID")
	}
}

func TestValidateAndGet_Correct_ReturnsStrippedRecord(t *testing.T) {
	reg := newTestRegistry(t, map[string]ClientRecord{
		"client-a": {Name: "Client A", SecretHash: sha256Hex("s3cr3t"), AllowedScopes: []string{"read:orders"}},
	})
	rec, ok := reg.ValidateAndGet("client-a", "s3cr3t")
	if !ok {
		t.Fatal("expected true for correct credentials")
	}
	if rec.SecretHash != "" {
		t.Fatalf("expected secret to be stripped, got %q", rec.SecretHash)
	}
	if rec.Name != "Client A" {
		t.Fatalf("expected Name %q, got %q", "Client A", rec.Name)
	}
	if len(rec.AllowedScopes) != 1 || rec.AllowedScopes[0] != "read:orders" {
		t.Fatalf("unexpected AllowedScopes: %v", rec.AllowedScopes)
	}
}

func TestGet_UninitializedRegistry(t *testing.T) {
	reg := &Registry{}
	_, ok := reg.Get("client-a")
	if ok {
		t.Fatal("expected false for an uninitialized registry")
	}
}

func TestGet_UnknownID(t *testing.T) {
	reg := newTestRegistry(t, map[string]ClientRecord{
		"client-a": {Name: "A", SecretHash: sha256Hex("s3cr3t")},
	})
	_, ok := reg.Get("unknown")
	if ok {
		t.Fatal("expected false for unknown client ID")
	}
}

func TestGet_StripsSecret(t *testing.T) {
	reg := newTestRegistry(t, map[string]ClientRecord{
		"client-a": {Name: "Client A", SecretHash: sha256Hex("s3cr3t"), AllowedScopes: []string{"read:orders"}},
	})
	rec, ok := reg.Get("client-a")
	if !ok {
		t.Fatal("expected true for known client ID")
	}
	if rec.SecretHash != "" {
		t.Fatalf("expected secret to be stripped, got %q", rec.SecretHash)
	}
	if rec.Name != "Client A" {
		t.Fatalf("expected Name %q, got %q", "Client A", rec.Name)
	}
}

func TestList_UninitializedRegistry(t *testing.T) {
	reg := &Registry{}
	if reg.List() != nil {
		t.Fatal("expected nil for an uninitialized registry")
	}
}

func TestList_StripsSecrets(t *testing.T) {
	reg := newTestRegistry(t, map[string]ClientRecord{
		"client-a": {Name: "A", SecretHash: sha256Hex("secret-a"), AllowedScopes: []string{"read:orders"}},
		"client-b": {Name: "B", SecretHash: sha256Hex("secret-b"), AllowedScopes: []string{"write:orders"}},
	})
	result := reg.List()
	if len(result) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(result))
	}
	for id, rec := range result {
		if rec.SecretHash != "" {
			t.Errorf("client %q: expected secret stripped, got %q", id, rec.SecretHash)
		}
	}
}

func TestReload_SwapsClientSet(t *testing.T) {
	reg := newTestRegistry(t, map[string]ClientRecord{
		"client-a": {Name: "A", SecretHash: sha256Hex("s3cr3t"), AllowedScopes: []string{"read:orders"}},
	})
	if _, ok := reg.Get("client-a"); !ok {
		t.Fatal("expected client-a to be present before reload")
	}

	raw, _ := json.Marshal(map[string]ClientRecord{
		"client-b": {Name: "B", SecretHash: sha256Hex("s3cr3t"), AllowedScopes: []string{"write:orders"}},
	})
	if err := reg.Reload(string(raw)); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if _, ok := reg.Get("client-a"); ok {
		t.Fatal("expected client-a to be gone after reload")
	}
	if _, ok := reg.Get("client-b"); !ok {
		t.Fatal("expected client-b to be present after reload")
	}
}

func TestReload_InvalidJSON_LeavesExistingRegistryIntact(t *testing.T) {
	reg := newTestRegistry(t, map[string]ClientRecord{
		"client-a": {Name: "A", SecretHash: sha256Hex("s3cr3t"), AllowedScopes: []string{"read:orders"}},
	})

	if err := reg.Reload(`{not valid json}`); err == nil {
		t.Fatal("expected error for malformed JSON")
	}

	if _, ok := reg.Get("client-a"); !ok {
		t.Fatal("expected client-a to still be present after a failed reload")
	}
}

func TestDummySecretHash_MatchesSHA256HexLength(t *testing.T) {
	if len(dummySecretHash) != len(sha256Hex("anything")) {
		t.Fatalf("dummySecretHash length %d != sha256 hex length %d", len(dummySecretHash), len(sha256Hex("anything")))
	}
}

func TestValidateAndGet_UnknownClient_VariableSecretLengths(t *testing.T) {
	reg := newTestRegistry(t, map[string]ClientRecord{
		"client-a": {Name: "A", SecretHash: sha256Hex("s3cr3t"), AllowedScopes: []string{"read"}},
	})
	for _, secret := range []string{"", "x", "a-much-longer-presented-secret-value-than-the-real-one"} {
		if _, ok := reg.ValidateAndGet("no-such-client", secret); ok {
			t.Fatalf("expected false for unknown client with secret %q", secret)
		}
	}
}

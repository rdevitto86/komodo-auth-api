package oauth

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"sync/atomic"
)

type ClientRecord struct {
	Name                string   `json:"name"`
	SecretHash          string   `json:"secret_hash"`
	AllowedScopes       []string `json:"allowed_scopes"`
	AllowedAudiences    []string `json:"allowed_audiences,omitempty"`
	AllowedRedirectURIs []string `json:"allowed_redirect_uris,omitempty"`
}

func (r ClientRecord) HasScope(scope string) bool {
	if len(r.AllowedScopes) == 0 {
		return false
	}
	if slices.Contains(r.AllowedScopes, "*") {
		return true
	}

	for s := range strings.FieldsSeq(scope) {
		if !slices.Contains(r.AllowedScopes, s) {
			return false
		}
	}
	return true
}

type store struct {
	clients map[string]ClientRecord
}

type Registry struct {
	ptr atomic.Pointer[store]
}

var dummySecretHash = hex.EncodeToString(make([]byte, sha256.Size))

func NewRegistry(raw string) (*Registry, error) {
	r := &Registry{}
	if err := r.Reload(raw); err != nil {
		return nil, err
	}
	return r, nil
}

func (r *Registry) Reload(raw string) error {
	if raw == "" {
		return fmt.Errorf("REGISTERED_CLIENTS not configured")
	}

	var parsed map[string]ClientRecord
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return fmt.Errorf("failed to parse REGISTERED_CLIENTS: %w", err)
	}

	r.ptr.Store(&store{clients: parsed})
	return nil
}

func (r *Registry) ValidateAndGet(clientID, secret string) (ClientRecord, bool) {
	if r == nil {
		return ClientRecord{}, false
	}

	s := r.ptr.Load()
	if s == nil {
		return ClientRecord{}, false
	}

	sum := sha256.Sum256([]byte(secret))
	presented := hex.EncodeToString(sum[:])

	rec, ok := s.clients[clientID]
	want := dummySecretHash
	if ok {
		want = rec.SecretHash
	}

	if subtle.ConstantTimeCompare([]byte(presented), []byte(want)) != 1 || !ok {
		return ClientRecord{}, false
	}
	return ClientRecord{
		Name:                rec.Name,
		AllowedScopes:       rec.AllowedScopes,
		AllowedAudiences:    rec.AllowedAudiences,
		AllowedRedirectURIs: rec.AllowedRedirectURIs,
	}, true
}

func (r *Registry) Get(clientID string) (ClientRecord, bool) {
	if r == nil {
		return ClientRecord{}, false
	}

	s := r.ptr.Load()
	if s == nil {
		return ClientRecord{}, false
	}

	rec, ok := s.clients[clientID]
	if !ok {
		return ClientRecord{}, false
	}

	return ClientRecord{
		Name:                rec.Name,
		AllowedScopes:       rec.AllowedScopes,
		AllowedAudiences:    rec.AllowedAudiences,
		AllowedRedirectURIs: rec.AllowedRedirectURIs,
	}, true
}

func (r *Registry) List() map[string]ClientRecord {
	if r == nil {
		return nil
	}
	s := r.ptr.Load()
	if s == nil {
		return nil
	}

	result := make(map[string]ClientRecord, len(s.clients))
	for id, rec := range s.clients {
		result[id] = ClientRecord{
			Name:                rec.Name,
			AllowedScopes:       rec.AllowedScopes,
			AllowedAudiences:    rec.AllowedAudiences,
			AllowedRedirectURIs: rec.AllowedRedirectURIs,
		}
	}
	return result
}

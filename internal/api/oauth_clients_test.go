package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/rdevitto86/komodo-forge-sdk-go/testing/testutil"
)

// ── Unit Tests ───────────────────────────────────────────────────────────────

func TestGetClientHandler_UnknownClient(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/v1/clients/no-such-client", nil)
	req.SetPathValue("id", "no-such-client")
	rr := httptest.NewRecorder()
	srv().GetClientHandler(rr, req)

	if rr.Code >= 200 && rr.Code < 300 {
		t.Errorf("expected non-2xx for unknown client, got %d; body: %s", rr.Code, rr.Body.String())
	}
}

// ── Component Tests ──────────────────────────────────────────────────────────

func TestGetClientHandler_Component_KnownClient(t *testing.T) {
	testutil.Component(t)
	req := httptest.NewRequest(http.MethodGet, "/v1/clients/test-client", nil)
	req.SetPathValue("id", "test-client")
	rr := httptest.NewRecorder()
	srv().GetClientHandler(rr, req)
	checkStatus(t, rr, http.StatusOK)

	type clientResp struct {
		ClientID      string   `json:"client_id"`
		Name          string   `json:"name"`
		AllowedScopes []string `json:"allowed_scopes"`
		Secret        string   `json:"secret"`
	}

	resp := decodeJSON[clientResp](t, rr)

	if resp.ClientID != "test-client" {
		t.Errorf("expected client_id=test-client, got %q", resp.ClientID)
	}
	if resp.Name == "" {
		t.Error("expected non-empty name in client response")
	}
	if resp.Secret != "" {
		t.Error("secret must never be returned in client response")
	}
}

func TestListClientsHandler_Component_ReturnsArray(t *testing.T) {
	testutil.Component(t)
	req := httptest.NewRequest(http.MethodGet, "/v1/clients", nil)
	rr := httptest.NewRecorder()
	srv().ListClientsHandler(rr, req)
	checkStatus(t, rr, http.StatusOK)

	type clientEntry struct {
		ClientID string `json:"client_id"`
	}

	entries := decodeJSON[[]clientEntry](t, rr)

	if len(entries) == 0 {
		t.Error("expected at least one client entry from seeded registry")
	}

	found := false
	for _, e := range entries {
		if e.ClientID == "test-client" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("expected test-client in list response; got: %+v", entries)
	}
}

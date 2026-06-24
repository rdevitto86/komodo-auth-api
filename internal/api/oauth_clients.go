package api

import (
	"net/http"

	httpErr "github.com/rdevitto86/komodo-forge-sdk-go/api/errors"
	logger "github.com/rdevitto86/komodo-forge-sdk-go/logging/runtime"
)

func (s *Service) GetClientHandler(wtr http.ResponseWriter, req *http.Request) {
	wtr.Header().Set("Content-Type", "application/json")

	id := req.PathValue("id")
	rec, ok := s.ClientRegistry.Get(id)
	if !ok {
		httpErr.SendError(wtr, req, httpErr.Auth.InvalidClientCredentials, httpErr.WithDetail("client not found: "+id))
		return
	}

	logger.Info("fetched client", logger.Attr("client_id", id))
	wtr.WriteHeader(http.StatusOK)
	writeJSON(wtr, map[string]any{
		"client_id":      id,
		"name":           rec.Name,
		"allowed_scopes": rec.AllowedScopes,
	})
}

func (s *Service) ListClientsHandler(wtr http.ResponseWriter, req *http.Request) {
	wtr.Header().Set("Content-Type", "application/json")

	all := s.ClientRegistry.List()
	result := make([]map[string]any, 0, len(all))
	for id, rec := range all {
		result = append(result, map[string]any{
			"client_id":      id,
			"name":           rec.Name,
			"allowed_scopes": rec.AllowedScopes,
		})
	}

	wtr.WriteHeader(http.StatusOK)
	writeJSON(wtr, result)
}

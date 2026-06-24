package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"komodo-auth-api/internal/models"

	gojwt "github.com/golang-jwt/jwt/v5"
	logger "github.com/rdevitto86/komodo-forge-sdk-go/logging/runtime"
)

func validationErrorReason(err error) string {
	switch {
	case errors.Is(err, gojwt.ErrTokenExpired):
		return "token has expired"
	case errors.Is(err, gojwt.ErrTokenNotValidYet):
		return "token is not yet valid"
	case errors.Is(err, gojwt.ErrTokenInvalidAudience), errors.Is(err, gojwt.ErrTokenInvalidIssuer):
		return "token issuer or audience is invalid"
	case errors.Is(err, gojwt.ErrTokenSignatureInvalid), errors.Is(err, gojwt.ErrTokenMalformed):
		return "token signature is invalid"
	default:
		return "token is invalid"
	}
}

func (s *Service) ValidateTokenHandler(wtr http.ResponseWriter, req *http.Request) {
	wtr.Header().Set("Content-Type", "application/json")
	wtr.Header().Set("Cache-Control", "no-store")

	var body models.ValidateRequest
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil || body.Token == "" {
		logger.Error("invalid request body", err)
		errMsg := "missing or unparseable token"
		wtr.WriteHeader(http.StatusOK)
		writeJSON(wtr, models.ValidateResponse{Valid: false, Error: &errMsg})
		return
	}

	claims, err := s.JWT.ValidateAndParseClaims(body.Token)
	if err != nil {
		logger.Error("token validation failed", err)
		errMsg := validationErrorReason(err)
		wtr.WriteHeader(http.StatusOK)
		writeJSON(wtr, models.ValidateResponse{Valid: false, Error: &errMsg})
		return
	}

	if claims.ID != "" {
		revoked, err := s.CacheClient.IsRevoked(req.Context(), claims.ID)
		if err != nil {
			logger.Error("revocation check failed, proceeding", err)
		} else if revoked {
			logger.Error("token is revoked", fmt.Errorf("jti: %s", claims.ID))
			errMsg := "token has been revoked"
			wtr.WriteHeader(http.StatusOK)
			writeJSON(wtr, models.ValidateResponse{Valid: false, Error: &errMsg})
			return
		}
	}

	logger.Info("token validated", logger.Attr("subject", claims.Subject))

	wtr.WriteHeader(http.StatusOK)
	writeJSON(wtr, models.ValidateResponse{
		Valid:  true,
		Sub:    &claims.Subject,
		Scopes: &claims.Scopes,
	})
}

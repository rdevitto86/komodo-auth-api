package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"komodo-auth-api/internal/models"

	httpErr "github.com/rdevitto86/komodo-forge-sdk-go/api/errors"
	logger "github.com/rdevitto86/komodo-forge-sdk-go/logging/runtime"
)

func (s *Service) OAuthIntrospectHandler(wtr http.ResponseWriter, req *http.Request) {
	wtr.Header().Set("Content-Type", "application/json")
	wtr.Header().Set("Cache-Control", "no-store")

	var reqBody models.IntrospectRequest
	if err := json.NewDecoder(req.Body).Decode(&reqBody); err != nil || reqBody.Token == "" {
		httpErr.SendError(wtr, req, httpErr.Global.BadRequest, httpErr.WithDetail("missing token"))
		return
	}

	inactive := func() {
		wtr.WriteHeader(http.StatusOK)
		writeJSON(wtr, models.IntrospectResponse{Active: false})
	}

	claims, err := s.JWT.ParseClaims(reqBody.Token)
	if err != nil {
		logger.Warn("unparseable token submitted")
		inactive()
		return
	}

	var scope *string // scopes aka permissions
	if len(claims.Scopes) > 0 {
		scopeStr := strings.Join(claims.Scopes, " ")
		scope = &scopeStr
	}

	var aud *string // audience aka intended recipient
	if len(claims.Audience) > 0 {
		audStr := claims.Audience[0]
		aud = &audStr
	}

	var exp *int64 // expiration time
	if claims.ExpiresAt != nil {
		expiresAt := claims.ExpiresAt.Unix()
		exp = &expiresAt
	}

	var iat *int64 // issued at time
	if claims.IssuedAt != nil {
		issuedAt := claims.IssuedAt.Unix()
		iat = &issuedAt
	}

	sub := claims.Subject // subject aka user ID
	tokenType := "Bearer"

	if claims.ID != "" {
		revoked, err := s.CacheClient.IsRevoked(req.Context(), claims.ID)
		if err != nil {
			logger.Error("revocation check failed", err)
		} else if revoked {
			logger.Info("token is revoked", logger.Attr("jti", claims.ID))
			inactive()
			return
		}
	}

	logger.Info("token introspection successful", logger.Attr("subject", claims.Subject))

	wtr.WriteHeader(http.StatusOK)
	writeJSON(wtr, models.IntrospectResponse{
		Active:    true,
		Scope:     scope,
		ClientId:  &sub,
		TokenType: &tokenType,
		Exp:       exp,
		Iat:       iat,
		Sub:       &sub,
		Aud:       aud,
	})
}

package api

import (
	"encoding/json"
	"net/http"
	"time"

	"komodo-auth-api/internal/models"

	httpErr "github.com/rdevitto86/komodo-forge-sdk-go/api/errors"
	logger "github.com/rdevitto86/komodo-forge-sdk-go/logging/runtime"
)

func (s *Service) OAuthRevokeHandler(wtr http.ResponseWriter, req *http.Request) {
	wtr.Header().Set("Content-Type", "application/json")
	wtr.Header().Set("Cache-Control", "no-store")

	var reqBody models.RevokeRequest
	if err := json.NewDecoder(req.Body).Decode(&reqBody); err != nil {
		logger.Error("failed to parse request body", err)
		httpErr.SendError(wtr, req, httpErr.Global.BadRequest, httpErr.WithDetail("failed to parse request body"))
		return
	}

	if reqBody.Token == "" {
		logger.Warn("missing token parameter")
		httpErr.SendError(wtr, req, httpErr.Global.BadRequest, httpErr.WithDetail("missing token parameter"))
		return
	}

	clientID, clientSecret, hasBasic := req.BasicAuth()
	if !hasBasic {
		if reqBody.ClientId != nil {
			clientID = *reqBody.ClientId
		}
		if reqBody.ClientSecret != nil {
			clientSecret = *reqBody.ClientSecret
		}
	}

	if clientID == "" || clientSecret == "" {
		logger.Warn("revoke rejected: missing client credentials")
		wtr.Header().Set("WWW-Authenticate", `Basic realm="komodo-auth"`)
		httpErr.SendError(wtr, req, httpErr.Auth.InvalidClientCredentials, httpErr.WithDetail("client authentication required"))
		return
	}

	if _, ok := s.ClientRegistry.ValidateAndGet(clientID, clientSecret); !ok {
		logger.Warn("invalid client credentials for token revocation", logger.Attr("client_id", clientID))
		wtr.Header().Set("WWW-Authenticate", `Basic realm="komodo-auth"`)
		httpErr.SendError(wtr, req, httpErr.Auth.InvalidClientCredentials, httpErr.WithDetail("invalid client credentials"))
		return
	}

	claims, err := s.JWT.ParseClaims(reqBody.Token)
	if err != nil {
		logger.Warn("invalid token submitted for revocation", logger.Attr("client_id", clientID))
		wtr.WriteHeader(http.StatusOK)
		writeJSON(wtr, map[string]bool{"revoked": true})
		return
	}

	jti := claims.ID
	if jti == "" {
		logger.Warn("token submitted for revocation is missing JTI claim", logger.Attr("client_id", clientID))
		wtr.WriteHeader(http.StatusOK)
		writeJSON(wtr, map[string]bool{"revoked": true})
		return
	}

	if _, isRegisteredClient := s.ClientRegistry.Get(claims.Subject); isRegisteredClient {
		if claims.Subject != clientID {
			logger.Warn("rejected cross-client revocation attempt", logger.Attr("client_id", clientID), logger.Attr("token_subject", claims.Subject))
			httpErr.SendError(wtr, req, httpErr.Auth.InsufficientScope, httpErr.WithDetail("token was not issued to this client"))
			return
		}
	} else if claims.Azp != "" && claims.Azp != clientID {
		logger.Warn("rejected cross-client user token revocation", logger.Attr("client_id", clientID), logger.Attr("azp", claims.Azp))
		httpErr.SendError(wtr, req, httpErr.Auth.InsufficientScope, httpErr.WithDetail("token was not issued to this client"))
		return
	}

	ttl := time.Duration(0)
	if claims.ExpiresAt != nil {
		ttl = time.Until(claims.ExpiresAt.Time)
	}
	if ttl <= 0 {
		logger.Info("token already expired, no revocation needed")
		wtr.WriteHeader(http.StatusOK)
		writeJSON(wtr, map[string]bool{"revoked": true})
		return
	}

	if err := s.CacheClient.StoreRevoked(req.Context(), jti, ttl); err != nil {
		logger.Error("failed to store revoked JTI in cache", err)
		httpErr.SendError(wtr, req, httpErr.Global.Internal, httpErr.WithDetail("failed to revoke token"))
		return
	}

	logger.Info("token revoked", logger.Attr("subject", claims.Subject), logger.Attr("jti", jti), logger.Attr("client_id", clientID))

	wtr.WriteHeader(http.StatusOK)
	writeJSON(wtr, map[string]any{
		"revoked":    true,
		"revoked_at": time.Now().Unix(),
	})
}

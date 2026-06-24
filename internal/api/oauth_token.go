package api

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"slices"
	"strings"
	"time"

	"komodo-auth-api/internal/jwt"
	"komodo-auth-api/internal/models"

	"github.com/google/uuid"
	httpErr "github.com/rdevitto86/komodo-forge-sdk-go/api/errors"
	logger "github.com/rdevitto86/komodo-forge-sdk-go/logging/runtime"
	secOAuth "github.com/rdevitto86/komodo-forge-sdk-go/security/oauth"
)

const (
	accessTokenTTL  = int64(3600)
	refreshTokenTTL = int64(2592000)
)

func serviceScopes(clientID string, requested []string) []string {
	out := append([]string{}, requested...)
	return append(out, "svc:"+clientID)
}

func verifyCodeChallenge(challenge, verifier string) bool {
	h := sha256.Sum256([]byte(verifier))
	computed := base64.RawURLEncoding.EncodeToString(h[:])
	return subtle.ConstantTimeCompare([]byte(computed), []byte(challenge)) == 1
}

func decodeTokenRequest(req *http.Request) (models.TokenRequest, error) {
	var tr models.TokenRequest

	if strings.HasPrefix(req.Header.Get("Content-Type"), "application/x-www-form-urlencoded") {
		if err := req.ParseForm(); err != nil {
			return tr, err
		}

		optionalForm := func(key string, dst **string) {
			if v := req.PostForm.Get(key); v != "" {
				*dst = &v
			}
		}

		tr.GrantType = models.TokenRequestGrantType(req.PostForm.Get("grant_type"))
		tr.ClientId = req.PostForm.Get("client_id")
		tr.ClientSecret = req.PostForm.Get("client_secret")

		optionalForm("scope", &tr.Scope)
		optionalForm("refresh_token", &tr.RefreshToken)
		optionalForm("code", &tr.Code)
		optionalForm("redirect_uri", &tr.RedirectUri)
		optionalForm("code_verifier", &tr.CodeVerifier)
	} else if err := json.NewDecoder(req.Body).Decode(&tr); err != nil {
		return tr, err
	}

	if id, secret, ok := req.BasicAuth(); ok {
		tr.ClientId, tr.ClientSecret = id, secret
	}
	return tr, nil
}

func (s *Service) OAuthTokenHandler(wtr http.ResponseWriter, req *http.Request) {
	wtr.Header().Set("Content-Type", "application/json")
	wtr.Header().Set("Cache-Control", "no-store")

	reqBody, err := decodeTokenRequest(req)
	if err != nil {
		logger.Error("failed to parse request body", err)
		httpErr.SendError(wtr, req, httpErr.Global.BadRequest, httpErr.WithDetail("failed to parse request body"))
		return
	}

	if reqBody.GrantType == "" {
		logger.Warn("missing grant type")
		httpErr.SendError(wtr, req, httpErr.Auth.UnsupportedGrantType, httpErr.WithDetail("missing grant type"))
		return
	}
	if !secOAuth.IsValidGrantType(string(reqBody.GrantType)) {
		logger.Warn("unsupported grant type", logger.Attr("grant_type", string(reqBody.GrantType)))
		httpErr.SendError(wtr, req, httpErr.Auth.UnsupportedGrantType, httpErr.WithDetail("unsupported grant type"))
		return
	}

	switch reqBody.GrantType {
	case models.TokenRequestGrantTypeClientCredentials:
		s.handleClientCredentials(wtr, req, &reqBody)
	case models.TokenRequestGrantTypeRefreshToken:
		s.handleRefreshToken(wtr, req, &reqBody)
	case models.TokenRequestGrantTypeAuthorizationCode:
		s.handleAuthorizationCode(wtr, req, &reqBody)
	default:
		logger.Warn("unsupported grant type", logger.Attr("grant_type", string(reqBody.GrantType)))
		httpErr.SendError(wtr, req, httpErr.Auth.UnsupportedGrantType, httpErr.WithDetail("unsupported grant type"))
	}
}

func (s *Service) handleClientCredentials(wtr http.ResponseWriter, req *http.Request, reqBody *models.TokenRequest) {
	if reqBody.ClientId == "" || reqBody.ClientSecret == "" {
		logger.Warn("missing client credentials")
		httpErr.SendError(
			wtr, req, httpErr.Auth.InvalidClientCredentials, httpErr.WithDetail("missing client credentials"),
		)
		return
	}

	rec, ok := s.ClientRegistry.ValidateAndGet(reqBody.ClientId, reqBody.ClientSecret)
	if !ok {
		logger.Warn("invalid client credentials", logger.Attr("client_id", reqBody.ClientId))
		httpErr.SendError(wtr, req, httpErr.Auth.InvalidClientCredentials, httpErr.WithDetail("invalid client credentials"))
		return
	}

	requestedOfflineAccess := false
	scopeStr := ""
	if reqBody.Scope != nil {
		scopeStr = *reqBody.Scope
	}

	scopeFields := strings.Fields(scopeStr)
	normalScope := scopeStr

	if slices.Contains(scopeFields, "offline_access") {
		requestedOfflineAccess = true
		filtered := make([]string, 0, len(scopeFields))
		for _, s := range scopeFields {
			if s != "offline_access" {
				filtered = append(filtered, s)
			}
		}
		normalScope = strings.Join(filtered, " ")
		scopeFields = filtered
	}

	if normalScope != "" {
		if !s.ScopeValidator.IsValidScope(normalScope) {
			logger.Warn("invalid scope", logger.Attr("scope", normalScope))
			httpErr.SendError(wtr, req, httpErr.Auth.InvalidScope, httpErr.WithDetail("invalid scope: "+normalScope))
			return
		}
		if !rec.HasScope(normalScope) {
			logger.Warn("scope not permitted for client", logger.Attr("client_id", reqBody.ClientId), logger.Attr("scope", normalScope))
			httpErr.SendError(wtr, req, httpErr.Auth.InsufficientScope, httpErr.WithDetail("client not permitted to request scope: "+normalScope))
			return
		}
	}

	var audience string
	if len(rec.AllowedAudiences) == 1 {
		audience = rec.AllowedAudiences[0]
	} else {
		audience = audienceService
	}

	var scopes []string
	if len(scopeFields) > 0 {
		scopes = serviceScopes(reqBody.ClientId, scopeFields)
	}

	accessToken, err := s.JWT.SignToken(
		"komodo-auth-api",
		reqBody.ClientId,
		audience,
		accessTokenTTL,
		scopes,
	)
	if err != nil {
		logger.Error("failed to sign access token", err)
		httpErr.SendError(wtr, req, httpErr.Global.Internal, httpErr.WithDetail("failed to sign access token"))
		return
	}

	var refreshToken string
	if requestedOfflineAccess {
		refreshScopes := make([]string, 0, len(scopeFields)+1)
		refreshScopes = append(refreshScopes, "offline_access")
		refreshScopes = append(refreshScopes, scopeFields...)

		refreshToken, err = s.JWT.SignRefreshToken(
			"komodo-auth-api",
			reqBody.ClientId,
			"komodo-apis:service",
			reqBody.ClientId,
			uuid.NewString(),
			refreshTokenTTL,
			refreshScopes,
		)
		if err != nil {
			logger.Error("failed to sign refresh token", err)
			httpErr.SendError(wtr, req, httpErr.Global.Internal, httpErr.WithDetail("failed to sign refresh token"))
			return
		}
	}

	resp := models.TokenResponse{
		AccessToken: accessToken,
		TokenType:   "Bearer",
		ExpiresIn:   int(accessTokenTTL),
	}
	if normalScope != "" {
		resp.Scope = &normalScope
	}
	if refreshToken != "" {
		resp.RefreshToken = &refreshToken
	}

	wtr.WriteHeader(http.StatusOK)
	writeJSON(wtr, resp)

	logger.Info("issued client_credentials token", logger.Attr("client_id", reqBody.ClientId))
}

func (s *Service) handleRefreshToken(wtr http.ResponseWriter, req *http.Request, reqBody *models.TokenRequest) {
	if reqBody.RefreshToken == nil || *reqBody.RefreshToken == "" {
		httpErr.SendError(wtr, req, httpErr.Global.BadRequest, httpErr.WithDetail("missing refresh token"))
		return
	}

	if reqBody.ClientId == "" || reqBody.ClientSecret == "" {
		logger.Warn("missing client credentials in refresh request")
		httpErr.SendError(wtr, req, httpErr.Auth.InvalidClientCredentials, httpErr.WithDetail("missing client credentials"))
		return
	}
	rec, credOK := s.ClientRegistry.ValidateAndGet(reqBody.ClientId, reqBody.ClientSecret)
	if !credOK {
		logger.Warn("invalid client credentials in refresh request", logger.Attr("client_id", reqBody.ClientId))
		httpErr.SendError(wtr, req, httpErr.Auth.InvalidClientCredentials, httpErr.WithDetail("invalid client credentials"))
		return
	}

	claims, err := s.JWT.ParseClaims(*reqBody.RefreshToken)
	if err != nil {
		logger.Error("failed to parse refresh token", err)
		httpErr.SendError(wtr, req, httpErr.Auth.InvalidToken, httpErr.WithDetail("failed to parse refresh token"))
		return
	}

	if !slices.Contains(claims.Scopes, "offline_access") {
		logger.Warn("refused refresh token grant: token missing offline_access scope")
		httpErr.SendError(wtr, req, httpErr.Auth.InvalidToken, httpErr.WithDetail("token is not a refresh token"))
		return
	}

	if claims.Azp != reqBody.ClientId {
		logger.Warn("refresh token azp does not match presenting client",
			logger.Attr("client_id", reqBody.ClientId),
			logger.Attr("azp", claims.Azp))
		httpErr.SendError(wtr, req, httpErr.Auth.InvalidToken, httpErr.WithDetail("refresh token was not issued to this client"))
		return
	}

	if s.refreshRevocationDenied(wtr, req, claims) {
		return
	}

	if s.isRefreshTokenUserBanned(req, claims.Scopes, claims.Subject) {
		httpErr.SendError(wtr, req, httpErr.Global.Forbidden, httpErr.WithDetail("account is not eligible for token refresh"))
		return
	}

	defaultAudiences := []string{"komodo-apis:service"}
	allowedAudiences := rec.AllowedAudiences
	if len(allowedAudiences) == 0 {
		allowedAudiences = defaultAudiences
	}

	audience := "komodo-apis:service"
	if len(claims.Audience) > 0 {
		audience = claims.Audience[0]
	}

	isUserSession := claims.Azp != "" && claims.Azp != claims.Subject

	if !isUserSession {
		if !slices.Contains(allowedAudiences, audience) {
			logger.Warn("refresh token audience not permitted", logger.Attr("audience", audience), logger.Attr("client_id", reqBody.ClientId))
			httpErr.SendError(wtr, req, httpErr.Global.BadRequest, httpErr.WithDetail("audience not permitted for this client"))
			return
		}
	}

	var accessScopes []string
	for _, sc := range claims.Scopes {
		if sc != "offline_access" {
			accessScopes = append(accessScopes, sc)
		}
	}

	if isUserSession {
		accessScopes = []string{passkeyLoginScope}
	}

	scope := strings.Join(accessScopes, " ")

	var tokenScopes []string
	if isUserSession {
		tokenScopes = accessScopes
	} else {
		tokenScopes = serviceScopes(reqBody.ClientId, accessScopes)
	}

	accessToken, err := s.JWT.SignToken(
		"komodo-auth-api",
		claims.Subject,
		audience,
		accessTokenTTL,
		tokenScopes,
	)
	if err != nil {
		logger.Error("failed to sign access token", err)
		httpErr.SendError(wtr, req, httpErr.Global.Internal, httpErr.WithDetail("failed to sign access token"))
		return
	}

	rotatedFamilyID := claims.FamilyId
	if rotatedFamilyID == "" {
		rotatedFamilyID = uuid.NewString()
	}

	newRefreshToken, err := s.JWT.SignRefreshToken(
		"komodo-auth-api",
		claims.Subject,
		audience,
		reqBody.ClientId,
		rotatedFamilyID,
		refreshTokenTTL,
		claims.Scopes,
	)
	if err != nil {
		logger.Error("failed to sign refresh token", err)
		httpErr.SendError(wtr, req, httpErr.Global.Internal, httpErr.WithDetail("failed to sign refresh token"))
		return
	}

	if claims.ID != "" && claims.ExpiresAt != nil {
		if remaining := time.Until(claims.ExpiresAt.Time); remaining > 0 {
			if revokeErr := s.CacheClient.StoreRevoked(req.Context(), claims.ID, remaining); revokeErr != nil {
				logger.Error("failed to revoke rotated refresh token", revokeErr)
			}
		}
	}

	refreshResp := models.TokenResponse{
		AccessToken:  accessToken,
		TokenType:    "Bearer",
		ExpiresIn:    int(accessTokenTTL),
		RefreshToken: &newRefreshToken,
	}
	if scope != "" {
		refreshResp.Scope = &scope
	}

	wtr.WriteHeader(http.StatusOK)
	writeJSON(wtr, refreshResp)

	logger.Info("refreshed token", logger.Attr("client_id", reqBody.ClientId))
}

func (s *Service) refreshRevocationDenied(wtr http.ResponseWriter, req *http.Request, claims *jwt.CustomClaims) bool {
	if claims.ID != "" {
		revoked, err := s.CacheClient.IsRevoked(req.Context(), claims.ID)
		if err != nil {
			logger.Error("revocation check failed, denying refresh", err)
			httpErr.SendError(wtr, req, httpErr.Global.Internal, httpErr.WithDetail("revocation check unavailable"))
			return true
		}
		if revoked {
			if claims.FamilyId != "" && claims.ExpiresAt != nil {
				if familyTTL := time.Until(claims.ExpiresAt.Time); familyTTL > 0 {
					if revokeErr := s.CacheClient.StoreRevokedFamily(req.Context(), claims.FamilyId, familyTTL); revokeErr != nil {
						logger.Error("failed to revoke token family on reuse detection", revokeErr, logger.Attr("family_id", claims.FamilyId))
					}
				}
			}
			logger.Warn("refresh token reuse detected",
				logger.Attr("jti", claims.ID),
				logger.Attr("family_id", claims.FamilyId),
			)
			httpErr.SendError(wtr, req, httpErr.Auth.InvalidToken, httpErr.WithDetail("refresh token has been revoked"))
			return true
		}
	}

	if claims.FamilyId != "" {
		familyRevoked, err := s.CacheClient.IsFamilyRevoked(req.Context(), claims.FamilyId)
		if err != nil {
			logger.Error("family revocation check failed, denying refresh", err)
			httpErr.SendError(wtr, req, httpErr.Global.Internal, httpErr.WithDetail("revocation check unavailable"))
			return true
		}
		if familyRevoked {
			logger.Warn("refresh token family is revoked", logger.Attr("family_id", claims.FamilyId))
			httpErr.SendError(wtr, req, httpErr.Auth.InvalidToken, httpErr.WithDetail("refresh token has been revoked"))
			return true
		}
	}
	return false
}

func (s *Service) isRefreshTokenUserBanned(req *http.Request, scopes []string, subject string) bool {
	isServiceToken := slices.ContainsFunc(scopes, func(sc string) bool {
		return strings.HasPrefix(sc, "svc:")
	})
	if isServiceToken || s.BannedChecker == nil || s.HttpClient == nil {
		return false
	}

	svcToken, tokenErr := s.getOrRefreshSvcJWT()
	if tokenErr != nil {
		logger.Error("failed to obtain service token for ban check", tokenErr)
		return false
	}

	user, userErr := s.HttpClient.GetUserByID(req.Context(), subject, svcToken)
	if userErr != nil {
		logger.Error("failed to look up user for ban check", userErr)
		return false
	}
	if user == nil {
		return false
	}

	banned, bannedErr := s.BannedChecker.IsBanned(req.Context(), string(user.Email))
	if bannedErr != nil {
		logger.Error("failed to check banned status on refresh", bannedErr)
		return false
	}
	return banned
}

func (s *Service) handleAuthorizationCode(wtr http.ResponseWriter, req *http.Request, reqBody *models.TokenRequest) {
	if !s.authCodeGrantEnabled {
		logger.Warn("authorization_code grant requested while disabled")
		httpErr.SendError(wtr, req, httpErr.Global.NotImplemented, httpErr.WithDetail("authorization_code grant is disabled"))
		return
	}

	if reqBody.Code == nil || *reqBody.Code == "" {
		httpErr.SendError(wtr, req, httpErr.Global.BadRequest, httpErr.WithDetail("missing authorization code"))
		return
	}

	if reqBody.CodeVerifier == nil || *reqBody.CodeVerifier == "" {
		httpErr.SendError(wtr, req, httpErr.Global.BadRequest, httpErr.WithDetail("missing code_verifier"))
		return
	}

	if reqBody.RedirectUri == nil || *reqBody.RedirectUri == "" {
		httpErr.SendError(wtr, req, httpErr.Global.BadRequest, httpErr.WithDetail("missing redirect_uri"))
		return
	}

	if reqBody.ClientId == "" {
		httpErr.SendError(wtr, req, httpErr.Auth.InvalidClientCredentials, httpErr.WithDetail("missing client_id"))
		return
	}

	if _, ok := s.ClientRegistry.Get(reqBody.ClientId); !ok {
		logger.Warn("unknown client_id in authorization_code exchange", logger.Attr("client_id", reqBody.ClientId))
		httpErr.SendError(wtr, req, httpErr.Auth.InvalidClientCredentials, httpErr.WithDetail("unknown client_id"))
		return
	}

	entry, err := s.CacheClient.GetAuthCode(req.Context(), *reqBody.Code)
	if err != nil {
		logger.Warn("authorization code not found or expired", logger.AttrError(err))
		httpErr.SendError(wtr, req, httpErr.Auth.InvalidToken, httpErr.WithDetail("authorization code not found or expired"))
		return
	}

	if entry.ClientID != reqBody.ClientId {
		logger.Warn("authorization code client_id mismatch",
			logger.Attr("expected", entry.ClientID),
			logger.Attr("presented", reqBody.ClientId))
		httpErr.SendError(wtr, req, httpErr.Auth.InvalidToken, httpErr.WithDetail("authorization code was not issued to this client"))
		return
	}

	if entry.RedirectURI != *reqBody.RedirectUri {
		logger.Warn("authorization code redirect_uri mismatch",
			logger.Attr("expected", entry.RedirectURI),
			logger.Attr("presented", *reqBody.RedirectUri))
		httpErr.SendError(wtr, req, httpErr.Auth.InvalidToken, httpErr.WithDetail("redirect_uri does not match"))
		return
	}

	if !verifyCodeChallenge(entry.CodeChallenge, *reqBody.CodeVerifier) {
		logger.Warn("PKCE code_verifier verification failed", logger.Attr("client_id", reqBody.ClientId))
		httpErr.SendError(wtr, req, httpErr.Auth.InvalidToken, httpErr.WithDetail("code_verifier verification failed"))
		return
	}

	if delErr := s.CacheClient.DeleteAuthCode(req.Context(), *reqBody.Code); delErr != nil {
		logger.Error("failed to delete used authorization code", delErr)
	}

	if s.BannedChecker != nil {
		svcToken, tokenErr := s.getOrRefreshSvcJWT()
		if tokenErr != nil {
			logger.Error("failed to obtain service token for ban check", tokenErr)
		} else {
			user, userErr := s.HttpClient.GetUserByID(req.Context(), entry.UserID, svcToken)
			if userErr != nil {
				logger.Error("failed to look up user for ban check", userErr)
			} else if user != nil {
				banned, bannedErr := s.BannedChecker.IsBanned(req.Context(), string(user.Email))
				if bannedErr != nil {
					logger.Error("failed to check banned status", bannedErr)
				} else if banned {
					httpErr.SendError(wtr, req, httpErr.Global.Forbidden, httpErr.WithDetail("account is not eligible for token issuance"))
					return
				}
			}
		}
	}

	var scopes []string
	if entry.Scope != "" {
		scopes = strings.Fields(entry.Scope)
	}

	accessToken, err := s.JWT.SignToken(
		"komodo-auth-api",
		entry.UserID,
		audienceUser,
		accessTokenTTL,
		scopes,
	)
	if err != nil {
		logger.Error("failed to sign access token", err)
		httpErr.SendError(wtr, req, httpErr.Global.Internal, httpErr.WithDetail("failed to sign access token"))
		return
	}

	refreshToken, err := s.JWT.SignRefreshToken(
		"komodo-auth-api",
		entry.UserID,
		audienceUser,
		reqBody.ClientId,
		uuid.NewString(),
		refreshTokenTTL,
		append([]string{"offline_access"}, scopes...),
	)
	if err != nil {
		logger.Error("failed to sign refresh token", err)
		httpErr.SendError(wtr, req, httpErr.Global.Internal, httpErr.WithDetail("failed to sign refresh token"))
		return
	}

	resp := models.TokenResponse{
		AccessToken:  accessToken,
		TokenType:    "Bearer",
		ExpiresIn:    int(accessTokenTTL),
		RefreshToken: &refreshToken,
	}
	if entry.Scope != "" {
		resp.Scope = &entry.Scope
	}

	wtr.WriteHeader(http.StatusOK)
	writeJSON(wtr, resp)

	logger.Info("issued authorization_code token",
		logger.Attr("client_id", reqBody.ClientId),
		logger.Attr("user_id", entry.UserID),
	)
}

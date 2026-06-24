package api

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"komodo-auth-api/internal/clients"
	"komodo-auth-api/internal/db"
	"komodo-auth-api/internal/models"
	authwebauthn "komodo-auth-api/internal/webauthn"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/google/uuid"
	httpErr "github.com/rdevitto86/komodo-forge-sdk-go/api/errors"
	"github.com/rdevitto86/komodo-forge-sdk-go/auth"
	logger "github.com/rdevitto86/komodo-forge-sdk-go/logging/runtime"
)

const (
	passkeyLoginScope     = "passkey:verified"
	maxAssertionBodyBytes = 1 << 20
)

func descriptorsToCredentials(descs []clients.PasskeyCredentialDescriptor) ([]webauthn.Credential, error) {
	creds := make([]webauthn.Credential, 0, len(descs))
	for _, d := range descs {
		id, err := base64.RawURLEncoding.DecodeString(d.CredentialId)
		if err != nil {
			return nil, err
		}

		pubKey, err := base64.StdEncoding.DecodeString(d.PublicKey)
		if err != nil {
			return nil, err
		}

		var aaguid []byte
		if d.Aaguid != "" {
			aaguid, err = base64.StdEncoding.DecodeString(d.Aaguid)
			if err != nil {
				return nil, err
			}
		}

		transports := make([]protocol.AuthenticatorTransport, 0, len(d.Transports))
		for _, t := range d.Transports {
			transports = append(transports, protocol.AuthenticatorTransport(t))
		}

		creds = append(creds, webauthn.Credential{
			ID:        id,
			PublicKey: pubKey,
			Transport: transports,
			Flags: webauthn.CredentialFlags{
				BackupEligible: d.BackupEligible,
				BackupState:    d.BackupState,
			},
			Authenticator: webauthn.Authenticator{
				AAGUID:    aaguid,
				SignCount: d.SignCount,
			},
		})
	}
	return creds, nil
}

func (s *Service) PasskeyLoginBeginHandler(wtr http.ResponseWriter, req *http.Request) {
	wtr.Header().Set("Content-Type", "application/json")
	wtr.Header().Set("Cache-Control", "no-store")

	if s.WebAuthn == nil {
		logger.Error("webauthn not configured", errors.New("nil WebAuthn instance"), logger.Attr("handler", "PasskeyLoginBegin"))
		httpErr.SendError(wtr, req, httpErr.Global.Internal, httpErr.WithDetail("passkey login unavailable"))
		return
	}

	var body models.PasskeyLoginBeginRequest
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
		logger.Error("failed to decode body", err, logger.Attr("handler", "PasskeyLoginBegin"))
		httpErr.SendError(wtr, req, httpErr.Global.BadRequest, httpErr.WithDetail("invalid request body"))
		return
	}

	email := strings.TrimSpace(strings.ToLower(string(body.Email)))
	if _, err := mail.ParseAddress(email); err != nil {
		httpErr.SendError(wtr, req, httpErr.Global.BadRequest, httpErr.WithDetail("email is required"))
		return
	}

	if body.ClientId == "" {
		httpErr.SendError(wtr, req, httpErr.Global.BadRequest, httpErr.WithDetail("client_id is required"))
		return
	}
	if _, ok := s.ClientRegistry.Get(body.ClientId); !ok {
		logger.Warn("unknown client in passkey login begin", logger.Attr("client_id", body.ClientId))
		httpErr.SendError(wtr, req, httpErr.Auth.InvalidClientCredentials, httpErr.WithDetail("unknown client_id"))
		return
	}

	svcToken, err := s.getOrRefreshSvcJWT()
	if err != nil {
		logger.Error("failed to obtain service token", err, logger.Attr("handler", "PasskeyLoginBegin"))
		httpErr.SendError(wtr, req, httpErr.Global.ServiceUnavailable, httpErr.WithDetail("passkey login unavailable"))
		return
	}

	creds, err := s.HttpClient.GetUserCredentials(req.Context(), email, svcToken)
	if err != nil {
		logger.Error("failed to look up user credentials", err, logger.Attr("handler", "PasskeyLoginBegin"))
		httpErr.SendError(wtr, req, httpErr.Global.ServiceUnavailable, httpErr.WithDetail("passkey login unavailable"))
		return
	}
	if creds == nil || creds.UserId == "" {
		httpErr.SendError(wtr, req, httpErr.Global.NotFound, httpErr.WithDetail("account not found"))
		return
	}

	userID := creds.UserId

	existing, err := s.HttpClient.ListPasskeyCredentials(req.Context(), userID, svcToken)
	if err != nil {
		logger.Error("failed to list existing passkey credentials", err, logger.Attr("handler", "PasskeyLoginBegin"))
		httpErr.SendError(wtr, req, httpErr.Global.ServiceUnavailable, httpErr.WithDetail("passkey login unavailable"))
		return
	}
	if len(existing) == 0 {
		httpErr.SendError(wtr, req, httpErr.Global.NotFound, httpErr.WithDetail("no passkeys registered for this account"))
		return
	}

	webauthnCreds, err := descriptorsToCredentials(existing)
	if err != nil {
		logger.Error("failed to decode existing passkey credentials", err, logger.Attr("handler", "PasskeyLoginBegin"))
		httpErr.SendError(wtr, req, httpErr.Global.Internal, httpErr.WithDetail("passkey login unavailable"))
		return
	}

	user := &authwebauthn.RegistrationUser{
		ID:          []byte(userID),
		Name:        userID,
		DisplayName: userID,
		Credentials: webauthnCreds,
	}

	assertion, session, err := s.WebAuthn.BeginLogin(user, webauthn.WithUserVerification(protocol.VerificationRequired))
	if err != nil {
		logger.Error("failed to begin passkey login", err, logger.Attr("handler", "PasskeyLoginBegin"))
		httpErr.SendError(wtr, req, httpErr.Global.Internal, httpErr.WithDetail("failed to begin passkey login"))
		return
	}

	loginSession := &db.WebAuthnLoginSession{
		SessionData: session,
		UserID:      userID,
		Email:       email,
		ClientID:    body.ClientId,
	}
	if err := s.CacheClient.StoreWebAuthnLoginSession(req.Context(), session.Challenge, loginSession); err != nil {
		logger.Error("failed to store webauthn login session", err, logger.Attr("handler", "PasskeyLoginBegin"))
		httpErr.SendError(wtr, req, httpErr.Global.Internal, httpErr.WithDetail("failed to begin passkey login"))
		return
	}

	wtr.WriteHeader(http.StatusOK)
	writeJSON(wtr, assertion)
}

func (s *Service) PasskeyLoginCompleteHandler(wtr http.ResponseWriter, req *http.Request) {
	wtr.Header().Set("Content-Type", "application/json")
	wtr.Header().Set("Cache-Control", "no-store")

	if s.WebAuthn == nil {
		logger.Error("webauthn not configured", errors.New("nil WebAuthn instance"), logger.Attr("handler", "PasskeyLoginComplete"))
		httpErr.SendError(wtr, req, httpErr.Global.Internal, httpErr.WithDetail("passkey login unavailable"))
		return
	}

	rawBody, err := io.ReadAll(io.LimitReader(req.Body, maxAssertionBodyBytes))
	if err != nil {
		logger.Error("failed to read request body", err, logger.Attr("handler", "PasskeyLoginComplete"))
		httpErr.SendError(wtr, req, httpErr.Global.BadRequest, httpErr.WithDetail("invalid request body"))
		return
	}

	parsed, err := protocol.ParseCredentialRequestResponseBody(bytes.NewReader(rawBody))
	if err != nil {
		logger.Warn("failed to parse passkey assertion response", logger.Attr("handler", "PasskeyLoginComplete"), logger.AttrError(err))
		httpErr.SendError(wtr, req, httpErr.Global.BadRequest, httpErr.WithDetail("invalid assertion response"))
		return
	}

	challenge := parsed.Response.CollectedClientData.Challenge

	session, err := s.CacheClient.GetWebAuthnLoginSession(req.Context(), challenge)
	if err != nil {
		if errors.Is(err, db.ErrWebAuthnSessionNotFound) {
			httpErr.SendError(wtr, req, httpErr.Global.BadRequest, httpErr.WithDetail("login session not found or expired"))
			return
		}
		logger.Error("failed to load webauthn login session", err, logger.Attr("handler", "PasskeyLoginComplete"))
		httpErr.SendError(wtr, req, httpErr.Global.Internal, httpErr.WithDetail("failed to complete passkey login"))
		return
	}

	svcToken, err := s.getOrRefreshSvcJWT()
	if err != nil {
		logger.Error("failed to obtain service token", err, logger.Attr("handler", "PasskeyLoginComplete"))
		httpErr.SendError(wtr, req, httpErr.Global.ServiceUnavailable, httpErr.WithDetail("passkey login unavailable"))
		return
	}

	existing, err := s.HttpClient.ListPasskeyCredentials(req.Context(), session.UserID, svcToken)
	if err != nil {
		logger.Error("failed to list existing passkey credentials", err, logger.Attr("handler", "PasskeyLoginComplete"))
		httpErr.SendError(wtr, req, httpErr.Global.ServiceUnavailable, httpErr.WithDetail("passkey login unavailable"))
		return
	}

	webauthnCreds, err := descriptorsToCredentials(existing)
	if err != nil {
		logger.Error("failed to decode existing passkey credentials", err, logger.Attr("handler", "PasskeyLoginComplete"))
		httpErr.SendError(wtr, req, httpErr.Global.Internal, httpErr.WithDetail("passkey login unavailable"))
		return
	}

	user := &authwebauthn.RegistrationUser{
		ID:          []byte(session.UserID),
		Name:        session.UserID,
		DisplayName: session.UserID,
		Credentials: webauthnCreds,
	}

	req.Body = io.NopCloser(bytes.NewReader(rawBody))

	credential, err := s.WebAuthn.FinishLogin(user, *session.SessionData, req)
	if err != nil {
		logger.Warn("passkey login ceremony failed", logger.Attr("handler", "PasskeyLoginComplete"), logger.AttrError(err))
		httpErr.SendError(wtr, req, httpErr.Auth.InvalidToken, httpErr.WithDetail("passkey login failed"))
		return
	}

	claimed, claimErr := s.CacheClient.ClaimSession(req.Context(), "login:"+challenge)
	if claimErr != nil {
		logger.Error("failed to claim login session", claimErr, logger.Attr("handler", "PasskeyLoginComplete"))
		httpErr.SendError(wtr, req, httpErr.Global.Internal, httpErr.WithDetail("failed to complete passkey login"))
		return
	}
	if !claimed {
		logger.Warn("login session replay detected", logger.Attr("handler", "PasskeyLoginComplete"), logger.Attr("auth.subject", session.UserID))
		httpErr.SendError(wtr, req, httpErr.Global.Conflict, httpErr.WithDetail("login session already completed"))
		return
	}

	credentialID := base64.RawURLEncoding.EncodeToString(credential.ID)
	reportedSignCount := parsed.Response.AuthenticatorData.Counter

	var prior *clients.PasskeyCredentialDescriptor
	for i := range existing {
		if existing[i].CredentialId == credentialID {
			prior = &existing[i]
			break
		}
	}

	if credential.Authenticator.CloneWarning {
		logger.Warn("passkey sign count did not increase, possible cloned authenticator",
			logger.Attr("handler", "PasskeyLoginComplete"),
			logger.Attr("auth.subject", session.UserID),
			logger.Attr("credential_id", credentialID),
		)
	}

	now := time.Now().UTC()
	transports := make([]string, 0, len(credential.Transport))
	for _, t := range credential.Transport {
		transports = append(transports, string(t))
	}

	updated := clients.PasskeyCredentialDescriptor{
		CredentialId:   credentialID,
		PublicKey:      base64.StdEncoding.EncodeToString(credential.PublicKey),
		SignCount:      reportedSignCount,
		Transports:     transports,
		Aaguid:         base64.StdEncoding.EncodeToString(credential.Authenticator.AAGUID),
		BackupEligible: credential.Flags.BackupEligible,
		BackupState:    credential.Flags.BackupState,
		LastUsedAt:     &now,
	}
	if prior != nil {
		updated.CreatedAt = prior.CreatedAt
	}

	if err := s.HttpClient.UpdatePasskeyCredential(req.Context(), session.UserID, svcToken, updated); err != nil {
		logger.Error("failed to persist passkey credential update", err, logger.Attr("handler", "PasskeyLoginComplete"))
		httpErr.SendError(wtr, req, httpErr.Global.ServiceUnavailable, httpErr.WithDetail("failed to persist passkey credential"))
		return
	}

	if err := s.CacheClient.DeleteWebAuthnLoginSession(req.Context(), challenge); err != nil {
		logger.Error("failed to delete webauthn login session", err, logger.Attr("handler", "PasskeyLoginComplete"))
	}

	if s.BannedChecker != nil {
		banned, err := s.BannedChecker.IsBanned(req.Context(), session.Email)
		if err != nil {
			logger.Error("failed to check banned status", err, logger.Attr("handler", "PasskeyLoginComplete"))
		} else if banned {
			httpErr.SendError(wtr, req, httpErr.Global.Forbidden, httpErr.WithDetail("account is not eligible for passkey login"))
			return
		}
	}

	subject := session.UserID

	accessToken, err := s.JWT.SignToken(
		"komodo-auth-api",
		subject,
		audienceUser,
		otpTokenTTL,
		[]string{passkeyLoginScope},
	)
	if err != nil {
		logger.Error("failed to sign access token", err, logger.Attr("handler", "PasskeyLoginComplete"))
		httpErr.SendError(wtr, req, httpErr.Global.Internal, httpErr.WithDetail("failed to issue token"))
		return
	}

	refreshToken, err := s.JWT.SignRefreshToken(
		"komodo-auth-api",
		subject,
		audienceUser,
		session.ClientID,
		uuid.NewString(),
		refreshTokenTTL,
		[]string{"offline_access"},
	)
	if err != nil {
		logger.Error("failed to sign refresh token", err, logger.Attr("handler", "PasskeyLoginComplete"))
		httpErr.SendError(wtr, req, httpErr.Global.Internal, httpErr.WithDetail("failed to issue token"))
		return
	}

	logger.Info("issued token", logger.Attr("handler", "PasskeyLoginComplete"), logger.Attr("auth.subject", subject))

	scope := passkeyLoginScope

	wtr.WriteHeader(http.StatusOK)
	writeJSON(wtr, models.TokenResponse{
		AccessToken:  accessToken,
		RefreshToken: &refreshToken,
		TokenType:    "Bearer",
		ExpiresIn:    int(otpTokenTTL),
		Scope:        &scope,
	})
}

type tokenVerifier struct {
	jwt TokenAuthority
}

func (v *tokenVerifier) Verify(_ context.Context, token string) (*auth.Claims, error) {
	claims, err := v.jwt.ValidateAndParseClaims(token)
	if err != nil {
		return nil, auth.ErrInvalidToken
	}

	return &auth.Claims{
		Subject:   claims.Subject,
		Audience:  []string(claims.Audience),
		Scopes:    claims.Scopes,
		JTI:       claims.ID,
		IssuedAt:  claims.IssuedAt.Time,
		ExpiresAt: claims.ExpiresAt.Time,
		Issuer:    claims.Issuer,
	}, nil
}

func PasskeyAuthMiddleware(jwt TokenAuthority) func(http.Handler) http.Handler {
	return auth.Middleware(&tokenVerifier{jwt: jwt})
}

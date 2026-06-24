package api

import (
	"encoding/base64"
	"errors"
	"net/http"
	"time"

	"komodo-auth-api/internal/clients"
	"komodo-auth-api/internal/db"
	"komodo-auth-api/internal/models"
	authwebauthn "komodo-auth-api/internal/webauthn"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/protocol/webauthncose"
	"github.com/go-webauthn/webauthn/webauthn"
	httpErr "github.com/rdevitto86/komodo-forge-sdk-go/api/errors"
	ctxKeys "github.com/rdevitto86/komodo-forge-sdk-go/http/context"
	logger "github.com/rdevitto86/komodo-forge-sdk-go/logging/runtime"
)

const maxPasskeysPerUser = 10

var registrationCredentialParameters = []protocol.CredentialParameter{
	{Type: protocol.PublicKeyCredentialType, Algorithm: webauthncose.AlgES256},
	{Type: protocol.PublicKeyCredentialType, Algorithm: webauthncose.AlgRS256},
}

func passkeyUserID(req *http.Request) (string, string, bool) {
	sub := ctxKeys.GetUserID(req.Context())
	return sub, sub, sub != ""
}

func descriptorToCredentialDescriptor(cred clients.PasskeyCredentialDescriptor) (protocol.CredentialDescriptor, error) {
	id, err := base64.RawURLEncoding.DecodeString(cred.CredentialId)
	if err != nil {
		return protocol.CredentialDescriptor{}, err
	}

	transports := make([]protocol.AuthenticatorTransport, 0, len(cred.Transports))
	for _, t := range cred.Transports {
		transports = append(transports, protocol.AuthenticatorTransport(t))
	}

	return protocol.CredentialDescriptor{
		Type:         protocol.PublicKeyCredentialType,
		CredentialID: id,
		Transport:    transports,
	}, nil
}

func (s *Service) PasskeyRegisterBeginHandler(wtr http.ResponseWriter, req *http.Request) {
	wtr.Header().Set("Content-Type", "application/json")
	wtr.Header().Set("Cache-Control", "no-store")

	if s.WebAuthn == nil {
		logger.Error("webauthn not configured", errors.New("nil WebAuthn instance"), logger.Attr("handler", "PasskeyRegisterBegin"))
		httpErr.SendError(wtr, req, httpErr.Global.Internal, httpErr.WithDetail("passkey registration unavailable"))
		return
	}

	sub, userID, ok := passkeyUserID(req)
	if !ok {
		logger.Error("failed to resolve user subject", errors.New("empty subject in context"), logger.Attr("handler", "PasskeyRegisterBegin"))
		httpErr.SendError(wtr, req, httpErr.Auth.InvalidToken, httpErr.WithDetail("invalid user subject"))
		return
	}

	svcToken, err := s.getOrRefreshSvcJWT()
	if err != nil {
		logger.Error("failed to obtain service token", err, logger.Attr("handler", "PasskeyRegisterBegin"))
		httpErr.SendError(wtr, req, httpErr.Global.ServiceUnavailable, httpErr.WithDetail("passkey registration unavailable"))
		return
	}

	existing, err := s.HttpClient.ListPasskeyCredentials(req.Context(), userID, svcToken)
	if err != nil {
		logger.Error("failed to list existing passkey credentials", err, logger.Attr("handler", "PasskeyRegisterBegin"))
		httpErr.SendError(wtr, req, httpErr.Global.ServiceUnavailable, httpErr.WithDetail("passkey registration unavailable"))
		return
	}

	if len(existing) >= maxPasskeysPerUser {
		httpErr.SendError(wtr, req, httpErr.Global.Conflict, httpErr.WithDetail("maximum number of passkeys reached"))
		return
	}

	excludeList := make([]protocol.CredentialDescriptor, 0, len(existing))
	for _, cred := range existing {
		desc, err := descriptorToCredentialDescriptor(cred)
		if err != nil {
			logger.Error("failed to decode existing credential descriptor", err, logger.Attr("handler", "PasskeyRegisterBegin"))
			continue
		}
		excludeList = append(excludeList, desc)
	}

	creation, session, err := s.WebAuthn.BeginRegistration(
		&authwebauthn.RegistrationUser{
			ID:          []byte(userID),
			Name:        userID,
			DisplayName: userID,
		},
		webauthn.WithExclusions(excludeList),
		webauthn.WithAuthenticatorSelection(protocol.AuthenticatorSelection{
			ResidentKey:      protocol.ResidentKeyRequirementPreferred,
			UserVerification: protocol.VerificationRequired,
		}),
		webauthn.WithConveyancePreference(protocol.PreferNoAttestation),
		webauthn.WithCredentialParameters(registrationCredentialParameters),
	)
	if err != nil {
		logger.Error("failed to begin passkey registration", err, logger.Attr("handler", "PasskeyRegisterBegin"))
		httpErr.SendError(wtr, req, httpErr.Global.Internal, httpErr.WithDetail("failed to begin passkey registration"))
		return
	}

	if err := s.CacheClient.StoreWebAuthnRegistrationSession(req.Context(), sub, session); err != nil {
		logger.Error("failed to store webauthn registration session", err, logger.Attr("handler", "PasskeyRegisterBegin"))
		httpErr.SendError(wtr, req, httpErr.Global.Internal, httpErr.WithDetail("failed to begin passkey registration"))
		return
	}

	wtr.WriteHeader(http.StatusOK)
	writeJSON(wtr, creation)
}

func (s *Service) PasskeyRegisterCompleteHandler(wtr http.ResponseWriter, req *http.Request) {
	wtr.Header().Set("Content-Type", "application/json")
	wtr.Header().Set("Cache-Control", "no-store")

	if s.WebAuthn == nil {
		logger.Error("webauthn not configured", errors.New("nil WebAuthn instance"), logger.Attr("handler", "PasskeyRegisterComplete"))
		httpErr.SendError(wtr, req, httpErr.Global.Internal, httpErr.WithDetail("passkey registration unavailable"))
		return
	}

	sub, userID, ok := passkeyUserID(req)
	if !ok {
		logger.Error("failed to resolve user subject", errors.New("empty subject in context"), logger.Attr("handler", "PasskeyRegisterComplete"))
		httpErr.SendError(wtr, req, httpErr.Auth.InvalidToken, httpErr.WithDetail("invalid user subject"))
		return
	}

	session, err := s.CacheClient.GetWebAuthnRegistrationSession(req.Context(), sub)
	if err != nil {
		if errors.Is(err, db.ErrWebAuthnSessionNotFound) {
			httpErr.SendError(wtr, req, httpErr.Global.BadRequest, httpErr.WithDetail("registration session not found or expired"))
			return
		}
		logger.Error("failed to load webauthn registration session", err, logger.Attr("handler", "PasskeyRegisterComplete"))
		httpErr.SendError(wtr, req, httpErr.Global.Internal, httpErr.WithDetail("failed to complete passkey registration"))
		return
	}

	user := &authwebauthn.RegistrationUser{
		ID:          []byte(userID),
		Name:        userID,
		DisplayName: userID,
	}

	credential, err := s.WebAuthn.FinishRegistration(user, *session, req)
	if err != nil {
		logger.Warn("passkey registration ceremony failed", logger.Attr("handler", "PasskeyRegisterComplete"), logger.AttrError(err))
		httpErr.SendError(wtr, req, httpErr.Global.BadRequest, httpErr.WithDetail("passkey registration failed"))
		return
	}

	claimed, claimErr := s.CacheClient.ClaimSession(req.Context(), "reg:"+sub)
	if claimErr != nil {
		logger.Error("failed to claim registration session", claimErr, logger.Attr("handler", "PasskeyRegisterComplete"))
		httpErr.SendError(wtr, req, httpErr.Global.Internal, httpErr.WithDetail("failed to complete passkey registration"))
		return
	}
	if !claimed {
		logger.Warn("registration session replay detected", logger.Attr("handler", "PasskeyRegisterComplete"), logger.Attr("auth.subject", sub))
		httpErr.SendError(wtr, req, httpErr.Global.Conflict, httpErr.WithDetail("registration session already completed"))
		return
	}

	transports := make([]string, 0, len(credential.Transport))
	for _, t := range credential.Transport {
		transports = append(transports, string(t))
	}

	descriptor := clients.PasskeyCredentialDescriptor{
		CredentialId:   base64.RawURLEncoding.EncodeToString(credential.ID),
		PublicKey:      base64.StdEncoding.EncodeToString(credential.PublicKey),
		SignCount:      credential.Authenticator.SignCount,
		Transports:     transports,
		Aaguid:         base64.StdEncoding.EncodeToString(credential.Authenticator.AAGUID),
		BackupEligible: credential.Flags.BackupEligible,
		BackupState:    credential.Flags.BackupState,
	}

	svcToken, err := s.getOrRefreshSvcJWT()
	if err != nil {
		logger.Error("failed to obtain service token", err, logger.Attr("handler", "PasskeyRegisterComplete"))
		httpErr.SendError(wtr, req, httpErr.Global.ServiceUnavailable, httpErr.WithDetail("passkey registration unavailable"))
		return
	}

	if err := s.HttpClient.CreatePasskeyCredential(req.Context(), userID, svcToken, descriptor); err != nil {
		logger.Error("failed to persist passkey credential", err, logger.Attr("handler", "PasskeyRegisterComplete"))
		httpErr.SendError(wtr, req, httpErr.Global.ServiceUnavailable, httpErr.WithDetail("failed to persist passkey credential"))
		return
	}

	if err := s.CacheClient.DeleteWebAuthnRegistrationSession(req.Context(), sub); err != nil {
		logger.Error("failed to delete webauthn registration session", err, logger.Attr("handler", "PasskeyRegisterComplete"))
	}

	logger.Info("passkey registered", logger.Attr("handler", "PasskeyRegisterComplete"), logger.Attr("auth.subject", sub))

	wtr.WriteHeader(http.StatusCreated)
	writeJSON(wtr, models.PasskeyRegisteredResponse{
		CredentialId: descriptor.CredentialId,
		CreatedAt:    time.Now().UTC(),
	})
}

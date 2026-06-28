package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/mail"
	"strconv"
	"strings"
	"time"

	"komodo-auth-api/internal/db"
	"komodo-auth-api/internal/models"
	commsmodels "komodo-auth-api/internal/models/comms"
	usermodels "komodo-auth-api/internal/models/user"

	openapi_types "github.com/oapi-codegen/runtime/types"
	httpErr "github.com/rdevitto86/komodo-forge-sdk-go/api/errors"
	logger "github.com/rdevitto86/komodo-forge-sdk-go/logging/runtime"
)

const (
	otpTokenTTL  = int64(1800)
	svcJWTTTLSec = 30

	audienceUser    = "komodo-apis:user"
	audienceService = "komodo-apis:service"
	otpScope        = "otp:verified"
)

func (s *Service) OTPRequestHandler(wtr http.ResponseWriter, req *http.Request) {
	wtr.Header().Set("Content-Type", "application/json")
	wtr.Header().Set("Cache-Control", "no-store")

	var body models.OTPRequest
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
		logger.Error("failed to decode body", err, logger.Attr("handler", "OTPRequest"))
		httpErr.SendError(wtr, req, httpErr.Global.BadRequest, httpErr.WithDetail("invalid request body"))
		return
	}

	email := strings.TrimSpace(strings.ToLower(string(body.Email)))
	body.Email = openapi_types.Email(email)
	if _, err := mail.ParseAddress(email); err != nil {
		httpErr.SendError(wtr, req, httpErr.Global.BadRequest, httpErr.WithDetail("email is required"))
		return
	}

	if s.BannedChecker != nil {
		banned, err := s.BannedChecker.IsBanned(req.Context(), email)
		if err != nil {
			logger.Error("failed to check banned status", err, logger.Attr("handler", "OTPRequest"))
		} else if banned {
			httpErr.SendError(wtr, req, httpErr.Global.Forbidden, httpErr.WithDetail("account is not eligible for OTP"))
			return
		}
	}

	code, err := s.CacheClient.GenerateAndStoreOTP(req.Context(), email)
	if err != nil {
		if errors.Is(err, db.ErrOTPCooldown) {
			wtr.Header().Set("Retry-After", strconv.Itoa(db.OTPCooldownSeconds))
			httpErr.SendError(wtr, req, httpErr.Global.TooManyRequests, httpErr.WithDetail("OTP requested too soon, try again shortly"))
			return
		}
		logger.Error("failed to generate OTP", err, logger.Attr("handler", "OTPRequest"))
		httpErr.SendError(wtr, req, httpErr.Global.Internal, httpErr.WithDetail("failed to generate OTP"))
		return
	}

	logger.Debug("generated OTP", logger.FromContext(req.Context())...)

	err = s.HttpClient.SendEmail(req.Context(), commsmodels.SendEmailJSONRequestBody{
		To:         openapi_types.Email(email),
		TemplateId: "otp",
		TemplateData: &map[string]any{
			"code": code,
			"ttl":  otpTokenTTL,
		},
	})
	if err != nil {
		logger.Error("failed to dispatch OTP via communications-api", err, logger.Attr("handler", "OTPRequest"))
	}

	wtr.WriteHeader(http.StatusOK)
	writeJSON(wtr, map[string]string{
		"message": "OTP created successfully",
	})
}

func (s *Service) OTPVerifyHandler(wtr http.ResponseWriter, req *http.Request) {
	wtr.Header().Set("Content-Type", "application/json")
	wtr.Header().Set("Cache-Control", "no-store")

	var body models.OTPVerifyRequest
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
		logger.Error("failed to decode body", err, logger.Attr("handler", "OTPVerify"))
		httpErr.SendError(wtr, req, httpErr.Global.BadRequest, httpErr.WithDetail("invalid request body"))
		return
	}

	verifyEmail := strings.TrimSpace(strings.ToLower(string(body.Email)))
	body.Email = openapi_types.Email(verifyEmail)
	body.Code = strings.TrimSpace(body.Code)

	if _, err := mail.ParseAddress(verifyEmail); err != nil {
		httpErr.SendError(wtr, req, httpErr.Global.BadRequest, httpErr.WithDetail("email is required"))
		return
	}
	if body.Code == "" {
		httpErr.SendError(wtr, req, httpErr.Global.BadRequest, httpErr.WithDetail("code is required"))
		return
	}

	attempts, incrErr := s.CacheClient.IncrOTPAttempts(req.Context(), verifyEmail)
	if incrErr != nil {
		logger.Error("failed to increment OTP attempt count", incrErr, logger.Attr("handler", "OTPVerify"))
	} else if attempts > db.MaxOTPAttempts {
		logger.Warn("OTP verify blocked: max attempts reached", logger.Attr("handler", "OTPVerify"))
		httpErr.SendError(wtr, req, httpErr.Global.TooManyRequests, httpErr.WithDetail("too many OTP attempts"))
		return
	}

	type verifyRes struct {
		err error
	}

	type credsRes struct {
		creds *usermodels.CredentialsResponse
		err   error
	}

	verifyCh := make(chan verifyRes, 1)
	credsCh := make(chan credsRes, 1)

	go func() {
		defer func() {
			if r := recover(); r != nil {
				verifyCh <- verifyRes{fmt.Errorf("panic in OTP verification: %v", r)}
			}
		}()
		verifyCh <- verifyRes{s.CacheClient.VerifyOTP(req.Context(), verifyEmail, body.Code)}
	}()

	go func() {
		defer func() {
			if r := recover(); r != nil {
				credsCh <- credsRes{err: fmt.Errorf("panic in credential lookup: %v", r)}
			}
		}()
		if s.HttpClient == nil {
			credsCh <- credsRes{err: fmt.Errorf("customer-api client not configured")}
			return
		}

		svcToken, tokenErr := s.getOrRefreshSvcJWT()
		if tokenErr != nil {
			credsCh <- credsRes{err: fmt.Errorf("failed to obtain service token: %w", tokenErr)}
			return
		}

		creds, err := s.HttpClient.GetUserCredentials(req.Context(), verifyEmail, svcToken)
		credsCh <- credsRes{creds: creds, err: err}
	}()

	vr := <-verifyCh
	if vr.err != nil {
		switch {
		case errors.Is(vr.err, db.ErrOTPNotFound):
			logger.Info("no OTP found for email", logger.Attr("handler", "OTPVerify"))
			httpErr.SendError(wtr, req, httpErr.Auth.InvalidToken, httpErr.WithDetail("OTP not found or expired"))
		case errors.Is(vr.err, db.ErrOTPInvalid):
			logger.Warn("invalid OTP for email", logger.Attr("handler", "OTPVerify"))
			httpErr.SendError(wtr, req, httpErr.Auth.InvalidToken, httpErr.WithDetail("invalid OTP"))
		case errors.Is(vr.err, db.ErrOTPAlreadyRedeemed):
			logger.Warn("OTP already redeemed", logger.Attr("handler", "OTPVerify"))
			httpErr.SendError(wtr, req, httpErr.Global.Conflict, httpErr.WithDetail("OTP has already been used"))
		default:
			logger.Error("verification error", vr.err, logger.Attr("handler", "OTPVerify"))
			httpErr.SendError(wtr, req, httpErr.Global.Internal, httpErr.WithDetail("OTP verification failed"))
		}
		return
	}

	s.CacheClient.DeleteOTPAttempts(req.Context(), verifyEmail)

	cr := <-credsCh
	switch {
	case cr.err != nil:
		logger.Error("user credential lookup failed", cr.err, logger.Attr("handler", "OTPVerify"))
		httpErr.SendError(wtr, req, httpErr.Global.ServiceUnavailable, httpErr.WithDetail("credential lookup unavailable"))
		return
	case cr.creds == nil:
		logger.Warn("no user credentials found for verified OTP", logger.Attr("handler", "OTPVerify"))
		httpErr.SendError(wtr, req, httpErr.Auth.InvalidToken, httpErr.WithDetail("account not found"))
		return
	}

	subject := cr.creds.UserId

	accessToken, err := s.JWT.SignToken(
		"komodo-auth-api",
		subject,
		audienceUser,
		otpTokenTTL,
		[]string{"otp:verified"},
	)
	if err != nil {
		logger.Error("failed to sign token", err, logger.Attr("handler", "OTPVerify"))
		httpErr.SendError(wtr, req, httpErr.Global.Internal, httpErr.WithDetail("failed to issue token"))
		return
	}

	logger.Info("issued token", logger.Attr("handler", "OTPVerify"), logger.Attr("auth.subject", subject))

	scope := otpScope

	wtr.WriteHeader(http.StatusOK)
	writeJSON(wtr, models.TokenResponse{
		AccessToken: accessToken,
		TokenType:   "Bearer",
		ExpiresIn:   int(otpTokenTTL),
		Scope:       &scope,
	})
}

func (s *Service) getOrRefreshSvcJWT() (string, error) {
	s.svcJWTMu.Lock()
	defer s.svcJWTMu.Unlock()

	if s.svcJWT != "" && time.Now().Before(s.svcJWTExpiry.Add(-5*time.Second)) {
		return s.svcJWT, nil
	}

	token, err := s.JWT.SignToken(
		"komodo-auth-api",
		"komodo-auth-api",
		audienceService,
		svcJWTTTLSec,
		[]string{"svc:komodo-auth-api"},
	)
	if err != nil {
		return "", fmt.Errorf("failed to sign service token: %w", err)
	}

	s.svcJWT = token
	s.svcJWTExpiry = time.Now().Add(svcJWTTTLSec * time.Second)
	return token, nil
}

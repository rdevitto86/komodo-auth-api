package api

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"html"
	"net/http"
	"net/url"
	"slices"

	"komodo-auth-api/internal/db"

	logger "github.com/rdevitto86/komodo-forge-sdk-go/logging/runtime"
)

const authCodeBytes = 32

func sendAuthorizeDirectError(wtr http.ResponseWriter, status int, msg string) {
	wtr.Header().Set("Content-Type", "text/html; charset=utf-8")
	wtr.WriteHeader(status)
	fmt.Fprintf(wtr, "<html><body><h1>%d %s</h1><p>%s</p></body></html>", status, html.EscapeString(http.StatusText(status)), html.EscapeString(msg))
}

func redirectAuthorizeError(wtr http.ResponseWriter, req *http.Request, redirectURI, errCode, errDesc, state string) {
	u, _ := url.Parse(redirectURI)
	q := u.Query()
	q.Set("error", errCode)
	if errDesc != "" {
		q.Set("error_description", errDesc)
	}
	if state != "" {
		q.Set("state", state)
	}
	u.RawQuery = q.Encode()
	http.Redirect(wtr, req, u.String(), http.StatusFound)
}

func generateAuthCode() (string, error) {
	b := make([]byte, authCodeBytes)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("failed to generate authorization code: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func (s *Service) OAuthAuthorizeHandler(wtr http.ResponseWriter, req *http.Request) {
	if !s.authCodeGrantEnabled {
		logger.Warn("authorize endpoint called while authorization_code grant is disabled")
		sendAuthorizeDirectError(wtr, http.StatusNotImplemented, "authorization_code grant is not enabled")
		return
	}

	query := req.URL.Query()
	clientID := query.Get("client_id")
	redirectURI := query.Get("redirect_uri")
	responseType := query.Get("response_type")
	scope := query.Get("scope")
	state := query.Get("state")

	if clientID == "" {
		logger.Warn("missing client_id in authorize request")
		sendAuthorizeDirectError(wtr, http.StatusBadRequest, "missing required parameter: client_id")
		return
	}

	rec, ok := s.ClientRegistry.Get(clientID)
	if !ok {
		logger.Warn("unknown client_id in authorize request", logger.Attr("client_id", clientID))
		sendAuthorizeDirectError(wtr, http.StatusBadRequest, "unknown client_id")
		return
	}

	if redirectURI == "" {
		logger.Warn("missing redirect_uri in authorize request", logger.Attr("client_id", clientID))
		sendAuthorizeDirectError(wtr, http.StatusBadRequest, "missing required parameter: redirect_uri")
		return
	}

	parsedRedirect, err := url.ParseRequestURI(redirectURI)
	if err != nil || parsedRedirect.Scheme == "" || parsedRedirect.Host == "" {
		logger.Warn("invalid redirect_uri in authorize request", logger.Attr("client_id", clientID), logger.Attr("redirect_uri", redirectURI))
		sendAuthorizeDirectError(wtr, http.StatusBadRequest, "invalid redirect_uri: must be an absolute URI")
		return
	}

	if !slices.Contains(rec.AllowedRedirectURIs, redirectURI) {
		logger.Warn("redirect_uri not registered for client", logger.Attr("client_id", clientID), logger.Attr("redirect_uri", redirectURI))
		sendAuthorizeDirectError(wtr, http.StatusBadRequest, "redirect_uri not registered for this client")
		return
	}

	codeChallenge := query.Get("code_challenge")
	codeChallengeMethod := query.Get("code_challenge_method")

	if responseType == "" {
		logger.Warn("missing response_type in authorize request", logger.Attr("client_id", clientID))
		redirectAuthorizeError(wtr, req, redirectURI, "invalid_request", "missing required parameter: response_type", state)
		return
	}

	if responseType != "code" {
		logger.Warn("unsupported response_type in authorize request", logger.Attr("client_id", clientID), logger.Attr("response_type", responseType))
		redirectAuthorizeError(wtr, req, redirectURI, "unsupported_response_type", "only response_type=code is supported", state)
		return
	}

	if codeChallenge == "" {
		redirectAuthorizeError(wtr, req, redirectURI, "invalid_request", "code_challenge is required", state)
		return
	}

	if codeChallengeMethod != "S256" {
		redirectAuthorizeError(wtr, req, redirectURI, "invalid_request", "code_challenge_method must be S256", state)
		return
	}

	userID := query.Get("user_id")
	if userID == "" {
		redirectAuthorizeError(wtr, req, redirectURI, "invalid_request", "user_id is required", state)
		return
	}

	code, err := generateAuthCode()
	if err != nil {
		logger.Error("failed to generate authorization code", err)
		redirectAuthorizeError(wtr, req, redirectURI, "server_error", "failed to generate authorization code", state)
		return
	}

	entry := &db.AuthCodeEntry{
		ClientID:      clientID,
		RedirectURI:   redirectURI,
		Scope:         scope,
		UserID:        userID,
		CodeChallenge: codeChallenge,
	}

	claimed, err := s.CacheClient.StoreAuthCode(req.Context(), code, entry)
	if err != nil {
		logger.Error("failed to store authorization code", err)
		redirectAuthorizeError(wtr, req, redirectURI, "server_error", "failed to store authorization code", state)
		return
	}
	if !claimed {
		logger.Error("authorization code collision detected", fmt.Errorf("code already exists"))
		redirectAuthorizeError(wtr, req, redirectURI, "server_error", "failed to generate authorization code", state)
		return
	}

	u, _ := url.Parse(redirectURI)
	q := u.Query()
	q.Set("code", code)
	if state != "" {
		q.Set("state", state)
	}
	u.RawQuery = q.Encode()
	http.Redirect(wtr, req, u.String(), http.StatusFound)

	logger.Info("issued authorization code",
		logger.Attr("client_id", clientID),
		logger.Attr("redirect_uri", redirectURI),
	)
}

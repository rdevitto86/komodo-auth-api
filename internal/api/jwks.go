package api

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"math/big"
	"net/http"
	"sync/atomic"

	"komodo-auth-api/internal/jwt"
	"komodo-auth-api/internal/models"

	httpErr "github.com/rdevitto86/komodo-forge-sdk-go/api/errors"
	logger "github.com/rdevitto86/komodo-forge-sdk-go/logging/runtime"
)

func buildJWKS(auth TokenAuthority) *models.JWKS {
	vks := auth.VerificationKeys()
	keys := make([]models.JWK, 0, len(vks))
	for _, vk := range vks {
		keys = append(keys, models.JWK{
			Kty: "RSA",
			Use: "sig",
			Kid: vk.Kid,
			Alg: "RS256",
			N:   base64.RawURLEncoding.EncodeToString(vk.Key.N.Bytes()),
			E:   base64.RawURLEncoding.EncodeToString(big.NewInt(int64(vk.Key.E)).Bytes()),
		})
	}

	return &models.JWKS{Keys: keys}
}

type jwksCache struct {
	kids []string
	body []byte
}

var jwksCachePtr atomic.Pointer[jwksCache]

func kidsOf(vks []jwt.VerificationKey) []string {
	kids := make([]string, len(vks))
	for i, vk := range vks {
		kids[i] = vk.Kid
	}
	return kids
}

func kidsEqual(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func cachedJWKSBody(auth TokenAuthority) ([]byte, error) {
	kids := kidsOf(auth.VerificationKeys()) // cache keys

	if cached := jwksCachePtr.Load(); cached != nil && kidsEqual(cached.kids, kids) {
		return cached.body, nil
	}

	body, err := json.Marshal(buildJWKS(auth))
	if err != nil {
		return nil, err
	}

	jwksCachePtr.Store(&jwksCache{kids: kids, body: body})
	return body, nil
}

func (s *Service) JWKSHandler(wtr http.ResponseWriter, req *http.Request) {
	wtr.Header().Set("Content-Type", "application/json")
	wtr.Header().Set("Cache-Control", "public, max-age=300")

	if s.JWT == nil {
		logger.Error("JWKS unavailable", errors.New("token authority not configured"))
		httpErr.SendError(wtr, req, httpErr.Auth.InvalidKey, httpErr.WithDetail("public key not configured"))
		return
	}

	body, err := cachedJWKSBody(s.JWT)
	if err != nil {
		logger.Error("failed to encode JWKS body", err)
		httpErr.SendError(wtr, req, httpErr.Global.Internal, httpErr.WithDetail("failed to build JWKS"))
		return
	}

	wtr.WriteHeader(http.StatusOK)
	if _, err := wtr.Write(body); err != nil {
		logger.Error("failed to write JWKS response", err)
	}
}

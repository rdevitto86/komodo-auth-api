package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	awsddb "github.com/rdevitto86/komodo-forge-sdk-go/aws/dynamodb"
	awsEC "github.com/rdevitto86/komodo-forge-sdk-go/db/redis"
	"github.com/rdevitto86/komodo-forge-sdk-go/testing/testutil"
	testcontainers "github.com/testcontainers/testcontainers-go"
	tcredis "github.com/testcontainers/testcontainers-go/modules/redis"
	"github.com/testcontainers/testcontainers-go/wait"

	"komodo-auth-api/internal/clients"
	"komodo-auth-api/internal/db"
)

// ── Integration Tests ────────────────────────────────────────────────────────

const (
	intBannedTable = "komodo-banned-customers"
	intClientID    = "test-client"
	intClientSec   = "test-secret"
)

type lsContainer struct {
	container testcontainers.Container
	endpoint  string
}

func newIntegrationLocalStack(t *testing.T) *lsContainer {
	t.Helper()
	ctx := context.Background()

	req := testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        "localstack/localstack:3",
			ExposedPorts: []string{"4566/tcp"},
			Env: map[string]string{
				"SERVICES":       "dynamodb",
				"DEFAULT_REGION": "us-east-1",
			},
			WaitingFor: wait.ForHTTP("/_localstack/health").
				WithPort("4566/tcp").
				WithResponseMatcher(func(body io.Reader) bool {
					var h struct {
						Services map[string]string `json:"services"`
					}
					if err := json.NewDecoder(body).Decode(&h); err != nil {
						return false
					}
					s := h.Services["dynamodb"]
					return s == "running" || s == "available"
				}),
		},
		Started: true,
	}

	c, err := testcontainers.GenericContainer(ctx, req)
	if err != nil {
		t.Fatalf("failed to start localstack container: %v", err)
	}
	t.Cleanup(func() {
		if err := c.Terminate(ctx); err != nil {
			t.Logf("failed to terminate localstack container: %v", err)
		}
	})

	host, err := c.Host(ctx)
	if err != nil {
		t.Fatalf("failed to get localstack host: %v", err)
	}
	port, err := c.MappedPort(ctx, "4566/tcp")
	if err != nil {
		t.Fatalf("failed to get localstack mapped port: %v", err)
	}

	return &lsContainer{
		container: c,
		endpoint:  fmt.Sprintf("http://%s:%s", host, port.Port()),
	}
}

func newRawDynamoDB(t *testing.T, endpoint string) *dynamodb.Client {
	t.Helper()
	ctx := context.Background()

	cfg, err := awsconfig.LoadDefaultConfig(ctx,
		awsconfig.WithRegion("us-east-1"),
		awsconfig.WithCredentialsProvider(
			credentials.NewStaticCredentialsProvider("test", "test", ""),
		),
	)
	if err != nil {
		t.Fatalf("failed to load aws config for localstack: %v", err)
	}

	ep := endpoint
	return dynamodb.NewFromConfig(cfg, func(o *dynamodb.Options) {
		o.BaseEndpoint = aws.String(ep)
	})
}

func createBannedTableInLocalStack(t *testing.T, ddb *dynamodb.Client) {
	t.Helper()
	_, err := ddb.CreateTable(context.Background(), &dynamodb.CreateTableInput{
		TableName: aws.String(intBannedTable),
		AttributeDefinitions: []types.AttributeDefinition{
			{AttributeName: aws.String("PK"), AttributeType: types.ScalarAttributeTypeS},
		},
		KeySchema: []types.KeySchemaElement{
			{AttributeName: aws.String("PK"), KeyType: types.KeyTypeHash},
		},
		BillingMode: types.BillingModePayPerRequest,
	})
	if err != nil {
		t.Fatalf("failed to create banned table in localstack: %v", err)
	}
}

func seedBannedEmail(t *testing.T, ddb *dynamodb.Client, email string) {
	t.Helper()
	_, err := ddb.PutItem(context.Background(), &dynamodb.PutItemInput{
		TableName: aws.String(intBannedTable),
		Item: map[string]types.AttributeValue{
			"PK":        &types.AttributeValueMemberS{Value: "EMAIL#" + email},
			"reason":    &types.AttributeValueMemberS{Value: "integration-test"},
			"banned_at": &types.AttributeValueMemberS{Value: "2024-01-01T00:00:00Z"},
			"banned_by": &types.AttributeValueMemberS{Value: "test"},
		},
	})
	if err != nil {
		t.Fatalf("failed to seed banned email %s: %v", email, err)
	}
}

func newForgeBannedChecker(t *testing.T, endpoint string) *clients.BannedCustomersClient {
	t.Helper()
	ddbClient, err := awsddb.New(context.Background(), awsddb.Config{
		Region:    "us-east-1",
		AccessKey: "test",
		SecretKey: "test",
		Endpoint:  endpoint,
	})
	if err != nil {
		t.Fatalf("failed to create forge DynamoDB client: %v", err)
	}
	return clients.NewBannedCustomers(clients.BannedCustomersConfig{
		TableName: intBannedTable,
		DynamoDB:  ddbClient,
	})
}

func startRedisContainer(t *testing.T) string {
	t.Helper()
	ctx := context.Background()

	container, err := tcredis.Run(ctx, "redis:7-alpine")
	if err != nil {
		t.Fatalf("failed to start redis container: %v", err)
	}
	t.Cleanup(func() {
		if err := container.Terminate(ctx); err != nil {
			t.Logf("failed to terminate redis container: %v", err)
		}
	})

	host, err := container.Host(ctx)
	if err != nil {
		t.Fatalf("failed to resolve redis host: %v", err)
	}
	port, err := container.MappedPort(ctx, "6379/tcp")
	if err != nil {
		t.Fatalf("failed to resolve redis port: %v", err)
	}
	return fmt.Sprintf("%s:%s", host, port.Port())
}

func newCacheFromAddr(t *testing.T, addr string) *db.CacheClient {
	t.Helper()
	c, err := db.New(db.CacheClientConfig{Endpoint: addr, DB: "0"})
	if err != nil {
		t.Fatalf("failed to construct cache client: %v", err)
	}
	return c
}

func readOTPDirect(t *testing.T, addr, email string) string {
	t.Helper()
	rc, err := awsEC.New(awsEC.Config{Addr: addr})
	if err != nil {
		t.Fatalf("failed to connect redis for OTP read: %v", err)
	}
	defer rc.Close()

	val, err := rc.Get(context.Background(), "otp:"+email)
	if err != nil {
		t.Fatalf("failed to read OTP from redis: %v", err)
	}
	return val
}

func customerAPIStub(t *testing.T, userID string) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/users/credentials", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"user_id":      userID,
			"auth_methods": []string{"password"},
		})
	})
	return httptest.NewServer(mux)
}

func commsStub(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/email/send", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	return httptest.NewServer(mux)
}

func srvIntegration(t *testing.T, cache db.CacheClientCallers, banned clients.BannedChecker, userURL, commsURL string) *Service {
	t.Helper()
	httpClient, err := clients.New(clients.HttpClientConfig{
		CustomerBaseURL:  userURL,
		CommsBaseURL: commsURL,
	})
	if err != nil {
		t.Fatalf("failed to create http client: %v", err)
	}
	svc := &Service{
		HttpClient:     httpClient,
		CacheClient:    cache,
		JWT:            testKeys,
		ClientRegistry: testRegistry,
	}
	if banned != nil {
		svc.BannedChecker = banned
	}
	return svc
}

func postJSONWithBasicAuth(t *testing.T, handler handlerFn, body any, user, pass string) *httptest.ResponseRecorder {
	t.Helper()
	b, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("postJSONWithBasicAuth: marshal: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.SetBasicAuth(user, pass)
	rr := httptest.NewRecorder()
	handler(rr, req)
	return rr
}

func TestOTPRequestAndVerify_Integration(t *testing.T) {
	testutil.Integration(t)

	redisAddr := startRedisContainer(t)
	cache := newCacheFromAddr(t, redisAddr)

	const testEmail = "integration-otp@example.com"
	const testUserID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"

	uStub := customerAPIStub(t, testUserID)
	defer uStub.Close()
	cStub := commsStub(t)
	defer cStub.Close()

	svc := srvIntegration(t, cache, nil, uStub.URL, cStub.URL)

	reqRR := postJSON(t, svc.OTPRequestHandler, map[string]string{"email": testEmail})
	checkStatus(t, reqRR, http.StatusOK)

	code := readOTPDirect(t, redisAddr, testEmail)
	if code == "" {
		t.Fatal("expected OTP code in Redis after request")
	}

	verifyRR := postJSON(t, svc.OTPVerifyHandler, map[string]any{
		"email": testEmail,
		"code":  code,
	})
	checkStatus(t, verifyRR, http.StatusOK)

	var tok struct {
		AccessToken string `json:"access_token"`
		Scope       string `json:"scope"`
	}
	if err := json.NewDecoder(verifyRR.Body).Decode(&tok); err != nil {
		t.Fatalf("decode verify response: %v", err)
	}
	if tok.AccessToken == "" {
		t.Fatal("expected non-empty access_token after OTP verify")
	}
	if tok.Scope != "otp:verified" {
		t.Errorf("expected scope=otp:verified, got %q", tok.Scope)
	}
}

func TestClientCredentialsAndIntrospect_Integration(t *testing.T) {
	testutil.Integration(t)

	redisAddr := startRedisContainer(t)
	cache := newCacheFromAddr(t, redisAddr)

	uStub := customerAPIStub(t, "b2c3d4e5-f6a7-8901-bcde-f01234567891")
	defer uStub.Close()
	cStub := commsStub(t)
	defer cStub.Close()

	svc := srvIntegration(t, cache, nil, uStub.URL, cStub.URL)

	tokenRR := postJSON(t, svc.OAuthTokenHandler, map[string]any{
		"grant_type":    "client_credentials",
		"client_id":     intClientID,
		"client_secret": intClientSec,
	})
	checkStatus(t, tokenRR, http.StatusOK)

	var tokResp struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(tokenRR.Body).Decode(&tokResp); err != nil {
		t.Fatalf("decode token response: %v", err)
	}
	if tokResp.AccessToken == "" {
		t.Fatal("expected non-empty access_token from client_credentials")
	}

	introspectRR := postJSON(t, svc.OAuthIntrospectHandler, map[string]string{
		"token": tokResp.AccessToken,
	})
	checkStatus(t, introspectRR, http.StatusOK)

	var ir struct {
		Active bool `json:"active"`
	}
	if err := json.NewDecoder(introspectRR.Body).Decode(&ir); err != nil {
		t.Fatalf("decode introspect response: %v", err)
	}
	if !ir.Active {
		t.Fatal("expected active=true for freshly issued token")
	}
}

func TestRevokeAndIntrospect_Integration(t *testing.T) {
	testutil.Integration(t)

	redisAddr := startRedisContainer(t)
	cache := newCacheFromAddr(t, redisAddr)

	uStub := customerAPIStub(t, "c3d4e5f6-a7b8-9012-cdef-012345678912")
	defer uStub.Close()
	cStub := commsStub(t)
	defer cStub.Close()

	svc := srvIntegration(t, cache, nil, uStub.URL, cStub.URL)

	tokenRR := postJSON(t, svc.OAuthTokenHandler, map[string]any{
		"grant_type":    "client_credentials",
		"client_id":     intClientID,
		"client_secret": intClientSec,
	})
	checkStatus(t, tokenRR, http.StatusOK)

	var tokResp struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(tokenRR.Body).Decode(&tokResp); err != nil {
		t.Fatalf("decode token response: %v", err)
	}

	revokeRR := postJSONWithBasicAuth(t, svc.OAuthRevokeHandler,
		map[string]string{"token": tokResp.AccessToken},
		intClientID, intClientSec,
	)
	checkStatus(t, revokeRR, http.StatusOK)

	introspectRR := postJSON(t, svc.OAuthIntrospectHandler, map[string]string{
		"token": tokResp.AccessToken,
	})
	checkStatus(t, introspectRR, http.StatusOK)

	var ir struct {
		Active bool `json:"active"`
	}
	if err := json.NewDecoder(introspectRR.Body).Decode(&ir); err != nil {
		t.Fatalf("decode introspect response after revoke: %v", err)
	}
	if ir.Active {
		t.Fatal("expected active=false after revocation")
	}
}

func TestJWKSFetch_Integration(t *testing.T) {
	testutil.Integration(t)

	redisAddr := startRedisContainer(t)
	cache := newCacheFromAddr(t, redisAddr)

	uStub := customerAPIStub(t, "d4e5f6a7-b8c9-0123-def0-123456789013")
	defer uStub.Close()
	cStub := commsStub(t)
	defer cStub.Close()

	svc := srvIntegration(t, cache, nil, uStub.URL, cStub.URL)

	rr := getWithQuery(t, svc.JWKSHandler, "")
	checkStatus(t, rr, http.StatusOK)

	var jwks struct {
		Keys []map[string]any `json:"keys"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&jwks); err != nil {
		t.Fatalf("decode JWKS response: %v", err)
	}
	if len(jwks.Keys) == 0 {
		t.Fatal("expected at least one JWK in JWKS response")
	}
	for _, field := range []string{"kty", "use", "kid", "alg", "n", "e"} {
		if _, ok := jwks.Keys[0][field]; !ok {
			t.Errorf("missing field %q in JWK", field)
		}
	}
}

func TestBannedEmail_OTPRequest_Integration(t *testing.T) {
	testutil.Integration(t)

	ls := newIntegrationLocalStack(t)
	rawDDB := newRawDynamoDB(t, ls.endpoint)
	createBannedTableInLocalStack(t, rawDDB)

	const bannedEmail = "banned-integration@example.com"
	seedBannedEmail(t, rawDDB, bannedEmail)

	redisAddr := startRedisContainer(t)
	cache := newCacheFromAddr(t, redisAddr)

	banned := newForgeBannedChecker(t, ls.endpoint)

	uStub := customerAPIStub(t, "e5f6a7b8-c9d0-1234-ef01-234567890124")
	defer uStub.Close()
	cStub := commsStub(t)
	defer cStub.Close()

	svc := srvIntegration(t, cache, banned, uStub.URL, cStub.URL)

	rr := postJSON(t, svc.OTPRequestHandler, map[string]string{"email": bannedEmail})
	checkStatus(t, rr, http.StatusForbidden)
}

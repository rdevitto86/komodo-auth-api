package clients

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"sync"
	"time"

	commsmodels "komodo-auth-api/internal/models/comms"
	usermodels "komodo-auth-api/internal/models/user"

	sdkhttp "github.com/rdevitto86/komodo-forge-sdk-go/http/client"
)

var defaultTransport http.RoundTripper = &http.Transport{
	MaxIdleConns:          100,
	MaxIdleConnsPerHost:   64,
	IdleConnTimeout:       90 * time.Second,
	TLSHandshakeTimeout:   10 * time.Second,
	ResponseHeaderTimeout: 10 * time.Second,
	DialContext: (&net.Dialer{
		Timeout:   5 * time.Second,
		KeepAlive: 30 * time.Second,
	}).DialContext,
}

//go:generate go tool mockgen -package=mocks -destination=../testutil/mocks/http_client_callers.go komodo-auth-api/internal/clients HttpClientCallers

type HttpClientCallers interface {
	SendEmail(ctx context.Context, body commsmodels.SendEmailJSONRequestBody) error
	GetUserCredentials(ctx context.Context, email, bearerToken string) (*usermodels.CredentialsResponse, error)
	GetUserByID(ctx context.Context, userID, bearerToken string) (*usermodels.User, error)
	PasskeyCredentialStore
}

type HttpClient struct {
	*sdkhttp.Client
	CommsBaseURL    string
	CustomerBaseURL string

	emailSemOnce sync.Once
	emailSem     chan struct{}
}

func (c *HttpClient) emailSemaphore() chan struct{} {
	c.emailSemOnce.Do(func() {
		c.emailSem = make(chan struct{}, maxConcurrentEmails)
	})
	return c.emailSem
}

type HttpClientConfig struct {
	sdkhttp.ClientConfig
	CommsBaseURL    string
	CustomerBaseURL string
}

func New(cfg HttpClientConfig) (*HttpClient, error) {
	if cfg.ClientConfig.Transport == nil {
		cfg.ClientConfig.Transport = defaultTransport
	}

	client := sdkhttp.NewClient(cfg.ClientConfig)
	if client == nil {
		return nil, fmt.Errorf("failed to create http client")
	}
	return &HttpClient{
		Client:          client,
		CommsBaseURL:    cfg.CommsBaseURL,
		CustomerBaseURL: cfg.CustomerBaseURL,
	}, nil
}

const reachableTimeout = 2 * time.Second // 2 seconds

func (c *HttpClient) reachable(ctx context.Context, baseURL, name string) error {
	if baseURL == "" {
		return fmt.Errorf("%s base URL not configured", name)
	}

	ctx, cancel := context.WithTimeout(ctx, reachableTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+"/health", nil)
	if err != nil {
		return fmt.Errorf("failed to build %s health request: %w", name, err)
	}

	resp, err := c.Do(req)
	if err != nil {
		return fmt.Errorf("failed to reach %s: %w", name, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("%s health check returned status %d", name, resp.StatusCode)
	}
	return nil
}

func (c *HttpClient) CommsReachable(ctx context.Context) error {
	return c.reachable(ctx, c.CommsBaseURL, "communications-api")
}

func (c *HttpClient) CustomerReachable(ctx context.Context) error {
	return c.reachable(ctx, c.CustomerBaseURL, "customer-api")
}

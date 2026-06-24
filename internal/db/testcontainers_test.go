package db

import (
	"context"
	"fmt"
	"testing"

	tcredis "github.com/testcontainers/testcontainers-go/modules/redis"
)

func newIntegrationCacheClient(t *testing.T) *CacheClient {
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
		t.Fatalf("failed to resolve redis container host: %v", err)
	}
	port, err := container.MappedPort(ctx, "6379/tcp")
	if err != nil {
		t.Fatalf("failed to resolve redis container port: %v", err)
	}

	c, err := New(CacheClientConfig{
		Endpoint: fmt.Sprintf("%s:%s", host, port.Port()),
		DB:       "0",
	})
	if err != nil {
		t.Fatalf("failed to construct cache client: %v", err)
	}
	return c
}

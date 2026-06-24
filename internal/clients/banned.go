package clients

import (
	"context"
	"errors"
	"fmt"
	"time"

	awsddb "github.com/rdevitto86/komodo-forge-sdk-go/aws/dynamodb"
)

const defaultBannedTable = "komodo-banned-customers"

type bannedRecord struct {
	PK        string `dynamodbav:"PK"`
	Reason    string `dynamodbav:"reason"`
	BannedAt  string `dynamodbav:"banned_at"`
	BannedBy  string `dynamodbav:"banned_by"`
	ExpiresAt int64  `dynamodbav:"expires_at"`
}

//go:generate go tool mockgen -package=mocks -destination=../testutil/mocks/banned_checker.go -source=banned.go BannedChecker

type BannedChecker interface {
	IsBanned(ctx context.Context, email string) (bool, error)
}

type BannedCustomersConfig struct {
	TableName string
	DynamoDB  awsddb.API
}

type BannedCustomersClient struct {
	table string
	ddb   awsddb.API
}

func NewBannedCustomers(cfg BannedCustomersConfig) *BannedCustomersClient {
	name := cfg.TableName
	if name == "" {
		name = defaultBannedTable
	}
	return &BannedCustomersClient{table: name, ddb: cfg.DynamoDB}
}

func (c *BannedCustomersClient) Reachable(ctx context.Context) error {
	if c.ddb == nil {
		return fmt.Errorf("banned customers table unavailable")
	}
	if err := c.ddb.DescribeTable(ctx, c.table); err != nil {
		return fmt.Errorf("failed to reach banned customers table: %w", err)
	}
	return nil
}

func (c *BannedCustomersClient) IsBanned(ctx context.Context, email string) (bool, error) {
	key, err := c.ddb.BuildKey("PK", "EMAIL#"+email, "", nil)
	if err != nil {
		return false, fmt.Errorf("failed to build banned-customers key: %w", err)
	}

	var rec bannedRecord
	if err := c.ddb.GetItemAs(ctx, c.table, key, false, nil, &rec); err != nil {
		if errors.Is(err, awsddb.ErrNotFound) {
			return false, nil
		}
		return false, fmt.Errorf("failed to look up banned-customers record: %w", err)
	}

	if rec.ExpiresAt > 0 && rec.ExpiresAt < time.Now().Unix() {
		return false, nil
	}
	return true, nil
}

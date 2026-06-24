package clients

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	awsddb "github.com/rdevitto86/komodo-forge-sdk-go/aws/dynamodb"
)

type fakeDDB struct {
	item        any
	getErr      error
	describeErr error
}

func (f *fakeDDB) BuildKey(pk string, pv any, sk string, sv any) (map[string]types.AttributeValue, error) {
	m, err := attributevalue.MarshalMap(map[string]any{pk: pv})
	if err != nil {
		return nil, err
	}
	return m, nil
}

func (f *fakeDDB) GetItemAs(_ context.Context, _ string, _ map[string]types.AttributeValue, _ bool, _ []map[string]types.AttributeValue, out any) error {
	if f.getErr != nil {
		return f.getErr
	}
	if f.item == nil {
		return nil
	}
	av, err := attributevalue.MarshalMap(f.item)
	if err != nil {
		return err
	}
	return attributevalue.UnmarshalMap(av, out)
}

func (f *fakeDDB) GetItem(_ context.Context, _ string, _ map[string]types.AttributeValue, _ bool, _ []map[string]types.AttributeValue) (any, error) {
	return nil, nil
}

func (f *fakeDDB) WriteItem(_ context.Context, _ string, _ map[string]types.AttributeValue, _ bool, _ []map[string]types.AttributeValue, _ *string) error {
	return nil
}

func (f *fakeDDB) WriteItemFrom(_ context.Context, _ string, _ any, _ bool, _ any, _ *string) error {
	return nil
}

func (f *fakeDDB) UpdateItem(_ context.Context, _ string, _ map[string]types.AttributeValue, _ string, _ map[string]types.AttributeValue, _ map[string]string, _ *string) (map[string]types.AttributeValue, error) {
	return nil, nil
}

func (f *fakeDDB) UpdateItemAs(_ context.Context, _ string, _ map[string]types.AttributeValue, _ string, _ map[string]types.AttributeValue, _ map[string]string, _ *string, _ any) error {
	return nil
}

func (f *fakeDDB) DeleteItem(_ context.Context, _ string, _ map[string]types.AttributeValue, _ bool, _ []map[string]types.AttributeValue, _ *string) error {
	return nil
}

func (f *fakeDDB) Query(_ context.Context, _ awsddb.QueryInput) (*awsddb.QueryOutput, error) {
	return nil, nil
}

func (f *fakeDDB) QueryAs(_ context.Context, _ awsddb.QueryInput, _ any) (*awsddb.QueryOutput, error) {
	return nil, nil
}

func (f *fakeDDB) QueryAll(_ context.Context, _ awsddb.QueryInput) ([]map[string]types.AttributeValue, error) {
	return nil, nil
}

func (f *fakeDDB) QueryAllAs(_ context.Context, _ awsddb.QueryInput, _ any) error { return nil }

func (f *fakeDDB) Scan(_ context.Context, _ awsddb.ScanInput) (*awsddb.ScanOutput, error) {
	return nil, nil
}

func (f *fakeDDB) ScanAs(_ context.Context, _ awsddb.ScanInput, _ any) (*awsddb.ScanOutput, error) {
	return nil, nil
}

func (f *fakeDDB) ScanAll(_ context.Context, _ awsddb.ScanInput) ([]map[string]types.AttributeValue, error) {
	return nil, nil
}

func (f *fakeDDB) ScanAllAs(_ context.Context, _ awsddb.ScanInput, _ any) error { return nil }

func (f *fakeDDB) DescribeTable(_ context.Context, _ string) error { return f.describeErr }

// ── Unit Tests ───────────────────────────────────────────────────────────────

func newChecker(ddb *fakeDDB) *BannedCustomersClient {
	return NewBannedCustomers(BannedCustomersConfig{DynamoDB: ddb})
}

func TestIsBanned_ActiveBan_ReturnsTrue(t *testing.T) {
	ddb := &fakeDDB{item: bannedRecord{
		PK:       "EMAIL#test@example.com",
		Reason:   "fraud",
		BannedAt: "2024-01-01T00:00:00Z",
		BannedBy: "admin",
	}}
	c := newChecker(ddb)

	got, err := c.IsBanned(context.Background(), "test@example.com")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !got {
		t.Fatal("expected banned=true for an active ban record")
	}
}

func TestIsBanned_NotFound_ReturnsFalse(t *testing.T) {
	ddb := &fakeDDB{getErr: fmt.Errorf("getItem: %w", awsddb.ErrNotFound)}
	c := newChecker(ddb)

	got, err := c.IsBanned(context.Background(), "clean@example.com")
	if err != nil {
		t.Fatalf("unexpected error on not-found path: %v", err)
	}
	if got {
		t.Fatal("expected banned=false when item does not exist")
	}
}

func TestIsBanned_ExpiredRecord_ReturnsFalse(t *testing.T) {
	ddb := &fakeDDB{item: bannedRecord{
		PK:        "EMAIL#expired@example.com",
		Reason:    "expired ban",
		ExpiresAt: time.Now().Add(-24 * time.Hour).Unix(),
	}}
	c := newChecker(ddb)

	got, err := c.IsBanned(context.Background(), "expired@example.com")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got {
		t.Fatal("expected banned=false for a record with expires_at in the past")
	}
}

func TestIsBanned_ActiveWithFutureTTL_ReturnsTrue(t *testing.T) {
	ddb := &fakeDDB{item: bannedRecord{
		PK:        "EMAIL#future@example.com",
		Reason:    "active temporary ban",
		ExpiresAt: time.Now().Add(24 * time.Hour).Unix(),
	}}
	c := newChecker(ddb)

	got, err := c.IsBanned(context.Background(), "future@example.com")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !got {
		t.Fatal("expected banned=true when expires_at is in the future")
	}
}

func TestIsBanned_DynamoDBError_Propagated(t *testing.T) {
	ddb := &fakeDDB{getErr: errors.New("connection timeout")}
	c := newChecker(ddb)

	got, err := c.IsBanned(context.Background(), "any@example.com")
	if err == nil {
		t.Fatal("expected error to be propagated on DynamoDB failure")
	}
	if got {
		t.Fatal("expected banned=false on DynamoDB error")
	}
}

func TestNewBannedCustomers_DefaultTableName(t *testing.T) {
	c := NewBannedCustomers(BannedCustomersConfig{DynamoDB: &fakeDDB{}})
	if c.table != defaultBannedTable {
		t.Errorf("expected default table %q, got %q", defaultBannedTable, c.table)
	}
}

func TestNewBannedCustomers_CustomTableName(t *testing.T) {
	c := NewBannedCustomers(BannedCustomersConfig{
		TableName: "my-custom-table",
		DynamoDB:  &fakeDDB{},
	})
	if c.table != "my-custom-table" {
		t.Errorf("expected custom table %q, got %q", "my-custom-table", c.table)
	}
}

func TestReachable_TableDescribable_ReturnsNil(t *testing.T) {
	c := newChecker(&fakeDDB{})

	if err := c.Reachable(context.Background()); err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
}

func TestReachable_DescribeTableError_Propagated(t *testing.T) {
	c := newChecker(&fakeDDB{describeErr: errors.New("connection timeout")})

	if err := c.Reachable(context.Background()); err == nil {
		t.Fatal("expected error when DescribeTable fails, got nil")
	}
}

func TestReachable_NilDDB_ReturnsError(t *testing.T) {
	c := &BannedCustomersClient{table: defaultBannedTable}

	if err := c.Reachable(context.Background()); err == nil {
		t.Fatal("expected error when ddb client is nil, got nil")
	}
}

# @komodo-forge-sdk/typescript

Internal TypeScript SDK for Komodo applications. Provides shared types, domain logic, and API client utilities. Organized into backend (Node.js/server), frontend (browser), and shared (universal) modules.

Package name: `@komodo-forge-sdk/typescript`

---

## Installation

### In a monorepo sibling (local link)

```bash
bun add @komodo-forge-sdk/typescript@link:../komodo-forge-sdk-ts
```

Or in `package.json`:
```json
"dependencies": {
  "@komodo-forge-sdk/typescript": "link:../komodo-forge-sdk-ts"
}
```

---

## Module Layout

```
src/
├── backend/          # Server-side only (Node.js / SvelteKit server routes)
│   ├── aws/          # AWS SDK utilities
│   ├── config/       # Server configuration
│   ├── db/           # Database utilities
│   ├── logging/      # Structured logging (runtime, security, telemetry)
│   ├── middleware/   # HTTP middleware
│   └── observability/
├── frontend/         # Client-side only (browser / Svelte components)
│   └── api/          # API client wrappers
└── shared/           # Universal — works in both environments
    ├── crypto/       # Cryptography utilities
    ├── domains/      # Domain logic (auth, payments, user)
    ├── entitlements/ # Entitlement management
    ├── feature-flags/
    ├── security/
    ├── types/        # TypeScript type definitions
    └── utils/
```

---

## Usage

### Shared types

```typescript
import type { Product, Service, Order } from '@komodo-forge-sdk/typescript/shared/types';
import { domains } from '@komodo-forge-sdk/typescript/shared';

const product: Product = { id: '1', slug: 'item-001', name: 'My Product' };
domains.auth.validateToken(token);
```

### Backend (SvelteKit `+server.ts`, hooks)

```typescript
import { logging } from '@komodo-forge-sdk/typescript/backend';

logging.runtime.logger.info('Handler called', { route: '/products' });
```

### Frontend (Svelte components)

```typescript
import { api } from '@komodo-forge-sdk/typescript/frontend';

const product = await api.fetchProduct(id);
```

---

## Available Types

| Type | Description |
|------|-------------|
| `Product` | Product catalog item |
| `Service` | Service catalog item |
| `Order` | Order record |
| `MarketingContent` | Marketing content block |
| `Campaign` | Marketing campaign |

---

## Development

```bash
cd apis/komodo-forge-sdk-ts
bun run build     # compile TypeScript → dist/
bun run clean     # remove dist/
bun run rebuild   # clean + build
```

---

## Publishing

Internal use only. To publish to a private registry:

```bash
bun run build
pnpm publish --registry=<your-private-registry-url>
```

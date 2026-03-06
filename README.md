[![npm](https://img.shields.io/npm/v/@wintyx/x402-sdk)](https://www.npmjs.com/package/@wintyx/x402-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue)](https://www.typescriptlang.org/)
[![x402 Protocol](https://img.shields.io/badge/Protocol-x402-orange)](https://x402bazaar.org)

# @wintyx/x402-sdk

TypeScript SDK for integrating [x402 Bazaar](https://x402bazaar.org) APIs into AI agents.

Handles the full HTTP 402 payment cycle automatically: detect 402 response, pay USDC on-chain (Base or SKALE), retry with transaction proof. **Zero configuration required** — the SDK auto-generates and encrypts a wallet if no private key is provided.

## Installation

```bash
npm install @wintyx/x402-sdk
```

## Quick Start

```ts
import { createClient } from '@wintyx/x402-sdk';

// Zero-config: auto-generates an encrypted wallet on first use
const client = createClient({ chain: 'base' });

// Or provide your own private key
// const client = createClient({
//   privateKey: process.env.AGENT_PRIVATE_KEY as `0x${string}`,
//   chain: 'base',
// });

// List available APIs
const services = await client.listServices();

// Call an API with automatic payment (detects 402, pays USDC, retries)
const result = await client.call('service-id', { text: 'Hello world' });

// Check wallet balance
const balance = await client.getBalance();
console.log(`${balance} USDC available`);
```

## Auto-Wallet

When no `privateKey` is provided, the SDK automatically:

1. **Generates** a new Ethereum private key
2. **Encrypts** it with AES-256-GCM (key derived from machine identity: hostname + username + homedir)
3. **Persists** it to `~/.x402-bazaar/sdk-wallet.json`
4. **Reuses** the same wallet on subsequent calls

The wallet file is distinct from the MCP wallet (`wallet.json`) to avoid collisions. Fund it with USDC to start calling paid APIs.

```ts
import { createClient, loadOrCreateWallet } from '@wintyx/x402-sdk';

// Auto-wallet (recommended for agents)
const client = createClient({ chain: 'base' });
console.log(`Wallet: ${client.walletAddress}`);

// Or manage the wallet directly
const wallet = loadOrCreateWallet();
console.log(`Address: ${wallet.address}, new: ${wallet.isNew}`);
```

## API

### `createClient(config)` — Factory function

The recommended way to create a client.

```ts
const client = createClient({
  chain: 'base',
  budget: { max: 5.0, period: 'daily' },
  timeout: 30000,
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `privateKey` | `` `0x${string}` `` | auto-generated | Agent wallet private key (optional — auto-generates encrypted wallet if omitted) |
| `chain` | `'base' \| 'base-sepolia' \| 'skale'` | `'base'` | Blockchain network |
| `network` | same as `chain` | `'base'` | Alias for `chain` |
| `baseUrl` | `string` | `https://x402-api.onrender.com` | Bazaar API URL |
| `budget` | `{ max: number, period: 'daily'\|'weekly'\|'monthly' }` | unlimited | Spending cap (local tracking) |
| `timeout` | `number` | `30000` | HTTP timeout in ms |
| `walletPath` | `string` | `~/.x402-bazaar/sdk-wallet.json` | Custom path for auto-generated wallet file |

### `client.call(serviceId, params?, options?)`

Calls a Bazaar service by its UUID via the proxy endpoint (`POST /api/call/:serviceId`). If the API returns 402, the SDK pays automatically and retries. The server handles the 95/5 revenue split.

```ts
// Simple call
const weather = await client.call('uuid-weather', { city: 'Paris' })

// With options
const image = await client.call('uuid-image', { prompt: 'A sunset' }, {
  timeout: 60000,
  maxRetries: 2,
})
```

### `client.listServices()`

Returns all services available on the Bazaar.

```ts
const services = await client.listServices();
// ServiceInfo[] with id, name, description, url, price_usdc, category, ...
```

### `client.searchServices(query)`

Searches services by name, description, category, or tags (client-side filtering).

```ts
const aiServices = await client.searchServices('image generation');
const weatherApis = await client.searchServices('weather');
```

### `client.getService(serviceId)`

Returns a single service by its UUID.

```ts
const service = await client.getService('uuid-weather');
// { id, name, description, url, price_usdc, category, ... }
```

### `client.getBalance()`

Returns the USDC balance of the agent wallet on the configured chain.

```ts
const balance = await client.getBalance();  // e.g. 4.523
```

### `client.getBudgetStatus()`

Returns current budget usage (local tracking, resets automatically each period).

```ts
const budget = client.getBudgetStatus();
// {
//   spent: 0.15,
//   limit: 1.0,
//   remaining: 0.85,
//   period: 'daily',
//   callCount: 12,
//   resetAt: Date | null
// }
```

### `client.health()`

Checks the Bazaar backend status.

```ts
const health = await client.health();
// { status: 'ok', version: '1.0.0', network: 'Base', uptime_seconds: 3600 }
```

### `client.callDirect(endpoint, params?, options?)`

Calls an API endpoint directly (bypasses the proxy). Use `call()` instead when possible to benefit from the server-side 95/5 revenue split.

```ts
const result = await client.callDirect('/api/search', { q: 'AI tools' });
```

### `client.discover(endpoint?)`

Backward-compatible method. Without argument: returns all services. With an endpoint path: returns the matching service.

```ts
const services = await client.discover();           // ServiceInfo[]
const service  = await client.discover('/api/search'); // ServiceInfo
```

## Error Handling

```ts
import {
  BudgetExceededError,
  InsufficientBalanceError,
  PaymentError,
  ApiError,
  NetworkError,
  TimeoutError,
} from '@wintyx/x402-sdk';

try {
  const result = await client.call('uuid-image', { prompt: 'A cat' });
} catch (err) {
  if (err instanceof BudgetExceededError) {
    console.error(`Budget ${err.period} depleted: ${err.spent}/${err.limit} USDC`);
  } else if (err instanceof InsufficientBalanceError) {
    console.error(`Wallet needs ${err.required} USDC, only has ${err.available}`);
  } else if (err instanceof PaymentError) {
    console.error('USDC transfer failed:', err.message);
  } else if (err instanceof ApiError) {
    console.error(`API error ${err.statusCode} on ${err.endpoint}`);
  } else if (err instanceof TimeoutError) {
    console.error('Request timed out');
  } else if (err instanceof NetworkError) {
    console.error('Network error:', err.message);
  }
}
```

## Supported Networks

| Network | Chain ID | USDC Contract | Gas |
|---------|----------|---------------|-----|
| `base` | 8453 | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | ~$0.001 |
| `base-sepolia` | 84532 | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | Testnet |
| `skale` | 1187947933 | `0x85889c8c714505E0c94b30fcfcF64fE3Ac8FCb20` | ~$0.0007 (CREDITS) |

SKALE on Base offers ultra-low gas fees via CREDITS token (~$0.0007 per transfer). Each RPC has fallback endpoints configured automatically.

## Protocol Flow

```
1. client.call('uuid-weather', { city: 'Paris' })
   └─> GET https://x402-api.onrender.com/api/call/uuid-weather?city=Paris
       └─> 402 Payment Required
           {
             payment_details: {
               amount: 0.002,
               recipient: '0xfb1c...',
               networks: [{ network: 'base', chainId: 8453, ... }]
             }
           }

2. SDK pays automatically
   └─> USDC.transfer(recipient, 0.002 USDC) on Base
       └─> txHash: 0xabc123...

3. SDK retries with payment proof
   └─> GET /api/call/uuid-weather?city=Paris
       Headers: X-Payment-TxHash: 0xabc123...
                X-Payment-Chain: base
       └─> 200 OK { temperature: 18, condition: 'Sunny', ... }
```

## CommonJS Support

The SDK ships both ESM and CJS builds:

```js
// CommonJS
const { createClient } = require('@wintyx/x402-sdk');
```

```ts
// ESM / TypeScript
import { createClient } from '@wintyx/x402-sdk';
```

## Available APIs (71+ endpoints)

| Endpoint | Price | Description |
|----------|-------|-------------|
| `/api/search` | 0.005 USDC | Web search (DuckDuckGo) |
| `/api/scrape` | 0.005 USDC | Web scraper |
| `/api/image` | 0.05 USDC | Image generation (DALL-E 3) |
| `/api/weather` | 0.002 USDC | Weather data |
| `/api/translate` | 0.005 USDC | Text translation |
| `/api/summarize` | 0.01 USDC | Text summarization (GPT) |
| `/api/sentiment` | 0.005 USDC | Sentiment analysis |
| `/api/geocoding` | 0.002 USDC | Geocoding |
| `/api/crypto` | 0.001 USDC | Crypto prices |
| `/api/stocks` | 0.005 USDC | Stock prices |
| `/api/news` | 0.005 USDC | Latest news |
| ... | | 60+ more |

Full list: [x402bazaar.org/services](https://x402bazaar.org/services) or `client.listServices()`

## Ecosystem

| Repository | Description |
|---|---|
| **[x402-backend](https://github.com/Wintyx57/x402-backend)** | API server, 69 native endpoints, payment middleware, MCP server |
| **[x402-frontend](https://github.com/Wintyx57/x402-frontend)** | React + TypeScript marketplace UI |
| **[x402-bazaar-cli](https://github.com/Wintyx57/x402-bazaar-cli)** | `npx x402-bazaar` — CLI with 7 commands |
| **[x402-sdk](https://github.com/Wintyx57/x402-sdk)** | TypeScript SDK for AI agents (this repo) |
| **[x402-langchain](https://github.com/Wintyx57/x402-langchain)** | Python LangChain tools |
| **[n8n-nodes-x402-bazaar](https://github.com/Wintyx57/n8n-nodes-x402-bazaar)** | n8n community node |

**Live:** [x402bazaar.org](https://x402bazaar.org) | **API:** [x402-api.onrender.com](https://x402-api.onrender.com)

## License

MIT

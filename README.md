# @x402/sdk

TypeScript SDK for integrating [x402 Bazaar](https://x402bazaar.org) APIs into AI agents — automatic USDC payment on Base.

## Installation

```bash
npm install @x402/sdk
```

## Quick Start

```ts
import { BazaarClient } from '@x402/sdk'

const client = new BazaarClient({
  privateKey: process.env.AGENT_PRIVATE_KEY as `0x${string}`,
  budget: { max: 1.0, period: 'daily' },  // optional: 1 USDC/day max
})

// The SDK handles 402 responses and USDC payment automatically
const result = await client.call('/api/search', { q: 'AI tools 2025' })
console.log(result)
```

## API

### `new BazaarClient(config)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `privateKey` | `0x${string}` | required | Agent wallet private key |
| `baseUrl` | `string` | `https://x402-api.onrender.com` | Bazaar API URL |
| `network` | `'base' \| 'base-sepolia' \| 'skale'` | `'base'` | Blockchain network |
| `budget` | `{ max: number, period: 'daily'\|'weekly'\|'monthly' }` | unlimited | Spending cap |
| `timeout` | `number` | `30000` | HTTP timeout in ms |

### `client.call(endpoint, params?, options?)`

Calls an API endpoint. If the API returns 402, the SDK pays automatically and retries.

```ts
// Simple call
const weather = await client.call('/api/weather', { city: 'Paris' })

// With options
const image = await client.call('/api/image', { prompt: 'A sunset' }, {
  timeout: 60000,
  maxRetries: 2,
})
```

### `client.discover(endpoint?)`

Lists available APIs or gets details for a specific endpoint.

```ts
// All services
const services = await client.discover()

// Specific service
const searchService = await client.discover('/api/search')
```

### `client.getBudgetStatus()`

Returns current budget usage (local tracking, resets automatically).

```ts
const budget = client.getBudgetStatus()
// {
//   spent: 0.15,
//   limit: 1.0,
//   remaining: 0.85,
//   period: 'daily',
//   callCount: 12,
//   resetAt: Date
// }
```

### `client.getBalance()`

Returns the USDC balance of the agent wallet.

```ts
const balance = await client.getBalance()  // e.g. 4.523
```

### `client.health()`

Checks the Bazaar backend status.

```ts
const health = await client.health()
// { status: 'ok', version: '1.0.0', network: 'Base', uptime_seconds: 3600 }
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
} from '@x402/sdk'

try {
  const result = await client.call('/api/image', { prompt: 'A cat' })
} catch (err) {
  if (err instanceof BudgetExceededError) {
    console.error(`Budget ${err.period} depleted: ${err.spent}/${err.limit} USDC`)
  } else if (err instanceof InsufficientBalanceError) {
    console.error(`Wallet needs ${err.required} USDC, only has ${err.available}`)
  } else if (err instanceof PaymentError) {
    console.error('USDC transfer failed:', err.message)
  } else if (err instanceof ApiError) {
    console.error(`API error ${err.statusCode} on ${err.endpoint}`)
  } else if (err instanceof TimeoutError) {
    console.error('Request timed out')
  }
}
```

## Available APIs (69+ endpoints)

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
| ... | | 60+ more |

Full list: [x402bazaar.org](https://x402bazaar.org) or `client.discover()`

## Protocol

x402 Bazaar uses the HTTP 402 Payment Required protocol:

1. Agent calls an API endpoint
2. Server responds with `402` and `payment_details` (amount, recipient, network)
3. SDK sends USDC transfer on-chain (Base mainnet by default)
4. SDK retries with `X-Payment-TxHash` header
5. Server verifies the transaction and returns the result

## Links

- Website: https://x402bazaar.org
- Backend: https://x402-api.onrender.com
- CLI: `npm install -g x402-bazaar`
- MCP Server: for Claude/Cursor integration

## License

MIT

/**
 * Tests unitaires — src/types.ts
 * Validation de la forme des interfaces et des valeurs acceptées.
 * Ces tests vérifient les invariants de structure au runtime et servent
 * de garde-fou contre les regressions de types.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// On importe uniquement les types — les checks runtime sont sur des objects littéraux
import type {
  Network,
  BudgetPeriod,
  BudgetConfig,
  BazaarClientConfig,
  CallOptions,
  PaymentDetails,
  NetworkInfo,
  PaymentRequiredResponse,
  ServiceInfo,
  BudgetStatus,
  HealthResponse,
  PaymentResult,
  FundingInfo,
} from "../src/types.js";

// ─── Helpers de validation de forme (runtime) ─────────────────────────────────

function isValidNetwork(v: unknown): v is Network {
  return (
    v === "base" || v === "base-sepolia" || v === "skale" || v === "polygon"
  );
}

function isValidBudgetPeriod(v: unknown): v is BudgetPeriod {
  return v === "daily" || v === "weekly" || v === "monthly";
}

// ─── Network ─────────────────────────────────────────────────────────────────

describe("Network type — valid values", () => {
  it('should accept "base" as a valid Network', () => {
    assert.ok(isValidNetwork("base"));
  });

  it('should accept "base-sepolia" as a valid Network', () => {
    assert.ok(isValidNetwork("base-sepolia"));
  });

  it('should accept "skale" as a valid Network', () => {
    assert.ok(isValidNetwork("skale"));
  });

  it('should accept "polygon" as a valid Network', () => {
    assert.ok(isValidNetwork("polygon"));
  });

  it("should reject unknown strings as Network", () => {
    assert.ok(!isValidNetwork("ethereum"));
    assert.ok(!isValidNetwork("arbitrum"));
    assert.ok(!isValidNetwork(""));
    assert.ok(!isValidNetwork(null));
    assert.ok(!isValidNetwork(42));
  });

  it("should have exactly 4 valid Network values", () => {
    const validNetworks = ["base", "base-sepolia", "skale", "polygon"];
    assert.equal(validNetworks.filter(isValidNetwork).length, 4);
  });
});

// ─── BudgetPeriod ─────────────────────────────────────────────────────────────

describe("BudgetPeriod type — valid values", () => {
  it('should accept "daily" as a valid BudgetPeriod', () => {
    assert.ok(isValidBudgetPeriod("daily"));
  });

  it('should accept "weekly" as a valid BudgetPeriod', () => {
    assert.ok(isValidBudgetPeriod("weekly"));
  });

  it('should accept "monthly" as a valid BudgetPeriod', () => {
    assert.ok(isValidBudgetPeriod("monthly"));
  });

  it("should reject unknown strings as BudgetPeriod", () => {
    assert.ok(!isValidBudgetPeriod("hourly"));
    assert.ok(!isValidBudgetPeriod("yearly"));
    assert.ok(!isValidBudgetPeriod(""));
  });
});

// ─── BudgetConfig ─────────────────────────────────────────────────────────────

describe("BudgetConfig interface — shape", () => {
  it("should accept a valid BudgetConfig object", () => {
    const config: BudgetConfig = { max: 10, period: "daily" };
    assert.equal(config.max, 10);
    assert.equal(config.period, "daily");
  });

  it("should allow fractional max values", () => {
    const config: BudgetConfig = { max: 0.005, period: "weekly" };
    assert.equal(config.max, 0.005);
  });

  it("should accept Infinity as max", () => {
    const config: BudgetConfig = { max: Infinity, period: "monthly" };
    assert.equal(config.max, Infinity);
  });
});

// ─── BazaarClientConfig ───────────────────────────────────────────────────────

describe("BazaarClientConfig interface — shape", () => {
  it("should be constructible with only a privateKey", () => {
    const config: BazaarClientConfig = {
      privateKey:
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    };
    assert.ok(config.privateKey!.startsWith("0x"));
  });

  it("should accept chain and network fields", () => {
    const config: BazaarClientConfig = {
      privateKey:
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      chain: "polygon",
      network: "base",
    };
    assert.equal(config.chain, "polygon");
    assert.equal(config.network, "base");
  });

  it("should accept optional baseUrl, timeout, budget, walletPath, validationSecret", () => {
    const config: BazaarClientConfig = {
      privateKey:
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      baseUrl: "https://custom.bazaar.io",
      timeout: 15000,
      budget: { max: 5, period: "daily" },
      walletPath: "/tmp/my-wallet.json",
      validationSecret: "my-secret",
    };
    assert.equal(config.baseUrl, "https://custom.bazaar.io");
    assert.equal(config.timeout, 15000);
    assert.equal(config.budget!.max, 5);
    assert.equal(config.validationSecret, "my-secret");
  });

  it("should allow absent privateKey (auto-wallet mode)", () => {
    const config: BazaarClientConfig = { chain: "skale" };
    assert.equal(config.privateKey, undefined);
  });
});

// ─── CallOptions ─────────────────────────────────────────────────────────────

describe("CallOptions interface — shape", () => {
  it("should accept empty options", () => {
    const opts: CallOptions = {};
    assert.equal(opts.timeout, undefined);
    assert.equal(opts.maxRetries, undefined);
  });

  it("should accept timeout and maxRetries", () => {
    const opts: CallOptions = { timeout: 5000, maxRetries: 3 };
    assert.equal(opts.timeout, 5000);
    assert.equal(opts.maxRetries, 3);
  });
});

// ─── NetworkInfo ──────────────────────────────────────────────────────────────

describe("NetworkInfo interface — shape", () => {
  it("should accept a complete NetworkInfo object", () => {
    const info: NetworkInfo = {
      network: "base",
      chainId: 8453,
      label: "Base",
      usdc_contract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      explorer: "https://basescan.org",
      gas: "~$0.001",
    };
    assert.equal(info.chainId, 8453);
    assert.equal(info.network, "base");
  });
});

// ─── PaymentDetails ───────────────────────────────────────────────────────────

describe("PaymentDetails interface — shape", () => {
  it("should accept a full PaymentDetails object", () => {
    const details: PaymentDetails = {
      amount: 0.005,
      currency: "USDC",
      network: "base",
      chainId: 8453,
      networks: [
        {
          network: "base",
          chainId: 8453,
          label: "Base",
          usdc_contract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          explorer: "https://basescan.org",
          gas: "~$0.001",
        },
      ],
      recipient: "0xfb1c478BD5567BdcD39782E0D6D23418bFda2430",
      accepted: ["USDC"],
      action: "search",
    };
    assert.equal(details.amount, 0.005);
    assert.equal(details.networks.length, 1);
    assert.equal(details.networks[0]!.chainId, 8453);
  });
});

// ─── PaymentRequiredResponse ──────────────────────────────────────────────────

describe("PaymentRequiredResponse interface — shape", () => {
  it("should accept a full 402 response object", () => {
    const resp: PaymentRequiredResponse = {
      error: "Payment Required",
      message: "This action costs 0.005 USDC.",
      payment_details: {
        amount: 0.005,
        currency: "USDC",
        network: "base",
        chainId: 8453,
        networks: [],
        recipient: "0xfb1c478BD5567BdcD39782E0D6D23418bFda2430",
        accepted: ["USDC"],
        action: "call",
      },
    };
    assert.equal(resp.error, "Payment Required");
    assert.equal(resp.extensions, undefined);
  });

  it("should accept optional extensions field", () => {
    const resp: PaymentRequiredResponse = {
      error: "Payment Required",
      message: "costs 0.005 USDC",
      payment_details: {
        amount: 0.005,
        currency: "USDC",
        network: "base",
        chainId: 8453,
        networks: [],
        recipient: "0xabc",
        accepted: [],
        action: "x",
      },
      extensions: { custom: true },
    };
    assert.deepEqual(resp.extensions, { custom: true });
  });
});

// ─── ServiceInfo ─────────────────────────────────────────────────────────────

describe("ServiceInfo interface — shape", () => {
  it("should accept required fields only", () => {
    const svc: ServiceInfo = {
      id: "uuid-abc",
      name: "My API",
      description: "Does things",
      url: "https://example.com",
      price_usdc: 0.01,
    };
    assert.equal(svc.id, "uuid-abc");
    assert.equal(svc.price_usdc, 0.01);
  });

  it("should accept all optional fields", () => {
    const svc: ServiceInfo = {
      id: "uuid-full",
      name: "Full API",
      description: "Full description",
      url: "https://example.com",
      price_usdc: 0.05,
      endpoint: "/api/v1/call",
      category: "ai",
      network: "polygon",
      owner_address: "0xdeadbeef",
      owner_wallet: "0xdeadbeef",
      is_native: true,
      verified_status: "verified",
      tags: ["ai", "nlp"],
      method: "POST",
      created_at: "2025-01-01T00:00:00.000Z",
    };
    assert.equal(svc.tags!.length, 2);
    assert.equal(svc.is_native, true);
  });
});

// ─── BudgetStatus ─────────────────────────────────────────────────────────────

describe("BudgetStatus interface — shape", () => {
  it("should accept a full BudgetStatus with a Date resetAt", () => {
    const status: BudgetStatus = {
      spent: 2.5,
      limit: 10,
      remaining: 7.5,
      period: "daily",
      callCount: 5,
      resetAt: new Date("2025-01-02T00:00:00.000Z"),
    };
    assert.equal(status.remaining, 7.5);
    assert.ok(status.resetAt instanceof Date);
  });

  it("should accept null resetAt when budget is unlimited", () => {
    const status: BudgetStatus = {
      spent: 0,
      limit: Infinity,
      remaining: Infinity,
      period: "monthly",
      callCount: 0,
      resetAt: null,
    };
    assert.equal(status.resetAt, null);
  });

  it("should compute remaining = limit - spent", () => {
    const spent = 3.14;
    const limit = 10;
    const status: BudgetStatus = {
      spent,
      limit,
      remaining: limit - spent,
      period: "weekly",
      callCount: 7,
      resetAt: null,
    };
    assert.ok(Math.abs(status.remaining - 6.86) < 1e-10);
  });
});

// ─── HealthResponse ───────────────────────────────────────────────────────────

describe("HealthResponse interface — shape", () => {
  it("should accept required fields status, version, network", () => {
    const health: HealthResponse = {
      status: "ok",
      version: "1.0.3",
      network: "base",
    };
    assert.equal(health.status, "ok");
  });

  it("should accept optional uptime_seconds and node_version", () => {
    const health: HealthResponse = {
      status: "ok",
      version: "1.0.3",
      network: "base",
      uptime_seconds: 12345,
      node_version: "v22.0.0",
    };
    assert.equal(health.uptime_seconds, 12345);
    assert.equal(health.node_version, "v22.0.0");
  });
});

// ─── PaymentResult ────────────────────────────────────────────────────────────

describe("PaymentResult interface — shape", () => {
  it("should accept a valid PaymentResult", () => {
    const result: PaymentResult = {
      txHash:
        "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab" as `0x${string}`,
      explorer: "https://basescan.org/tx/0xabcdef...",
      from: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
      amount: 0.005,
    };
    assert.ok(result.txHash.startsWith("0x"));
    assert.ok(result.explorer.includes("basescan"));
    assert.equal(result.amount, 0.005);
  });
});

// ─── FundingInfo ──────────────────────────────────────────────────────────────

describe("FundingInfo interface — shape", () => {
  it("should accept a valid FundingInfo object", () => {
    const info: FundingInfo = {
      bridgeUrl: "https://bridge.base.org",
      walletAddress: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
      supportedChains: ["base", "ethereum"],
      bridgeTime: "~5 minutes",
      minimumAmount: "1 USDC",
      howItWorks:
        "Bridge USDC from Ethereum to Base using the official bridge.",
    };
    assert.equal(info.supportedChains.length, 2);
    assert.equal(info.minimumAmount, "1 USDC");
  });
});

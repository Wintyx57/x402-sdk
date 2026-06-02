/**
 * Lot L-JS — Split mode payment tests
 *
 * Verifies that when the backend sends a 402 with split details,
 * the SDK sends two separate USDC transfers (provider 95% + platform 5%)
 * and retries the request with X-Payment-TxHash-Provider header.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { BazaarClient } from "../src/client.js";
import { PaymentNotChargedError, ApiError } from "../src/errors.js";

// ─── Test fixtures ────────────────────────────────────────────────────────────

const TEST_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as `0x${string}`;

const PLATFORM_WALLET = "0xfb1c478BD5567BdcD39782E0D6D23418bFda2430";
const PROVIDER_WALLET = "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B";
const FAKE_TX_PROVIDER =
  "0xaaaa000000000000000000000000000000000000000000000000000000000001" as `0x${string}`;
const FAKE_TX_PLATFORM =
  "0xbbbb000000000000000000000000000000000000000000000000000000000002" as `0x${string}`;

// ─── Mock helpers ─────────────────────────────────────────────────────────────

type MockFetchFn = (
  url: string,
  init?: RequestInit,
) => Promise<{ status: number; ok: boolean; json: () => Promise<unknown> }>;

function setFetch(fn: MockFetchFn) {
  (global as unknown as { fetch: MockFetchFn }).fetch = fn;
}

function restoreFetch() {
  (global as unknown as Record<string, unknown>).fetch = undefined;
}

/**
 * Patches PaymentHandler.sendUsdc so it never touches the real RPC.
 * Returns an array that captures each { to, amount } call in order.
 */
function mockSendUsdc(
  handler: InstanceType<typeof import("../src/payment.js").PaymentHandler>,
  hashes: readonly `0x${string}`[],
) {
  const calls: { to: string; amount: number }[] = [];
  let idx = 0;

  // Access the handler via prototype injection — keeps the rest of the class intact
  (
    handler as unknown as {
      sendUsdc: (to: string, amount: number) => Promise<unknown>;
    }
  ).sendUsdc = async (to: string, amount: number) => {
    calls.push({ to, amount });
    const txHash = hashes[idx++] ?? hashes[hashes.length - 1]!;
    return {
      txHash,
      explorer: `https://basescan.org/tx/${txHash}`,
      from: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      amount,
    };
  };

  return calls;
}

function getPaymentHandler(client: BazaarClient) {
  return (
    client as unknown as {
      paymentHandler: InstanceType<
        typeof import("../src/payment.js").PaymentHandler
      >;
    }
  ).paymentHandler;
}

// ─── 402 fixture with split details ──────────────────────────────────────────

function make402Split(providerAmount: number, platformAmount: number) {
  return {
    status: 402,
    ok: false,
    json: async () => ({
      error: "Payment Required",
      message: "This action costs USDC.",
      payment_details: {
        amount: providerAmount + platformAmount,
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
        recipient: PLATFORM_WALLET,
        accepted: ["USDC"],
        action: "call",
        payment_mode: "split_native",
        provider_wallet: PROVIDER_WALLET,
        split: {
          provider_amount_usdc: providerAmount,
          platform_amount_usdc: platformAmount,
          provider_wallet: PROVIDER_WALLET,
          platform_wallet: PLATFORM_WALLET,
        },
      },
    }),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("_handlePayment — split_native mode", () => {
  const BASE_CONFIG = {
    privateKey: TEST_PRIVATE_KEY,
    baseUrl: "https://mock.bazaar.test",
    chain: "base" as const,
  };

  it("sends two transfers when split details are present", async () => {
    const client = new BazaarClient(BASE_CONFIG);
    const handler = getPaymentHandler(client);
    const calls = mockSendUsdc(handler, [FAKE_TX_PROVIDER, FAKE_TX_PLATFORM]);

    setFetch(
      (() => {
        let call = 0;
        return async (_url: string, _init?: RequestInit) => {
          call++;
          if (call === 1) return make402Split(0.0095, 0.0005);
          return {
            status: 200,
            ok: true,
            json: async () => ({ success: true, data: "result" }),
          };
        };
      })(),
    );

    try {
      await client.call("svc-id", { q: "test" });
      assert.equal(
        calls.length,
        2,
        "should have made exactly 2 sendUsdc calls",
      );
      assert.equal(
        calls[0]!.to.toLowerCase(),
        PROVIDER_WALLET.toLowerCase(),
        "first transfer must go to provider",
      );
      assert.equal(calls[0]!.amount, 0.0095);
      assert.equal(
        calls[1]!.to.toLowerCase(),
        PLATFORM_WALLET.toLowerCase(),
        "second transfer must go to platform",
      );
      assert.equal(calls[1]!.amount, 0.0005);
    } finally {
      restoreFetch();
    }
  });

  it("retries with X-Payment-TxHash-Provider header (not X-Payment-TxHash)", async () => {
    const client = new BazaarClient(BASE_CONFIG);
    const handler = getPaymentHandler(client);
    mockSendUsdc(handler, [FAKE_TX_PROVIDER, FAKE_TX_PLATFORM]);

    const retryHeaders: Record<string, string> = {};

    setFetch(
      (() => {
        let call = 0;
        return async (_url: string, init?: RequestInit) => {
          call++;
          if (call === 1) return make402Split(0.0095, 0.0005);
          // Capture headers from the retry request
          Object.assign(
            retryHeaders,
            (init?.headers ?? {}) as Record<string, string>,
          );
          return {
            status: 200,
            ok: true,
            json: async () => ({ success: true }),
          };
        };
      })(),
    );

    try {
      await client.call("svc-id", {});
      assert.ok(
        "X-Payment-TxHash-Provider" in retryHeaders,
        "retry must include X-Payment-TxHash-Provider",
      );
      assert.equal(retryHeaders["X-Payment-TxHash-Provider"], FAKE_TX_PROVIDER);
      assert.ok(
        "X-Payment-Chain" in retryHeaders,
        "retry must include X-Payment-Chain",
      );
      assert.ok(
        !("X-Payment-TxHash" in retryHeaders) ||
          retryHeaders["X-Payment-TxHash"] === undefined,
        "split mode must NOT use plain X-Payment-TxHash",
      );
    } finally {
      restoreFetch();
    }
  });

  it("includes X-Payment-TxHash-Platform when platform transfer succeeds", async () => {
    const client = new BazaarClient(BASE_CONFIG);
    const handler = getPaymentHandler(client);
    mockSendUsdc(handler, [FAKE_TX_PROVIDER, FAKE_TX_PLATFORM]);

    const retryHeaders: Record<string, string> = {};

    setFetch(
      (() => {
        let call = 0;
        return async (_url: string, init?: RequestInit) => {
          call++;
          if (call === 1) return make402Split(0.0095, 0.0005);
          Object.assign(
            retryHeaders,
            (init?.headers ?? {}) as Record<string, string>,
          );
          return {
            status: 200,
            ok: true,
            json: async () => ({ success: true }),
          };
        };
      })(),
    );

    try {
      await client.call("svc-id", {});
      assert.equal(
        retryHeaders["X-Payment-TxHash-Platform"],
        FAKE_TX_PLATFORM,
        "retry must include X-Payment-TxHash-Platform",
      );
    } finally {
      restoreFetch();
    }
  });

  it("succeeds even if platform transfer fails (best-effort)", async () => {
    const client = new BazaarClient(BASE_CONFIG);
    const handler = getPaymentHandler(client);

    // Provider succeeds, platform throws
    let callIdx = 0;
    (
      handler as unknown as {
        sendUsdc: (to: string, amount: number) => Promise<unknown>;
      }
    ).sendUsdc = async (to: string, amount: number) => {
      callIdx++;
      if (callIdx === 1) {
        return {
          txHash: FAKE_TX_PROVIDER,
          explorer: "",
          from: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
          amount,
        };
      }
      throw new Error("platform transfer failed");
    };

    setFetch(
      (() => {
        let call = 0;
        return async (_url: string, _init?: RequestInit) => {
          call++;
          if (call === 1) return make402Split(0.0095, 0.0005);
          return {
            status: 200,
            ok: true,
            json: async () => ({ success: true }),
          };
        };
      })(),
    );

    try {
      const result = await client.call("svc-id", {});
      assert.equal((result as { success: boolean }).success, true);
    } finally {
      restoreFetch();
    }
  });

  it("infers split mode from presence of split field (no explicit payment_mode)", async () => {
    const client = new BazaarClient(BASE_CONFIG);
    const handler = getPaymentHandler(client);
    const calls = mockSendUsdc(handler, [FAKE_TX_PROVIDER, FAKE_TX_PLATFORM]);

    setFetch(
      (() => {
        let call = 0;
        return async (_url: string, _init?: RequestInit) => {
          call++;
          if (call === 1) {
            // Same as make402Split but without payment_mode field
            return {
              status: 402,
              ok: false,
              json: async () => ({
                error: "Payment Required",
                message: "costs USDC",
                payment_details: {
                  amount: 0.01,
                  currency: "USDC",
                  network: "base",
                  chainId: 8453,
                  networks: [],
                  recipient: PLATFORM_WALLET,
                  accepted: ["USDC"],
                  action: "call",
                  // No payment_mode field — SDK must infer from split presence
                  split: {
                    provider_amount_usdc: 0.0095,
                    platform_amount_usdc: 0.0005,
                    provider_wallet: PROVIDER_WALLET,
                    platform_wallet: PLATFORM_WALLET,
                  },
                },
              }),
            };
          }
          return {
            status: 200,
            ok: true,
            json: async () => ({ success: true }),
          };
        };
      })(),
    );

    try {
      await client.call("svc-id", {});
      assert.equal(
        calls.length,
        2,
        "inferred split mode must still produce 2 transfers",
      );
    } finally {
      restoreFetch();
    }
  });

  it("always sends X-Agent-Wallet in retry headers", async () => {
    const client = new BazaarClient(BASE_CONFIG);
    const handler = getPaymentHandler(client);
    mockSendUsdc(handler, [FAKE_TX_PROVIDER, FAKE_TX_PLATFORM]);

    const retryHeaders: Record<string, string> = {};

    setFetch(
      (() => {
        let call = 0;
        return async (_url: string, init?: RequestInit) => {
          call++;
          if (call === 1) return make402Split(0.0095, 0.0005);
          Object.assign(
            retryHeaders,
            (init?.headers ?? {}) as Record<string, string>,
          );
          return {
            status: 200,
            ok: true,
            json: async () => ({ success: true }),
          };
        };
      })(),
    );

    try {
      await client.call("svc-id", {});
      assert.ok(
        "X-Agent-Wallet" in retryHeaders,
        "X-Agent-Wallet must be present in split-mode retry",
      );
    } finally {
      restoreFetch();
    }
  });

  it("lève ApiError si split mode mais provider_wallet manquant", async () => {
    const client = new BazaarClient(BASE_CONFIG);
    const handler = getPaymentHandler(client);
    mockSendUsdc(handler, [FAKE_TX_PROVIDER]);

    setFetch(async () => ({
      status: 402,
      ok: false,
      json: async () => ({
        error: "Payment Required",
        message: "costs USDC",
        payment_details: {
          amount: 0.01,
          currency: "USDC",
          network: "base",
          chainId: 8453,
          networks: [],
          recipient: PLATFORM_WALLET,
          accepted: ["USDC"],
          action: "call",
          payment_mode: "split_native",
          split: {
            provider_amount_usdc: 0.0095,
            platform_amount_usdc: 0.0005,
            // provider_wallet intentionally absent
            platform_wallet: PLATFORM_WALLET,
          },
        },
      }),
    }));

    try {
      await assert.rejects(
        () => client.call("svc-id", {}),
        (err: unknown) => err instanceof ApiError,
      );
    } finally {
      restoreFetch();
    }
  });
});

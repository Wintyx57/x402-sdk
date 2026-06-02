/**
 * Lot L-JS — _payment_status handling tests
 *
 * Verifies that HTTP 200 responses with _payment_status: 'not_charged' or
 * 'refunded' are NOT silently treated as success — the SDK must throw
 * PaymentNotChargedError so callers can detect the problem.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { BazaarClient } from "../src/client.js";
import { PaymentNotChargedError } from "../src/errors.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const TEST_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as `0x${string}`;

const PLATFORM_WALLET = "0xfb1c478BD5567BdcD39782E0D6D23418bFda2430";
const FAKE_TX =
  "0xcccc000000000000000000000000000000000000000000000000000000000003" as `0x${string}`;

const BASE_CONFIG = {
  privateKey: TEST_PRIVATE_KEY,
  baseUrl: "https://mock.bazaar.test",
  chain: "base" as const,
};

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

function getPaymentHandler(client: BazaarClient) {
  return (
    client as unknown as {
      paymentHandler: InstanceType<
        typeof import("../src/payment.js").PaymentHandler
      >;
    }
  ).paymentHandler;
}

function mockSendUsdcAlwaysSucceeds(
  handler: InstanceType<typeof import("../src/payment.js").PaymentHandler>,
) {
  (
    handler as unknown as {
      sendUsdc: (to: string, amount: number) => Promise<unknown>;
    }
  ).sendUsdc = async (_to: string, amount: number) => ({
    txHash: FAKE_TX,
    explorer: `https://basescan.org/tx/${FAKE_TX}`,
    from: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    amount,
  });
}

/** Standard legacy 402 fixture */
const FIXTURE_402_LEGACY = {
  status: 402,
  ok: false,
  json: async () => ({
    error: "Payment Required",
    message: "This action costs 0.005 USDC.",
    payment_details: {
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
      recipient: PLATFORM_WALLET,
      accepted: ["USDC"],
      action: "search",
    },
  }),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("_handlePayment — _payment_status: not_charged", () => {
  it("throws PaymentNotChargedError when backend returns not_charged on 200", async () => {
    const client = new BazaarClient(BASE_CONFIG);
    mockSendUsdcAlwaysSucceeds(getPaymentHandler(client));

    setFetch(
      (() => {
        let call = 0;
        return async () => {
          call++;
          if (call === 1) return FIXTURE_402_LEGACY;
          return {
            status: 200,
            ok: true,
            json: async () => ({
              _payment_status: "not_charged",
              reason: "parameter_missing",
            }),
          };
        };
      })(),
    );

    try {
      await assert.rejects(
        () => client.call("svc-id", {}),
        (err: unknown) => {
          assert.ok(
            err instanceof PaymentNotChargedError,
            `Expected PaymentNotChargedError, got ${String(err)}`,
          );
          assert.equal((err as PaymentNotChargedError).status, "not_charged");
          return true;
        },
      );
    } finally {
      restoreFetch();
    }
  });

  it("PaymentNotChargedError has code PAYMENT_NOT_CHARGED", async () => {
    const client = new BazaarClient(BASE_CONFIG);
    mockSendUsdcAlwaysSucceeds(getPaymentHandler(client));

    setFetch(
      (() => {
        let call = 0;
        return async () => {
          call++;
          if (call === 1) return FIXTURE_402_LEGACY;
          return {
            status: 200,
            ok: true,
            json: async () => ({ _payment_status: "not_charged" }),
          };
        };
      })(),
    );

    try {
      await assert.rejects(
        () => client.call("svc-id", {}),
        (err: unknown) => {
          assert.ok(err instanceof PaymentNotChargedError);
          assert.equal(
            (err as PaymentNotChargedError).code,
            "PAYMENT_NOT_CHARGED",
          );
          return true;
        },
      );
    } finally {
      restoreFetch();
    }
  });

  it("reverses budget tracking when not_charged is returned", async () => {
    const client = new BazaarClient({
      ...BASE_CONFIG,
      budget: { max: 1.0, period: "daily" },
    });
    mockSendUsdcAlwaysSucceeds(getPaymentHandler(client));

    setFetch(
      (() => {
        let call = 0;
        return async () => {
          call++;
          if (call === 1) return FIXTURE_402_LEGACY;
          return {
            status: 200,
            ok: true,
            json: async () => ({ _payment_status: "not_charged" }),
          };
        };
      })(),
    );

    try {
      const beforeStatus = client.getBudgetStatus();
      assert.equal(beforeStatus.spent, 0);

      await assert.rejects(
        () => client.call("svc-id", {}),
        PaymentNotChargedError,
      );

      const afterStatus = client.getBudgetStatus();
      // Budget must be reversed back to 0 after not_charged
      assert.equal(
        afterStatus.spent,
        0,
        "budget must be reversed on not_charged",
      );
    } finally {
      restoreFetch();
    }
  });
});

describe("_handlePayment — _payment_status: refunded", () => {
  it("throws PaymentNotChargedError when backend returns refunded on 200", async () => {
    const client = new BazaarClient(BASE_CONFIG);
    mockSendUsdcAlwaysSucceeds(getPaymentHandler(client));

    setFetch(
      (() => {
        let call = 0;
        return async () => {
          call++;
          if (call === 1) return FIXTURE_402_LEGACY;
          return {
            status: 200,
            ok: true,
            json: async () => ({
              _payment_status: "refunded",
              _x402: {
                refund_tx_hash: FAKE_TX,
                refund_wallet: PLATFORM_WALLET,
              },
            }),
          };
        };
      })(),
    );

    try {
      await assert.rejects(
        () => client.call("svc-id", {}),
        (err: unknown) => {
          assert.ok(err instanceof PaymentNotChargedError);
          assert.equal((err as PaymentNotChargedError).status, "refunded");
          return true;
        },
      );
    } finally {
      restoreFetch();
    }
  });

  it("reverses budget tracking when refunded is returned", async () => {
    const client = new BazaarClient({
      ...BASE_CONFIG,
      budget: { max: 1.0, period: "daily" },
    });
    mockSendUsdcAlwaysSucceeds(getPaymentHandler(client));

    setFetch(
      (() => {
        let call = 0;
        return async () => {
          call++;
          if (call === 1) return FIXTURE_402_LEGACY;
          return {
            status: 200,
            ok: true,
            json: async () => ({ _payment_status: "refunded" }),
          };
        };
      })(),
    );

    try {
      await assert.rejects(
        () => client.call("svc-id", {}),
        PaymentNotChargedError,
      );
      const afterStatus = client.getBudgetStatus();
      assert.equal(afterStatus.spent, 0, "budget must be reversed on refunded");
    } finally {
      restoreFetch();
    }
  });

  it("PaymentNotChargedError message clearly describes the status", () => {
    const errNotCharged = new PaymentNotChargedError("not_charged");
    assert.ok(errNotCharged.message.toLowerCase().includes("not charged"));

    const errRefunded = new PaymentNotChargedError("refunded");
    assert.ok(errRefunded.message.toLowerCase().includes("refunded"));
  });

  it("PaymentNotChargedError is distinct from a generic 200 success", async () => {
    // A plain 200 with no _payment_status must return the result normally
    const client = new BazaarClient(BASE_CONFIG);
    mockSendUsdcAlwaysSucceeds(getPaymentHandler(client));

    setFetch(
      (() => {
        let call = 0;
        return async () => {
          call++;
          if (call === 1) return FIXTURE_402_LEGACY;
          return {
            status: 200,
            ok: true,
            json: async () => ({ data: "real result", success: true }),
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
});

describe("PaymentNotChargedError — error structure", () => {
  it("is an instance of Error", () => {
    const err = new PaymentNotChargedError("not_charged");
    assert.ok(err instanceof Error);
  });

  it("name is PaymentNotChargedError", () => {
    const err = new PaymentNotChargedError("not_charged");
    assert.equal(err.name, "PaymentNotChargedError");
  });

  it("carries the raw details from the backend response", () => {
    const details = { _payment_status: "not_charged", reason: "bad_param" };
    const err = new PaymentNotChargedError("not_charged", details);
    assert.deepEqual(err.details, details);
  });

  it("status field distinguishes not_charged from refunded", () => {
    const nc = new PaymentNotChargedError("not_charged");
    const rf = new PaymentNotChargedError("refunded");
    assert.equal(nc.status, "not_charged");
    assert.equal(rf.status, "refunded");
  });
});

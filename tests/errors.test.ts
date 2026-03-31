/**
 * Tests unitaires — src/errors.ts
 * Hiérarchie d'erreurs, propriétés, messages, instanceof
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  BazaarError,
  PaymentError,
  InsufficientBalanceError,
  BudgetExceededError,
  ApiError,
  NetworkError,
  TimeoutError,
  InvalidConfigError,
} from "../src/errors.js";

// ─── BazaarError ──────────────────────────────────────────────────────────────

describe("BazaarError", () => {
  it("should be an instance of Error", () => {
    const err = new BazaarError("something failed", "SOME_CODE");
    assert.ok(err instanceof Error);
  });

  it("should be an instance of BazaarError", () => {
    const err = new BazaarError("something failed", "SOME_CODE");
    assert.ok(err instanceof BazaarError);
  });

  it("should expose the message passed to the constructor", () => {
    const err = new BazaarError("test message", "CODE");
    assert.equal(err.message, "test message");
  });

  it("should expose the code passed to the constructor", () => {
    const err = new BazaarError("msg", "MY_CODE");
    assert.equal(err.code, "MY_CODE");
  });

  it('should have name "BazaarError"', () => {
    const err = new BazaarError("msg", "CODE");
    assert.equal(err.name, "BazaarError");
  });

  it("should have a stack trace", () => {
    const err = new BazaarError("msg", "CODE");
    assert.ok(typeof err.stack === "string");
    assert.ok(err.stack!.length > 0);
  });
});

// ─── PaymentError ─────────────────────────────────────────────────────────────

describe("PaymentError", () => {
  it("should extend BazaarError", () => {
    const err = new PaymentError("payment failed");
    assert.ok(err instanceof BazaarError);
  });

  it('should have code "PAYMENT_ERROR"', () => {
    const err = new PaymentError("payment failed");
    assert.equal(err.code, "PAYMENT_ERROR");
  });

  it('should have name "PaymentError"', () => {
    const err = new PaymentError("payment failed");
    assert.equal(err.name, "PaymentError");
  });

  it("should store optional details.amount", () => {
    const err = new PaymentError("failed", { amount: 0.005 });
    assert.equal(err.details?.amount, 0.005);
  });

  it("should store optional details.recipient", () => {
    const err = new PaymentError("failed", {
      recipient: "0xabc",
      amount: 1,
    });
    assert.equal(err.details?.recipient, "0xabc");
  });

  it("should store optional details.txHash", () => {
    const err = new PaymentError("failed", {
      txHash: "0xdeadbeef",
    });
    assert.equal(err.details?.txHash, "0xdeadbeef");
  });

  it("should work without details argument", () => {
    const err = new PaymentError("no details");
    assert.equal(err.details, undefined);
  });
});

// ─── InsufficientBalanceError ─────────────────────────────────────────────────

describe("InsufficientBalanceError", () => {
  it("should extend PaymentError", () => {
    const err = new InsufficientBalanceError(0.001, 0.005);
    assert.ok(err instanceof PaymentError);
  });

  it("should extend BazaarError", () => {
    const err = new InsufficientBalanceError(0.001, 0.005);
    assert.ok(err instanceof BazaarError);
  });

  it('should have name "InsufficientBalanceError"', () => {
    const err = new InsufficientBalanceError(0.001, 0.005);
    assert.equal(err.name, "InsufficientBalanceError");
  });

  it("should expose available and required as properties", () => {
    const err = new InsufficientBalanceError(1.23, 5.0);
    assert.equal(err.available, 1.23);
    assert.equal(err.required, 5.0);
  });

  it("should include available and required amounts in message", () => {
    const err = new InsufficientBalanceError(0.001234, 0.005);
    assert.ok(err.message.includes("0.001234"));
    assert.ok(err.message.includes("0.005"));
  });

  it('should have code "PAYMENT_ERROR" (inherited)', () => {
    const err = new InsufficientBalanceError(0, 1);
    assert.equal(err.code, "PAYMENT_ERROR");
  });

  it("should format available with 6 decimal places", () => {
    const err = new InsufficientBalanceError(0.1, 0.5);
    assert.ok(err.message.includes("0.100000"));
  });
});

// ─── BudgetExceededError ──────────────────────────────────────────────────────

describe("BudgetExceededError", () => {
  it("should extend BazaarError", () => {
    const err = new BudgetExceededError(10, 5, "daily");
    assert.ok(err instanceof BazaarError);
  });

  it('should have code "BUDGET_EXCEEDED"', () => {
    const err = new BudgetExceededError(10, 5, "daily");
    assert.equal(err.code, "BUDGET_EXCEEDED");
  });

  it('should have name "BudgetExceededError"', () => {
    const err = new BudgetExceededError(10, 5, "daily");
    assert.equal(err.name, "BudgetExceededError");
  });

  it("should expose spent, limit, and period", () => {
    const err = new BudgetExceededError(3.5, 2.0, "weekly");
    assert.equal(err.spent, 3.5);
    assert.equal(err.limit, 2.0);
    assert.equal(err.period, "weekly");
  });

  it("should include period name in the message", () => {
    const err = new BudgetExceededError(10, 5, "monthly");
    assert.ok(err.message.toLowerCase().includes("monthly"));
  });

  it("should include spent and limit values in the message", () => {
    const err = new BudgetExceededError(10.1234, 5, "daily");
    assert.ok(err.message.includes("10.1234"));
    assert.ok(err.message.includes("5"));
  });
});

// ─── ApiError ─────────────────────────────────────────────────────────────────

describe("ApiError", () => {
  it("should extend BazaarError", () => {
    const err = new ApiError("Not Found", 404, "/api/services");
    assert.ok(err instanceof BazaarError);
  });

  it('should have name "ApiError"', () => {
    const err = new ApiError("Not Found", 404, "/api/services");
    assert.equal(err.name, "ApiError");
  });

  it("should build a code from the status code", () => {
    const err = new ApiError("Not Found", 404, "/api/services");
    assert.equal(err.code, "API_ERROR_404");
  });

  it("should expose statusCode and endpoint", () => {
    const err = new ApiError("Internal Server Error", 500, "/api/call/abc");
    assert.equal(err.statusCode, 500);
    assert.equal(err.endpoint, "/api/call/abc");
  });

  it("should carry the message as-is", () => {
    const err = new ApiError("Custom message", 403, "/api/test");
    assert.equal(err.message, "Custom message");
  });

  it("should build different codes for different status codes", () => {
    const err401 = new ApiError("Unauthorized", 401, "/");
    const err503 = new ApiError("Unavailable", 503, "/");
    assert.equal(err401.code, "API_ERROR_401");
    assert.equal(err503.code, "API_ERROR_503");
  });
});

// ─── NetworkError ─────────────────────────────────────────────────────────────

describe("NetworkError", () => {
  it("should extend BazaarError", () => {
    const err = new NetworkError("connection refused");
    assert.ok(err instanceof BazaarError);
  });

  it('should have code "NETWORK_ERROR"', () => {
    const err = new NetworkError("connection refused");
    assert.equal(err.code, "NETWORK_ERROR");
  });

  it('should have name "NetworkError"', () => {
    const err = new NetworkError("connection refused");
    assert.equal(err.name, "NetworkError");
  });

  it("should store the underlying cause when provided", () => {
    const cause = new Error("ECONNREFUSED");
    const err = new NetworkError("wrapped", cause);
    assert.equal(err.cause, cause);
  });

  it("should work without a cause", () => {
    const err = new NetworkError("no cause");
    assert.equal(err.cause, undefined);
  });
});

// ─── TimeoutError ─────────────────────────────────────────────────────────────

describe("TimeoutError", () => {
  it("should extend BazaarError", () => {
    const err = new TimeoutError("/api/services", 5000);
    assert.ok(err instanceof BazaarError);
  });

  it('should have code "TIMEOUT"', () => {
    const err = new TimeoutError("/api/services", 5000);
    assert.equal(err.code, "TIMEOUT");
  });

  it('should have name "TimeoutError"', () => {
    const err = new TimeoutError("/api/services", 5000);
    assert.equal(err.name, "TimeoutError");
  });

  it("should include the timeout duration in the message", () => {
    const err = new TimeoutError("/api/call/xyz", 30000);
    assert.ok(err.message.includes("30000"));
  });

  it("should include the endpoint in the message", () => {
    const err = new TimeoutError("/api/call/xyz", 30000);
    assert.ok(err.message.includes("/api/call/xyz"));
  });
});

// ─── InvalidConfigError ───────────────────────────────────────────────────────

describe("InvalidConfigError", () => {
  it("should extend BazaarError", () => {
    const err = new InvalidConfigError("bad config");
    assert.ok(err instanceof BazaarError);
  });

  it('should have code "INVALID_CONFIG"', () => {
    const err = new InvalidConfigError("bad config");
    assert.equal(err.code, "INVALID_CONFIG");
  });

  it('should have name "InvalidConfigError"', () => {
    const err = new InvalidConfigError("bad config");
    assert.equal(err.name, "InvalidConfigError");
  });

  it("should carry the message as-is", () => {
    const err = new InvalidConfigError("privateKey must start with 0x");
    assert.equal(err.message, "privateKey must start with 0x");
  });
});

// ─── Cross-cutting: instanceof checks ────────────────────────────────────────

describe("Error hierarchy — instanceof checks", () => {
  it("InsufficientBalanceError is instanceof Error, BazaarError, PaymentError, and itself", () => {
    const err = new InsufficientBalanceError(0, 1);
    assert.ok(err instanceof Error);
    assert.ok(err instanceof BazaarError);
    assert.ok(err instanceof PaymentError);
    assert.ok(err instanceof InsufficientBalanceError);
  });

  it("PaymentError is NOT instanceof ApiError", () => {
    const err = new PaymentError("payment failed");
    assert.ok(!(err instanceof ApiError));
  });

  it("TimeoutError is NOT instanceof NetworkError", () => {
    const err = new TimeoutError("/api", 1000);
    assert.ok(!(err instanceof NetworkError));
  });

  it("all error classes are throwable and catchable as Error", () => {
    const classes = [
      () => {
        throw new BazaarError("x", "C");
      },
      () => {
        throw new PaymentError("x");
      },
      () => {
        throw new InsufficientBalanceError(0, 1);
      },
      () => {
        throw new BudgetExceededError(1, 0.5, "daily");
      },
      () => {
        throw new ApiError("x", 500, "/");
      },
      () => {
        throw new NetworkError("x");
      },
      () => {
        throw new TimeoutError("/", 1000);
      },
      () => {
        throw new InvalidConfigError("x");
      },
    ];

    for (const throwFn of classes) {
      assert.throws(throwFn, Error);
    }
  });
});

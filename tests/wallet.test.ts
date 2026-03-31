/**
 * Tests unitaires — src/wallet.ts
 * Génération de wallet, chiffrement AES-256-GCM, déchiffrement, persistance
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

import { loadOrCreateWallet, DEFAULT_SDK_WALLET_PATH } from "../src/wallet.js";
import type { WalletInfo } from "../src/wallet.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Crée un répertoire temporaire isolé pour chaque test */
function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "x402-wallet-test-"));
}

function removeTempDir(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ─── DEFAULT_SDK_WALLET_PATH ──────────────────────────────────────────────────

describe("DEFAULT_SDK_WALLET_PATH", () => {
  it("should be an absolute path", () => {
    assert.ok(path.isAbsolute(DEFAULT_SDK_WALLET_PATH));
  });

  it("should end with sdk-wallet.json", () => {
    assert.ok(DEFAULT_SDK_WALLET_PATH.endsWith("sdk-wallet.json"));
  });

  it("should be inside the ~/.x402-bazaar directory", () => {
    const expected = path.join(os.homedir(), ".x402-bazaar", "sdk-wallet.json");
    assert.equal(DEFAULT_SDK_WALLET_PATH, expected);
  });
});

// ─── loadOrCreateWallet — nouveau wallet ─────────────────────────────────────

describe("loadOrCreateWallet — when no wallet file exists", () => {
  let tmpDir: string;
  let walletPath: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    walletPath = path.join(tmpDir, "sdk-wallet.json");
  });

  afterEach(() => {
    removeTempDir(tmpDir);
  });

  it("should return a WalletInfo object", () => {
    const result = loadOrCreateWallet(walletPath);
    assert.ok(result !== null && typeof result === "object");
  });

  it("should mark isNew as true for a freshly generated wallet", () => {
    const result = loadOrCreateWallet(walletPath);
    assert.equal(result.isNew, true);
  });

  it("should return a privateKey starting with 0x", () => {
    const result = loadOrCreateWallet(walletPath);
    assert.ok(result.privateKey.startsWith("0x"));
  });

  it("should return a privateKey of the correct length (66 chars: 0x + 64 hex)", () => {
    const result = loadOrCreateWallet(walletPath);
    assert.equal(result.privateKey.length, 66);
  });

  it("should return a valid Ethereum address (0x + 40 hex chars, checksum)", () => {
    const result = loadOrCreateWallet(walletPath);
    assert.ok(result.address.startsWith("0x"));
    assert.equal(result.address.length, 42);
    // EIP-55 checksum: mixed case
    assert.match(result.address, /^0x[0-9a-fA-F]{40}$/);
  });

  it("should create the wallet file on disk", () => {
    loadOrCreateWallet(walletPath);
    assert.ok(fs.existsSync(walletPath));
  });

  it("should persist a file with encrypted, iv, tag, and address fields", () => {
    loadOrCreateWallet(walletPath);
    const raw = JSON.parse(fs.readFileSync(walletPath, "utf-8")) as Record<
      string,
      unknown
    >;
    assert.ok(typeof raw["encrypted"] === "string");
    assert.ok(typeof raw["iv"] === "string");
    assert.ok(typeof raw["tag"] === "string");
    assert.ok(typeof raw["address"] === "string");
  });

  it("should persist the wallet address in the JSON file", () => {
    const result = loadOrCreateWallet(walletPath);
    const raw = JSON.parse(fs.readFileSync(walletPath, "utf-8")) as Record<
      string,
      unknown
    >;
    assert.equal(raw["address"], result.address);
  });

  it("should persist a createdAt ISO timestamp in the JSON file", () => {
    loadOrCreateWallet(walletPath);
    const raw = JSON.parse(fs.readFileSync(walletPath, "utf-8")) as Record<
      string,
      unknown
    >;
    assert.ok(typeof raw["createdAt"] === "string");
    // Should be a valid ISO date
    assert.ok(!isNaN(Date.parse(raw["createdAt"] as string)));
  });

  it("should create intermediate directories if they do not exist", () => {
    const nestedPath = path.join(tmpDir, "nested", "deep", "sdk-wallet.json");
    loadOrCreateWallet(nestedPath);
    assert.ok(fs.existsSync(nestedPath));
  });

  it("should generate a different key on each call to a different path", () => {
    const path1 = path.join(tmpDir, "wallet-a.json");
    const path2 = path.join(tmpDir, "wallet-b.json");
    const a = loadOrCreateWallet(path1);
    const b = loadOrCreateWallet(path2);
    assert.notEqual(a.privateKey, b.privateKey);
    assert.notEqual(a.address, b.address);
  });
});

// ─── loadOrCreateWallet — wallet existant ─────────────────────────────────────

describe("loadOrCreateWallet — when a wallet file already exists", () => {
  let tmpDir: string;
  let walletPath: string;
  let original: WalletInfo;

  beforeEach(() => {
    tmpDir = makeTempDir();
    walletPath = path.join(tmpDir, "sdk-wallet.json");
    original = loadOrCreateWallet(walletPath);
  });

  afterEach(() => {
    removeTempDir(tmpDir);
  });

  it("should return isNew as false when loading an existing wallet", () => {
    const loaded = loadOrCreateWallet(walletPath);
    assert.equal(loaded.isNew, false);
  });

  it("should return the same privateKey as the original", () => {
    const loaded = loadOrCreateWallet(walletPath);
    assert.equal(loaded.privateKey, original.privateKey);
  });

  it("should return the same address as the original", () => {
    const loaded = loadOrCreateWallet(walletPath);
    assert.equal(loaded.address, original.address);
  });

  it("should be idempotent — multiple loads return the same wallet", () => {
    const load1 = loadOrCreateWallet(walletPath);
    const load2 = loadOrCreateWallet(walletPath);
    assert.equal(load1.privateKey, load2.privateKey);
    assert.equal(load1.address, load2.address);
  });
});

// ─── loadOrCreateWallet — fichiers corrompus ──────────────────────────────────

describe("loadOrCreateWallet — when the wallet file is corrupted", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    removeTempDir(tmpDir);
  });

  it("should throw when the file contains invalid JSON", () => {
    const p = path.join(tmpDir, "bad.json");
    fs.writeFileSync(p, "not-valid-json");
    assert.throws(() => loadOrCreateWallet(p), Error);
  });

  it("should throw when the file contains JSON without encrypted/iv/tag fields", () => {
    const p = path.join(tmpDir, "bad.json");
    fs.writeFileSync(
      p,
      JSON.stringify({ address: "0x1234", note: "no encryption fields" }),
    );
    assert.throws(() => loadOrCreateWallet(p), Error);
  });

  it("should throw with a descriptive message when decryption fails (tampered tag)", () => {
    // Create a valid wallet first
    const p = path.join(tmpDir, "wallet.json");
    loadOrCreateWallet(p);

    // Tamper the auth tag to force GCM decryption failure
    const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as Record<
      string,
      string
    >;
    raw["tag"] = crypto.randomBytes(16).toString("hex"); // wrong tag
    fs.writeFileSync(p, JSON.stringify(raw));

    assert.throws(
      () => loadOrCreateWallet(p),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes("x402-sdk"));
        return true;
      },
    );
  });

  it("should throw with a descriptive message when iv is tampered", () => {
    const p = path.join(tmpDir, "wallet.json");
    loadOrCreateWallet(p);

    const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as Record<
      string,
      string
    >;
    raw["iv"] = crypto.randomBytes(12).toString("hex"); // wrong iv
    fs.writeFileSync(p, JSON.stringify(raw));

    assert.throws(() => loadOrCreateWallet(p), Error);
  });
});

// ─── Round-trip chiffrement/déchiffrement ─────────────────────────────────────

describe("loadOrCreateWallet — AES-256-GCM round-trip", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    removeTempDir(tmpDir);
  });

  it("should store the private key in encrypted form (not plaintext) in the JSON", () => {
    const p = path.join(tmpDir, "wallet.json");
    const result = loadOrCreateWallet(p);
    const raw = fs.readFileSync(p, "utf-8");

    // The raw file must NOT contain the private key in plaintext
    assert.ok(!raw.includes(result.privateKey.slice(2))); // check hex part without 0x
  });

  it("should NOT store the private key as address field", () => {
    const p = path.join(tmpDir, "wallet.json");
    const result = loadOrCreateWallet(p);
    const parsed = JSON.parse(fs.readFileSync(p, "utf-8")) as Record<
      string,
      string
    >;
    assert.notEqual(parsed["address"], result.privateKey);
  });

  it("should decrypt back to the original privateKey", () => {
    const p = path.join(tmpDir, "wallet.json");
    const created = loadOrCreateWallet(p);
    const loaded = loadOrCreateWallet(p);
    assert.equal(loaded.privateKey, created.privateKey);
  });

  it("should have iv stored as 24-char hex (12 bytes)", () => {
    const p = path.join(tmpDir, "wallet.json");
    loadOrCreateWallet(p);
    const parsed = JSON.parse(fs.readFileSync(p, "utf-8")) as Record<
      string,
      string
    >;
    assert.equal(parsed["iv"]!.length, 24); // 12 bytes = 24 hex chars
  });

  it("should have tag stored as 32-char hex (16 bytes GCM tag)", () => {
    const p = path.join(tmpDir, "wallet.json");
    loadOrCreateWallet(p);
    const parsed = JSON.parse(fs.readFileSync(p, "utf-8")) as Record<
      string,
      string
    >;
    assert.equal(parsed["tag"]!.length, 32); // 16 bytes = 32 hex chars
  });
});

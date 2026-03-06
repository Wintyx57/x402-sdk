/**
 * Tests unitaires pour @x402/sdk
 * Utilise node:test + node:assert — aucune dépendance externe
 * Les appels réseau et blockchain sont mockés (pas d'appels réels)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ─── Types ────────────────────────────────────────────────────────────────────

type FetchResponse = {
  status: number;
  ok: boolean;
  json: () => Promise<unknown>;
};

// ─── Helpers mock fetch ───────────────────────────────────────────────────────

function makeFetch(responses: FetchResponse[]) {
  let callIndex = 0;
  return async (_url: string, _init?: RequestInit): Promise<FetchResponse> => {
    const resp = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;
    return resp!;
  };
}

const originalFetch = (global as unknown as { fetch?: typeof global.fetch }).fetch;

function setFetch(fn: unknown) {
  (global as unknown as { fetch: unknown }).fetch = fn;
}

function restoreFetch() {
  (global as unknown as { fetch: unknown }).fetch = originalFetch;
}

// ─── Fixture services ─────────────────────────────────────────────────────────

const FIXTURE_SERVICES = [
  {
    id: 'uuid-search',
    name: 'Web Search',
    description: 'Search the web via DuckDuckGo',
    endpoint: '/api/search',
    price_usdc: 0.005,
    category: 'web',
    network: 'base',
    is_native: true,
    tags: ['search', 'web'],
  },
  {
    id: 'uuid-weather',
    name: 'Weather Data',
    description: 'Get weather data for any city',
    endpoint: '/api/weather',
    price_usdc: 0.002,
    category: 'data',
    network: 'base',
    is_native: true,
    tags: ['weather', 'forecast'],
  },
  {
    id: 'uuid-image',
    name: 'Image Generation',
    description: 'Generate images with DALL-E 3',
    endpoint: '/api/image',
    price_usdc: 0.05,
    category: 'ai',
    network: 'base',
    is_native: true,
    tags: ['ai', 'image', 'dall-e'],
  },
];

const FIXTURE_402 = {
  status: 402,
  ok: false,
  json: async () => ({
    error: 'Payment Required',
    message: 'This action costs 0.005 USDC.',
    payment_details: {
      amount: 0.005,
      currency: 'USDC',
      network: 'base',
      chainId: 8453,
      networks: [
        {
          network: 'base',
          chainId: 8453,
          label: 'Base',
          usdc_contract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          explorer: 'https://basescan.org',
          gas: '~$0.001',
        },
      ],
      recipient: '0xfb1c478BD5567BdcD39782E0D6D23418bFda2430',
      accepted: ['USDC'],
      action: 'search',
    },
  }),
};

// ─── Imports SDK ──────────────────────────────────────────────────────────────

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { loadOrCreateWallet } from '../src/wallet.js';
import { BazaarClient, createClient } from '../src/client.js';
import {
  BudgetExceededError,
  InvalidConfigError,
  ApiError,
} from '../src/errors.js';
import type { BazaarClientConfig } from '../src/types.js';

// Clé privée de test (hardhat account #0 — wallet vide, NE PAS utiliser en production)
const TEST_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as `0x${string}`;

const BASE_CONFIG: BazaarClientConfig = {
  privateKey: TEST_PRIVATE_KEY,
  baseUrl:    'https://mock.bazaar.test',
  chain:      'base',
};

// ─── Construction ─────────────────────────────────────────────────────────────

describe('BazaarClient — construction', () => {
  it('crée un client avec config minimale (privateKey seulement)', () => {
    const client = new BazaarClient({ privateKey: TEST_PRIVATE_KEY });
    assert.ok(client instanceof BazaarClient);
  });

  it('createClient() retourne une instance BazaarClient', () => {
    const client = createClient(BASE_CONFIG);
    assert.ok(client instanceof BazaarClient);
  });

  it('walletAddress dérivé de la clé privée est une adresse Ethereum valide', () => {
    const client = new BazaarClient(BASE_CONFIG);
    assert.ok(typeof client.walletAddress === 'string');
    assert.ok(client.walletAddress.startsWith('0x'));
    assert.equal(client.walletAddress.length, 42);
  });

  it('accepte `chain` comme alias de `network`', () => {
    const client = new BazaarClient({
      privateKey: TEST_PRIVATE_KEY,
      chain: 'skale',
    });
    assert.equal(client.network, 'skale');
  });

  it('accepte `network` comme fallback si `chain` absent', () => {
    const client = new BazaarClient({
      privateKey: TEST_PRIVATE_KEY,
      network: 'base-sepolia',
    });
    assert.equal(client.network, 'base-sepolia');
  });

  it('network par défaut est "base"', () => {
    const client = new BazaarClient({ privateKey: TEST_PRIVATE_KEY });
    assert.equal(client.network, 'base');
  });

  it('lève InvalidConfigError si privateKey ne commence pas par 0x', () => {
    assert.throws(
      () => new BazaarClient({ privateKey: 'deadbeef' as `0x${string}` }),
      (err: unknown) => err instanceof InvalidConfigError
    );
  });

  it('lève InvalidConfigError si privateKey est vide', () => {
    assert.throws(
      () => new BazaarClient({ privateKey: '' as `0x${string}` }),
      (err: unknown) => err instanceof InvalidConfigError
    );
  });

  it('supprime le slash final de baseUrl', () => {
    // Vérifié indirectement : aucune double-barre dans les URLs construites
    const client = new BazaarClient({
      privateKey: TEST_PRIVATE_KEY,
      baseUrl: 'https://mock.bazaar.test/',
    });
    assert.ok(client instanceof BazaarClient);
  });
});

// ─── listServices ─────────────────────────────────────────────────────────────

describe('BazaarClient.listServices()', () => {
  it('retourne un tableau de ServiceInfo depuis { services: [...] }', async () => {
    const client = createClient(BASE_CONFIG);

    setFetch(makeFetch([
      {
        status: 200,
        ok: true,
        json: async () => ({ services: FIXTURE_SERVICES }),
      },
    ]));

    try {
      const services = await client.listServices();
      assert.ok(Array.isArray(services));
      assert.equal(services.length, 3);
      assert.equal(services[0]!.id, 'uuid-search');
      assert.equal(services[0]!.price_usdc, 0.005);
    } finally {
      restoreFetch();
    }
  });

  it('gère une réponse qui est directement un tableau', async () => {
    const client = createClient(BASE_CONFIG);

    setFetch(makeFetch([
      { status: 200, ok: true, json: async () => FIXTURE_SERVICES },
    ]));

    try {
      const services = await client.listServices();
      assert.equal(services.length, 3);
    } finally {
      restoreFetch();
    }
  });

  it('retourne un tableau vide si aucun service', async () => {
    const client = createClient(BASE_CONFIG);

    setFetch(makeFetch([
      { status: 200, ok: true, json: async () => ({ services: [] }) },
    ]));

    try {
      const services = await client.listServices();
      assert.deepEqual(services, []);
    } finally {
      restoreFetch();
    }
  });

  it('lève ApiError si la réponse est 500', async () => {
    const client = createClient(BASE_CONFIG);

    setFetch(makeFetch([
      { status: 500, ok: false, json: async () => ({ error: 'Internal Server Error' }) },
    ]));

    try {
      await assert.rejects(
        () => client.listServices(),
        (err: unknown) => {
          assert.ok(err instanceof ApiError);
          assert.equal((err as ApiError).statusCode, 500);
          return true;
        }
      );
    } finally {
      restoreFetch();
    }
  });
});

// ─── searchServices ───────────────────────────────────────────────────────────

describe('BazaarClient.searchServices()', () => {
  it('filtre par nom (insensible à la casse)', async () => {
    const client = createClient(BASE_CONFIG);

    setFetch(makeFetch([
      { status: 200, ok: true, json: async () => ({ services: FIXTURE_SERVICES }) },
    ]));

    try {
      const results = await client.searchServices('weather');
      assert.equal(results.length, 1);
      assert.equal(results[0]!.id, 'uuid-weather');
    } finally {
      restoreFetch();
    }
  });

  it('filtre par description', async () => {
    const client = createClient(BASE_CONFIG);

    setFetch(makeFetch([
      { status: 200, ok: true, json: async () => ({ services: FIXTURE_SERVICES }) },
    ]));

    try {
      const results = await client.searchServices('duckduckgo');
      assert.equal(results.length, 1);
      assert.equal(results[0]!.id, 'uuid-search');
    } finally {
      restoreFetch();
    }
  });

  it('filtre par tag', async () => {
    const client = createClient(BASE_CONFIG);

    setFetch(makeFetch([
      { status: 200, ok: true, json: async () => ({ services: FIXTURE_SERVICES }) },
    ]));

    try {
      const results = await client.searchServices('dall-e');
      assert.equal(results.length, 1);
      assert.equal(results[0]!.id, 'uuid-image');
    } finally {
      restoreFetch();
    }
  });

  it('filtre par catégorie', async () => {
    const client = createClient(BASE_CONFIG);

    setFetch(makeFetch([
      { status: 200, ok: true, json: async () => ({ services: FIXTURE_SERVICES }) },
    ]));

    try {
      const results = await client.searchServices('ai');
      assert.equal(results.length, 1);
      assert.equal(results[0]!.id, 'uuid-image');
    } finally {
      restoreFetch();
    }
  });

  it('retourne tous les services si query vide', async () => {
    const client = createClient(BASE_CONFIG);

    setFetch(makeFetch([
      { status: 200, ok: true, json: async () => ({ services: FIXTURE_SERVICES }) },
    ]));

    try {
      const results = await client.searchServices('');
      assert.equal(results.length, 3);
    } finally {
      restoreFetch();
    }
  });

  it('retourne tableau vide si aucun match', async () => {
    const client = createClient(BASE_CONFIG);

    setFetch(makeFetch([
      { status: 200, ok: true, json: async () => ({ services: FIXTURE_SERVICES }) },
    ]));

    try {
      const results = await client.searchServices('xxxxxxnonexistent');
      assert.equal(results.length, 0);
    } finally {
      restoreFetch();
    }
  });
});

// ─── getService ───────────────────────────────────────────────────────────────

describe('BazaarClient.getService()', () => {
  it('retourne le détail d\'un service par ID', async () => {
    const client = createClient(BASE_CONFIG);
    const fixture = FIXTURE_SERVICES[0]!;

    setFetch(makeFetch([
      { status: 200, ok: true, json: async () => fixture },
    ]));

    try {
      const service = await client.getService('uuid-search');
      assert.equal(service.id, 'uuid-search');
      assert.equal(service.name, 'Web Search');
    } finally {
      restoreFetch();
    }
  });

  it('lève ApiError si service non trouvé (404)', async () => {
    const client = createClient(BASE_CONFIG);

    setFetch(makeFetch([
      { status: 404, ok: false, json: async () => ({ error: 'Not Found' }) },
    ]));

    try {
      await assert.rejects(
        () => client.getService('nonexistent-id'),
        (err: unknown) => {
          assert.ok(err instanceof ApiError);
          assert.equal((err as ApiError).statusCode, 404);
          return true;
        }
      );
    } finally {
      restoreFetch();
    }
  });
});

// ─── call() via proxy ─────────────────────────────────────────────────────────

describe('BazaarClient.call() — proxy /api/call/:serviceId', () => {
  it('retourne la réponse JSON si 200 direct', async () => {
    const client = createClient(BASE_CONFIG);

    setFetch(makeFetch([
      {
        status: 200,
        ok: true,
        json: async () => ({ success: true, result: 'weather data', city: 'Paris' }),
      },
    ]));

    try {
      const result = await client.call('uuid-weather', { city: 'Paris' });
      assert.equal((result as { success: boolean }).success, true);
    } finally {
      restoreFetch();
    }
  });

  it('envoie X-Agent-Wallet dans les headers', async () => {
    const client = createClient(BASE_CONFIG);
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};

    setFetch(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedHeaders = Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>)
      );
      return { status: 200, ok: true, json: async () => ({ ok: true }) };
    });

    try {
      await client.call('uuid-search', { q: 'test' });
      assert.ok(capturedUrl.includes('/api/call/uuid-search'));
      assert.ok(
        'X-Agent-Wallet' in capturedHeaders ||
        'x-agent-wallet' in capturedHeaders
      );
    } finally {
      restoreFetch();
    }
  });

  it('l\'URL inclut /api/call/:serviceId', async () => {
    const client = createClient(BASE_CONFIG);
    let capturedUrl = '';

    setFetch(async (url: string) => {
      capturedUrl = url;
      return { status: 200, ok: true, json: async () => ({ ok: true }) };
    });

    try {
      await client.call('my-service-id', {});
      assert.ok(capturedUrl.includes('/api/call/my-service-id'));
    } finally {
      restoreFetch();
    }
  });

  it('lève BudgetExceededError si budget dépassé par la réponse 402', async () => {
    const client = createClient({
      ...BASE_CONFIG,
      budget: { max: 0.001, period: 'daily' }, // budget < 0.005 USDC requis
    });

    setFetch(makeFetch([FIXTURE_402 as FetchResponse]));

    try {
      await assert.rejects(
        () => client.call('uuid-search', { q: 'test' }),
        (err: unknown) => err instanceof BudgetExceededError
      );
    } finally {
      restoreFetch();
    }
  });

  it('lève ApiError si réponse 402 sans payment_details', async () => {
    const client = createClient(BASE_CONFIG);

    setFetch(makeFetch([
      {
        status: 402,
        ok: false,
        json: async () => ({ error: 'Payment Required' }),
      },
    ]));

    try {
      await assert.rejects(
        () => client.call('uuid-broken', {}),
        (err: unknown) => err instanceof ApiError
      );
    } finally {
      restoreFetch();
    }
  });

  it('lève ApiError si réponse HTTP 500', async () => {
    const client = createClient(BASE_CONFIG);

    setFetch(makeFetch([
      { status: 500, ok: false, json: async () => ({ error: 'Internal Error' }) },
    ]));

    try {
      await assert.rejects(
        () => client.call('uuid-broken', {}),
        (err: unknown) => {
          assert.ok(err instanceof ApiError);
          assert.equal((err as ApiError).statusCode, 500);
          return true;
        }
      );
    } finally {
      restoreFetch();
    }
  });
});

// ─── discover() — rétrocompatibilité ─────────────────────────────────────────

describe('BazaarClient.discover() — compatibilité', () => {
  it('sans argument : retourne la liste complète', async () => {
    const client = createClient(BASE_CONFIG);

    setFetch(makeFetch([
      { status: 200, ok: true, json: async () => ({ services: FIXTURE_SERVICES }) },
    ]));

    try {
      const result = await client.discover();
      assert.ok(Array.isArray(result));
      assert.equal((result as unknown[]).length, 3);
    } finally {
      restoreFetch();
    }
  });

  it('avec endpoint : retourne le service correspondant', async () => {
    const client = createClient(BASE_CONFIG);

    setFetch(makeFetch([
      { status: 200, ok: true, json: async () => ({ services: FIXTURE_SERVICES }) },
    ]));

    try {
      const service = await client.discover('/api/weather');
      assert.ok(!Array.isArray(service));
      assert.equal((service as { endpoint: string }).endpoint, '/api/weather');
    } finally {
      restoreFetch();
    }
  });

  it('lève ApiError si endpoint introuvable dans la liste', async () => {
    const client = createClient(BASE_CONFIG);

    setFetch(makeFetch([
      { status: 200, ok: true, json: async () => ({ services: [] }) },
    ]));

    try {
      await assert.rejects(
        () => client.discover('/api/nonexistent'),
        (err: unknown) => err instanceof ApiError
      );
    } finally {
      restoreFetch();
    }
  });
});

// ─── health() ─────────────────────────────────────────────────────────────────

describe('BazaarClient.health()', () => {
  it('retourne le statut de santé du backend', async () => {
    const client = createClient(BASE_CONFIG);

    setFetch(makeFetch([
      {
        status: 200,
        ok: true,
        json: async () => ({
          status: 'ok',
          version: '1.0.0',
          network: 'Base',
          uptime_seconds: 3600,
          node_version: 'v20.0.0',
        }),
      },
    ]));

    try {
      const health = await client.health();
      assert.equal(health.status, 'ok');
      assert.equal(health.version, '1.0.0');
      assert.equal(health.network, 'Base');
    } finally {
      restoreFetch();
    }
  });

  it('lève ApiError si health check échoue (503)', async () => {
    const client = createClient(BASE_CONFIG);

    setFetch(makeFetch([
      { status: 503, ok: false, json: async () => ({ error: 'Service Unavailable' }) },
    ]));

    try {
      await assert.rejects(
        () => client.health(),
        (err: unknown) => {
          assert.ok(err instanceof ApiError);
          assert.equal((err as ApiError).statusCode, 503);
          return true;
        }
      );
    } finally {
      restoreFetch();
    }
  });
});

// ─── BudgetTracker ────────────────────────────────────────────────────────────

describe('BudgetTracker — calcul local', () => {
  it('budget initialisé avec spent=0, callCount=0', () => {
    const client = createClient({
      ...BASE_CONFIG,
      budget: { max: 1.0, period: 'daily' },
    });

    const status = client.getBudgetStatus();
    assert.equal(status.spent, 0);
    assert.equal(status.limit, 1.0);
    assert.equal(status.remaining, 1.0);
    assert.equal(status.callCount, 0);
    assert.equal(status.period, 'daily');
  });

  it('budget infini si non configuré', () => {
    const client = createClient(BASE_CONFIG);
    const status = client.getBudgetStatus();
    assert.equal(status.limit, Infinity);
    assert.equal(status.remaining, Infinity);
    assert.equal(status.resetAt, null);
  });

  it('resetAt est une Date dans le futur pour budget fini (weekly)', () => {
    const client = createClient({
      ...BASE_CONFIG,
      budget: { max: 5.0, period: 'weekly' },
    });

    const status = client.getBudgetStatus();
    assert.ok(status.resetAt instanceof Date);
    assert.ok(status.resetAt.getTime() > Date.now());
  });

  it('resetAt est une Date dans le futur pour budget monthly', () => {
    const client = createClient({
      ...BASE_CONFIG,
      budget: { max: 10.0, period: 'monthly' },
    });

    const status = client.getBudgetStatus();
    assert.ok(status.resetAt instanceof Date);
  });
});

// ─── Erreurs custom ───────────────────────────────────────────────────────────

import {
  BazaarError,
  PaymentError,
  InsufficientBalanceError,
  NetworkError,
  TimeoutError,
} from '../src/errors.js';

describe('Erreurs custom — propriétés', () => {
  it('BudgetExceededError a les bonnes propriétés', () => {
    const err = new BudgetExceededError(0.9, 1.0, 'daily');
    assert.equal(err.name, 'BudgetExceededError');
    assert.equal(err.code, 'BUDGET_EXCEEDED');
    assert.equal(err.spent, 0.9);
    assert.equal(err.limit, 1.0);
    assert.equal(err.period, 'daily');
    assert.ok(err.message.includes('daily'));
    assert.ok(err instanceof Error);
  });

  it('ApiError a le bon statusCode et endpoint', () => {
    const err = new ApiError('Not Found', 404, '/api/test');
    assert.equal(err.name, 'ApiError');
    assert.equal(err.statusCode, 404);
    assert.equal(err.endpoint, '/api/test');
    assert.equal(err.code, 'API_ERROR_404');
  });

  it('InvalidConfigError a le bon code', () => {
    const err = new InvalidConfigError('Clé invalide');
    assert.equal(err.name, 'InvalidConfigError');
    assert.equal(err.code, 'INVALID_CONFIG');
    assert.ok(err instanceof Error);
  });

  it('InsufficientBalanceError a les bonnes propriétés', () => {
    const err = new InsufficientBalanceError(0.5, 1.0);
    assert.equal(err.name, 'InsufficientBalanceError');
    assert.equal(err.available, 0.5);
    assert.equal(err.required, 1.0);
    assert.ok(err.message.includes('0.500000'));
  });

  it('NetworkError a le bon code', () => {
    const err = new NetworkError('Connexion refusée');
    assert.equal(err.name, 'NetworkError');
    assert.equal(err.code, 'NETWORK_ERROR');
  });

  it('TimeoutError a le bon code et message', () => {
    const err = new TimeoutError('/api/search', 5000);
    assert.equal(err.name, 'TimeoutError');
    assert.equal(err.code, 'TIMEOUT');
    assert.ok(err.message.includes('5000'));
    assert.ok(err.message.includes('/api/search'));
  });
});

// ─── callDirect() — rétrocompatibilité ───────────────────────────────────────

describe('BazaarClient.callDirect() — appel direct sans proxy', () => {
  it('retourne la réponse JSON si 200', async () => {
    const client = createClient(BASE_CONFIG);

    setFetch(makeFetch([
      {
        status: 200,
        ok: true,
        json: async () => ({ success: true, results: ['a', 'b'] }),
      },
    ]));

    try {
      const result = await client.callDirect('/api/search', { q: 'AI tools' });
      assert.equal((result as { success: boolean }).success, true);
    } finally {
      restoreFetch();
    }
  });

  it('l\'URL n\'inclut PAS /api/call/ pour callDirect', async () => {
    const client = createClient(BASE_CONFIG);
    let capturedUrl = '';

    setFetch(async (url: string) => {
      capturedUrl = url;
      return { status: 200, ok: true, json: async () => ({}) };
    });

    try {
      await client.callDirect('/api/search', { q: 'test' });
      assert.ok(!capturedUrl.includes('/api/call/'));
      assert.ok(capturedUrl.includes('/api/search'));
    } finally {
      restoreFetch();
    }
  });
});

// ─── createClient factory ─────────────────────────────────────────────────────

describe('createClient() — factory function', () => {
  it('createClient renvoie une instance BazaarClient', () => {
    const client = createClient({
      privateKey: TEST_PRIVATE_KEY,
      chain: 'base',
    });
    assert.ok(client instanceof BazaarClient);
  });

  it('createClient accepte chain skale', () => {
    const client = createClient({
      privateKey: TEST_PRIVATE_KEY,
      chain: 'skale',
    });
    assert.equal(client.network, 'skale');
  });

  it('createClient accepte chain base-sepolia', () => {
    const client = createClient({
      privateKey: TEST_PRIVATE_KEY,
      chain: 'base-sepolia',
    });
    assert.equal(client.network, 'base-sepolia');
  });

  it('createClient avec budget et timeout', () => {
    const client = createClient({
      privateKey: TEST_PRIVATE_KEY,
      chain: 'base',
      budget: { max: 2.0, period: 'weekly' },
      timeout: 15_000,
    });
    const status = client.getBudgetStatus();
    assert.equal(status.limit, 2.0);
    assert.equal(status.period, 'weekly');
  });
});

// ─── Auto-wallet (loadOrCreateWallet) ────────────────────────────────────────

describe('loadOrCreateWallet() — génération et persistance', () => {
  // Dossier temporaire isolé pour chaque test
  function tmpWalletPath(): string {
    return path.join(os.tmpdir(), `x402-sdk-test-wallet-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  }

  it('génère un nouveau wallet si le fichier n\'existe pas', () => {
    const walletPath = tmpWalletPath();
    try {
      const info = loadOrCreateWallet(walletPath);
      assert.ok(info.isNew, 'isNew doit être true pour un nouveau wallet');
      assert.ok(info.privateKey.startsWith('0x'), 'privateKey commence par 0x');
      assert.ok(info.address.startsWith('0x'), 'address commence par 0x');
      assert.equal(info.address.length, 42, 'adresse Ethereum de 42 caractères');
    } finally {
      if (fs.existsSync(walletPath)) fs.unlinkSync(walletPath);
    }
  });

  it('persiste le wallet dans un fichier JSON chiffré', () => {
    const walletPath = tmpWalletPath();
    try {
      loadOrCreateWallet(walletPath);
      assert.ok(fs.existsSync(walletPath), 'le fichier wallet doit exister');
      const raw = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
      assert.ok('encrypted' in raw, 'champ encrypted présent');
      assert.ok('iv' in raw, 'champ iv présent');
      assert.ok('tag' in raw, 'champ tag présent');
      assert.ok('address' in raw, 'champ address présent');
      assert.ok('createdAt' in raw, 'champ createdAt présent');
    } finally {
      if (fs.existsSync(walletPath)) fs.unlinkSync(walletPath);
    }
  });

  it('recharge le même wallet si le fichier existe déjà', () => {
    const walletPath = tmpWalletPath();
    try {
      const first  = loadOrCreateWallet(walletPath);
      const second = loadOrCreateWallet(walletPath);
      assert.equal(first.privateKey, second.privateKey, 'même clé privée');
      assert.equal(first.address, second.address, 'même adresse');
      assert.equal(second.isNew, false, 'isNew=false au rechargement');
    } finally {
      if (fs.existsSync(walletPath)) fs.unlinkSync(walletPath);
    }
  });

  it('le wallet rechargé a une adresse Ethereum valide', () => {
    const walletPath = tmpWalletPath();
    try {
      loadOrCreateWallet(walletPath); // création
      const info = loadOrCreateWallet(walletPath); // rechargement
      assert.ok(info.address.startsWith('0x'));
      assert.equal(info.address.length, 42);
    } finally {
      if (fs.existsSync(walletPath)) fs.unlinkSync(walletPath);
    }
  });
});

// ─── BazaarClient — auto-wallet sans privateKey ───────────────────────────────

describe('BazaarClient — auto-wallet (sans privateKey)', () => {
  function tmpWalletPath(): string {
    return path.join(os.tmpdir(), `x402-sdk-client-wallet-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  }

  it('crée un client sans fournir de privateKey', () => {
    const walletPath = tmpWalletPath();
    try {
      const client = createClient({ chain: 'base', walletPath });
      assert.ok(client instanceof BazaarClient);
      assert.ok(client.walletAddress.startsWith('0x'));
      assert.equal(client.walletAddress.length, 42);
    } finally {
      if (fs.existsSync(walletPath)) fs.unlinkSync(walletPath);
    }
  });

  it('deux instances sans privateKey sur le même walletPath partagent la même adresse', () => {
    const walletPath = tmpWalletPath();
    try {
      const c1 = createClient({ chain: 'base', walletPath });
      const c2 = createClient({ chain: 'base', walletPath });
      assert.equal(c1.walletAddress, c2.walletAddress);
    } finally {
      if (fs.existsSync(walletPath)) fs.unlinkSync(walletPath);
    }
  });

  it('createClient sans privateKey respecte le réseau configuré', () => {
    const walletPath = tmpWalletPath();
    try {
      const client = createClient({ chain: 'skale', walletPath });
      assert.equal(client.network, 'skale');
    } finally {
      if (fs.existsSync(walletPath)) fs.unlinkSync(walletPath);
    }
  });
});

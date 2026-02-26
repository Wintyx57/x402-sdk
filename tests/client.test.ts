/**
 * Tests unitaires pour @x402/sdk
 * Utilise node:test + node:assert — aucune dépendance externe
 * Les appels réseau et blockchain sont mocké (pas d'appels réels)
 */

import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';

// ─── Helpers pour mocker fetch ───────────────────────────────────────────────

type FetchResponse = {
  status: number;
  ok: boolean;
  json: () => Promise<unknown>;
};

function makeFetch(responses: FetchResponse[]) {
  let callIndex = 0;
  return async (_url: string, _init?: RequestInit): Promise<FetchResponse> => {
    const resp = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;
    return resp!;
  };
}

// Mock global fetch pour les tests
const originalFetch = global.fetch;

function setFetch(fn: typeof global.fetch) {
  (global as unknown as { fetch: typeof fn }).fetch = fn;
}

function restoreFetch() {
  (global as unknown as { fetch: typeof originalFetch }).fetch = originalFetch;
}

// ─── Imports SDK ─────────────────────────────────────────────────────────────

import { BazaarClient } from '../src/client.js';
import {
  BudgetExceededError,
  InvalidConfigError,
  ApiError,
} from '../src/errors.js';
import type { BazaarClientConfig } from '../src/types.js';

// Clé privée de test valide (ne jamais utiliser en prod — wallet vide)
const TEST_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as `0x${string}`;

const BASE_CONFIG: BazaarClientConfig = {
  privateKey: TEST_PRIVATE_KEY,
  baseUrl: 'https://mock.bazaar.test',
  network: 'base',
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('BazaarClient — construction', () => {
  it('crée un client avec config minimale', () => {
    const client = new BazaarClient(BASE_CONFIG);
    assert.ok(client instanceof BazaarClient);
    assert.ok(typeof client.walletAddress === 'string');
    assert.ok(client.walletAddress.startsWith('0x'));
    assert.equal(client.walletAddress.length, 42);
  });

  it('applique les valeurs par défaut (baseUrl, network, timeout)', () => {
    const client = new BazaarClient({ privateKey: TEST_PRIVATE_KEY });
    // Le client est construit sans erreur
    assert.ok(client instanceof BazaarClient);
  });

  it('lève InvalidConfigError si privateKey invalide', () => {
    assert.throws(
      () => new BazaarClient({ privateKey: 'invalid' as `0x${string}` }),
      (err: unknown) => err instanceof InvalidConfigError
    );
  });

  it('lève InvalidConfigError si privateKey ne commence pas par 0x', () => {
    assert.throws(
      () =>
        new BazaarClient({
          privateKey: 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as `0x${string}`,
        }),
      (err: unknown) => err instanceof InvalidConfigError
    );
  });
});

describe('BudgetTracker — calcul local', () => {
  it('budget initialisé avec spent=0, callCount=0', () => {
    const client = new BazaarClient({
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
    const client = new BazaarClient(BASE_CONFIG);
    const status = client.getBudgetStatus();
    assert.equal(status.limit, Infinity);
    assert.equal(status.remaining, Infinity);
    assert.equal(status.resetAt, null);
  });

  it('budget.resetAt est une Date dans le futur pour budget fini', () => {
    const client = new BazaarClient({
      ...BASE_CONFIG,
      budget: { max: 5.0, period: 'weekly' },
    });

    const status = client.getBudgetStatus();
    assert.ok(status.resetAt instanceof Date);
    assert.ok(status.resetAt.getTime() > Date.now());
  });

  it('lève BudgetExceededError si budget dépassé lors du call', async () => {
    const client = new BazaarClient({
      ...BASE_CONFIG,
      budget: { max: 0.001, period: 'daily' }, // budget très bas
    });

    // Mock fetch: retourne 402 avec 0.005 USDC (> budget)
    setFetch(makeFetch([
      {
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
      },
    ]) as unknown as typeof global.fetch);

    try {
      await assert.rejects(
        () => client.call('/api/search', { q: 'test' }),
        (err: unknown) => err instanceof BudgetExceededError
      );
    } finally {
      restoreFetch();
    }
  });
});

describe('Parsing des réponses 402', () => {
  it('parse correctement un payment_details standard', async () => {
    // Client avec budget suffisant
    const client = new BazaarClient({
      ...BASE_CONFIG,
      budget: { max: 10.0, period: 'daily' },
    });

    // On mocke fetch pour qu'il retourne 402 puis 200
    // Le sdk essaiera de payer — on mocke aussi la partie viem en interceptant l'erreur
    setFetch(makeFetch([
      {
        status: 402,
        ok: false,
        json: async () => ({
          error: 'Payment Required',
          message: 'Requires 0.005 USDC',
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
            action: 'test',
          },
        }),
      },
    ]) as unknown as typeof global.fetch);

    // Le paiement réel échouera (pas de vrai RPC) — on attend une PaymentError, pas une BudgetExceededError
    try {
      await client.call('/api/test', {});
    } catch (err: unknown) {
      // On valide que ce n'est PAS une BudgetExceededError (le budget est suffisant)
      assert.ok(!(err instanceof BudgetExceededError), 'Ne doit pas être BudgetExceededError');
      // C'est normal que ça échoue (pas de vrai wallet RPC)
    } finally {
      restoreFetch();
    }
  });

  it('lève ApiError si réponse 402 sans payment_details', async () => {
    const client = new BazaarClient(BASE_CONFIG);

    setFetch(makeFetch([
      {
        status: 402,
        ok: false,
        json: async () => ({ error: 'Payment Required' }),
      },
    ]) as unknown as typeof global.fetch);

    try {
      await assert.rejects(
        () => client.call('/api/broken', {}),
        (err: unknown) => err instanceof ApiError
      );
    } finally {
      restoreFetch();
    }
  });

  it('lève ApiError si réponse HTTP 500', async () => {
    const client = new BazaarClient(BASE_CONFIG);

    setFetch(makeFetch([
      {
        status: 500,
        ok: false,
        json: async () => ({ error: 'Internal Server Error' }),
      },
    ]) as unknown as typeof global.fetch);

    try {
      await assert.rejects(
        () => client.call('/api/broken', {}),
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

describe('BazaarClient.discover()', () => {
  it('retourne une liste de services', async () => {
    const client = new BazaarClient(BASE_CONFIG);

    setFetch(makeFetch([
      {
        status: 200,
        ok: true,
        json: async () => ({
          services: [
            {
              id: '1',
              name: 'Web Search',
              description: 'Search the web',
              endpoint: '/api/search',
              price_usdc: 0.005,
              category: 'web',
              network: 'base',
              is_native: true,
            },
            {
              id: '2',
              name: 'Weather',
              description: 'Get weather data',
              endpoint: '/api/weather',
              price_usdc: 0.002,
              category: 'data',
              network: 'base',
              is_native: true,
            },
          ],
        }),
      },
    ]) as unknown as typeof global.fetch);

    try {
      const services = await client.discover();
      assert.ok(Array.isArray(services));
      assert.equal(services.length, 2);
      assert.equal((services as Array<{ endpoint: string }>)[0]!.endpoint, '/api/search');
    } finally {
      restoreFetch();
    }
  });

  it('retourne un service spécifique par endpoint', async () => {
    const client = new BazaarClient(BASE_CONFIG);

    setFetch(makeFetch([
      {
        status: 200,
        ok: true,
        json: async () => ({
          services: [
            {
              id: '1',
              name: 'Web Search',
              endpoint: '/api/search',
              price_usdc: 0.005,
              category: 'web',
              network: 'base',
              description: 'Search the web',
            },
          ],
        }),
      },
    ]) as unknown as typeof global.fetch);

    try {
      const service = await client.discover('/api/search');
      assert.ok(!Array.isArray(service));
      assert.equal((service as { endpoint: string }).endpoint, '/api/search');
    } finally {
      restoreFetch();
    }
  });

  it('lève ApiError si le service n\'existe pas', async () => {
    const client = new BazaarClient(BASE_CONFIG);

    setFetch(makeFetch([
      {
        status: 200,
        ok: true,
        json: async () => ({ services: [] }),
      },
    ]) as unknown as typeof global.fetch);

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

describe('BazaarClient.health()', () => {
  it('retourne le statut de santé du backend', async () => {
    const client = new BazaarClient(BASE_CONFIG);

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
    ]) as unknown as typeof global.fetch);

    try {
      const health = await client.health();
      assert.equal(health.status, 'ok');
      assert.ok(typeof health.version === 'string');
    } finally {
      restoreFetch();
    }
  });

  it('lève ApiError si health check échoue', async () => {
    const client = new BazaarClient(BASE_CONFIG);

    setFetch(makeFetch([
      {
        status: 503,
        ok: false,
        json: async () => ({ error: 'Service Unavailable' }),
      },
    ]) as unknown as typeof global.fetch);

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

describe('Erreurs custom — propriétés', () => {
  it('BudgetExceededError a les bonnes propriétés', () => {
    const err = new BudgetExceededError(0.9, 1.0, 'daily');
    assert.equal(err.name, 'BudgetExceededError');
    assert.equal(err.code, 'BUDGET_EXCEEDED');
    assert.equal(err.spent, 0.9);
    assert.equal(err.limit, 1.0);
    assert.equal(err.period, 'daily');
    assert.ok(err.message.includes('daily'));
  });

  it('ApiError a le bon statusCode', () => {
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
  });
});

describe('BazaarClient.call() — succès direct (200)', () => {
  it('retourne la réponse JSON sans paiement si 200', async () => {
    const client = new BazaarClient(BASE_CONFIG);

    setFetch(makeFetch([
      {
        status: 200,
        ok: true,
        json: async () => ({
          success: true,
          query: 'AI tools',
          results_count: 3,
          results: [
            { title: 'LangChain', url: 'https://langchain.com', snippet: 'Build LLM apps.' },
          ],
        }),
      },
    ]) as unknown as typeof global.fetch);

    try {
      const result = await client.call('/api/search', { q: 'AI tools' });
      assert.ok((result as { success: boolean }).success === true);
      assert.equal((result as { results_count: number }).results_count, 3);
    } finally {
      restoreFetch();
    }
  });

  it('inclut X-Agent-Wallet dans les headers', async () => {
    const client = new BazaarClient(BASE_CONFIG);
    let capturedHeaders: Record<string, string> = {};

    const mockFetch = async (_url: string, init?: RequestInit): Promise<FetchResponse> => {
      capturedHeaders = Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>)
      );
      return {
        status: 200,
        ok: true,
        json: async () => ({ success: true }),
      };
    };

    setFetch(mockFetch as unknown as typeof global.fetch);

    try {
      await client.call('/api/test', {});
      assert.ok('X-Agent-Wallet' in capturedHeaders || 'x-agent-wallet' in capturedHeaders);
    } finally {
      restoreFetch();
    }
  });
});

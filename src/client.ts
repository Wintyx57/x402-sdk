// BazaarClient — main client for @wintyx/x402-sdk

import type {
  BazaarClientConfig,
  CallOptions,
  ServiceInfo,
  BudgetStatus,
  HealthResponse,
  PaymentRequiredResponse,
  Network,
  FundingInfo,
} from './types.js';
import { PaymentHandler } from './payment.js';
import { loadOrCreateWallet } from './wallet.js';
import {
  BudgetExceededError,
  ApiError,
  NetworkError,
  TimeoutError,
  InvalidConfigError,
} from './errors.js';

// ─── Constantes ───────────────────────────────────────────────────────────────

const DEFAULT_BASE_URL = 'https://x402-api.onrender.com';
const DEFAULT_TIMEOUT  = 30_000;
const DEFAULT_NETWORK: Network = 'base';

// ─── Types internes ───────────────────────────────────────────────────────────

interface BudgetTracker {
  spent: number;
  callCount: number;
  periodStart: Date;
}

interface ResolvedConfig {
  privateKey: `0x${string}`;
  baseUrl: string;
  network: Network;
  timeout: number;
  budget: { max: number; period: 'daily' | 'weekly' | 'monthly' };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

function getPeriodMs(period: 'daily' | 'weekly' | 'monthly'): number {
  switch (period) {
    case 'daily':   return 24 * 60 * 60 * 1000;
    case 'weekly':  return 7 * 24 * 60 * 60 * 1000;
    case 'monthly': return 30 * 24 * 60 * 60 * 1000;
  }
}

// ─── BazaarClient ─────────────────────────────────────────────────────────────

export class BazaarClient {
  private readonly paymentHandler: PaymentHandler;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly config: ResolvedConfig;
  private readonly budgetTracker: BudgetTracker;

  constructor(config: BazaarClientConfig) {
    let resolvedPrivateKey: `0x${string}`;

    if (config.privateKey !== undefined) {
      // Clé explicite fournie (même vide ou invalide)
      if (!config.privateKey || !config.privateKey.startsWith('0x')) {
        throw new InvalidConfigError(
          'privateKey must be a hex string starting with 0x'
        );
      }
      resolvedPrivateKey = config.privateKey;
    } else {
      // Auto-wallet : charger ou créer
      const wallet = loadOrCreateWallet(config.walletPath);
      resolvedPrivateKey = wallet.privateKey;
      if (wallet.isNew) {
        console.log(
          `[x402-sdk] Generated new wallet: ${wallet.address} — ` +
          'Fund it with USDC to start calling paid APIs.'
        );
      }
    }

    const network = config.chain ?? config.network ?? DEFAULT_NETWORK;

    this.config = {
      privateKey: resolvedPrivateKey,
      baseUrl:    (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, ''),
      network,
      timeout:    config.timeout ?? DEFAULT_TIMEOUT,
      budget:     config.budget ?? { max: Infinity, period: 'daily' },
    };

    this.baseUrl = this.config.baseUrl;
    this.timeout = this.config.timeout;

    this.paymentHandler = new PaymentHandler(
      this.config.privateKey,
      this.config.network
    );

    this.budgetTracker = {
      spent:       0,
      callCount:   0,
      periodStart: new Date(),
    };
  }

  // ─── Accesseurs ──────────────────────────────────────────────────────────

  /** Adresse Ethereum du wallet agent */
  get walletAddress(): string {
    return this.paymentHandler.walletAddress;
  }

  /** Réseau blockchain configuré */
  get network(): Network {
    return this.config.network;
  }

  // ─── API publiques ────────────────────────────────────────────────────────

  /**
   * Solde USDC du wallet agent sur le réseau configuré.
   */
  async getBalance(): Promise<number> {
    return this.paymentHandler.getBalance();
  }

  /**
   * Liste tous les services disponibles sur le Bazaar.
   * Équivalent de GET /api/services.
   */
  async listServices(): Promise<ServiceInfo[]> {
    const url = `${this.baseUrl}/api/services?limit=200`;
    const response = await this._fetchSafe(url, {}, '/api/services');

    const json = await response.json() as unknown;

    // Backend returns { data: [...], pagination } or { services: [...] } or a raw array
    if (Array.isArray(json)) return json;
    if (json && typeof json === 'object') {
      const obj = json as Record<string, unknown>;
      if (Array.isArray(obj['data'])) return obj['data'] as ServiceInfo[];
      if (Array.isArray(obj['services'])) return obj['services'] as ServiceInfo[];
    }
    return [];
  }

  /**
   * Recherche des services par mot-clé (filtre côté client sur name + description).
   * Pour une recherche serveur, utiliser listServices() puis filtrer.
   */
  async searchServices(query: string): Promise<ServiceInfo[]> {
    const all = await this.listServices();
    const q = query.toLowerCase().trim();
    if (!q) return all;

    return all.filter(
      s =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        (s.category ?? '').toLowerCase().includes(q) ||
        (s.tags ?? []).some((t: string) => t.toLowerCase().includes(q))
    );
  }

  /**
   * Détail d'un service par son ID.
   * Équivalent de GET /api/services/:id.
   */
  async getService(serviceId: string): Promise<ServiceInfo> {
    const url = `${this.baseUrl}/api/services/${encodeURIComponent(serviceId)}`;
    const response = await this._fetchSafe(url, {}, `/api/services/${serviceId}`);
    return response.json() as Promise<ServiceInfo>;
  }

  /**
   * Appelle un service par son ID via le proxy Bazaar (POST /api/call/:serviceId).
   * Le serveur gère le split 95/5 et la vérification du paiement.
   * Si le service retourne 402, le SDK paie automatiquement et retente.
   *
   * @param serviceId - L'ID UUID du service dans le Bazaar
   * @param params - Les paramètres à passer au service
   * @param options - Options de timeout/retry
   */
  async call<T = unknown>(
    serviceId: string,
    params: Record<string, string | number | boolean> = {},
    options: CallOptions = {}
  ): Promise<T> {
    const timeout    = options.timeout    ?? this.timeout;
    const maxRetries = options.maxRetries ?? 1;
    const endpoint   = `/api/call/${encodeURIComponent(serviceId)}`;

    // Construire l'URL avec query params
    const url = new URL(`${this.baseUrl}${endpoint}`);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v));
    }

    const baseHeaders: Record<string, string> = {
      'Content-Type':    'application/json',
      'X-Agent-Wallet':  this.paymentHandler.walletAddress,
    };

    // Première tentative — sans paiement
    let response: Response;
    try {
      response = await fetchWithTimeout(url.toString(), { headers: baseHeaders }, timeout);
    } catch (err) {
      throw this._wrapFetchError(err, endpoint, timeout);
    }

    if (response.ok) {
      return response.json() as Promise<T>;
    }

    // 402 Payment Required — payer et retenter
    if (response.status === 402) {
      return this._handlePayment<T>(
        response, url.toString(), baseHeaders, endpoint, timeout, maxRetries
      );
    }

    throw await this._buildApiError(response, endpoint);
  }

  /**
   * Appelle directement un endpoint (ancienne API — compatibilité).
   * Préférer `call(serviceId)` via le proxy pour bénéficier du split 95/5.
   *
   * @param endpoint - Chemin de l'API (ex: '/api/search')
   * @param params - Query parameters
   * @param options - Options de timeout/retry
   */
  async callDirect<T = unknown>(
    endpoint: string,
    params: Record<string, string | number | boolean> = {},
    options: CallOptions = {}
  ): Promise<T> {
    const timeout    = options.timeout    ?? this.timeout;
    const maxRetries = options.maxRetries ?? 1;

    const url = new URL(`${this.baseUrl}${endpoint}`);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v));
    }

    const baseHeaders: Record<string, string> = {
      'Content-Type':   'application/json',
      'X-Agent-Wallet': this.paymentHandler.walletAddress,
    };

    let response: Response;
    try {
      response = await fetchWithTimeout(url.toString(), { headers: baseHeaders }, timeout);
    } catch (err) {
      throw this._wrapFetchError(err, endpoint, timeout);
    }

    if (response.ok) return response.json() as Promise<T>;

    if (response.status === 402) {
      return this._handlePayment<T>(
        response, url.toString(), baseHeaders, endpoint, timeout, maxRetries
      );
    }

    throw await this._buildApiError(response, endpoint);
  }

  /**
   * Découvrir les services — alias rétrocompatible.
   * Sans argument : liste complète.
   * Avec endpoint : service correspondant (recherche par endpoint field).
   */
  async discover(endpoint?: string): Promise<ServiceInfo | ServiceInfo[]> {
    const services = await this.listServices();
    if (!endpoint) return services;

    const found = services.find(s => s.endpoint === endpoint);
    if (!found) {
      throw new ApiError(`Service not found: ${endpoint}`, 404, endpoint);
    }
    return found;
  }

  /** Statut du budget courant (tracking local, reset automatique par période) */
  getBudgetStatus(): BudgetStatus {
    const { budget } = this.config;
    const periodMs   = getPeriodMs(budget.period);
    const elapsed    = Date.now() - this.budgetTracker.periodStart.getTime();

    if (elapsed >= periodMs) {
      this.budgetTracker.spent       = 0;
      this.budgetTracker.callCount   = 0;
      this.budgetTracker.periodStart = new Date();
    }

    const remaining = Math.max(0, budget.max - this.budgetTracker.spent);
    const resetAt   = budget.max === Infinity
      ? null
      : new Date(this.budgetTracker.periodStart.getTime() + periodMs);

    return {
      spent:     this.budgetTracker.spent,
      limit:     budget.max,
      remaining,
      period:    budget.period,
      callCount: this.budgetTracker.callCount,
      resetAt,
    };
  }

  /** Health check du backend Bazaar */
  async health(): Promise<HealthResponse> {
    const url = `${this.baseUrl}/health`;
    const response = await this._fetchSafe(url, {}, '/health');
    return response.json() as Promise<HealthResponse>;
  }

  /**
   * Get funding instructions to bridge USDC to your wallet.
   * Returns bridge URL and wallet info for cross-chain bridging via Trails SDK.
   */
  async fundWallet(): Promise<FundingInfo> {
    const address = this.walletAddress;
    return {
      bridgeUrl: `https://x402bazaar.org/fund`,
      walletAddress: address,
      supportedChains: ['Ethereum', 'Polygon', 'Arbitrum', 'Optimism', 'Base'],
      bridgeTime: '5-15 minutes (IMA bridge to SKALE)',
      minimumAmount: '0.10 USDC',
      howItWorks: 'Trails SDK routes tokens from any chain → USDC on Base → IMA bridge → SKALE on Base. Visit the bridge URL to start.',
    };
  }

  // ─── Méthodes privées ─────────────────────────────────────────────────────

  private async _fetchSafe(
    url: string,
    init: RequestInit,
    label: string
  ): Promise<Response> {
    let response: Response;
    try {
      response = await fetchWithTimeout(url, init, this.timeout);
    } catch (err) {
      throw this._wrapFetchError(err, label, this.timeout);
    }

    if (!response.ok) {
      throw await this._buildApiError(response, label);
    }

    return response;
  }

  private _wrapFetchError(err: unknown, endpoint: string, timeout: number): Error {
    if (err instanceof Error && err.name === 'AbortError') {
      return new TimeoutError(endpoint, timeout);
    }
    return new NetworkError(
      `Network error on ${endpoint}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  private async _buildApiError(response: Response, endpoint: string): Promise<ApiError> {
    const body = await response.json().catch(() => ({}));
    return new ApiError(
      `API error ${response.status} on ${endpoint}: ${JSON.stringify(body)}`,
      response.status,
      endpoint
    );
  }

  private _checkBudget(amountUsdc: number): void {
    const { budget } = this.config;
    if (budget.max === Infinity) return;

    const periodMs = getPeriodMs(budget.period);
    const elapsed  = Date.now() - this.budgetTracker.periodStart.getTime();

    if (elapsed >= periodMs) {
      this.budgetTracker.spent       = 0;
      this.budgetTracker.callCount   = 0;
      this.budgetTracker.periodStart = new Date();
    }

    if (this.budgetTracker.spent + amountUsdc > budget.max) {
      throw new BudgetExceededError(
        this.budgetTracker.spent,
        budget.max,
        budget.period
      );
    }
  }

  private _recordSpending(amountUsdc: number): void {
    this.budgetTracker.spent     += amountUsdc;
    this.budgetTracker.callCount += 1;
  }

  private async _handlePayment<T>(
    initial402Response: Response,
    urlStr: string,
    baseHeaders: Record<string, string>,
    endpoint: string,
    timeout: number,
    maxRetries: number
  ): Promise<T> {
    const body = (await initial402Response.json()) as PaymentRequiredResponse;
    const details = body.payment_details;

    if (!details) {
      throw new ApiError('402 response missing payment_details', 402, endpoint);
    }

    const amountUsdc = details.amount;

    // Vérification budget AVANT de payer
    this._checkBudget(amountUsdc);

    // Trouver le bon réseau parmi ceux acceptés par le serveur
    const targetNetwork =
      details.networks?.find(n => n.network === this.config.network) ??
      details.networks?.[0];

    const recipient = (details.recipient ?? targetNetwork?.usdc_contract) as
      | `0x${string}`
      | undefined;

    if (!recipient) {
      throw new ApiError('No recipient found in payment_details', 402, endpoint);
    }

    // Envoyer le paiement USDC on-chain
    const payment = await this.paymentHandler.sendUsdc(recipient, amountUsdc);

    // Enregistrer la dépense localement
    this._recordSpending(amountUsdc);

    // Retenter avec le tx hash
    const paidHeaders: Record<string, string> = {
      ...baseHeaders,
      'X-Payment-TxHash': payment.txHash,
      'X-Payment-Chain':  this.config.network,
    };

    let retries = 0;
    let response: Response;

    while (true) {
      try {
        response = await fetchWithTimeout(urlStr, { headers: paidHeaders }, timeout);
      } catch (err) {
        if (retries >= maxRetries) {
          throw this._wrapFetchError(err, endpoint, timeout);
        }
        retries++;
        continue;
      }

      if (response.ok) {
        return response.json() as Promise<T>;
      }

      if (retries >= maxRetries) break;
      retries++;
    }

    throw await this._buildApiError(response!, endpoint);
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates an x402 Bazaar client ready to use.
 *
 * @example
 * ```ts
 * import { createClient } from '@wintyx/x402-sdk';
 *
 * const client = createClient({ chain: 'base' });
 *
 * const services = await client.listServices();
 * const result   = await client.call('service-uuid', { q: 'hello' });
 * const balance  = await client.getBalance();
 * ```
 */
export function createClient(config: BazaarClientConfig): BazaarClient {
  return new BazaarClient(config);
}

// BazaarClient — client principal pour @x402/sdk

import type {
  BazaarClientConfig,
  CallOptions,
  ServiceInfo,
  BudgetStatus,
  HealthResponse,
  PaymentRequiredResponse,
  Network,
} from './types.js';
import { PaymentHandler } from './payment.js';
import {
  BudgetExceededError,
  ApiError,
  NetworkError,
  TimeoutError,
  InvalidConfigError,
} from './errors.js';

const DEFAULT_BASE_URL = 'https://x402-api.onrender.com';
const DEFAULT_TIMEOUT  = 30_000;
const DEFAULT_NETWORK: Network = 'base';

interface BudgetTracker {
  spent: number;
  callCount: number;
  periodStart: Date;
}

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

export class BazaarClient {
  private readonly paymentHandler: PaymentHandler;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly config: Required<BazaarClientConfig>;
  private readonly budgetTracker: BudgetTracker;

  constructor(config: BazaarClientConfig) {
    if (!config.privateKey || !config.privateKey.startsWith('0x')) {
      throw new InvalidConfigError('privateKey doit être une clé hex commençant par 0x');
    }

    this.config = {
      privateKey: config.privateKey,
      baseUrl:  config.baseUrl  ?? DEFAULT_BASE_URL,
      network:  config.network  ?? DEFAULT_NETWORK,
      timeout:  config.timeout  ?? DEFAULT_TIMEOUT,
      budget:   config.budget   ?? { max: Infinity, period: 'daily' },
    };

    this.baseUrl  = this.config.baseUrl.replace(/\/$/, '');
    this.timeout  = this.config.timeout;

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

  /** Adresse du wallet agent */
  get walletAddress(): string {
    return this.paymentHandler.walletAddress;
  }

  /** Solde USDC du wallet agent */
  async getBalance(): Promise<number> {
    return this.paymentHandler.getBalance();
  }

  /**
   * Appelle un endpoint du Bazaar.
   * Si l'API retourne 402, le SDK paie automatiquement et retry.
   */
  async call<T = unknown>(
    endpoint: string,
    params: Record<string, string | number | boolean> = {},
    options: CallOptions = {}
  ): Promise<T> {
    const timeout  = options.timeout    ?? this.timeout;
    const maxRetries = options.maxRetries ?? 1;

    // Construire l'URL avec les query params
    const url = new URL(`${this.baseUrl}${endpoint}`);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v));
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Agent-Wallet': this.paymentHandler.walletAddress,
    };

    // Première tentative sans paiement
    let response: Response;
    try {
      response = await fetchWithTimeout(url.toString(), { headers }, timeout);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new TimeoutError(endpoint, timeout);
      }
      throw new NetworkError(
        `Erreur réseau sur ${endpoint}: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // Succès direct (pas de paiement requis)
    if (response.ok) {
      return response.json() as Promise<T>;
    }

    // 402 Payment Required — on paie et on retry
    if (response.status === 402) {
      const body = (await response.json()) as PaymentRequiredResponse;
      const details = body.payment_details;

      if (!details) {
        throw new ApiError('Réponse 402 sans payment_details', 402, endpoint);
      }

      const amountUsdc = details.amount;

      // Vérification budget AVANT de payer
      this._checkBudget(amountUsdc);

      // Trouver le bon réseau dans la liste des réseaux acceptés
      const targetNetwork = details.networks?.find(
        n => n.network === this.config.network
      ) ?? details.networks?.[0];

      const recipient = (details.recipient ?? targetNetwork?.usdc_contract) as `0x${string}`;

      if (!recipient) {
        throw new ApiError('Aucun destinataire dans payment_details', 402, endpoint);
      }

      // Envoyer le paiement USDC
      const payment = await this.paymentHandler.sendUsdc(recipient, amountUsdc);

      // Enregistrer la dépense dans le tracker
      this._recordSpending(amountUsdc);

      // Retry avec le tx hash
      const paidHeaders: Record<string, string> = {
        ...headers,
        'X-Payment-TxHash': payment.txHash,
        'X-Payment-Chain':  this.config.network,
      };

      let retries = 0;
      while (retries <= maxRetries) {
        try {
          response = await fetchWithTimeout(url.toString(), { headers: paidHeaders }, timeout);
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') {
            throw new TimeoutError(endpoint, timeout);
          }
          if (retries >= maxRetries) {
            throw new NetworkError(
              `Erreur réseau après paiement sur ${endpoint}`
            );
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

      const errorBody = await response.json().catch(() => ({}));
      throw new ApiError(
        `API error ${response.status} sur ${endpoint}: ${JSON.stringify(errorBody)}`,
        response.status,
        endpoint
      );
    }

    // Autre erreur HTTP
    const errorBody = await response.json().catch(() => ({}));
    throw new ApiError(
      `API error ${response.status} sur ${endpoint}: ${JSON.stringify(errorBody)}`,
      response.status,
      endpoint
    );
  }

  /**
   * Découvrir les services disponibles sur le Bazaar.
   * Sans argument : retourne la liste complète.
   * Avec un endpoint : retourne les détails de ce service.
   */
  async discover(endpoint?: string): Promise<ServiceInfo | ServiceInfo[]> {
    const timeout = this.timeout;

    if (endpoint) {
      // Chercher un service spécifique par endpoint
      const url = `${this.baseUrl}/api/services`;
      let response: Response;
      try {
        response = await fetchWithTimeout(url, {}, timeout);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          throw new TimeoutError('/api/services', timeout);
        }
        throw new NetworkError(`Erreur réseau sur /api/services`);
      }

      if (!response.ok) {
        throw new ApiError(`Erreur ${response.status} sur /api/services`, response.status, '/api/services');
      }

      const data = await response.json() as { services?: ServiceInfo[] };
      const services = data.services ?? (data as unknown as ServiceInfo[]);
      const found = (Array.isArray(services) ? services : []).find(
        s => s.endpoint === endpoint
      );

      if (!found) {
        throw new ApiError(`Service non trouvé: ${endpoint}`, 404, endpoint);
      }

      return found;
    }

    // Liste complète
    const url = `${this.baseUrl}/api/services`;
    let response: Response;
    try {
      response = await fetchWithTimeout(url, {}, timeout);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new TimeoutError('/api/services', timeout);
      }
      throw new NetworkError(`Erreur réseau sur /api/services`);
    }

    if (!response.ok) {
      throw new ApiError(`Erreur ${response.status} sur /api/services`, response.status, '/api/services');
    }

    const data = await response.json() as { services?: ServiceInfo[] };
    return data.services ?? (data as unknown as ServiceInfo[]);
  }

  /** Statut du budget courant */
  getBudgetStatus(): BudgetStatus {
    const { budget } = this.config;
    const periodMs   = getPeriodMs(budget.period);
    const now        = Date.now();
    const elapsed    = now - this.budgetTracker.periodStart.getTime();

    // Reset automatique si la période est écoulée
    if (elapsed >= periodMs) {
      this.budgetTracker.spent       = 0;
      this.budgetTracker.callCount   = 0;
      this.budgetTracker.periodStart = new Date();
    }

    const remaining  = Math.max(0, budget.max - this.budgetTracker.spent);
    const resetAt    = budget.max === Infinity
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

  /** Health check du backend */
  async health(): Promise<HealthResponse> {
    const url = `${this.baseUrl}/health`;
    let response: Response;

    try {
      response = await fetchWithTimeout(url, {}, this.timeout);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new TimeoutError('/health', this.timeout);
      }
      throw new NetworkError(`Impossible de joindre le Bazaar: ${this.baseUrl}`);
    }

    if (!response.ok) {
      throw new ApiError(`Health check échoué: ${response.status}`, response.status, '/health');
    }

    return response.json() as Promise<HealthResponse>;
  }

  // ─── Méthodes privées ───

  private _checkBudget(amountUsdc: number): void {
    const { budget } = this.config;
    if (budget.max === Infinity) return;

    const periodMs = getPeriodMs(budget.period);
    const elapsed  = Date.now() - this.budgetTracker.periodStart.getTime();

    // Reset si période écoulée
    if (elapsed >= periodMs) {
      this.budgetTracker.spent       = 0;
      this.budgetTracker.callCount   = 0;
      this.budgetTracker.periodStart = new Date();
    }

    const projected = this.budgetTracker.spent + amountUsdc;
    if (projected > budget.max) {
      throw new BudgetExceededError(
        this.budgetTracker.spent,
        budget.max,
        budget.period
      );
    }
  }

  private _recordSpending(amountUsdc: number): void {
    this.budgetTracker.spent    += amountUsdc;
    this.budgetTracker.callCount += 1;
  }
}

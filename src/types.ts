// TypeScript types for @wintyx/x402-sdk

export type Network = "base" | "base-sepolia" | "skale" | "polygon";
export type BudgetPeriod = "daily" | "weekly" | "monthly";

export interface BudgetConfig {
  /** Montant maximum en USDC par période */
  max: number;
  period: BudgetPeriod;
}

export interface BazaarClientConfig {
  /**
   * Clé privée hex (0x...) pour les paiements automatiques.
   * Si absente, un wallet est auto-généré et persisté dans
   * ~/.x402-bazaar/sdk-wallet.json (chiffré AES-256-GCM).
   */
  privateKey?: `0x${string}`;
  /** URL de base du Bazaar (default: https://x402-api.onrender.com) */
  baseUrl?: string;
  /** Réseau blockchain (default: 'skale') */
  chain?: Network;
  /** Alias de `chain` pour compatibilité */
  network?: Network;
  /** Limite de budget optionnelle */
  budget?: BudgetConfig;
  /** Timeout en ms pour les requêtes HTTP (default: 30000) */
  timeout?: number;
  /**
   * Chemin personnalisé pour le fichier wallet auto-généré.
   * Ignoré si privateKey est fourni.
   * (défaut: ~/.x402-bazaar/sdk-wallet.json)
   */
  walletPath?: string;
  /**
   * HMAC secret for server-side validation signature verification.
   * Must match the backend VALIDATION_SECRET env var.
   * Optional — if absent, HMAC verification is skipped.
   */
  validationSecret?: string;
}

export interface CallOptions {
  /** Timeout en ms pour cette requête (override config) */
  timeout?: number;
  /** Nombre de tentatives de retry réseau après paiement (default: 1) */
  maxRetries?: number;
}

export interface SplitDetails {
  provider_amount_usdc: number;
  platform_amount_usdc: number;
  provider_wallet: string;
  platform_wallet: string;
}

export interface PaymentDetails {
  amount: number;
  currency: string;
  network: string;
  chainId: number;
  networks: NetworkInfo[];
  recipient: string;
  accepted: string[];
  action: string;
  /** Present when the backend uses split mode (provider + platform separate payments) */
  provider_wallet?: string;
  /** Explicit payment mode signalled by the backend */
  payment_mode?: "legacy" | "split_native" | "facilitator";
  /** Amounts breakdown for split_native mode */
  split?: SplitDetails;
  /** Polygon facilitator URL — triggers EIP-3009 gas-free flow when present */
  facilitator?: string;
}

export interface NetworkInfo {
  network: string;
  chainId: number;
  label: string;
  usdc_contract: string;
  explorer: string;
  gas: string;
  /** Per-network recipient address (FeeSplitter for facilitator chains, platform wallet otherwise) */
  recipient?: string;
  /** Polygon facilitator URL exposed per network in the 402 body */
  facilitator?: string;
}

export interface PaymentRequiredResponse {
  error: string;
  message: string;
  payment_details: PaymentDetails;
  extensions?: unknown;
}

export interface ServiceInfo {
  id: string;
  name: string;
  description: string;
  url: string;
  endpoint?: string;
  price_usdc: number;
  category?: string;
  network?: string;
  owner_address?: string;
  owner_wallet?: string;
  is_native?: boolean;
  verified_status?: string;
  tags?: string[];
  method?: string;
  created_at?: string;
}

export interface BudgetStatus {
  spent: number;
  limit: number;
  remaining: number;
  period: BudgetPeriod;
  callCount: number;
  resetAt: Date | null;
}

export interface HealthResponse {
  status: string;
  version: string;
  network: string;
  uptime_seconds?: number;
  node_version?: string;
}

export interface PaymentResult {
  txHash: `0x${string}`;
  explorer: string;
  from: string;
  amount: number;
}

export interface FundingInfo {
  bridgeUrl: string;
  walletAddress: string;
  supportedChains: string[];
  bridgeTime: string;
  minimumAmount: string;
  howItWorks: string;
}

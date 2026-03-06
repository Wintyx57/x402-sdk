// @x402/sdk — Point d'entrée principal

export { BazaarClient, createClient } from './client.js';
export { PaymentHandler } from './payment.js';

export {
  BazaarError,
  PaymentError,
  InsufficientBalanceError,
  BudgetExceededError,
  ApiError,
  NetworkError,
  TimeoutError,
  InvalidConfigError,
} from './errors.js';

export type {
  BazaarClientConfig,
  CallOptions,
  BudgetConfig,
  BudgetPeriod,
  BudgetStatus,
  ServiceInfo,
  HealthResponse,
  PaymentDetails,
  PaymentRequiredResponse,
  PaymentResult,
  Network,
  NetworkInfo,
} from './types.js';

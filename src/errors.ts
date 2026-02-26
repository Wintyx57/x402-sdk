// Erreurs custom pour @x402/sdk

export class BazaarError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'BazaarError';
  }
}

export class PaymentError extends BazaarError {
  constructor(
    message: string,
    public readonly details?: {
      amount?: number;
      recipient?: string;
      txHash?: string;
    }
  ) {
    super(message, 'PAYMENT_ERROR');
    this.name = 'PaymentError';
  }
}

export class InsufficientBalanceError extends PaymentError {
  constructor(
    public readonly available: number,
    public readonly required: number
  ) {
    super(
      `Solde USDC insuffisant: ${available.toFixed(6)} USDC disponible (besoin: ${required} USDC)`,
      { amount: required }
    );
    this.name = 'InsufficientBalanceError';
  }
}

export class BudgetExceededError extends BazaarError {
  constructor(
    public readonly spent: number,
    public readonly limit: number,
    public readonly period: string
  ) {
    super(
      `Budget ${period} dépassé: ${spent.toFixed(4)} USDC dépensé sur ${limit} USDC maximum`,
      'BUDGET_EXCEEDED'
    );
    this.name = 'BudgetExceededError';
  }
}

export class ApiError extends BazaarError {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly endpoint: string
  ) {
    super(message, `API_ERROR_${statusCode}`);
    this.name = 'ApiError';
  }
}

export class NetworkError extends BazaarError {
  constructor(message: string, public readonly cause?: Error) {
    super(message, 'NETWORK_ERROR');
    this.name = 'NetworkError';
  }
}

export class TimeoutError extends BazaarError {
  constructor(endpoint: string, timeoutMs: number) {
    super(`Timeout après ${timeoutMs}ms pour ${endpoint}`, 'TIMEOUT');
    this.name = 'TimeoutError';
  }
}

export class InvalidConfigError extends BazaarError {
  constructor(message: string) {
    super(message, 'INVALID_CONFIG');
    this.name = 'InvalidConfigError';
  }
}

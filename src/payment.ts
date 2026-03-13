// Payment handler — sends USDC via viem (multi-chain: Base, Base Sepolia, SKALE on Base, Polygon)

import { randomBytes } from 'crypto';
import {
  createWalletClient,
  createPublicClient,
  http,
  fallback,
  type Hash,
  type Address,
} from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import type { Network, PaymentResult } from './types.js';
import { PaymentError, InsufficientBalanceError, NetworkError } from './errors.js';

// ─── Configuration des réseaux ────────────────────────────────────────────────

interface ChainConfig {
  usdcContract: Address;
  rpcUrls: string[];
  explorer: string;
  // Chain ID pour la définition manuelle (SKALE et Polygon ne sont pas dans viem/chains)
  chainId?: number;
  chainName?: string;
  nativeCurrency?: { name: string; symbol: string; decimals: number };
  confirmations: number;
  /** Nombre de décimales USDC sur ce réseau (défaut : 6) */
  usdcDecimals?: number;
}

const CHAIN_CONFIGS: Record<Network, ChainConfig> = {
  base: {
    usdcContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    rpcUrls: [
      'https://mainnet.base.org',
      'https://base.llamarpc.com',
      'https://1rpc.io/base',
    ],
    explorer: 'https://basescan.org',
    confirmations: 2,
  },
  'base-sepolia': {
    usdcContract: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    rpcUrls: ['https://sepolia.base.org'],
    explorer: 'https://sepolia.basescan.org',
    confirmations: 1,
  },
  skale: {
    usdcContract: '0x85889c8c714505E0c94b30fcfcF64fE3Ac8FCb20',
    rpcUrls: [
      'https://skale-base.skalenodes.com/v1/base',
      'https://1187947933.rpc.thirdweb.com',
    ],
    explorer: 'https://skale-base-explorer.skalenodes.com',
    chainId: 1187947933,
    chainName: 'SKALE on Base',
    nativeCurrency: { name: 'CREDITS', symbol: 'CREDITS', decimals: 18 },
    confirmations: 1,
    usdcDecimals: 18, // USDC bridge-wrapped sur SKALE a 18 décimales
  },
  polygon: {
    usdcContract: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', // Circle native USDC (6 décimales)
    rpcUrls: [
      'https://polygon-bor-rpc.publicnode.com',
      'https://polygon.publicnode.com',
    ],
    explorer: 'https://polygonscan.com',
    chainId: 137,
    chainName: 'Polygon',
    nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
    confirmations: 2,
  },
};

const USDC_ABI = [
  {
    name: 'transfer',
    type: 'function',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

// ─── EIP-3009 types & domain ───────────────────────────────────────────────────

/** Domaine EIP-712 pour USDC (Circle native, Polygon mainnet) */
const POLYGON_EIP712_DOMAIN = {
  name: 'USD Coin',
  version: '2',
  chainId: 137,
  verifyingContract: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359' as Address,
} as const;

/** Types EIP-712 pour TransferWithAuthorization (EIP-3009) */
const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from',        type: 'address' },
    { name: 'to',          type: 'address' },
    { name: 'value',       type: 'uint256' },
    { name: 'validAfter',  type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce',       type: 'bytes32' },
  ],
} as const;

/** Payload d'autorisation EIP-3009 */
interface Eip3009Authorization {
  from:        Address;
  to:          Address;
  value:       string; // uint256 en string
  validAfter:  string;
  validBefore: string;
  nonce:       `0x${string}`;
}

/** Réponse brute du facilitateur Polygon */
interface FacilitatorResponse {
  success:     boolean;
  transaction?: string;
  errorReason?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getViemChain(network: Network) {
  if (network === 'base') return base;
  if (network === 'base-sepolia') return baseSepolia;

  // SKALE on Base — définition manuelle car absent de viem/chains
  if (network === 'skale') {
    const cfg = CHAIN_CONFIGS.skale;
    return {
      id: cfg.chainId!,
      name: cfg.chainName!,
      nativeCurrency: cfg.nativeCurrency!,
      rpcUrls: {
        default: { http: cfg.rpcUrls as [string, ...string[]] },
      },
    } as const;
  }

  // Polygon — définition manuelle
  const cfg = CHAIN_CONFIGS.polygon;
  return {
    id: cfg.chainId!,
    name: cfg.chainName!,
    nativeCurrency: cfg.nativeCurrency!,
    rpcUrls: {
      default: { http: cfg.rpcUrls as [string, ...string[]] },
    },
  } as const;
}

function buildTransport(network: Network) {
  const { rpcUrls } = CHAIN_CONFIGS[network];
  if (rpcUrls.length === 1) return http(rpcUrls[0]);
  return fallback(rpcUrls.map(url => http(url)));
}

/** Convertit un montant USDC en unités brutes selon les décimales du réseau */
function toRawUnits(amountUsdc: number, network: Network): bigint {
  const decimals = CHAIN_CONFIGS[network].usdcDecimals ?? 6;
  return BigInt(Math.round(amountUsdc * 10 ** decimals));
}

/** Convertit des unités brutes en USDC selon les décimales du réseau */
function fromRawUnits(raw: bigint, network: Network): number {
  const decimals = CHAIN_CONFIGS[network].usdcDecimals ?? 6;
  return Number(raw) / 10 ** decimals;
}

// ─── PaymentHandler ───────────────────────────────────────────────────────────

export class PaymentHandler {
  private readonly privateKey: `0x${string}`;
  private readonly network: Network;
  private readonly usdcContract: Address;

  constructor(privateKey: `0x${string}`, network: Network = 'base') {
    this.privateKey = privateKey;
    this.network = network;
    this.usdcContract = CHAIN_CONFIGS[network].usdcContract;
  }

  get walletAddress(): Address {
    return privateKeyToAccount(this.privateKey).address;
  }

  async getBalance(): Promise<number> {
    const account = privateKeyToAccount(this.privateKey);
    const chain = getViemChain(this.network);
    const transport = buildTransport(this.network);

    const publicClient = createPublicClient({
      chain: chain as Parameters<typeof createPublicClient>[0]['chain'],
      transport,
    });

    try {
      const balance = await publicClient.readContract({
        address: this.usdcContract,
        abi: USDC_ABI,
        functionName: 'balanceOf',
        args: [account.address],
      });
      return fromRawUnits(balance, this.network);
    } catch (err) {
      throw new NetworkError(
        `Failed to fetch USDC balance on ${this.network}`,
        err instanceof Error ? err : undefined
      );
    }
  }

  async sendUsdc(toAddress: Address, amountUsdc: number): Promise<PaymentResult> {
    const account = privateKeyToAccount(this.privateKey);
    const chain = getViemChain(this.network);
    const transport = buildTransport(this.network);
    const { confirmations, explorer } = CHAIN_CONFIGS[this.network];

    const publicClient = createPublicClient({
      chain: chain as Parameters<typeof createPublicClient>[0]['chain'],
      transport,
    });

    const walletClient = createWalletClient({
      account,
      chain: chain as Parameters<typeof createWalletClient>[0]['chain'],
      transport,
    });

    const amountRaw = toRawUnits(amountUsdc, this.network);

    // Vérifier le solde avant d'envoyer
    let balance: bigint;
    try {
      balance = await publicClient.readContract({
        address: this.usdcContract,
        abi: USDC_ABI,
        functionName: 'balanceOf',
        args: [account.address],
      });
    } catch (err) {
      throw new NetworkError(
        `Failed to check USDC balance on ${this.network}`,
        err instanceof Error ? err : undefined
      );
    }

    if (balance < amountRaw) {
      throw new InsufficientBalanceError(
        fromRawUnits(balance, this.network),
        amountUsdc
      );
    }

    // Envoyer le transfert USDC
    let txHash: Hash;
    try {
      txHash = await walletClient.writeContract({
        address: this.usdcContract,
        abi: USDC_ABI,
        functionName: 'transfer',
        args: [toAddress, amountRaw],
        chain: null,
      });
    } catch (err) {
      throw new PaymentError(
        `USDC transfer failed: ${err instanceof Error ? err.message : String(err)}`,
        { amount: amountUsdc, recipient: toAddress }
      );
    }

    // Attendre la confirmation
    try {
      await publicClient.waitForTransactionReceipt({
        hash: txHash,
        confirmations,
      });
    } catch (err) {
      throw new PaymentError(
        `Transaction sent but confirmation failed: ${txHash}`,
        { txHash, amount: amountUsdc, recipient: toAddress }
      );
    }

    return {
      txHash,
      explorer: `${explorer}/tx/${txHash}`,
      from: account.address,
      amount: amountUsdc,
    };
  }

  /**
   * Envoie un paiement USDC sur Polygon via le facilitateur (EIP-3009 gas-free).
   *
   * Flow :
   *  1. Signe un TransferWithAuthorization EIP-3009 off-chain (zéro gas)
   *  2. POST au facilitateur /settle avec le payload signé
   *  3. Retourne le tx hash de la réponse du facilitateur
   *
   * @param toAddress           Destinataire du paiement (owner ou FeeSplitter)
   * @param amountUsdc          Montant en USDC (ex : 0.005)
   * @param facilitatorUrl      URL du facilitateur (ex : https://x402.polygon.technology)
   * @param feeSplitterContract Adresse du contrat FeeSplitter (optionnel — remplace toAddress dans l'auth)
   */
  async sendViaFacilitator(
    toAddress: Address,
    amountUsdc: number,
    facilitatorUrl: string,
    feeSplitterContract?: Address
  ): Promise<PaymentResult> {
    if (this.network !== 'polygon') {
      throw new PaymentError(
        'sendViaFacilitator is only supported on the Polygon network',
        { amount: amountUsdc, recipient: toAddress }
      );
    }

    const account = privateKeyToAccount(this.privateKey);
    const { explorer } = CHAIN_CONFIGS.polygon;

    // Nonce aléatoire 32 bytes
    const nonceBytes = randomBytes(32);
    const nonce = `0x${nonceBytes.toString('hex')}` as `0x${string}`;

    const amountRaw = toRawUnits(amountUsdc, 'polygon');
    const validAfter  = BigInt(0);
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 300);

    // Le destinataire dans l'autorisation : FeeSplitter si fourni, sinon toAddress
    const authTo: Address = feeSplitterContract ?? toAddress;

    const authorization: Eip3009Authorization = {
      from:        account.address,
      to:          authTo,
      value:       amountRaw.toString(),
      validAfter:  validAfter.toString(),
      validBefore: validBefore.toString(),
      nonce,
    };

    // Signer le message EIP-712 / EIP-3009
    let signature: `0x${string}`;
    try {
      // Créer un walletClient Polygon pour signTypedData
      const chain = getViemChain('polygon');
      const transport = buildTransport('polygon');
      const walletClient = createWalletClient({
        account,
        chain: chain as Parameters<typeof createWalletClient>[0]['chain'],
        transport,
      });

      signature = await walletClient.signTypedData({
        account,
        domain: POLYGON_EIP712_DOMAIN,
        types: TRANSFER_WITH_AUTHORIZATION_TYPES,
        primaryType: 'TransferWithAuthorization',
        message: {
          from:        account.address,
          to:          authTo,
          value:       amountRaw,
          validAfter,
          validBefore,
          nonce,
        },
      });
    } catch (err) {
      throw new PaymentError(
        `EIP-3009 signing failed: ${err instanceof Error ? err.message : String(err)}`,
        { amount: amountUsdc, recipient: toAddress }
      );
    }

    // Construire le payload pour le facilitateur
    const settlePayload = {
      x402Version: 1,
      paymentPayload: {
        x402Version: 1,
        scheme: 'exact',
        network: 'polygon',
        payload: {
          signature,
          authorization,
        },
      },
      paymentRequirements: {
        scheme: 'exact',
        network: 'polygon',
        maxAmountRequired: amountRaw.toString(),
        resource: 'x402-sdk-payment',
        description: 'x402 Bazaar API payment',
        mimeType: 'application/json',
        payTo: toAddress,
        asset: CHAIN_CONFIGS.polygon.usdcContract,
        maxTimeoutSeconds: 60,
      },
    };

    // Appeler le facilitateur
    let facilitatorResponse: FacilitatorResponse;
    try {
      const response = await fetch(`${facilitatorUrl.replace(/\/$/, '')}/settle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settlePayload),
      });

      facilitatorResponse = (await response.json()) as FacilitatorResponse;
    } catch (err) {
      throw new PaymentError(
        `Facilitator request failed: ${err instanceof Error ? err.message : String(err)}`,
        { amount: amountUsdc, recipient: toAddress }
      );
    }

    if (!facilitatorResponse.success || !facilitatorResponse.transaction) {
      throw new PaymentError(
        `Facilitator rejected payment: ${facilitatorResponse.errorReason ?? 'unknown error'}`,
        { amount: amountUsdc, recipient: toAddress }
      );
    }

    const txHash = facilitatorResponse.transaction as `0x${string}`;

    return {
      txHash,
      explorer: `${explorer}/tx/${txHash}`,
      from: account.address,
      amount: amountUsdc,
    };
  }
}

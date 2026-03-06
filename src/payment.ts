// Payment handler — sends USDC via viem (multi-chain: Base, Base Sepolia, SKALE on Base)

import {
  createWalletClient,
  createPublicClient,
  http,
  parseUnits,
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
  // Chain ID pour la définition manuelle (SKALE n'est pas dans viem/chains)
  chainId?: number;
  chainName?: string;
  nativeCurrency?: { name: string; symbol: string; decimals: number };
  confirmations: number;
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getViemChain(network: Network) {
  if (network === 'base') return base;
  if (network === 'base-sepolia') return baseSepolia;

  // SKALE on Base — définition manuelle car absent de viem/chains
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

function buildTransport(network: Network) {
  const { rpcUrls } = CHAIN_CONFIGS[network];
  if (rpcUrls.length === 1) return http(rpcUrls[0]);
  return fallback(rpcUrls.map(url => http(url)));
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
      return Number(balance) / 1_000_000;
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

    // Convertir en unités USDC (6 décimales, arrondi entier pour éviter les erreurs float)
    const amountRaw = BigInt(Math.round(amountUsdc * 1_000_000));

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
        Number(balance) / 1_000_000,
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
}

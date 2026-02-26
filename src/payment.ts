// Payment handler — envoie des USDC via viem (Base mainnet ou autre réseau)

import {
  createWalletClient,
  createPublicClient,
  http,
  parseUnits,
  type Hash,
  type Address,
} from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import type { Network, PaymentResult } from './types.js';
import { PaymentError, InsufficientBalanceError, NetworkError } from './errors.js';

// Contrats USDC par réseau
const USDC_CONTRACTS: Record<Network, Address> = {
  'base':        '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'base-sepolia':'0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  'skale':       '0x5F795bb52dAc3085f578f4877D450e2929D2F13d',
};

// RPC URLs par réseau
const RPC_URLS: Record<Network, string> = {
  'base':        'https://mainnet.base.org',
  'base-sepolia':'https://sepolia.base.org',
  'skale':       'https://mainnet.skalenodes.com/v1/elated-tan-skat',
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

function getChain(network: Network) {
  if (network === 'base') return base;
  if (network === 'base-sepolia') return baseSepolia;
  // SKALE n'est pas dans viem/chains — on définit manuellement
  return {
    id: 2046399126,
    name: 'SKALE Europa Hub',
    nativeCurrency: { name: 'sFUEL', symbol: 'sFUEL', decimals: 18 },
    rpcUrls: { default: { http: [RPC_URLS.skale] } },
  } as const;
}

export class PaymentHandler {
  private readonly privateKey: `0x${string}`;
  private readonly network: Network;
  private readonly usdcContract: Address;
  private readonly rpcUrl: string;

  constructor(privateKey: `0x${string}`, network: Network = 'base') {
    this.privateKey = privateKey;
    this.network = network;
    this.usdcContract = USDC_CONTRACTS[network];
    this.rpcUrl = RPC_URLS[network];
  }

  get walletAddress(): Address {
    return privateKeyToAccount(this.privateKey).address;
  }

  async getBalance(): Promise<number> {
    const account = privateKeyToAccount(this.privateKey);
    const chain = getChain(this.network);

    const publicClient = createPublicClient({
      chain: chain as Parameters<typeof createPublicClient>[0]['chain'],
      transport: http(this.rpcUrl),
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
        `Impossible de récupérer le solde USDC sur ${this.network}`,
        err instanceof Error ? err : undefined
      );
    }
  }

  async sendUsdc(toAddress: Address, amountUsdc: number): Promise<PaymentResult> {
    const account = privateKeyToAccount(this.privateKey);
    const chain = getChain(this.network);

    const walletClient = createWalletClient({
      account,
      chain: chain as Parameters<typeof createWalletClient>[0]['chain'],
      transport: http(this.rpcUrl),
    });

    const publicClient = createPublicClient({
      chain: chain as Parameters<typeof createPublicClient>[0]['chain'],
      transport: http(this.rpcUrl),
    });

    // Convertir en unités USDC (6 décimales)
    const amount = parseUnits(amountUsdc.toString(), 6);

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
        `Impossible de vérifier le solde USDC`,
        err instanceof Error ? err : undefined
      );
    }

    if (balance < amount) {
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
        args: [toAddress, amount],
        chain: null,
      });
    } catch (err) {
      throw new PaymentError(
        `Échec du transfert USDC: ${err instanceof Error ? err.message : String(err)}`,
        { amount: amountUsdc, recipient: toAddress }
      );
    }

    // Attendre la confirmation (1 bloc)
    try {
      await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1 });
    } catch (err) {
      throw new PaymentError(
        `Transaction envoyée mais confirmation échouée: ${txHash}`,
        { txHash, amount: amountUsdc, recipient: toAddress }
      );
    }

    const explorerBase = this.network === 'base' ? 'https://basescan.org' :
                         this.network === 'base-sepolia' ? 'https://sepolia.basescan.org' :
                         'https://elated-tan-skat.explorer.mainnet.skalenodes.com';

    return {
      txHash,
      explorer: `${explorerBase}/tx/${txHash}`,
      from: account.address,
      amount: amountUsdc,
    };
  }
}

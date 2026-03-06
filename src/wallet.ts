/**
 * Auto-wallet — génération et persistance chiffrée d'un wallet x402 Bazaar SDK
 *
 * Algorithme compatible avec mcp-server.mjs :
 *   - Chiffrement : AES-256-GCM
 *   - Clé dérivée : SHA256(hostname + ":" + username + ":" + homedir)
 *   - Format fichier : { encrypted, iv, tag, address, createdAt, note }
 *
 * Fichier SDK : ~/.x402-bazaar/sdk-wallet.json  (distinct du MCP wallet.json)
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WalletInfo {
  /** Clé privée hex (0x...) */
  privateKey: `0x${string}`;
  /** Adresse Ethereum dérivée */
  address: string;
  /** true si le wallet vient d'être créé lors de cet appel */
  isNew: boolean;
}

interface EncryptedWallet {
  encrypted: string;
  iv: string;
  tag: string;
  address: string;
  createdAt: string;
  note: string;
}

// ─── Chemin par défaut ────────────────────────────────────────────────────────

export const DEFAULT_SDK_WALLET_PATH = path.join(
  os.homedir(),
  '.x402-bazaar',
  'sdk-wallet.json'
);

// ─── Clé machine (même dérivation que le MCP) ────────────────────────────────

function getMachineKey(): Buffer {
  const raw = `${os.hostname()}:${os.userInfo().username}:${os.homedir()}`;
  return crypto.createHash('sha256').update(raw).digest();
}

// ─── Chiffrement AES-256-GCM ─────────────────────────────────────────────────

function encryptPrivateKey(privateKey: string): EncryptedWallet['encrypted'] extends string
  ? Pick<EncryptedWallet, 'encrypted' | 'iv' | 'tag'>
  : never {
  const key = getMachineKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(privateKey, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    encrypted: encrypted.toString('hex'),
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
  } as Pick<EncryptedWallet, 'encrypted' | 'iv' | 'tag'>;
}

function decryptPrivateKey(data: Pick<EncryptedWallet, 'encrypted' | 'iv' | 'tag'>): string {
  const key = getMachineKey();
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(data.iv, 'hex')
  );
  decipher.setAuthTag(Buffer.from(data.tag, 'hex'));
  return (
    decipher.update(Buffer.from(data.encrypted, 'hex')).toString('utf8') +
    decipher.final('utf8')
  );
}

// ─── API publique ─────────────────────────────────────────────────────────────

/**
 * Charge ou crée un wallet SDK persisté dans ~/.x402-bazaar/sdk-wallet.json.
 *
 * Comportement :
 *  - Si walletPath existe et contient un wallet chiffré valide → déchiffre et retourne
 *  - Si le fichier n'existe pas → génère une clé privée, chiffre, persiste, retourne
 *
 * Le format de chiffrement est identique au MCP (AES-256-GCM, clé dérivée machine).
 * Le fichier est distinct (sdk-wallet.json vs wallet.json) pour éviter toute collision.
 *
 * @param walletPath - Chemin du fichier wallet (défaut: ~/.x402-bazaar/sdk-wallet.json)
 */
export function loadOrCreateWallet(walletPath?: string): WalletInfo {
  const filePath = walletPath ?? DEFAULT_SDK_WALLET_PATH;

  // ── Wallet existant ────────────────────────────────────────────────────────
  if (fs.existsSync(filePath)) {
    let saved: unknown;
    try {
      saved = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      throw new Error(`[x402-sdk] Impossible de lire le wallet: ${filePath}`);
    }

    if (
      saved &&
      typeof saved === 'object' &&
      'encrypted' in saved &&
      'iv' in saved &&
      'tag' in saved
    ) {
      const encWallet = saved as EncryptedWallet;
      let privateKey: string;
      try {
        privateKey = decryptPrivateKey(encWallet);
      } catch {
        throw new Error(
          `[x402-sdk] Impossible de déchiffrer le wallet ${filePath}. ` +
          'Le fichier a peut-être été copié depuis une autre machine.'
        );
      }

      const key = (privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`) as `0x${string}`;
      const account = privateKeyToAccount(key);
      return { privateKey: key, address: account.address, isNew: false };
    }

    throw new Error(
      `[x402-sdk] Format de wallet non reconnu dans ${filePath}. ` +
      'Supprimez le fichier pour en générer un nouveau.'
    );
  }

  // ── Nouveau wallet ─────────────────────────────────────────────────────────
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);

  // Créer le dossier ~/.x402-bazaar si nécessaire
  const walletDir = path.dirname(filePath);
  if (!fs.existsSync(walletDir)) {
    fs.mkdirSync(walletDir, { recursive: true });
  }

  const encFields = encryptPrivateKey(privateKey);
  const walletData: EncryptedWallet = {
    ...encFields,
    address: account.address,
    createdAt: new Date().toISOString(),
    note: 'Auto-generated wallet for x402 Bazaar SDK. Fund with USDC to use paid APIs.',
  };

  // Permissions 0600 : lecture/écriture propriétaire uniquement
  fs.writeFileSync(filePath, JSON.stringify(walletData, null, 2), { mode: 0o600 });

  return { privateKey, address: account.address, isNew: true };
}

/**
 * Test E2E — vérifie que le SDK fonctionne avec le vrai backend
 * Usage: npx tsx tests/e2e.ts
 */

import { createClient } from '../src/index.js';

// Clé privée jetable (wallet de test, ne pas utiliser en production)
// On génère un wallet aléatoire juste pour tester les fonctions read-only
import { generatePrivateKey } from 'viem/accounts';

const privateKey = generatePrivateKey();

async function main() {
  console.log('=== @wintyx/x402-sdk E2E Test (SKALE) ===\n');

  // 1. Créer le client
  const client = createClient({
    privateKey,
    chain: 'skale',
  });
  console.log('✓ Client créé');
  console.log(`  Wallet: ${client.walletAddress}`);
  console.log(`  Network: ${client.network}\n`);

  // 2. Lister les services
  console.log('--- listServices() ---');
  const services = await client.listServices();
  console.log(`✓ ${services.length} services trouvés`);
  if (services.length > 0) {
    console.log(`  Premier: ${services[0].name} (${services[0].price_usdc} USDC)`);
    console.log(`  Dernier: ${services[services.length - 1].name}`);
  }

  // 3. Rechercher
  console.log('\n--- searchServices("joke") ---');
  const jokes = await client.searchServices('joke');
  console.log(`✓ ${jokes.length} résultats pour "joke"`);
  jokes.forEach(s => console.log(`  - ${s.name}: ${s.price_usdc} USDC`));

  // 4. Détail d'un service
  if (services.length > 0) {
    console.log(`\n--- getService("${services[0].id}") ---`);
    const detail = await client.getService(services[0].id);
    console.log(`✓ ${detail.name}`);
    console.log(`  URL: ${detail.url}`);
    console.log(`  Prix: ${detail.price_usdc} USDC`);
    console.log(`  Tags: ${detail.tags?.join(', ') || 'aucun'}`);
  }

  // 5. Balance (sera 0 pour un wallet aléatoire)
  console.log('\n--- getBalance() ---');
  try {
    const balance = await client.getBalance();
    console.log(`✓ Balance: ${balance} USDC`);
  } catch (e: any) {
    console.log(`⚠ Balance: ${e.message} (normal pour un wallet frais)`);
  }

  console.log('\n=== Tous les tests read-only passent ! ===');
}

main().catch(err => {
  console.error('✗ ERREUR:', err.message);
  process.exit(1);
});

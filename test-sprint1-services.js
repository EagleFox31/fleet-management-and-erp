#!/usr/bin/env node

/**
 * Script de test Sprint 1 - Services Phase 2
 * Teste les 3 services créés avec les données réelles
 */

const BASE_URL = 'http://localhost:5000';

async function testService(name, endpoint, description) {
  try {
    console.log(`\n🧪 Testing ${name}: ${description}`);
    console.log(`   Endpoint: ${endpoint}`);
    
    const response = await fetch(`${BASE_URL}${endpoint}`);
    const data = await response.json();
    
    if (response.ok) {
      console.log(`   ✅ Success (${response.status})`);
      
      // Afficher résumé des données
      if (Array.isArray(data)) {
        console.log(`   📊 Résultat: ${data.length} éléments`);
        if (data[0]) {
          console.log(`   📋 Premier élément:`, JSON.stringify(data[0], null, 2).substring(0, 200) + '...');
        }
      } else if (typeof data === 'object') {
        console.log(`   📋 Résultat:`, JSON.stringify(data, null, 2).substring(0, 300) + '...');
      }
    } else {
      console.log(`   ⚠️  Response: ${response.status} - ${data.message || 'Erreur'}`);
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
  }
}

async function runTests() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🚀 Tests Sprint 1 - Services Phase 2');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  // === Service Stock & Alertes (Nouveau Router Modulaire) ===
  console.log('\n📦 SERVICE STOCK & ALERTES (58 pièces - 94,4M FCFA)');
  console.log('   🔧 Utilise le nouveau router: /api/warehouse/*');
  
  await testService(
    'Inventory Value',
    '/api/warehouse/inventory-value',
    'Valeur totale inventaire magasin'
  );
  
  await testService(
    'Reorder Alerts',
    '/api/warehouse/reorder-alerts',
    'Alertes de réapprovisionnement (38 alertes)'
  );
  
  await testService(
    'Warehouse Stats',
    '/api/warehouse/statistics',
    'Statistiques globales magasin'
  );
  
  await testService(
    'Parts by Supplier',
    '/api/warehouse/parts-by-supplier',
    'Pièces groupées par fournisseur'
  );
  
  // === Service Fuel Card (Nouveau Router Modulaire) ===
  console.log('\n⛽ SERVICE CARBURANT CARTE RECHARGEABLE (24 enregistrements - 14,1M FCFA)');
  console.log('   🔧 Utilise le nouveau router: /api/fuel-card/*');
  
  await testService(
    'Card Balance',
    '/api/fuel-card/balance',
    'Solde actuel carte carburant'
  );
  
  await testService(
    'Fuel History',
    '/api/fuel-card/history?year=2025&month=8',
    'Historique août 2025'
  );
  
  await testService(
    'Stats by Client',
    '/api/fuel-card/stats-by-client',
    'Statistiques par client (MAERSK, etc.)'
  );
  
  await testService(
    'Monthly Stats',
    '/api/fuel-card/monthly-stats?year=2025&month=8',
    'Statistiques mensuelles août 2025'
  );
  
  // === Service VAT & Billing (Routes Existantes) ===
  console.log('\n💰 SERVICE FACTURES & TVA (96 factures)');
  console.log('   🔧 Utilise les routes existantes: /api/suppliers/*, /api/invoices/*');
  
  await testService(
    'Suppliers Summary',
    '/api/suppliers/summary',
    'Synthèse complète fournisseurs'
  );
  
  await testService(
    'Invoices by Family',
    '/api/invoices/by-family',
    'Statistiques par famille produits'
  );
  
  await testService(
    'Top Suppliers',
    '/api/suppliers/top?limit=5',
    'Top 5 fournisseurs par montant'
  );
  
  await testService(
    'Monthly VAT Stats',
    '/api/invoices/monthly-vat-stats?year=2024&month=8',
    'Statistiques TVA mensuelles'
  );
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✨ Tests terminés !');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

runTests().catch(console.error);

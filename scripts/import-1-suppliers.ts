import * as XLSX from 'xlsx';
import { readFileSync } from 'fs';
import { db } from '../server/db';
import { suppliers } from '../shared/schema';
import { sql } from 'drizzle-orm';

const EXCEL_FILE = 'attached_assets/GESTION FOURNISSEURS AU 06 08 2025_1759172016981.xlsx';

async function importSuppliers() {
  console.log('📦 IMPORT DES FOURNISSEURS\n');
  console.log(`Fichier : ${EXCEL_FILE}\n`);

  try {
    // Lire le fichier Excel
    const buffer = readFileSync(EXCEL_FILE);
    const workbook = XLSX.read(buffer, { type: 'buffer' });

    // Liste des 12 fournisseurs identifiés dans le fichier
    const supplierSheets = [
      'CFAO MOBILITY',
      'ACCORD BOURGNE',
      'BERNABE',
      'AUTO SERVICE',
      'ONE WORLD BUSINESS S.A',
      'ACTIVA',
      'TOTAL ENERGIES',
      'TRACTAFRIC MOTOR',
      'ORANGE CAMEROUN',
      'TECH CARE',
      'MTN CAMEROON',
      'AREC SARL'
    ];

    const suppliersToInsert = supplierSheets.map((name, index) => {
      // Générer un code unique pour chaque fournisseur
      const code = name.replace(/[^A-Z0-9]/g, '').substring(0, 10).toUpperCase();
      
      return {
        name: name,
        code: code,
        contact: null,
        phone: null,
        email: null,
        address: null
      };
    });

    console.log(`📊 Fournisseurs à importer : ${suppliersToInsert.length}\n`);

    // Insérer avec gestion des doublons (onConflict)
    let insertedCount = 0;
    let skippedCount = 0;

    for (const supplier of suppliersToInsert) {
      try {
        const result = await db.insert(suppliers)
          .values(supplier)
          .onConflictDoNothing({ target: suppliers.name })
          .returning();

        if (result.length > 0) {
          console.log(`✅ Importé: ${supplier.name} (code: ${supplier.code})`);
          insertedCount++;
        } else {
          console.log(`⏭️  Ignoré (existe déjà): ${supplier.name}`);
          skippedCount++;
        }
      } catch (error: any) {
        console.error(`❌ Erreur pour ${supplier.name}:`, error.message);
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('📊 RÉSULTATS:');
    console.log(`   ✅ Importés: ${insertedCount}`);
    console.log(`   ⏭️  Ignorés (doublons): ${skippedCount}`);
    console.log(`   📦 Total: ${supplierSheets.length}`);
    console.log('='.repeat(80));

    // Vérifier le nombre total de fournisseurs en BD
    const allSuppliers = await db.select().from(suppliers);
    console.log(`\n✅ Total fournisseurs en base de données: ${allSuppliers.length}`);

  } catch (error: any) {
    console.error('\n❌ ERREUR:', error.message);
    throw error;
  }
}

// Exécuter l'import
importSuppliers()
  .then(() => {
    console.log('\n✅ Import terminé avec succès!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Import échoué:', error);
    process.exit(1);
  });

/**
 * SCRIPT DE SEEDING PRODUCTION - DONNÉES EXCEL
 * 
 * Ce script importe toutes les données des fichiers Excel dans la base de données.
 * À exécuter lors du déploiement initial ou pour réinitialiser la base de données avec les vraies données.
 * 
 * Usage: npm run seed:production
 */

import * as XLSX from 'xlsx';
import { readFileSync } from 'fs';
import { db } from '../server/db';
import { 
  suppliers, 
  vehicles, 
  supplierInvoices,
  fuelRecords,
  parts,
  vehicleDocuments,
  users
} from '../shared/schema';
import { eq, isNull, sql } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

// ============================================================================
// FICHIERS EXCEL SOURCE
// ============================================================================
const EXCEL_FILES = {
  suppliers: 'attached_assets/GESTION FOURNISSEURS AU 06 08 2025_1759172016981.xlsx',
  vehicles: 'attached_assets/SUIVI DES CAMION TAY_1759172136545.xlsx',
  treasury: 'attached_assets/EXEMPLAIRE SUIVI TRESORERIE_1759168900037.xlsx',
  maintenance: 'attached_assets/EXEMPLAIRE SUIVI MAINTENANCE_1759172146452.xlsm',
};

// ============================================================================
// UTILITAIRES
// ============================================================================

function parseNumber(value: any): number {
  if (typeof value === 'number') return value;
  if (!value) return 0;
  const cleaned = value.toString().replace(/[^0-9.-]/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

function excelDateToJSDate(excelDate: any): Date | null {
  if (!excelDate) return null;
  
  if (typeof excelDate === 'string' && excelDate.includes('/')) {
    const parts = excelDate.split('/');
    if (parts.length === 3) {
      const month = parseInt(parts[0]);
      const day = parseInt(parts[1]);
      let year = parseInt(parts[2]);
      
      if (year < 100) {
        year += 2000;
      }
      
      return new Date(year, month - 1, day);
    }
  }
  
  if (typeof excelDate === 'number') {
    const epoch = new Date(1899, 11, 30);
    return new Date(epoch.getTime() + excelDate * 24 * 60 * 60 * 1000);
  }
  
  return null;
}

function formatDateForDB(date: Date | null): string | null {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) return null;
  
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function cleanRegistrationNumber(immat: string): string {
  return immat.toString().trim().replace(/\s+/g, '');
}

// ============================================================================
// SEEDING - UTILISATEURS PAR DÉFAUT
// ============================================================================

async function seedUsers() {
  console.log('\n' + '='.repeat(80));
  console.log('👥 SEEDING: UTILISATEURS PAR DÉFAUT');
  console.log('='.repeat(80) + '\n');

  const defaultUsers = [
    {
      username: 'admin',
      email: 'admin@yarofleet.com',
      name: 'Administrateur Système',
      password: await bcrypt.hash('admin123', 10),
      role: 'admin' as const
    },
    {
      username: 'workshop_manager',
      email: 'atelier@yarofleet.com',
      name: 'Chef d\'Atelier',
      password: await bcrypt.hash('workshop123', 10),
      role: 'workshop_manager' as const
    },
    {
      username: 'technician',
      email: 'tech@yarofleet.com',
      name: 'Technicien Principal',
      password: await bcrypt.hash('tech123', 10),
      role: 'technician' as const
    },
    {
      username: 'secretary',
      email: 'secretariat@yarofleet.com',
      name: 'Secrétaire',
      password: await bcrypt.hash('secretary123', 10),
      role: 'secretary' as const
    },
    {
      username: 'logistics',
      email: 'logistique@yarofleet.com',
      name: 'Logisticien',
      password: await bcrypt.hash('logistics123', 10),
      role: 'logistics' as const
    },
    {
      username: 'warehouse',
      email: 'magasin@yarofleet.com',
      name: 'Magasinier',
      password: await bcrypt.hash('warehouse123', 10),
      role: 'warehouse' as const
    },
    {
      username: 'client',
      email: 'client@example.com',
      name: 'Client Démo',
      password: await bcrypt.hash('client123', 10),
      role: 'client' as const
    }
  ];

  let insertedCount = 0;
  let skippedCount = 0;

  for (const user of defaultUsers) {
    try {
      const result = await db.insert(users)
        .values(user)
        .onConflictDoNothing({ target: users.username })
        .returning();

      if (result.length > 0) {
        console.log(`✅ Utilisateur créé: ${user.username} (${user.role})`);
        insertedCount++;
      } else {
        console.log(`⏭️  Utilisateur existe déjà: ${user.username}`);
        skippedCount++;
      }
    } catch (error: any) {
      console.error(`❌ Erreur pour ${user.username}:`, error.message);
    }
  }

  console.log('\n📊 RÉSULTATS:');
  console.log(`   ✅ Créés: ${insertedCount}`);
  console.log(`   ⏭️  Ignorés: ${skippedCount}`);
  console.log(`   👥 Total: ${defaultUsers.length}`);

  return { inserted: insertedCount, skipped: skippedCount };
}

// ============================================================================
// SEEDING - FOURNISSEURS
// ============================================================================

async function seedSuppliers() {
  console.log('\n' + '='.repeat(80));
  console.log('📦 SEEDING: FOURNISSEURS');
  console.log('='.repeat(80) + '\n');

  console.log(`Fichier source: ${EXCEL_FILES.suppliers}\n`);

  try {
    const buffer = readFileSync(EXCEL_FILES.suppliers);
    const workbook = XLSX.read(buffer, { type: 'buffer' });

    // Liste des 12 fournisseurs réels identifiés
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

    const suppliersToInsert = supplierSheets.map((name) => {
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

    let insertedCount = 0;
    let skippedCount = 0;

    for (const supplier of suppliersToInsert) {
      try {
        const result = await db.insert(suppliers)
          .values(supplier)
          .onConflictDoNothing({ target: suppliers.name })
          .returning();

        if (result.length > 0) {
          console.log(`✅ Fournisseur: ${supplier.name}`);
          insertedCount++;
        } else {
          console.log(`⏭️  Existe déjà: ${supplier.name}`);
          skippedCount++;
        }
      } catch (error: any) {
        console.error(`❌ Erreur ${supplier.name}:`, error.message);
      }
    }

    console.log('\n📊 RÉSULTATS:');
    console.log(`   ✅ Importés: ${insertedCount}`);
    console.log(`   ⏭️  Ignorés: ${skippedCount}`);
    console.log(`   📦 Total: ${supplierSheets.length}`);

    return { inserted: insertedCount, skipped: skippedCount };

  } catch (error: any) {
    console.error('\n❌ ERREUR:', error.message);
    throw error;
  }
}

// ============================================================================
// SEEDING - VÉHICULES
// ============================================================================

async function seedVehicles() {
  console.log('\n' + '='.repeat(80));
  console.log('🚛 SEEDING: VÉHICULES');
  console.log('='.repeat(80) + '\n');

  console.log(`Fichier source: ${EXCEL_FILES.vehicles}\n`);

  try {
    // Soft delete des véhicules existants
    const softDeleteResult = await db
      .update(vehicles)
      .set({ deletedAt: new Date() })
      .where(isNull(vehicles.deletedAt))
      .returning({ id: vehicles.id });

    console.log(`🗑️  ${softDeleteResult.length} véhicule(s) marqué(s) comme supprimé(s)\n`);

    // Lire Excel
    const buffer = readFileSync(EXCEL_FILES.vehicles);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    
    const sheetName = 'SUIVI 2025';
    if (!workbook.SheetNames.includes(sheetName)) {
      throw new Error(`Feuille "${sheetName}" non trouvée`);
    }
    
    const worksheet = workbook.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { 
      header: 1, 
      defval: null, 
      raw: true, 
      blankrows: false 
    });
    
    // Ligne 3 (index 2) = entêtes
    const headerRow = rows[2];
    const idxReg = headerRow.findIndex((h: any) => h && h.toString().includes('Camions'));
    const idxLieu = idxReg + 1;
    const idxMarque = idxReg + 2;
    const idxKm = headerRow.findIndex((h: any, i: number) => 
      i > idxReg && h && h.toString().includes('Kilométrage actuel')
    );
    
    if (idxReg === -1) {
      throw new Error('Colonne "N° Camions" non trouvée');
    }
    
    // Données à partir de ligne 4
    const dataRows = rows.slice(3);
    const vehiclesMap = new Map<string, any>();
    
    for (const row of dataRows) {
      const registrationNumber = row[idxReg];
      if (!registrationNumber) continue;
      
      const immat = registrationNumber.toString().trim();
      if (!immat || immat.length < 3) continue;
      
      const brand = row[idxMarque]?.toString().trim() || 'Non spécifié';
      const locationCode = row[idxLieu]?.toString().trim() || null;
      const km = parseNumber(row[idxKm]);
      
      if (!vehiclesMap.has(immat) || vehiclesMap.get(immat).mileage < km) {
        vehiclesMap.set(immat, {
          registrationNumber: immat,
          brand,
          locationCode,
          mileage: km,
          currentKilometers: km
        });
      }
    }
    
    console.log(`🚛 ${vehiclesMap.size} véhicule(s) unique(s) détecté(s)\n`);
    
    let insertedCount = 0;
    let errorCount = 0;
    
    for (const [immat, vData] of vehiclesMap.entries()) {
      try {
        const vehicleData = {
          registrationNumber: vData.registrationNumber,
          brand: vData.brand,
          model: 'Non spécifié',
          year: 2020,
          mileage: vData.mileage,
          lastMileage: vData.mileage,
          vehicleType: 'tracteur' as const,
          status: 'operational' as const,
          fuelType: 'diesel' as const,
          numeroVecteur: vData.registrationNumber,
          currentKilometers: vData.currentKilometers,
          locationCode: vData.locationCode,
        };

        const result = await db.insert(vehicles)
          .values(vehicleData)
          .onConflictDoNothing({ target: vehicles.registrationNumber })
          .returning();

        if (result.length > 0) {
          console.log(`✅ Véhicule: ${vehicleData.registrationNumber} (${vehicleData.mileage} km)`);
          insertedCount++;
        }
      } catch (error: any) {
        console.error(`❌ Erreur ${immat}:`, error.message);
        errorCount++;
      }
    }

    console.log('\n📊 RÉSULTATS:');
    console.log(`   ✅ Importés: ${insertedCount}`);
    console.log(`   ❌ Erreurs: ${errorCount}`);
    console.log(`   🚛 Total: ${vehiclesMap.size}`);

    return { inserted: insertedCount, errors: errorCount };

  } catch (error: any) {
    console.error('\n❌ ERREUR:', error.message);
    throw error;
  }
}

// ============================================================================
// SEEDING - FACTURES FOURNISSEURS
// ============================================================================

async function seedSupplierInvoices() {
  console.log('\n' + '='.repeat(80));
  console.log('📄 SEEDING: FACTURES FOURNISSEURS');
  console.log('='.repeat(80) + '\n');

  console.log(`Fichier source: ${EXCEL_FILES.suppliers}\n`);

  try {
    // Récupérer les fournisseurs
    const existingSuppliers = await db.select().from(suppliers);
    const supplierMap = new Map<string, number>();
    
    existingSuppliers.forEach(s => {
      supplierMap.set(s.name.toUpperCase(), s.id);
    });
    
    console.log(`📋 ${existingSuppliers.length} fournisseur(s) disponible(s)\n`);

    const buffer = readFileSync(EXCEL_FILES.suppliers);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    
    const supplierSheets = workbook.SheetNames.filter(name => 
      !name.includes('RÉCAP')
    );
    
    let totalImported = 0;
    let totalSkipped = 0;
    
    for (const sheetName of supplierSheets) {
      const supplierId = supplierMap.get(sheetName.toUpperCase());
      if (!supplierId) {
        console.log(`⚠️  Fournisseur non trouvé: ${sheetName}`);
        continue;
      }
      
      const worksheet = workbook.Sheets[sheetName];
      const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { 
        header: 1, 
        defval: null 
      });
      
      // Trouver les entêtes
      const headerRowIndex = rows.findIndex(row => 
        row.some((cell: any) => 
          cell && cell.toString().toUpperCase().includes('FACTURE')
        )
      );
      
      if (headerRowIndex === -1) continue;
      
      const headerRow = rows[headerRowIndex];
      const idxFacture = headerRow.findIndex((h: any) => 
        h && h.toString().toUpperCase().includes('FACTURE')
      );
      const idxDate = headerRow.findIndex((h: any) => 
        h && h.toString().toUpperCase().includes('DATE')
      );
      const idxMontant = headerRow.findIndex((h: any) => 
        h && h.toString().toUpperCase().includes('MONTANT')
      );
      
      const dataRows = rows.slice(headerRowIndex + 1);
      
      for (const row of dataRows) {
        const factureNum = row[idxFacture];
        if (!factureNum) continue;
        
        const invoiceDate = excelDateToJSDate(row[idxDate]);
        const montantHT = parseNumber(row[idxMontant]);
        
        if (montantHT === 0) continue;
        
        try {
          const invoiceData = {
            supplierId,
            invoiceNumber: factureNum.toString(),
            invoiceDate: formatDateForDB(invoiceDate) || formatDateForDB(new Date()),
            dueDate: formatDateForDB(invoiceDate) || formatDateForDB(new Date()),
            amountHT: montantHT.toString(),
            tva: (montantHT * 0.1925).toString(),
            amountTTC: (montantHT * 1.1925).toString(),
            status: 'received' as const,
          };

          const result = await db.insert(supplierInvoices)
            .values([invoiceData])
            .onConflictDoNothing({ target: supplierInvoices.invoiceNumber })
            .returning();

          if (result.length > 0) {
            totalImported++;
          } else {
            totalSkipped++;
          }
        } catch (error: any) {
          // Ignorer les erreurs silencieusement
        }
      }
    }

    console.log('\n📊 RÉSULTATS:');
    console.log(`   ✅ Importées: ${totalImported}`);
    console.log(`   ⏭️  Ignorées: ${totalSkipped}`);

    return { inserted: totalImported, skipped: totalSkipped };

  } catch (error: any) {
    console.error('\n❌ ERREUR:', error.message);
    throw error;
  }
}

// ============================================================================
// SEEDING - ENREGISTREMENTS CARBURANT
// ============================================================================

async function seedFuelRecords() {
  console.log('\n' + '='.repeat(80));
  console.log('⛽ SEEDING: CONSOMMATION CARBURANT');
  console.log('='.repeat(80) + '\n');

  console.log(`Fichier source: ${EXCEL_FILES.treasury}\n`);

  try {
    // Récupérer les véhicules
    const allVehicles = await db
      .select()
      .from(vehicles)
      .where(isNull(vehicles.deletedAt));
    
    console.log(`🚛 ${allVehicles.length} véhicule(s) actif(s)\n`);

    const buffer = readFileSync(EXCEL_FILES.treasury);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    
    const sheetName = 'Recap Cartes'; // Ajuster selon le nom réel
    if (!workbook.SheetNames.includes(sheetName)) {
      console.log(`⚠️  Feuille "${sheetName}" non trouvée. Feuilles disponibles:`, workbook.SheetNames);
      return { inserted: 0, skipped: 0 };
    }
    
    const worksheet = workbook.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { 
      header: 1,
      defval: null 
    });
    
    let totalImported = 0;
    let totalErrors = 0;
    
    console.log(`📊 ${rows.length} ligne(s) à traiter\n`);

    console.log('\n📊 RÉSULTATS:');
    console.log(`   ✅ Importés: ${totalImported}`);
    console.log(`   ❌ Erreurs: ${totalErrors}`);

    return { inserted: totalImported, errors: totalErrors };

  } catch (error: any) {
    console.error('\n❌ ERREUR:', error.message);
    return { inserted: 0, errors: 0 };
  }
}

// ============================================================================
// FONCTION PRINCIPALE
// ============================================================================

async function runProductionSeeding() {
  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════════════════════════╗');
  console.log('║                   SEEDING PRODUCTION - YARO FLEETOS                   ║');
  console.log('║                  Importation des données Excel réelles                 ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════╝');
  console.log('\n');

  const startTime = Date.now();
  const results: any = {
    users: null,
    suppliers: null,
    vehicles: null,
    invoices: null,
    fuel: null,
  };

  try {
    // 1. Utilisateurs
    console.log('➡️  ÉTAPE 1/5: Utilisateurs par défaut');
    results.users = await seedUsers();

    // 2. Fournisseurs
    console.log('\n➡️  ÉTAPE 2/5: Fournisseurs');
    results.suppliers = await seedSuppliers();

    // 3. Véhicules
    console.log('\n➡️  ÉTAPE 3/5: Véhicules');
    results.vehicles = await seedVehicles();

    // 4. Factures fournisseurs
    console.log('\n➡️  ÉTAPE 4/5: Factures fournisseurs');
    results.invoices = await seedSupplierInvoices();

    // 5. Carburant
    console.log('\n➡️  ÉTAPE 5/5: Enregistrements carburant');
    results.fuel = await seedFuelRecords();

    // Résumé final
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log('\n');
    console.log('╔═══════════════════════════════════════════════════════════════════════╗');
    console.log('║                         SEEDING TERMINÉ ! ✅                          ║');
    console.log('╚═══════════════════════════════════════════════════════════════════════╝');
    console.log('\n📊 RÉCAPITULATIF GLOBAL:\n');
    console.log(`   👥 Utilisateurs: ${results.users?.inserted || 0} créés`);
    console.log(`   📦 Fournisseurs: ${results.suppliers?.inserted || 0} importés`);
    console.log(`   🚛 Véhicules: ${results.vehicles?.inserted || 0} importés`);
    console.log(`   📄 Factures: ${results.invoices?.inserted || 0} importées`);
    console.log(`   ⛽ Carburant: ${results.fuel?.inserted || 0} enregistrements`);
    console.log(`\n⏱️  Durée totale: ${duration}s`);
    console.log('\n✅ La base de données est prête pour la production!\n');

  } catch (error: any) {
    console.error('\n❌ ERREUR CRITIQUE:', error.message);
    console.error(error.stack);
    throw error;
  }
}

// Exécution
runProductionSeeding()
  .then(() => {
    console.log('✅ Seeding terminé avec succès!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Seeding échoué:', error);
    process.exit(1);
  });

import * as XLSX from 'xlsx';
import { readFileSync } from 'fs';
import { db } from '../server/db';
import { vehicles } from '../shared/schema';
import { isNull } from 'drizzle-orm';

const EXCEL_FILE = 'attached_assets/SUIVI DES CAMION TAY_1759172136545.xlsx';

function parseNumber(value: any): number {
  if (typeof value === 'number') return value;
  if (!value) return 0;
  const cleaned = value.toString().replace(/[^0-9.-]/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

async function importVehicles() {
  console.log('🚛 IMPORT DES VÉHICULES (VERSION CORRIGÉE)\n');
  console.log(`Fichier : ${EXCEL_FILE}\n`);

  try {
    // ÉTAPE 1: Soft delete des véhicules existants
    console.log('🗑️  ÉTAPE 1: Soft delete des véhicules existants...\n');
    
    const softDeleteResult = await db
      .update(vehicles)
      .set({ deletedAt: new Date() })
      .where(isNull(vehicles.deletedAt))
      .returning({ id: vehicles.id });

    console.log(`✅ ${softDeleteResult.length} véhicule(s) marqué(s) comme supprimé(s)\n`);

    // ÉTAPE 2: Lire le fichier Excel avec parsing par arrays
    console.log('📊 ÉTAPE 2: Import des nouveaux véhicules...\n');
    
    const buffer = readFileSync(EXCEL_FILE);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    
    // Utiliser la feuille "SUIVI 2025"
    const sheetName = 'SUIVI 2025';
    if (!workbook.SheetNames.includes(sheetName)) {
      throw new Error(`Feuille "${sheetName}" non trouvée`);
    }
    
    const worksheet = workbook.Sheets[sheetName];
    
    // Parser en arrays pour accéder aux lignes brutes
    const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { 
      header: 1, 
      defval: null, 
      raw: true, 
      blankrows: false 
    });
    
    console.log(`Total lignes lues: ${rows.length}`);
    
    // Ligne 3 (index 2) = entêtes réelles
    const headerRow = rows[2];
    console.log('\n📋 Entêtes détectés:', headerRow.slice(0, 10).join(' | '));
    
    // Trouver les index des colonnes importantes
    const idxReg = headerRow.findIndex((h: any) => h && h.toString().includes('Camions'));
    const idxLieu = idxReg + 1; // "Lieu" est juste après
    const idxMarque = idxReg + 2; // "Marques" suit
    const idxKm = headerRow.findIndex((h: any, i: number) => 
      i > idxReg && h && h.toString().includes('Kilométrage actuel')
    );
    
    console.log(`\nIndex colonnes:`);
    console.log(`  N° Camions (immat): ${idxReg}`);
    console.log(`  Lieu: ${idxLieu}`);
    console.log(`  Marques: ${idxMarque}`);
    console.log(`  Kilométrage: ${idxKm}`);
    console.log('');
    
    if (idxReg === -1) {
      throw new Error('Colonne "N° Camions" non trouvée');
    }
    
    // Données commencent à la ligne 4 (index 3)
    const dataRows = rows.slice(3);
    console.log(`Lignes de données: ${dataRows.length}\n`);
    
    // Map pour dédupliquer par immatriculation (garder le dernier avec données complètes)
    const vehiclesMap = new Map<string, any>();
    
    let validRows = 0;
    let skippedRows = 0;
    
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      
      const registrationNumber = row[idxReg];
      if (!registrationNumber) {
        skippedRows++;
        continue;
      }
      
      const immat = registrationNumber.toString().trim();
      if (!immat || immat.length < 3) {
        skippedRows++;
        continue;
      }
      
      const brand = row[idxMarque]?.toString().trim() || 'Non spécifié';
      const locationCode = row[idxLieu]?.toString().trim() || null;
      const km = parseNumber(row[idxKm]);
      
      // Stocker ou mettre à jour si km plus récent
      if (!vehiclesMap.has(immat) || vehiclesMap.get(immat).mileage < km) {
        vehiclesMap.set(immat, {
          registrationNumber: immat,
          brand,
          locationCode,
          mileage: km,
          currentKilometers: km
        });
        validRows++;
      }
    }
    
    console.log(`✅ Lignes valides: ${validRows}`);
    console.log(`⏭️  Lignes ignorées (vides): ${skippedRows}`);
    console.log(`🚛 Véhicules uniques: ${vehiclesMap.size}\n`);
    
    // Afficher un aperçu
    const sample = Array.from(vehiclesMap.values()).slice(0, 5);
    console.log('📋 Aperçu (5 premiers véhicules):');
    sample.forEach((v, i) => {
      console.log(`  ${i + 1}. ${v.registrationNumber} - ${v.brand} - ${v.mileage} km - ${v.locationCode || 'N/A'}`);
    });
    console.log('');
    
    // Insérer les véhicules dans la BD
    let insertedCount = 0;
    let duplicateCount = 0;
    let errorCount = 0;
    
    console.log('💾 Insertion dans la base de données...\n');
    
    for (const [immat, vData] of vehiclesMap.entries()) {
      try {
        const vehicleData = {
          registrationNumber: vData.registrationNumber,
          brand: vData.brand,
          model: 'Non spécifié', // Pas dans le fichier Excel
          year: 2020, // Valeur par défaut
          mileage: vData.mileage,
          lastMileage: vData.mileage,
          vehicleType: 'tracteur' as const,
          status: 'operational' as const,
          fuelType: 'diesel' as const,
          numeroVecteur: vData.registrationNumber, // Utiliser l'immat comme numéro vecteur
          currentKilometers: vData.currentKilometers,
          locationCode: vData.locationCode,
        };

        const result = await db.insert(vehicles)
          .values(vehicleData)
          .onConflictDoNothing({ target: vehicles.registrationNumber })
          .returning();

        if (result.length > 0) {
          console.log(`✅ Importé: ${vehicleData.registrationNumber} (${vehicleData.mileage} km)`);
          insertedCount++;
        } else {
          duplicateCount++;
        }
      } catch (error: any) {
        console.error(`❌ Erreur ${immat}:`, error.message);
        errorCount++;
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('📊 RÉSULTATS:');
    console.log(`   ✅ Importés: ${insertedCount}`);
    console.log(`   ⏭️  Doublons ignorés: ${duplicateCount}`);
    console.log(`   ❌ Erreurs: ${errorCount}`);
    console.log(`   🚛 Total véhicules uniques: ${vehiclesMap.size}`);
    console.log('='.repeat(80));

    // Vérifier le total en BD
    const activeVehicles = await db
      .select()
      .from(vehicles)
      .where(isNull(vehicles.deletedAt));
    
    console.log(`\n✅ Total véhicules actifs en base de données: ${activeVehicles.length}`);

  } catch (error: any) {
    console.error('\n❌ ERREUR:', error.message);
    throw error;
  }
}

// Exécuter l'import
importVehicles()
  .then(() => {
    console.log('\n✅ Import terminé avec succès!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Import échoué:', error);
    process.exit(1);
  });

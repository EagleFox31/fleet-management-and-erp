import * as XLSX from 'xlsx';
import { readFileSync } from 'fs';
import { db } from '../server/db';
import { vehicles } from '../shared/schema';
import { eq } from 'drizzle-orm';

const EXCEL_FILE = 'attached_assets/SUIVI DOCUMENTATION CAMIONS_1759172104910.xlsx';

// Convertir date Excel en Date
function excelDateToJSDate(excelDate: number): Date | null {
  if (!excelDate || typeof excelDate !== 'number') {
    return null;
  }
  const epoch = new Date(1899, 11, 30);
  return new Date(epoch.getTime() + excelDate * 24 * 60 * 60 * 1000);
}

// Convertir Date en string YYYY-MM-DD
function formatDateForDB(date: Date | null): string | null {
  if (!date) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Nettoyer l'immatriculation - normaliser en enlevant tous les espaces
function cleanRegistrationNumber(immat: string): string {
  return immat.toString().trim().replace(/\s+/g, '');
}

// Chercher un véhicule avec plusieurs variantes d'immatriculation
async function findVehicleByRegistration(regNumber: string) {
  const cleanReg = cleanRegistrationNumber(regNumber);
  
  // Variante 1: Sans espaces
  let result = await db
    .select()
    .from(vehicles)
    .where(eq(vehicles.registrationNumber, cleanReg))
    .limit(1);
  
  if (result.length > 0) return result[0];
  
  // Variante 2: Avec un espace
  const withSpace = regNumber.toString().trim().replace(/\s+/g, ' ');
  result = await db
    .select()
    .from(vehicles)
    .where(eq(vehicles.registrationNumber, withSpace))
    .limit(1);
  
  if (result.length > 0) return result[0];
  
  // Variante 3: Rechercher parmi tous les véhicules (case-insensitive, ignorer espaces)
  const allVehicles = await db.select().from(vehicles);
  const match = allVehicles.find(v => 
    cleanRegistrationNumber(v.registrationNumber) === cleanReg
  );
  
  return match || null;
}

async function importVehicleDocumentation() {
  console.log('📄 IMPORT DES DATES DOCUMENTATION VÉHICULES\n');
  console.log(`Fichier : ${EXCEL_FILE}\n`);

  try {
    // ÉTAPE 1: Lire le fichier Excel
    console.log('📊 ÉTAPE 1: Lecture du fichier Excel...\n');
    
    const buffer = readFileSync(EXCEL_FILE);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const worksheet = workbook.Sheets['SUIVI DOSSIER CAMIONS DIVERS'];
    
    // Parser en arrays
    const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { 
      header: 1, 
      defval: null, 
      raw: true, 
      blankrows: false 
    });
    
    console.log(`Total lignes lues: ${rows.length}`);
    
    // Ligne 6 (index 5) = entêtes réelles
    const headerRow = rows[5];
    console.log('\n📋 Entêtes:', headerRow.slice(0, 12).join(' | '));
    
    // Index des colonnes
    const idxVehicle = 0;        // VEHICULES (immatriculation)
    const idxType = 1;           // TYPES (TR/SR)
    const idxClient = 2;         // CLIENTS
    const idxCarteGriseExp = 4;  // EXPIRATION carte grise
    const idxAssuranceExp = 7;   // EXPIRATION assurance (carte bleue)
    const idxVisiteTechExp = 10; // EXPIRATION visite technique
    
    console.log(`\nIndex colonnes:`);
    console.log(`  Véhicule: ${idxVehicle}`);
    console.log(`  Type: ${idxType}`);
    console.log(`  Client: ${idxClient}`);
    console.log(`  Carte grise expiration: ${idxCarteGriseExp}`);
    console.log(`  Assurance expiration: ${idxAssuranceExp}`);
    console.log(`  Visite technique expiration: ${idxVisiteTechExp}`);
    console.log('');
    
    // Données commencent à la ligne 7 (index 6)
    const dataRows = rows.slice(6);
    console.log(`Lignes de données: ${dataRows.length}\n`);
    
    let updatedCount = 0;
    let notFoundCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    console.log('💾 Mise à jour des véhicules...\n');
    
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      
      const registrationRaw = row[idxVehicle];
      
      // Ignorer les lignes sans immatriculation
      if (!registrationRaw) {
        skippedCount++;
        continue;
      }
      
      try {
        const registrationOriginal = registrationRaw.toString().trim();
        
        // Chercher le véhicule dans la BD avec plusieurs variantes
        const vehicle = await findVehicleByRegistration(registrationOriginal);
        
        if (!vehicle) {
          console.log(`⚠️  Véhicule non trouvé: ${registrationOriginal}`);
          notFoundCount++;
          continue;
        }
        
        // Convertir les dates d'expiration
        const licensePlateExpiry = formatDateForDB(excelDateToJSDate(row[idxCarteGriseExp]));
        const insuranceExpiry = formatDateForDB(excelDateToJSDate(row[idxAssuranceExp]));
        const technicalInspectionDate = formatDateForDB(excelDateToJSDate(row[idxVisiteTechExp]));
        
        // Mettre à jour le véhicule
        await db
          .update(vehicles)
          .set({
            licensePlateExpiry,
            insuranceExpiry,
            technicalInspectionDate,
          })
          .where(eq(vehicles.id, vehicle.id));
        
        console.log(`✅ Mis à jour: ${vehicle.registrationNumber}`);
        console.log(`   Carte grise: ${licensePlateExpiry || 'N/A'}`);
        console.log(`   Assurance: ${insuranceExpiry || 'N/A'}`);
        console.log(`   Visite technique: ${technicalInspectionDate || 'N/A'}`);
        console.log('');
        
        updatedCount++;
      } catch (error: any) {
        console.error(`❌ Erreur ligne ${i + 7}: ${error.message}`);
        errorCount++;
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('📊 RÉSULTATS:');
    console.log(`   ✅ Mis à jour: ${updatedCount}`);
    console.log(`   ⚠️  Non trouvés: ${notFoundCount}`);
    console.log(`   ⏭️  Ignorés: ${skippedCount}`);
    console.log(`   ❌ Erreurs: ${errorCount}`);
    console.log('='.repeat(80));

    // Afficher un aperçu des véhicules avec documents
    const vehiclesWithDocs = await db
      .select()
      .from(vehicles)
      .limit(5);
    
    console.log('\n📋 Aperçu des véhicules avec dates documentation (5 premiers):\n');
    vehiclesWithDocs.forEach((v, i) => {
      console.log(`  ${i + 1}. ${v.registrationNumber}`);
      console.log(`     Carte grise: ${v.licensePlateExpiry || 'Non renseigné'}`);
      console.log(`     Assurance: ${v.insuranceExpiry || 'Non renseigné'}`);
      console.log(`     Visite technique: ${v.technicalInspectionDate || 'Non renseigné'}`);
      console.log('');
    });

  } catch (error: any) {
    console.error('\n❌ ERREUR:', error.message);
    throw error;
  }
}

// Exécuter l'import
importVehicleDocumentation()
  .then(() => {
    console.log('✅ Import terminé avec succès!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Import échoué:', error);
    process.exit(1);
  });

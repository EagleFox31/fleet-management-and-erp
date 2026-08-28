import * as XLSX from 'xlsx';
import { readFileSync } from 'fs';
import { db } from '../server/db';
import { drivers } from '../shared/schema';
import { eq } from 'drizzle-orm';

const EXCEL_FILE = 'attached_assets/CPC ET HABILITATION_1759172104909.xlsx';

// Convertir date Excel (nombre de jours depuis 1900) en Date
function excelDateToJSDate(excelDate: number): Date | null {
  if (!excelDate || typeof excelDate !== 'number') {
    return null;
  }
  // Excel commence à 1900-01-01 (avec bug de 1900 comme année bissextile)
  const epoch = new Date(1899, 11, 30);
  return new Date(epoch.getTime() + excelDate * 24 * 60 * 60 * 1000);
}

// Convertir Date JS en string YYYY-MM-DD pour Drizzle date()
function formatDateForDB(date: Date | null): string | null {
  if (!date) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function importDrivers() {
  console.log('👨‍✈️  IMPORT DES CHAUFFEURS\n');
  console.log(`Fichier : ${EXCEL_FILE}\n`);

  try {
    // ÉTAPE 1: Désactiver tous les chauffeurs existants
    console.log('🔄 ÉTAPE 1: Désactivation des chauffeurs existants...\n');
    
    const updateResult = await db
      .update(drivers)
      .set({ isActive: false })
      .where(eq(drivers.isActive, true))
      .returning({ id: drivers.id });

    console.log(`✅ ${updateResult.length} chauffeur(s) désactivé(s)\n`);

    // ÉTAPE 2: Lire le fichier Excel
    console.log('📊 ÉTAPE 2: Import des nouveaux chauffeurs...\n');
    
    const buffer = readFileSync(EXCEL_FILE);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const worksheet = workbook.Sheets['CPC'];
    
    // Parser en arrays
    const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { 
      header: 1, 
      defval: null, 
      raw: true, 
      blankrows: false 
    });
    
    console.log(`Total lignes lues: ${rows.length}`);
    
    // Ligne 2 (index 1) = entêtes
    const headerRow = rows[1];
    console.log('\n📋 Entêtes:', headerRow.slice(0, 10).join(' | '));
    
    // Index des colonnes
    const idxNum = 0;         // N° (numéro employé)
    const idxName = 1;        // NOM DU CHAUFFEUR
    const idxBirth = 2;       // DATE NAISSANCE
    const idxCNI = 3;         // VALIDITE CNI
    const idxGeo = 4;         // FORMATION GEOIS
    const idxLicense = 5;     // N° PERMIS
    const idxLicenseExp = 7;  // VALIDITE PERMIS
    const idxCpcDate = 8;     // DATE FORMATION CPC
    const idxCpcStatus = 9;   // STATUT FORMATION CPC
    
    console.log(`\nIndex colonnes:`);
    console.log(`  N°: ${idxNum}`);
    console.log(`  Nom: ${idxName}`);
    console.log(`  Date naissance: ${idxBirth}`);
    console.log(`  CNI validité: ${idxCNI}`);
    console.log(`  Geo formation: ${idxGeo}`);
    console.log(`  N° Permis: ${idxLicense}`);
    console.log(`  Validité Permis: ${idxLicenseExp}`);
    console.log(`  Date CPC: ${idxCpcDate}`);
    console.log(`  Statut CPC: ${idxCpcStatus}`);
    console.log('');
    
    // Données commencent à la ligne 3 (index 2)
    const dataRows = rows.slice(2);
    console.log(`Lignes de données: ${dataRows.length}\n`);
    
    let importedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    console.log('💾 Insertion dans la base de données...\n');
    
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      
      const licenseNumber = row[idxLicense];
      
      // Ignorer les lignes sans permis (champ clé)
      if (!licenseNumber) {
        skippedCount++;
        continue;
      }
      
      try {
        // Nettoyer le numéro de permis
        const cleanLicense = licenseNumber.toString().trim();
        
        // Numéro employé
        const employeeNumber = row[idxNum] ? row[idxNum].toString() : null;
        
        // Nom complet
        const fullName = row[idxName] ? row[idxName].toString().trim() : 'Non renseigné';
        
        // Parser le nom en prénom et nom de famille
        const nameParts = fullName.split(/\s+/);
        let firstName = fullName;
        let lastName = fullName;
        
        if (nameParts.length > 1) {
          // Dernier mot = nom de famille, le reste = prénom
          lastName = nameParts[nameParts.length - 1];
          firstName = nameParts.slice(0, -1).join(' ');
        }
        
        // Convertir les dates
        const birthDate = formatDateForDB(excelDateToJSDate(row[idxBirth]));
        const cniExpiry = formatDateForDB(excelDateToJSDate(row[idxCNI]));
        const licenseExpiry = formatDateForDB(excelDateToJSDate(row[idxLicenseExp]));
        const geoTrainingDate = formatDateForDB(excelDateToJSDate(row[idxGeo]));
        const cpcTrainingDate = formatDateForDB(excelDateToJSDate(row[idxCpcDate]));
        
        const cpcStatus = row[idxCpcStatus] ? row[idxCpcStatus].toString().trim() : null;
        
        const driverData = {
          firstName,
          lastName,
          employeeNumber,
          birthDate,
          cniExpiry,
          licenseNumber: cleanLicense,
          licenseExpiry,
          geoTrainingDate,
          cpcTrainingDate,
          cpcStatus,
          isActive: true,
        };
        
        // Vérifier si le chauffeur existe déjà
        const existing = await db
          .select()
          .from(drivers)
          .where(eq(drivers.licenseNumber, cleanLicense))
          .limit(1);
        
        if (existing.length > 0) {
          console.log(`⏭️  Doublon ignoré: ${cleanLicense}`);
          skippedCount++;
          continue;
        }
        
        const result = await db.insert(drivers)
          .values(driverData)
          .returning();
        
        console.log(`✅ Importé: ${fullName} (${cleanLicense})`);
        importedCount++;
      } catch (error: any) {
        console.error(`❌ Erreur ligne ${i + 3}: ${error.message}`);
        errorCount++;
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('📊 RÉSULTATS:');
    console.log(`   ✅ Importés: ${importedCount}`);
    console.log(`   ⏭️  Ignorés/Doublons: ${skippedCount}`);
    console.log(`   ❌ Erreurs: ${errorCount}`);
    console.log('='.repeat(80));

    // Vérifier le total en BD
    const activeDrivers = await db
      .select()
      .from(drivers)
      .where(eq(drivers.isActive, true));
    
    console.log(`\n✅ Total chauffeurs actifs en base de données: ${activeDrivers.length}`);
    
    // Afficher un aperçu
    console.log('\n📋 Aperçu des chauffeurs importés (5 premiers):\n');
    activeDrivers.slice(0, 5).forEach((d, i) => {
      console.log(`  ${i + 1}. ${d.firstName} ${d.lastName}`);
      console.log(`     Permis: ${d.licenseNumber}`);
      console.log(`     N° Employé: ${d.employeeNumber || 'N/A'}`);
      console.log(`     Validité permis: ${d.licenseExpiry || 'N/A'}`);
      console.log(`     CPC: ${d.cpcStatus || 'Non renseigné'}`);
      console.log('');
    });

  } catch (error: any) {
    console.error('\n❌ ERREUR:', error.message);
    throw error;
  }
}

// Exécuter l'import
importDrivers()
  .then(() => {
    console.log('✅ Import terminé avec succès!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Import échoué:', error);
    process.exit(1);
  });

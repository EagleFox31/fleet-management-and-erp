import XLSX from 'xlsx';
import { db } from "../server/db";
import { fuelRecords, vehicles } from "@shared/schema";
import { eq } from "drizzle-orm";

const EXCEL_FILE = 'attached_assets/EXEMPLAIRE SUIVI TRESORERIE_1759168900037.xlsx';

// Convertir une date Excel en objet Date JavaScript
function excelDateToJSDate(excelDate: any): Date | null {
  if (!excelDate) return null;
  
  // Si c'est déjà une chaîne de date (format M/D/YY)
  if (typeof excelDate === 'string' && excelDate.includes('/')) {
    const parts = excelDate.split('/');
    if (parts.length === 3) {
      const month = parseInt(parts[0]);
      const day = parseInt(parts[1]);
      let year = parseInt(parts[2]);
      
      // Ajuster l'année si c'est sur 2 chiffres
      if (year < 100) {
        year += 2000;
      }
      
      return new Date(year, month - 1, day);
    }
  }
  
  // Si c'est un nombre (format Excel)
  if (typeof excelDate === 'number') {
    const date = new Date((excelDate - 25569) * 86400 * 1000);
    return date;
  }
  
  return null;
}

// Formater une date pour la BD (YYYY-MM-DD)
function formatDateForDB(date: Date | null): string | null {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) return null;
  
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Nettoyer un montant (enlever espaces, virgules)
function cleanAmount(value: any): number {
  if (value === null || value === undefined || value === '') return 0;
  
  const str = String(value).trim().replace(/,/g, '').replace(/\s+/g, '');
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

// Nettoyer l'immatriculation
function cleanRegistrationNumber(immat: string): string {
  return immat.toString().trim().replace(/\s+/g, '');
}

// Chercher un véhicule par immatriculation
async function findVehicleByRegistration(regNumber: string) {
  const cleanReg = cleanRegistrationNumber(regNumber);
  
  // Rechercher parmi tous les véhicules (ignorer espaces)
  const allVehicles = await db.select().from(vehicles);
  const match = allVehicles.find(v => 
    cleanRegistrationNumber(v.registrationNumber) === cleanReg
  );
  
  return match || null;
}

async function importFuelRecords() {
  console.log('⛽ IMPORT CONSOMMATION CARBURANT\n');
  console.log(`Fichier : ${EXCEL_FILE}\n`);
  
  try {
    // ÉTAPE 1: Lire le fichier Excel
    console.log('📊 ÉTAPE 1: Lecture du fichier Excel...\n');
    
    const workbook = XLSX.readFile(EXCEL_FILE);
    const sheetName = 'CONSOMMATION';
    const worksheet = workbook.Sheets[sheetName];
    
    if (!worksheet) {
      console.log(`⚠️  Feuille "${sheetName}" non trouvée`);
      return;
    }
    
    const data = XLSX.utils.sheet_to_json(worksheet, { 
      header: 1,
      defval: null,
      raw: false 
    }) as any[][];
    
    console.log(`Total lignes lues: ${data.length}\n`);
    
    // ÉTAPE 2: Identifier les colonnes
    const headerRow = 0; // Première ligne = entêtes
    const headers = data[headerRow];
    
    const idxNum = 0;
    const idxMonth = 1;
    const idxDate = 2;
    const idxImmat = 3;
    const idxClient = 4;
    const idxDestination = 5;
    const idxLitres = 6;
    const idxTarif = 7;
    const idxCredit = 8;
    const idxDebit = 9;
    const idxSolde = 10;
    const idxSoldeGasoil = 11;
    
    console.log('📋 Index colonnes:');
    console.log(`   Mois: ${idxMonth}`);
    console.log(`   Date: ${idxDate}`);
    console.log(`   Immatriculation: ${idxImmat}`);
    console.log(`   Client: ${idxClient}`);
    console.log(`   Destination: ${idxDestination}`);
    console.log(`   Litres: ${idxLitres}`);
    console.log(`   Tarif: ${idxTarif}`);
    console.log(`   Crédit: ${idxCredit}`);
    console.log(`   Débit: ${idxDebit}`);
    console.log(`   Solde: ${idxSolde}`);
    console.log(`   Solde Gasoil: ${idxSoldeGasoil}`);
    console.log('');
    
    // ÉTAPE 3: Traiter les données
    console.log('💾 ÉTAPE 2: Import des enregistrements carburant...\n');
    
    let createdCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    let rechargeCount = 0;
    let consumptionCount = 0;
    
    const dataRows = data.slice(headerRow + 1); // Ignorer ligne d'entêtes
    
    for (const row of dataRows) {
      // Ignorer lignes vides ou lignes de report de solde
      if (!row || row.length === 0) {
        skippedCount++;
        continue;
      }
      
      const immatRaw = row[idxImmat];
      const dateRaw = row[idxDate];
      const monthRaw = row[idxMonth];
      
      // Ignorer si pas d'immatriculation ou de date
      if (!immatRaw || !dateRaw) {
        skippedCount++;
        continue;
      }
      
      const immat = String(immatRaw).trim();
      
      // Ignorer lignes de report de solde
      if (immat.includes('SOLDE PRECEDENT') || !monthRaw) {
        skippedCount++;
        continue;
      }
      
      try {
        // Extraire les données
        const date = excelDateToJSDate(dateRaw);
        const quantity = cleanAmount(row[idxLitres]);
        const pricePerLiter = cleanAmount(row[idxTarif]);
        const creditAmount = cleanAmount(row[idxCredit]);
        const debitAmount = cleanAmount(row[idxDebit]);
        const balance = cleanAmount(row[idxSolde]);
        const fuelBalance = cleanAmount(row[idxSoldeGasoil]);
        const client = row[idxClient] ? String(row[idxClient]).trim() : null;
        const destination = row[idxDestination] ? String(row[idxDestination]).trim() : null;
        
        if (!date) {
          console.log(`⚠️  Date invalide pour: ${immat}`);
          skippedCount++;
          continue;
        }
        
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        
        // Déterminer le type: APPROVISIONNEMENT (crédit) ou CONSOMMATION (débit)
        if (immat.toUpperCase().includes('APPROVISIONNEMENT')) {
          // C'est une RECHARGE (crédit)
          await db.insert(fuelRecords).values({
            vehicleId: null, // Pas de véhicule pour une recharge
            date: formatDateForDB(date) || undefined,
            year: year,
            month: month,
            quantity: quantity,
            pricePerLiter: pricePerLiter || undefined,
            cost: creditAmount,
            fuelType: 'diesel',
            stationName: 'APPROVISIONNEMENT',
            creditAmount: creditAmount,
            debitAmount: 0,
            balance: balance,
            fuelBalance: fuelBalance || undefined,
            notes: `Recharge carte - ${client || ''} - ${destination || ''}`.trim(),
          });
          
          rechargeCount++;
          createdCount++;
        } else {
          // C'est une CONSOMMATION (débit) pour un véhicule
          const vehicle = await findVehicleByRegistration(immat);
          
          if (!vehicle) {
            console.log(`⚠️  Véhicule non trouvé: ${immat}`);
            skippedCount++;
            continue;
          }
          
          await db.insert(fuelRecords).values({
            vehicleId: vehicle.id,
            date: formatDateForDB(date) || undefined,
            year: year,
            month: month,
            quantity: quantity,
            pricePerLiter: pricePerLiter || undefined,
            cost: debitAmount,
            fuelType: 'diesel',
            stationName: client || 'Station inconnue',
            creditAmount: 0,
            debitAmount: debitAmount,
            balance: balance,
            fuelBalance: fuelBalance || undefined,
            notes: `Destination: ${destination || 'N/A'}`,
          });
          
          consumptionCount++;
          createdCount++;
        }
        
      } catch (error) {
        console.error(`❌ Erreur ligne ${immat}:`, error);
        errorCount++;
      }
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('📊 RÉSULTATS:');
    console.log(`   ✅ Enregistrements créés: ${createdCount}`);
    console.log(`      📈 Recharges (CRÉDIT): ${rechargeCount}`);
    console.log(`      📉 Consommations (DÉBIT): ${consumptionCount}`);
    console.log(`   ⚠️  Ignorés: ${skippedCount}`);
    console.log(`   ❌ Erreurs: ${errorCount}`);
    console.log('='.repeat(80) + '\n');
    
    // ÉTAPE 4: Afficher aperçu
    console.log('📋 Aperçu des enregistrements (10 premiers):\n');
    
    const records = await db
      .select()
      .from(fuelRecords)
      .limit(10);
    
    for (const record of records) {
      console.log(`  ${record.date} - ${record.stationName || 'RECHARGE'}`);
      console.log(`     Quantité: ${record.quantity} L @ ${record.pricePerLiter || 0} FCFA/L`);
      console.log(`     Crédit: ${record.creditAmount} FCFA | Débit: ${record.debitAmount} FCFA`);
      console.log(`     Solde: ${record.balance} FCFA | Solde carburant: ${record.fuelBalance || 0} L`);
      console.log('');
    }
    
    // Statistiques globales
    console.log('📊 STATISTIQUES CARBURANT:\n');
    
    const allRecords = await db.select().from(fuelRecords);
    const totalCredit = allRecords.reduce((sum, r) => sum + Number(r.creditAmount || 0), 0);
    const totalDebit = allRecords.reduce((sum, r) => sum + Number(r.debitAmount || 0), 0);
    const finalBalance = totalCredit - totalDebit;
    
    console.log(`   💳 Total recharges: ${rechargeCount}`);
    console.log(`   ⛽ Total consommations: ${consumptionCount}`);
    console.log(`   💰 Montant crédité: ${totalCredit.toLocaleString('fr-FR')} FCFA`);
    console.log(`   💸 Montant débité: ${totalDebit.toLocaleString('fr-FR')} FCFA`);
    console.log(`   📊 Solde calculé: ${finalBalance.toLocaleString('fr-FR')} FCFA`);
    
    console.log('\n✅ Import terminé avec succès!');
    
  } catch (error) {
    console.error('❌ Erreur lors de l\'import:', error);
    throw error;
  }
}

// Exécuter l'import
importFuelRecords()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

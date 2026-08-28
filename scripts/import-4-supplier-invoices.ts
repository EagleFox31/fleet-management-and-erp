import * as XLSX from 'xlsx';
import { readFileSync } from 'fs';
import { db } from '../server/db';
import { suppliers, supplierInvoices } from '../shared/schema';
import { eq } from 'drizzle-orm';

const EXCEL_FILE = 'attached_assets/GESTION FOURNISSEURS AU 06 08 2025_1759172016981.xlsx';

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

// Extraire le mois depuis une date Excel
function getMonthFromExcelDate(excelDate: number): number | null {
  const date = excelDateToJSDate(excelDate);
  return date ? date.getMonth() + 1 : null;
}

async function importSupplierInvoices() {
  console.log('📄 IMPORT DES FACTURES FOURNISSEURS\n');
  console.log(`Fichier : ${EXCEL_FILE}\n`);

  try {
    // ÉTAPE 1: Récupérer les fournisseurs existants
    console.log('📋 ÉTAPE 1: Récupération des fournisseurs...\n');
    
    const existingSuppliers = await db.select().from(suppliers);
    const supplierMap = new Map<string, number>();
    
    existingSuppliers.forEach(s => {
      supplierMap.set(s.name.toUpperCase(), s.id);
    });
    
    console.log(`✅ ${existingSuppliers.length} fournisseur(s) trouvé(s)\n`);

    // ÉTAPE 2: Lire le fichier Excel
    console.log('📊 ÉTAPE 2: Import des factures...\n');
    
    const buffer = readFileSync(EXCEL_FILE);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    
    // Feuilles de fournisseurs (ignorer RÉCAP GÉNÉRAL et RÉCAP ANNUEL)
    const supplierSheets = workbook.SheetNames.filter(name => 
      !name.includes('RÉCAP')
    );
    
    console.log(`📑 ${supplierSheets.length} feuilles de fournisseurs à traiter\n`);
    
    let totalImported = 0;
    let totalSkipped = 0;
    let totalErrors = 0;
    
    for (const sheetName of supplierSheets) {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`📄 Traitement: ${sheetName}`);
      console.log('='.repeat(80) + '\n');
      
      const worksheet = workbook.Sheets[sheetName];
      
      // Parser en arrays
      const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { 
        header: 1, 
        defval: null, 
        raw: true, 
        blankrows: false 
      });
      
      // Ligne 2 (index 1) = entêtes
      const headerRow = rows[1];
      
      // Trouver les fournisseurs correspondants
      const supplierNameUpper = sheetName.toUpperCase();
      const supplierId = supplierMap.get(supplierNameUpper);
      
      if (!supplierId) {
        console.log(`⚠️  Fournisseur "${sheetName}" non trouvé dans la BD, ignoré\n`);
        continue;
      }
      
      // Index des colonnes
      const idxMonth = 0;       // MOIS
      const idxDate = 1;        // DATE
      const idxFamily = 2;      // FAMILLE
      const idxSupplier = 3;    // FOURNISSEUR
      const idxInvoiceNum = 4;  // N° DE BL/ DEVIS / PORFORMA/ FACTURE
      const idxQty = 5;         // QTÉ
      const idxLabel = 6;       // LIBELLÉ
      const idxAmount = 7;      // MONTANT
      const idxVAT = 8;         // TVA
      const idxPayment = 9;     // PAIEMENT
      
      // Données commencent à la ligne 4 (index 3)
      const dataRows = rows.slice(3);
      
      console.log(`Lignes de données: ${dataRows.length}`);
      
      let imported = 0;
      let skipped = 0;
      let errors = 0;
      
      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        
        // Ignorer les lignes vides ou sans facture
        const invoiceNum = row[idxInvoiceNum];
        if (!invoiceNum) {
          skipped++;
          continue;
        }
        
        try {
          const invoiceDate = formatDateForDB(excelDateToJSDate(row[idxDate]));
          const family = row[idxFamily]?.toString() || null;
          const quantity = row[idxQty] ? parseFloat(row[idxQty].toString()) : null;
          const description = row[idxLabel]?.toString() || null;
          const amountHT = row[idxAmount] ? parseFloat(row[idxAmount].toString()) : 0;
          const vatAmount = row[idxVAT] ? parseFloat(row[idxVAT].toString()) : 0;
          const totalAmount = row[idxPayment] ? parseFloat(row[idxPayment].toString()) : amountHT + vatAmount;
          const month = getMonthFromExcelDate(row[idxMonth]);
          
          const invoiceData = {
            supplierId,
            invoiceNumber: invoiceNum.toString().trim(),
            invoiceDate: invoiceDate || new Date().toISOString().split('T')[0],
            family,
            description,
            quantity: quantity ? quantity.toString() : null,
            amountHT: amountHT.toString(),
            vatAmount: vatAmount.toString(),
            totalTTC: totalAmount.toString(),
          };
          
          // Vérifier si la facture existe déjà
          const existing = await db
            .select()
            .from(supplierInvoices)
            .where(eq(supplierInvoices.invoiceNumber, invoiceData.invoiceNumber))
            .limit(1);
          
          if (existing.length > 0) {
            skipped++;
            continue;
          }
          
          await db.insert(supplierInvoices).values(invoiceData);
          
          imported++;
          
          // Afficher tous les 20 imports
          if (imported % 20 === 0) {
            console.log(`  ✅ ${imported} factures importées...`);
          }
        } catch (error: any) {
          console.error(`  ❌ Erreur ligne ${i + 4}: ${error.message}`);
          errors++;
        }
      }
      
      console.log(`\n📊 Résultat ${sheetName}:`);
      console.log(`   ✅ Importées: ${imported}`);
      console.log(`   ⏭️  Ignorées: ${skipped}`);
      console.log(`   ❌ Erreurs: ${errors}`);
      
      totalImported += imported;
      totalSkipped += skipped;
      totalErrors += errors;
    }

    console.log('\n' + '='.repeat(80));
    console.log('📊 RÉSULTATS GLOBAUX:');
    console.log(`   ✅ Total importées: ${totalImported}`);
    console.log(`   ⏭️  Total ignorées: ${totalSkipped}`);
    console.log(`   ❌ Total erreurs: ${totalErrors}`);
    console.log('='.repeat(80));

    // Vérifier le total en BD
    const totalInvoices = await db.select().from(supplierInvoices);
    
    console.log(`\n✅ Total factures en base de données: ${totalInvoices.length}`);
    
    // Afficher un aperçu
    console.log('\n📋 Aperçu des factures (5 premières):\n');
    totalInvoices.slice(0, 5).forEach((inv, i) => {
      console.log(`  ${i + 1}. Facture: ${inv.invoiceNumber}`);
      console.log(`     Date: ${inv.invoiceDate || 'N/A'}`);
      console.log(`     Montant TTC: ${inv.totalTTC} FCFA`);
      console.log(`     Description: ${inv.description?.substring(0, 50) || 'N/A'}...`);
      console.log('');
    });

  } catch (error: any) {
    console.error('\n❌ ERREUR:', error.message);
    throw error;
  }
}

// Exécuter l'import
importSupplierInvoices()
  .then(() => {
    console.log('✅ Import terminé avec succès!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Import échoué:', error);
    process.exit(1);
  });

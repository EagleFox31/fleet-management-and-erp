import { db } from "../server/db";
import { supplierInvoices, suppliers, parts } from "@shared/schema";
import { eq } from "drizzle-orm";

// Générer une référence unique pour une pièce
function generatePartReference(description: string, index: number): string {
  // Nettoyer la description et prendre les premiers caractères
  const cleaned = description
    .toString()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .substring(0, 8);
  
  // Ajouter un numéro de séquence
  return `PART-${cleaned}-${String(index).padStart(4, '0')}`;
}

// Nettoyer le nom de la pièce
function cleanPartName(description: string): string {
  return description.toString().trim().substring(0, 200); // Limiter à 200 caractères
}

async function importPartsInventory() {
  console.log('🔧 IMPORT INVENTAIRE PIÈCES DÉTACHÉES\n');
  
  try {
    // ÉTAPE 1: Récupérer toutes les factures "PIECES DETACHEES"
    console.log('📊 ÉTAPE 1: Récupération des factures de pièces...\n');
    
    const invoices = await db
      .select({
        id: supplierInvoices.id,
        invoiceNumber: supplierInvoices.invoiceNumber,
        family: supplierInvoices.family,
        description: supplierInvoices.description,
        quantity: supplierInvoices.quantity,
        amountHT: supplierInvoices.amountHT,
        supplierId: supplierInvoices.supplierId,
      })
      .from(supplierInvoices)
      .where(eq(supplierInvoices.family, 'PIECES DETACHEES'));
    
    console.log(`✅ ${invoices.length} factures de pièces détachées trouvées\n`);
    
    if (invoices.length === 0) {
      console.log('⚠️  Aucune facture de pièces détachées à importer');
      return;
    }
    
    // ÉTAPE 2: Récupérer les fournisseurs pour mapping
    const allSuppliers = await db.select().from(suppliers);
    const supplierMap = new Map(allSuppliers.map(s => [s.id, s.name]));
    
    // ÉTAPE 3: Traiter chaque facture et créer les pièces
    console.log('💾 ÉTAPE 2: Création des pièces dans l\'inventaire...\n');
    
    let createdCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < invoices.length; i++) {
      const invoice = invoices[i];
      
      try {
        // Vérifier que description existe
        if (!invoice.description) {
          console.log(`⚠️  Facture ${invoice.invoiceNumber}: Description manquante`);
          skippedCount++;
          continue;
        }
        
        // Calculer le prix unitaire
        const qty = Number(invoice.quantity) || 1;
        const amountHT = Number(invoice.amountHT) || 0;
        const unitPrice = qty > 0 ? (amountHT / qty) : amountHT;
        
        // Générer référence unique
        const reference = generatePartReference(invoice.description, i + 1);
        const partName = cleanPartName(invoice.description);
        const supplierName = invoice.supplierId ? supplierMap.get(invoice.supplierId) : null;
        
        // Quantité initiale (celle de la facture)
        const initialQuantity = Math.floor(qty);
        
        // Créer la pièce
        await db.insert(parts).values({
          name: partName,
          reference: reference,
          description: invoice.description,
          quantity: initialQuantity,
          realStock: initialQuantity, // Stock réel = quantité initiale
          minQuantity: 5, // Seuil par défaut
          reorderAlert: initialQuantity <= 5, // Alerte si stock faible
          unitPrice: unitPrice.toFixed(2),
          supplier: supplierName || undefined,
          category: 'PIECES DETACHEES',
          location: 'MAGASIN PRINCIPAL', // Location par défaut
        });
        
        createdCount++;
        
        // Afficher progression tous les 10 items
        if ((i + 1) % 10 === 0) {
          console.log(`   📦 ${i + 1}/${invoices.length} pièces traitées...`);
        }
        
      } catch (error) {
        console.error(`❌ Erreur facture ${invoice.invoiceNumber}:`, error);
        errorCount++;
      }
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('📊 RÉSULTATS:');
    console.log(`   ✅ Pièces créées: ${createdCount}`);
    console.log(`   ⚠️  Ignorées: ${skippedCount}`);
    console.log(`   ❌ Erreurs: ${errorCount}`);
    console.log('='.repeat(80) + '\n');
    
    // ÉTAPE 4: Afficher aperçu des pièces créées
    console.log('📋 Aperçu des pièces créées (10 premières):\n');
    
    const createdParts = await db
      .select()
      .from(parts)
      .limit(10);
    
    createdParts.forEach((part, idx) => {
      console.log(`  ${idx + 1}. ${part.name}`);
      console.log(`     Référence: ${part.reference}`);
      console.log(`     Prix unitaire: ${part.unitPrice} FCFA`);
      console.log(`     Quantité: ${part.quantity}`);
      console.log(`     Fournisseur: ${part.supplier || 'N/A'}`);
      console.log(`     Alerte stock: ${part.reorderAlert ? '🔴 OUI' : '🟢 NON'}`);
      console.log('');
    });
    
    // Statistiques globales
    console.log('📊 STATISTIQUES INVENTAIRE:\n');
    
    const allParts = await db.select().from(parts);
    const totalValue = allParts.reduce((sum, p) => sum + (Number(p.unitPrice) * p.quantity), 0);
    const lowStockCount = allParts.filter(p => p.reorderAlert).length;
    
    console.log(`   📦 Total pièces: ${allParts.length}`);
    console.log(`   💰 Valeur totale: ${totalValue.toLocaleString('fr-FR')} FCFA`);
    console.log(`   🔴 Alertes stock bas: ${lowStockCount}`);
    console.log(`   📍 Catégorie: PIECES DETACHEES`);
    
    console.log('\n✅ Import terminé avec succès!');
    
  } catch (error) {
    console.error('❌ Erreur lors de l\'import:', error);
    throw error;
  }
}

// Exécuter l'import
importPartsInventory()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

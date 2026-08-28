import { db } from '../server/db';
import { users, vehicles, parts, workOrders, maintenanceSchedules, fuelRecords, alerts } from '../shared/schema';
import * as fs from 'fs';
import * as path from 'path';

export async function exportData() {
  console.log('📦 Export des données en cours...');
  
  try {
    const exportData = {
      exportDate: new Date().toISOString(),
      users: await db.select().from(users),
      vehicles: await db.select().from(vehicles),
      parts: await db.select().from(parts),
      workOrders: await db.select().from(workOrders),
      maintenanceSchedules: await db.select().from(maintenanceSchedules),
      fuelRecords: await db.select().from(fuelRecords),
      alerts: await db.select().from(alerts)
    };

    // Créer le dossier de sauvegarde s'il n'existe pas
    const backupDir = path.join(process.cwd(), 'backup');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    // Générer le nom de fichier avec la date
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const filename = `fleet-backup-${timestamp}.json`;
    const filepath = path.join(backupDir, filename);

    // Sauvegarder les données
    fs.writeFileSync(filepath, JSON.stringify(exportData, null, 2), 'utf8');

    console.log('✅ Export terminé !');
    console.log(`📁 Fichier sauvegardé : ${filepath}`);
    console.log(`👥 Utilisateurs : ${exportData.users.length}`);
    console.log(`🚛 Véhicules : ${exportData.vehicles.length}`);
    console.log(`🔧 Pièces : ${exportData.parts.length}`);
    console.log(`🔨 Ordres de travail : ${exportData.workOrders.length}`);
    console.log(`📅 Plannings maintenance : ${exportData.maintenanceSchedules.length}`);
    console.log(`⛽ Enregistrements carburant : ${exportData.fuelRecords.length}`);
    console.log(`🔔 Alertes : ${exportData.alerts.length}`);

    return filepath;
  } catch (error) {
    console.error('❌ Erreur lors de l\'export:', error);
    throw error;
  }
}

// Exécuter l'export directement
exportData()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
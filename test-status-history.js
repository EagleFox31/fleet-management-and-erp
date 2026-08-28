// Script de test pour vérifier la méthode getStatusHistoryByPeriod
import { storage } from './server/storage.js';

async function testGetStatusHistoryByPeriod() {
  try {
    console.log('Récupération de l\'historique des statuts pour la période : month');
    const historyMonth = await storage.getStatusHistoryByPeriod('month');
    console.log('Résultat pour le mois :');
    console.log(JSON.stringify(historyMonth, null, 2));
    
    console.log('\nRécupération de l\'historique des statuts pour la période : week');
    const historyWeek = await storage.getStatusHistoryByPeriod('week');
    console.log('Résultat pour la semaine :');
    console.log(JSON.stringify(historyWeek, null, 2));
  } catch (error) {
    console.error('Erreur lors du test:', error);
  }
}

testGetStatusHistoryByPeriod();
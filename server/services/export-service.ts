import { db } from "../db";
import { vehicles, workOrders, parts, partsStockMovements, fuelRecords, users } from "@shared/schema";
import { eq, desc, asc } from "drizzle-orm";
import { ROLE_LABELS } from "@shared/constants/roles";
import { canReadPurchasePrice, type PriceReader } from "../lib/vehicle-price-scope";
import { WORK_ORDER_PRIORITY_LABELS, WORK_ORDER_STATUS_LABELS } from "@shared/constants/work-orders";
import * as XLSX from 'xlsx';
import archiver from 'archiver';
import { Readable } from 'stream';

export class ExportService {
  
  // Export des véhicules en XLSX
  async exportVehiclesXLSX(reader?: PriceReader): Promise<Buffer> {
    // Prix d'achat : colonne réservée à admin, logistique et secrétariat (décision du 3 novembre 2026).
    const withPrice = canReadPurchasePrice(reader);
    try {
      console.log('Exporting vehicles to XLSX...');
      
      const vehiclesList = await db
        .select({
          id: vehicles.id,
          registrationNumber: vehicles.registrationNumber,
          brand: vehicles.brand,
          model: vehicles.model,
          year: vehicles.year,
          mileage: vehicles.mileage,
          status: vehicles.status,
          fuelType: vehicles.fuelType,
          vehicleType: vehicles.vehicleType,
          tonnage: vehicles.tonnage,
          axleCount: vehicles.axleCount,
          vin: vehicles.vin,
          purchaseDate: vehicles.purchaseDate,
          purchasePrice: vehicles.purchasePrice,
          insuranceExpiry: vehicles.insuranceExpiry,
          technicalInspectionDate: vehicles.technicalInspectionDate,
          createdAt: vehicles.createdAt
        })
        .from(vehicles)
        .orderBy(asc(vehicles.registrationNumber));

      const worksheetData = vehiclesList.map(vehicle => ({
        'Immatriculation': vehicle.registrationNumber,
        'Marque': vehicle.brand,
        'Modèle': vehicle.model,
        'Année': vehicle.year,
        'Kilométrage': vehicle.mileage,
        'Statut': this.translateStatus(vehicle.status),
        'Type de véhicule': vehicle.vehicleType,
        'Type de carburant': vehicle.fuelType,
        'Tonnage': vehicle.tonnage || '',
        'Nombre d\'essieux': vehicle.axleCount || '',
        'Numéro VIN': vehicle.vin || '',
        'Date d\'achat': vehicle.purchaseDate ? new Date(vehicle.purchaseDate).toLocaleDateString('fr-FR') : '',
        ...(withPrice ? { 'Prix d\'achat (XAF)': vehicle.purchasePrice || '' } : {}),
        'Expiration assurance': vehicle.insuranceExpiry ? new Date(vehicle.insuranceExpiry).toLocaleDateString('fr-FR') : '',
        'Contrôle technique': vehicle.technicalInspectionDate ? new Date(vehicle.technicalInspectionDate).toLocaleDateString('fr-FR') : '',
        'Date de création': new Date(vehicle.createdAt).toLocaleDateString('fr-FR')
      }));

      const worksheet = XLSX.utils.json_to_sheet(worksheetData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Véhicules');

      return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    } catch (error) {
      console.error('Error exporting vehicles:', error);
      throw new Error('Erreur lors de l\'export des véhicules');
    }
  }

  // Export des ordres de travail en XLSX
  async exportWorkOrdersXLSX(): Promise<Buffer> {
    try {
      console.log('Exporting work orders to XLSX...');
      
      const workOrdersList = await db
        .select({
          id: workOrders.id,
          vehicleId: workOrders.vehicleId,
          title: workOrders.title,
          description: workOrders.description,
          status: workOrders.status,
          priority: workOrders.priority,
          technicianId: workOrders.technicianId,
          startDate: workOrders.startDate,
          endDate: workOrders.endDate,
          duration: workOrders.duration,
          cost: workOrders.cost,
          diagnosis: workOrders.diagnosis,
          isPreventive: workOrders.isPreventive,
          createdAt: workOrders.createdAt
        })
        .from(workOrders)
        .orderBy(desc(workOrders.createdAt));

      const worksheetData = workOrdersList.map(order => ({
        'N° OT': `OT-${order.id.toString().padStart(4, '0')}`,
        'ID Véhicule': order.vehicleId,
        'ID Technicien': order.technicianId || '',
        'Titre': order.title,
        'Description': order.description,
        'Diagnostic': order.diagnosis || '',
        'Statut': this.translateWorkOrderStatus(order.status),
        'Priorité': this.translatePriority(order.priority),
        'Type': order.isPreventive ? 'Préventive' : 'Corrective',
        'Date de début': order.startDate ? new Date(order.startDate).toLocaleDateString('fr-FR') : '',
        'Date de fin': order.endDate ? new Date(order.endDate).toLocaleDateString('fr-FR') : '',
        'Durée (h)': order.duration || '',
        'Coût (XAF)': order.cost || '',
        'Date de création': new Date(order.createdAt).toLocaleDateString('fr-FR')
      }));

      const worksheet = XLSX.utils.json_to_sheet(worksheetData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Ordres de travail');

      return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    } catch (error) {
      console.error('Error exporting work orders:', error);
      throw new Error('Erreur lors de l\'export des ordres de travail');
    }
  }

  // Export de l'inventaire en XLSX
  async exportInventoryXLSX(): Promise<Buffer> {
    try {
      console.log('Exporting inventory to XLSX...');
      
      const partsList = await db
        .select()
        .from(parts)
        .orderBy(asc(parts.name));

      const worksheetData = partsList.map(part => ({
        'Référence': part.reference,
        'Nom': part.name,
        'Description': part.description || '',
        'Catégorie': part.category,
        'Quantité en stock': part.quantity,
        'Seuil minimum': part.minQuantity,
        'Unité': part.unit,
        'Prix unitaire (XAF)': part.unitPrice,
        'Fournisseur': part.supplier || '',
        'Emplacement': part.location || '',
        'Date de création': new Date(part.createdAt).toLocaleDateString('fr-FR')
      }));

      const worksheet = XLSX.utils.json_to_sheet(worksheetData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Inventaire');

      return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    } catch (error) {
      console.error('Error exporting inventory:', error);
      throw new Error('Erreur lors de l\'export de l\'inventaire');
    }
  }

  // Export des données de carburant en XLSX
  async exportFuelXLSX(): Promise<Buffer> {
    try {
      console.log('Exporting fuel data to XLSX...');
      
      const fuelList = await db
        .select({
          id: fuelRecords.id,
          vehicleId: fuelRecords.vehicleId,
          date: fuelRecords.date,
          quantity: fuelRecords.quantity,
          cost: fuelRecords.cost,
          mileage: fuelRecords.mileage,
          notes: fuelRecords.notes,
          createdAt: fuelRecords.createdAt
        })
        .from(fuelRecords)
        .orderBy(desc(fuelRecords.date));

      const worksheetData = fuelList.map(record => {
        const consumptionPer100km = record.mileage && record.quantity ? 
          ((record.quantity / record.mileage) * 100).toFixed(2) : '';
          
        return {
          'Date': record.date ? new Date(record.date).toLocaleDateString('fr-FR') : '',
          'ID Véhicule': record.vehicleId,
          'Quantité (L)': record.quantity,
          'Coût (XAF)': record.cost,
          'Kilométrage': record.mileage,
          'Consommation/100km (L)': consumptionPer100km,
          'Notes': record.notes || '',
          'Date de saisie': new Date(record.createdAt).toLocaleDateString('fr-FR')
        };
      });

      const worksheet = XLSX.utils.json_to_sheet(worksheetData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Carburant');

      return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    } catch (error) {
      console.error('Error exporting fuel data:', error);
      throw new Error('Erreur lors de l\'export des données de carburant');
    }
  }

  // Export des utilisateurs en XLSX
  async exportUsersXLSX(): Promise<Buffer> {
    try {
      console.log('Exporting users to XLSX...');
      
      const usersList = await db
        .select({
          id: users.id,
          name: users.name,
          username: users.username,
          role: users.role,
          email: users.email,
          createdAt: users.createdAt
        })
        .from(users)
        .orderBy(asc(users.name));

      const worksheetData = usersList.map(user => ({
        'ID': user.id,
        'Nom complet': user.name,
        'Nom d\'utilisateur': user.username,
        'Rôle': this.translateUserRole(user.role),
        'Email': user.email || '',
        'Date de création': new Date(user.createdAt).toLocaleDateString('fr-FR')
      }));

      const worksheet = XLSX.utils.json_to_sheet(worksheetData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Utilisateurs');

      return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    } catch (error) {
      console.error('Error exporting users:', error);
      throw new Error('Erreur lors de l\'export des utilisateurs');
    }
  }

  // Export complet de la base de données en ZIP
  async exportCompleteDatabase(): Promise<Buffer> {
    try {
      console.log('Exporting complete database to ZIP...');
      
      const archive = archiver('zip', { zlib: { level: 9 } });
      const buffers: Buffer[] = [];
      
      archive.on('data', (chunk) => buffers.push(chunk));
      
      // Export de chaque table en JSON
      const vehiclesData = await db.select().from(vehicles);
      const workOrdersData = await db.select().from(workOrders);
      const partsData = await db.select().from(parts);
      const stockMovementsData = await db.select().from(partsStockMovements);
      const fuelData = await db.select().from(fuelRecords);
      const usersData = await db.select({
        id: users.id,
        name: users.name,
        username: users.username,
        role: users.role,
        email: users.email,
        createdAt: users.createdAt
      }).from(users); // Exclure les mots de passe

      // Ajouter chaque dataset au ZIP
      archive.append(JSON.stringify(vehiclesData, null, 2), { name: 'vehicles.json' });
      archive.append(JSON.stringify(workOrdersData, null, 2), { name: 'work_orders.json' });
      archive.append(JSON.stringify(partsData, null, 2), { name: 'parts.json' });
      archive.append(JSON.stringify(stockMovementsData, null, 2), { name: 'stock_movements.json' });
      archive.append(JSON.stringify(fuelData, null, 2), { name: 'fuel_records.json' });
      archive.append(JSON.stringify(usersData, null, 2), { name: 'users.json' });

      // Ajouter un fichier README
      const readmeContent = `
# Sauvegarde de la base de données
Date d'export: ${new Date().toLocaleString('fr-FR')}

## Contenu:
- vehicles.json: Données des véhicules
- work_orders.json: Ordres de travail
- parts.json: Inventaire des pièces
- stock_movements.json: Mouvements de stock
- fuel_records.json: Données de carburant
- users.json: Utilisateurs (sans mots de passe)

## Format: JSON
Chaque fichier contient un tableau d'objets représentant les enregistrements de la table correspondante.
      `;
      archive.append(readmeContent, { name: 'README.txt' });

      await archive.finalize();

      return Buffer.concat(buffers);
    } catch (error) {
      console.error('Error exporting complete database:', error);
      throw new Error('Erreur lors de l\'export complet de la base de données');
    }
  }

  // Fonctions utilitaires de traduction
  private translateStatus(status: string): string {
    const statusMap: { [key: string]: string } = {
      'operational': 'Opérationnel',
      'maintenance': 'En maintenance',
      'out_of_service': 'Hors service'
    };
    return statusMap[status] || status;
  }

  private translateWorkOrderStatus(status: string): string {
    return (WORK_ORDER_STATUS_LABELS as Record<string, string>)[status] ?? status;
  }

  private translatePriority(priority: string): string {
    return (WORK_ORDER_PRIORITY_LABELS as Record<string, string>)[priority] ?? priority;
  }

  private translateUserRole(role: string): string {
    return (ROLE_LABELS as Record<string, string>)[role] ?? role;
  }
}

export const exportService = new ExportService();

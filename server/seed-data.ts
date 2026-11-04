import { db } from './db';
import { users, vehicles, parts, workOrders, maintenanceSchedules, fuelRecords } from '../shared/schema';
import bcrypt from 'bcryptjs';
import { suppressSideEffects } from './lib/suppress-side-effects';

export async function seedDatabase() {
  console.log('🌱 Initialisation des données de démonstration...');

  try {
    // Vérifier si des données existent déjà
    const existingUsers = await db.select().from(users).limit(1);
    if (existingUsers.length > 0) {
      console.log('✅ Base de données déjà initialisée');
      return;
    }

    // 1. Créer les utilisateurs
    console.log('👥 Création des utilisateurs...');
    const adminPassword = await bcrypt.hash('admin123', 10);
    const techPassword = await bcrypt.hash('tech123', 10);

    const seedUsers = await db.insert(users).values([
      {
        username: 'admin',
        email: 'admin@fleet.com',
        name: 'Administrateur Système',
        password: adminPassword,
        role: 'admin'
      },
      {
        username: 'tech1',
        email: 'tech1@fleet.com', 
        name: 'Jean Technicien',
        password: techPassword,
        role: 'technician'
      },
      {
        username: 'tech2',
        email: 'tech2@fleet.com',
        name: 'Marie Mécanicienne', 
        password: techPassword,
        role: 'technician'
      },
      {
        username: 'manager',
        email: 'manager@fleet.com',
        name: 'Paul Gestionnaire',
        password: techPassword,
        role: 'admin'
      }
    ]).returning();

    // 2. Créer les véhicules
    console.log('🚛 Création de la flotte de véhicules...');
    const seedVehicles = await db.insert(vehicles).values([
      {
        registrationNumber: 'AB123CD',
        brand: 'Renault',
        model: 'Premium',
        year: 2020,
        vehicleType: 'truck',
        status: 'operational',
        mileage: 85000,
        fuelType: 'diesel',
        capacity: '26 tonnes',
        location: 'Dépôt Principal'
      },
      {
        registrationNumber: 'CE123FG', 
        brand: 'Mercedes',
        model: 'Actros',
        year: 2021,
        vehicleType: 'truck',
        status: 'maintenance',
        mileage: 42000,
        fuelType: 'diesel',
        capacity: '40 tonnes',
        location: 'Atelier'
      },
      {
        registrationNumber: 'HI456JK',
        brand: 'Volvo',
        model: 'FH16',
        year: 2019,
        vehicleType: 'truck', 
        status: 'operational',
        mileage: 120000,
        fuelType: 'diesel',
        capacity: '32 tonnes',
        location: 'En mission'
      },
      {
        registrationNumber: 'LM789NO',
        brand: 'Iveco',
        model: 'Daily',
        year: 2022,
        vehicleType: 'van',
        status: 'operational',
        mileage: 15000,
        fuelType: 'diesel',
        capacity: '3.5 tonnes',
        location: 'Dépôt Principal'
      },
      {
        registrationNumber: 'PQ012RS',
        brand: 'Ford',
        model: 'Transit',
        year: 2020,
        vehicleType: 'van',
        status: 'out_of_service',
        mileage: 95000,
        fuelType: 'diesel',
        capacity: '2.2 tonnes',
        location: 'Atelier'
      }
    ] as any).returning();

    // 3. Créer les pièces détachées
    console.log('🔧 Création de l\'inventaire des pièces...');
    const seedParts = await db.insert(parts).values([
      {
        name: 'Filtre à huile',
        reference: 'FO-001',
        description: 'Filtre à huile moteur universel pour poids lourds',
        quantity: 25,
        minQuantity: 5,
        unitPrice: 15.50,
        location: 'Étagère A1',
        supplier: 'Autodistribution'
      },
      {
        name: 'Plaquettes de frein avant',
        reference: 'PF-002', 
        description: 'Jeu de plaquettes de frein avant - Renault Premium',
        quantity: 12,
        minQuantity: 3,
        unitPrice: 85.00,
        location: 'Étagère B2',
        supplier: 'Bosch'
      },
      {
        name: 'Courroie de distribution',
        reference: 'CD-003',
        description: 'Courroie de distribution renforcée',
        quantity: 8,
        minQuantity: 2,
        unitPrice: 120.00,
        location: 'Étagère C1',
        supplier: 'Gates'
      },
      {
        name: 'Amortisseur avant',
        reference: 'AM-004',
        description: 'Amortisseur avant gauche/droit - Mercedes Actros',
        quantity: 6,
        minQuantity: 2,
        unitPrice: 180.00,
        location: 'Zone stockage',
        supplier: 'Sachs'
      },
      {
        name: 'Batterie 12V',
        reference: 'BAT-005',
        description: 'Batterie 12V 180Ah démarrage poids lourd',
        quantity: 4,
        minQuantity: 2,
        unitPrice: 220.00,
        location: 'Local batteries',
        supplier: 'Varta'
      },
      {
        name: 'Pneumatique 315/80R22.5',
        reference: 'PN-006',
        description: 'Pneu directeur premium 315/80R22.5',
        quantity: 16,
        minQuantity: 4,
        unitPrice: 450.00,
        location: 'Zone pneus',
        supplier: 'Michelin'
      },
      {
        name: 'Filtre à air',
        reference: 'FA-007',
        description: 'Filtre à air moteur haute performance',
        quantity: 18,
        minQuantity: 5,
        unitPrice: 35.00,
        location: 'Étagère A2',
        supplier: 'Mann Filter'
      },
      {
        name: 'Liquide de refroidissement',
        reference: 'LR-008',
        description: 'Antigel/liquide de refroidissement concentré 5L',
        quantity: 30,
        minQuantity: 8,
        unitPrice: 25.00,
        location: 'Local liquides',
        supplier: 'Total'
      },
      {
        name: 'Disques de frein avant',
        reference: 'DF-009',
        description: 'Paire de disques de frein avant ventilés',
        quantity: 8,
        minQuantity: 2,
        unitPrice: 150.00,
        location: 'Étagère B1',
        supplier: 'Brembo'
      },
      {
        name: 'Huile moteur 15W40',
        reference: 'HM-010',
        description: 'Huile moteur semi-synthétique 15W40 - 20L',
        quantity: 45,
        minQuantity: 10,
        unitPrice: 80.00,
        location: 'Local huiles',
        supplier: 'Castrol'
      }
    ] as any).returning();

    // 4. Créer les ordres de travail
    console.log('🔨 Création des ordres de travail...');
    const seedWorkOrders = await db.insert(workOrders).values([
      {
        title: 'Révision complète 40 000 km',
        description: 'Révision périodique: vidange, filtres, contrôle général',
        status: 'completed',
        priority: 'medium',
        vehicleId: seedVehicles[0].id,
        technicianId: seedUsers[1].id,
        startDate: new Date('2025-05-15'),
        endDate: new Date('2025-05-16'),
        cost: 380.50,
        isPreventive: true
      },
      {
        title: 'Remplacement plaquettes frein',
        description: 'Usure excessive des plaquettes avant détectée',
        status: 'in_progress', 
        priority: 'high',
        vehicleId: seedVehicles[1].id,
        technicianId: seedUsers[2].id,
        startDate: new Date('2025-05-22'),
        cost: 285.00,
        isPreventive: false
      },
      {
        title: 'Contrôle technique',
        description: 'Préparation et passage du contrôle technique annuel',
        status: 'pending',
        priority: 'medium',
        vehicleId: seedVehicles[2].id,
        technicianId: seedUsers[1].id,
        startDate: new Date('2025-05-25'),
        isPreventive: true
      },
      {
        title: 'Réparation système de refroidissement',
        description: 'Fuite du radiateur détectée - remplacement nécessaire',
        status: 'pending',
        priority: 'critical',
        vehicleId: seedVehicles[4].id,
        technicianId: seedUsers[2].id,
        startDate: new Date('2025-05-24'),
        isPreventive: false
      }
    ] as any).returning();

    // 5. Créer les plannings de maintenance
    console.log('📅 Création des plannings de maintenance...');
    await db.insert(maintenanceSchedules).values([
      {
        vehicleId: seedVehicles[0].id,
        title: 'Révision 80 000 km',
        description: 'Révision majeure programmée',
        maintenanceType: 'preventive',
        scheduledDate: new Date('2025-06-15'),
        intervalType: 'mileage',
        intervalValue: 40000,
        priority: 'high',
        estimatedDuration: 480,
        estimatedCost: 650.00
      },
      {
        vehicleId: seedVehicles[2].id,
        title: 'Vidange périodique',
        description: 'Vidange moteur et remplacement des filtres',
        maintenanceType: 'preventive',
        scheduledDate: new Date('2025-06-01'),
        intervalType: 'mileage', 
        intervalValue: 15000,
        priority: 'medium',
        estimatedDuration: 120,
        estimatedCost: 180.00
      },
      {
        vehicleId: seedVehicles[3].id,
        title: 'Contrôle freinage',
        description: 'Inspection complète du système de freinage',
        maintenanceType: 'inspection',
        scheduledDate: new Date('2025-05-30'),
        intervalType: 'time',
        intervalValue: 6,
        priority: 'high',
        estimatedDuration: 180,
        estimatedCost: 120.00
      }
    ] as any);

    // 6. Créer les enregistrements de carburant
    console.log('⛽ Création des données de carburant...');
    // Reprise d'historique : pas d'alerte carburant par plein semé (triggers #287).
    await db.transaction(async (tx) => {
      await suppressSideEffects(tx);
      await tx.insert(fuelRecords).values([
      {
        vehicleId: seedVehicles[0].id,
        date: new Date('2025-05-20'),
        quantity: 350.5,
        pricePerLiter: 1.45,
        totalCost: 508.23,
        mileage: 84850,
        location: 'Station Total A1',
        createdById: seedUsers[0].id
      },
      {
        vehicleId: seedVehicles[0].id,
        date: new Date('2025-05-18'),
        quantity: 380.0,
        pricePerLiter: 1.43,
        totalCost: 543.40,
        mileage: 84200,
        location: 'Station Shell Centre',
        createdById: seedUsers[0].id
      },
      {
        vehicleId: seedVehicles[2].id,
        date: new Date('2025-05-21'),
        quantity: 420.0,
        pricePerLiter: 1.46,
        totalCost: 613.20,
        mileage: 119650,
        location: 'Station BP Nord',
        createdById: seedUsers[0].id
      },
      {
        vehicleId: seedVehicles[3].id,
        date: new Date('2025-05-19'),
        quantity: 95.5,
        pricePerLiter: 1.44,
        totalCost: 137.52,
        mileage: 14800,
        location: 'Station Esso Centre',
        createdById: seedUsers[0].id
      }
    ] as any);
    });

    console.log('✅ Données de démonstration créées avec succès !');
    console.log('👤 Comptes créés:');
    console.log('   - admin / admin123 (Administrateur)');
    console.log('   - tech1 / tech123 (Technicien)');
    console.log('   - tech2 / tech123 (Technicien)');
    console.log('   - manager / tech123 (Gestionnaire)');
    console.log(`🚛 ${seedVehicles.length} véhicules créés`);
    console.log(`🔧 ${seedParts.length} pièces en stock`);
    console.log(`🔨 ${seedWorkOrders.length} ordres de travail`);

  } catch (error) {
    console.error('❌ Erreur lors de l\'initialisation des données:', error);
    throw error;
  }
}

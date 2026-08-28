import * as XLSX from 'xlsx';
import { Vehicle, InsertVehicle } from '@shared/schema';
import { companyInfo } from '@/components/layout/company-logo';

// Fonction pour convertir des véhicules en fichier Excel
export function vehiclesToExcel(vehicles: Vehicle[]): Blob {
  // Créer un nouveau workbook
  const workbook = XLSX.utils.book_new();
  
  // Préparer les données pour l'en-tête d'entreprise (2 lignes)
  const headerData = [
    [companyInfo.name],
    [`${companyInfo.address} - ${companyInfo.email}`],
    [], // Ligne vide pour l'espacement
  ];
  
  // Préparer les headers des colonnes
  const columnHeaders = [
    'ID',
    'Immatriculation',
    'Marque',
    'Modèle',
    'Type',
    'Année',
    'Kilométrage',
    'VIN',
    'Spécifications moteur',
    'Carburant',
    'Date assurance',
    'Date visite technique',
    'Date expiration plaque',
    'Statut',
    'Date de création'
  ];
  
  // Convertir les véhicules en lignes de données
  const rows = vehicles.map(vehicle => [
    vehicle.id,
    vehicle.registrationNumber,
    vehicle.brand,
    vehicle.model,
    vehicle.vehicleType,
    vehicle.year,
    vehicle.mileage,
    vehicle.vin,
    vehicle.engineSpec,
    vehicle.fuelType,
    formatDate(vehicle.insuranceExpiry),
    formatDate(vehicle.technicalInspectionDate),
    formatDate(vehicle.licensePlateExpiry),
    vehicle.status,
    formatDate(vehicle.createdAt)
  ]);
  
  // Combiner l'en-tête, les headers de colonnes et les données
  const data = [...headerData, columnHeaders, ...rows];
  
  // Créer une feuille de calcul avec les données
  const worksheet = XLSX.utils.aoa_to_sheet(data);
  
  // Ajouter des styles pour l'en-tête d'entreprise (en fusionnant les cellules)
  worksheet['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 14 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 14 } }
  ];
  
  // Ajouter la feuille de calcul au workbook
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Véhicules');
  
  // Convertir le workbook en ArrayBuffer
  const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  
  // Convertir l'ArrayBuffer en Blob
  return new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// Fonction pour importer des véhicules depuis un fichier Excel
export function excelToVehicles(file: File): Promise<Partial<InsertVehicle>[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // Obtenir la première feuille de calcul
        const worksheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[worksheetName];
        
        // Convertir les données en tableau d'objets
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        // Ignorer les lignes d'en-tête (3 premières lignes)
        const rows = jsonData.slice(3);
        
        // Extraire les headers (4ème ligne)
        const headers = rows[0] as string[];
        
        // Mapper les données en véhicules
        const vehicles: Partial<InsertVehicle>[] = rows.slice(1).map((row: any) => {
          const mappedVehicle: Partial<InsertVehicle> = {};
          
          if (row[1]) mappedVehicle.registrationNumber = String(row[1]);
          if (row[2]) mappedVehicle.brand = String(row[2]);
          if (row[3]) mappedVehicle.model = String(row[3]);
          if (row[4]) {
            const vehicleType = String(row[4]);
            // Valider le type de véhicule
            if (["tracteur", "porteur", "semi_remorque", "remorque", "utilitaire", "autre"].includes(vehicleType)) {
              mappedVehicle.vehicleType = vehicleType as "tracteur" | "porteur" | "semi_remorque" | "remorque" | "utilitaire" | "autre";
            } else {
              mappedVehicle.vehicleType = "autre";
            }
          }
          if (row[5]) mappedVehicle.year = parseInt(row[5]);
          if (row[6]) mappedVehicle.mileage = parseInt(row[6]);
          if (row[7]) mappedVehicle.vin = String(row[7]);
          if (row[8]) mappedVehicle.engineSpec = String(row[8]);
          if (row[9]) {
            const fuelType = String(row[9]);
            // Valider le type de carburant
            if (["diesel", "petrol", "electric", "hybrid", "other"].includes(fuelType)) {
              mappedVehicle.fuelType = fuelType as "diesel" | "petrol" | "electric" | "hybrid" | "other";
            } else {
              mappedVehicle.fuelType = "other";
            }
          }
          if (row[10]) {
            const date = parseDate(row[10]);
            if (date) mappedVehicle.insuranceExpiry = date.toISOString().split('T')[0];
          }
          if (row[11]) {
            const date = parseDate(row[11]);
            if (date) mappedVehicle.technicalInspectionDate = date.toISOString().split('T')[0];
          }
          if (row[12]) {
            const date = parseDate(row[12]);
            if (date) mappedVehicle.licensePlateExpiry = date.toISOString().split('T')[0];
          }
          if (row[13]) {
            const status = String(row[13]);
            // Valider le statut
            if (["operational", "maintenance", "out_of_service"].includes(status)) {
              mappedVehicle.status = status as "operational" | "maintenance" | "out_of_service";
            } else {
              mappedVehicle.status = "operational";
            }
          }
          
          return mappedVehicle;
        });
        
        resolve(vehicles);
      } catch (error) {
        reject(error);
      }
    };
    
    reader.onerror = (error) => {
      reject(error);
    };
    
    reader.readAsArrayBuffer(file);
  });
}

// Fonction pour formatter une date
function formatDate(date: Date | string | null): string {
  if (!date) return '';
  
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  
  // Format date au format français
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(d);
}

// Fonction pour parser une date
function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  
  // Essayer de parser la date au format français (DD/MM/YYYY)
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    const day = parseInt(parts[0]);
    const month = parseInt(parts[1]) - 1;
    const year = parseInt(parts[2]);
    
    const date = new Date(year, month, day);
    if (!isNaN(date.getTime())) {
      return date;
    }
  }
  
  // Essayer de parser comme une date standard
  const date = new Date(dateStr);
  if (!isNaN(date.getTime())) {
    return date;
  }
  
  return null;
}

// Fonction pour télécharger un fichier Excel
export function downloadExcel(data: Blob, filename: string): void {
  const url = URL.createObjectURL(data);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
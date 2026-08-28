import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import { 
  vehicleDocuments,
  type VehicleDocument, 
  type InsertVehicleDocument 
} from "@shared/schema";
import { deleteFile } from '../middleware/upload';
import path from 'path';

// Méthodes pour gérer les documents de véhicules
export async function getVehicleDocument(id: number): Promise<VehicleDocument | undefined> {
  try {
    const [document] = await db
      .select()
      .from(vehicleDocuments)
      .where(eq(vehicleDocuments.id, id));
    return document;
  } catch (error) {
    console.error("Get vehicle document error:", error);
    return undefined;
  }
}

export async function getVehicleDocuments(vehicleId: number): Promise<VehicleDocument[]> {
  try {
    return await db
      .select()
      .from(vehicleDocuments)
      .where(eq(vehicleDocuments.vehicleId, vehicleId))
      .orderBy(desc(vehicleDocuments.createdAt));
  } catch (error) {
    console.error("Get vehicle documents error:", error);
    return [];
  }
}

export async function getVehicleDocumentsByType(vehicleId: number, type: string): Promise<VehicleDocument[]> {
  try {
    const documentType = type as InsertVehicleDocument["type"];
    return await db
      .select()
      .from(vehicleDocuments)
      .where(and(
        eq(vehicleDocuments.vehicleId, vehicleId),
        eq(vehicleDocuments.type, documentType)
      ))
      .orderBy(desc(vehicleDocuments.createdAt));
  } catch (error) {
    console.error("Get vehicle documents by type error:", error);
    return [];
  }
}

export async function createVehicleDocument(document: InsertVehicleDocument): Promise<VehicleDocument> {
  try {
    const [createdDocument] = await db
      .insert(vehicleDocuments)
      .values(document)
      .returning();
    return createdDocument;
  } catch (error) {
    console.error("Create vehicle document error:", error);
    throw error;
  }
}

export async function updateVehicleDocument(id: number, document: Partial<InsertVehicleDocument>): Promise<VehicleDocument | undefined> {
  try {
    const [updatedDocument] = await db
      .update(vehicleDocuments)
      .set({
        ...document,
        updatedAt: new Date()
      })
      .where(eq(vehicleDocuments.id, id))
      .returning();
    
    return updatedDocument;
  } catch (error) {
    console.error("Update vehicle document error:", error);
    return undefined;
  }
}

export async function deleteVehicleDocument(id: number): Promise<boolean> {
  try {
    // D'abord, récupérer le document pour obtenir le chemin du fichier
    const [document] = await db
      .select()
      .from(vehicleDocuments)
      .where(eq(vehicleDocuments.id, id));
    
    if (!document) {
      return false;
    }
    
    // Supprimer le fichier du système de fichiers
    try {
      await deleteFile(document.filePath);
    } catch (error) {
      console.error("Error deleting file:", error);
      // Continuer même si la suppression du fichier échoue
    }
    
    // Supprimer l'enregistrement de la base de données
    const result = await db
      .delete(vehicleDocuments)
      .where(eq(vehicleDocuments.id, id))
      .returning();
    
    return result.length > 0;
  } catch (error) {
    console.error("Delete vehicle document error:", error);
    return false;
  }
}

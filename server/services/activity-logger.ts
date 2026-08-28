import { db } from "../db";
import { activityLogs } from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";
import type { InsertActivityLog } from "@shared/schema";

export class ActivityLogger {
  /**
   * Enregistre une action dans les logs d'activité
   */
  async log(params: {
    userId?: number;
    action: string;
    entityType: string;
    entityId?: number;
    details?: any;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    try {
      const logData: InsertActivityLog = {
        userId: params.userId || null,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId || null,
        details: params.details || null,
        ipAddress: params.ipAddress || null,
        userAgent: params.userAgent || null
      };

      await db.insert(activityLogs).values(logData);
      
      console.log(`📝 Activity logged: ${params.action} on ${params.entityType}${params.entityId ? ` (ID: ${params.entityId})` : ''} by user ${params.userId || 'system'}`);
    } catch (error) {
      console.error('Error logging activity:', error);
      // Ne pas faire échouer l'opération principale si le logging échoue
    }
  }

  /**
   * Log pour la création d'une entité
   */
  async logCreate(params: {
    userId?: number;
    entityType: string;
    entityId: number;
    entityData?: any;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    await this.log({
      ...params,
      action: 'CREATE',
      details: {
        entity: params.entityData,
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Log pour la modification d'une entité
   */
  async logUpdate(params: {
    userId?: number;
    entityType: string;
    entityId: number;
    previousData?: any;
    newData?: any;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    await this.log({
      ...params,
      action: 'UPDATE',
      details: {
        previous: params.previousData,
        new: params.newData,
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Log pour la suppression (soft delete) d'une entité
   */
  async logDelete(params: {
    userId?: number;
    entityType: string;
    entityId: number;
    entityData?: any;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    await this.log({
      ...params,
      action: 'DELETE',
      details: {
        deletedEntity: params.entityData,
        timestamp: new Date().toISOString(),
        deletionType: 'soft'
      }
    });
  }

  /**
   * Log pour les actions personnalisées
   */
  async logCustomAction(params: {
    userId?: number;
    action: string;
    entityType: string;
    entityId?: number;
    description?: string;
    metadata?: any;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    await this.log({
      ...params,
      details: {
        description: params.description,
        metadata: params.metadata,
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Récupère l'historique des logs pour une entité
   */
  async getEntityLogs(entityType: string, entityId: number): Promise<any[]> {
    try {
      const logs = await db
        .select()
        .from(activityLogs)
        .where(
          and(
            eq(activityLogs.entityType, entityType),
            eq(activityLogs.entityId, entityId)
          )
        )
        .orderBy(desc(activityLogs.createdAt));

      return logs;
    } catch (error) {
      console.error('Error fetching entity logs:', error);
      return [];
    }
  }

  /**
   * Récupère les logs d'un utilisateur
   */
  async getUserLogs(userId: number, limit: number = 50): Promise<any[]> {
    try {
      const logs = await db
        .select()
        .from(activityLogs)
        .where(eq(activityLogs.userId, userId))
        .orderBy(desc(activityLogs.createdAt))
        .limit(limit);

      return logs;
    } catch (error) {
      console.error('Error fetching user logs:', error);
      return [];
    }
  }
}

// Instance singleton du logger
export const activityLogger = new ActivityLogger();
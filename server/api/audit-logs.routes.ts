import { Router } from "express";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { activityLogs, users } from "@shared/schema";
import { AUDIT_ACTIONS, auditLogsQuerySchema, auditLogsResponseSchema, type AuditAction } from "@shared/contracts/audit-logs";
import { db } from "../db";
import { isAdmin } from "../middleware/auth";
import { maskSecrets } from "../lib/audit";

const router = Router();

const DEFAULT_RANGE_DAYS = 31;
const MAX_PAGE_SIZE = 100;
const DAY_MS = 86_400_000;

function toAction(raw: string): AuditAction {
  const a = raw.toLowerCase();
  return (AUDIT_ACTIONS as readonly string[]).includes(a) ? (a as AuditAction) : "update";
}

/** Journal d'audit (P-04), lecture admin. Plage par defaut 31 jours, 100 lignes par page au plus. */
router.get("/audit-logs", isAdmin, async (req, res, next) => {
  try {
    const q = auditLogsQuerySchema.parse(req.query);
    const to = q.to ? new Date(`${q.to}T00:00:00.000Z`).getTime() + DAY_MS : Date.now() + 1;
    const from = q.from ? new Date(`${q.from}T00:00:00.000Z`).getTime() : to - DEFAULT_RANGE_DAYS * DAY_MS;
    const pageSize = Math.min(q.pageSize, MAX_PAGE_SIZE);

    const conds = [gte(activityLogs.createdAt, new Date(from)), lt(activityLogs.createdAt, new Date(to))];
    if (q.userId) conds.push(eq(activityLogs.userId, q.userId));
    if (q.entityType) conds.push(eq(activityLogs.entityType, q.entityType));
    if (q.entityId) {
      conds.push(
        /^\d+$/.test(q.entityId) ? eq(activityLogs.entityId, Number(q.entityId)) : eq(activityLogs.entityRef, q.entityId),
      );
    }
    const where = and(...conds);

    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(activityLogs).where(where);
    const rows = await db
      .select({ log: activityLogs, userName: users.name })
      .from(activityLogs)
      .leftJoin(users, eq(users.id, activityLogs.userId))
      .where(where)
      .orderBy(desc(activityLogs.createdAt), desc(activityLogs.id))
      .limit(pageSize)
      .offset((q.page - 1) * pageSize);

    res.json(
      auditLogsResponseSchema.parse({
        items: rows.map(({ log, userName }) => ({
          id: log.id,
          at: log.createdAt.toISOString(),
          userId: log.userId,
          userName: userName ?? null,
          action: toAction(log.action),
          entityType: log.entityType,
          entityId: log.entityId !== null ? String(log.entityId) : log.entityRef,
          method: log.method,
          path: log.path,
          details:
            log.details && typeof log.details === "object" && !Array.isArray(log.details)
              ? (maskSecrets(log.details) as Record<string, unknown>)
              : null,
        })),
        total: n,
        page: q.page,
        pageSize,
      }),
    );
  } catch (err) {
    next(err);
  }
});

export default router;

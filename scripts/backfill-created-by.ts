import { sql } from "drizzle-orm";
import { db, pool } from "../server/db";

type BackfillStep = {
  label: string;
  table: string;
  alias: string;
  sources: string[];
};

type BackfillResult = {
  inferred: number;
  roleBasedFallback: number;
  fallback: number;
  remaining: number;
};

type AppRole =
  | "admin"
  | "workshop_manager"
  | "technician"
  | "user"
  | "secretary"
  | "warehouse"
  | "logistics"
  | "client";

type UserCandidate = {
  id: number;
  role: AppRole;
};

type RoleFallbackPolicy = {
  label: string;
  table: string;
  preferredRoles: AppRole[];
  allowAdmin: boolean;
};

const CREATED_BY_COLUMN = "created_by";
const ID_COLUMN = "id";

const dryRun = process.argv.includes("--dry-run");
const fallbackAdmin = process.argv.includes("--fallback-admin");
const fallbackRoleBased =
  process.argv.includes("--fallback-by-role") ||
  process.argv.includes("--fallback-role-based");

const ROLE_ALIASES: Record<string, AppRole> = {
  admin: "admin",
  administrateur: "admin",
  workshop_manager: "workshop_manager",
  gestionnaire_atelier: "workshop_manager",
  "gestionnaire d'atelier": "workshop_manager",
  technician: "technician",
  technicien: "technician",
  secretary: "secretary",
  secretaire: "secretary",
  "secrétaire": "secretary",
  logistics: "logistics",
  logisticien: "logistics",
  warehouse: "warehouse",
  magasinier: "warehouse",
  client: "client",
  user: "user",
};

const ROLE_BASED_POLICIES: RoleFallbackPolicy[] = [
  {
    label: "Véhicules",
    table: "vehicles",
    preferredRoles: ["admin"],
    allowAdmin: true,
  },
  {
    label: "Pièces",
    table: "parts",
    preferredRoles: ["warehouse", "workshop_manager"],
    allowAdmin: false,
  },
  {
    label: "Fournisseurs",
    table: "suppliers",
    preferredRoles: ["secretary"],
    allowAdmin: false,
  },
  {
    label: "Clients",
    table: "clients",
    preferredRoles: ["secretary", "logistics"],
    allowAdmin: false,
  },
];

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeRole(role: unknown): AppRole {
  if (typeof role !== "string") {
    return "user";
  }

  const normalized = role.trim().toLowerCase();
  return ROLE_ALIASES[normalized] || "user";
}

async function tableExists(table: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ${table}
    ) AS exists
  `);

  return Boolean((result.rows[0] as { exists?: unknown } | undefined)?.exists);
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${table}
        AND column_name = ${column}
    ) AS exists
  `);

  return Boolean((result.rows[0] as { exists?: unknown } | undefined)?.exists);
}

async function tableHasColumns(table: string, columns: string[]): Promise<boolean> {
  if (!(await tableExists(table))) {
    return false;
  }

  for (const column of columns) {
    if (!(await columnExists(table, column))) {
      return false;
    }
  }

  return true;
}

async function getMissingCount(table: string): Promise<number> {
  const result = await db.execute(sql.raw(`
    SELECT COUNT(*)::int AS missing
    FROM ${table}
    WHERE ${CREATED_BY_COLUMN} IS NULL
  `));

  return toNumber((result.rows[0] as { missing?: unknown } | undefined)?.missing);
}

async function getAdminUserId(): Promise<number | null> {
  const hasUsers = await tableHasColumns("users", ["id", "role", "deleted_at"]);
  if (!hasUsers) {
    return null;
  }

  const result = await db.execute(sql`
    SELECT id
    FROM users
    WHERE role = 'admin'
      AND deleted_at IS NULL
    ORDER BY id
    LIMIT 1
  `);

  const userId = toNumber((result.rows[0] as { id?: unknown } | undefined)?.id);
  return userId > 0 ? userId : null;
}

async function getActiveUserCandidates(): Promise<UserCandidate[]> {
  const hasUsers = await tableHasColumns("users", ["id", "role"]);
  if (!hasUsers) {
    return [];
  }

  const hasDeletedAt = await columnExists("users", "deleted_at");
  const query = hasDeletedAt
    ? `
      SELECT id, role
      FROM users
      WHERE deleted_at IS NULL
    `
    : `
      SELECT id, role
      FROM users
    `;

  const result = await db.execute(sql.raw(query));
  return result.rows
    .map((row) => ({
      id: toNumber((row as { id?: unknown }).id),
      role: normalizeRole((row as { role?: unknown }).role),
    }))
    .filter((user) => user.id > 0);
}

function selectCandidatesByPolicy(users: UserCandidate[], policy: RoleFallbackPolicy): number[] {
  const preferred = users
    .filter((user) => policy.preferredRoles.includes(user.role))
    .map((user) => user.id);

  if (!policy.allowAdmin) {
    return preferred.filter((id) => {
      const user = users.find((item) => item.id === id);
      return user?.role !== "admin";
    });
  }

  return preferred;
}

async function getMissingIds(table: string): Promise<number[]> {
  const result = await db.execute(sql.raw(`
    SELECT ${ID_COLUMN}
    FROM ${table}
    WHERE ${CREATED_BY_COLUMN} IS NULL
    ORDER BY ${ID_COLUMN}
  `));

  return result.rows
    .map((row) => toNumber((row as { id?: unknown }).id))
    .filter((id) => id > 0);
}

async function applyRoundRobinFallback(table: string, missingIds: number[], userIds: number[]): Promise<number> {
  if (missingIds.length === 0 || userIds.length === 0) {
    return 0;
  }

  const CHUNK_SIZE = 500;
  let updatedTotal = 0;

  for (let i = 0; i < missingIds.length; i += CHUNK_SIZE) {
    const chunk = missingIds.slice(i, i + CHUNK_SIZE);

    const values = chunk
      .map((id, index) => {
        const userId = userIds[(i + index) % userIds.length];
        return `(${id}, ${userId})`;
      })
      .join(", ");

    const updateQuery = `
      WITH mapping (id, user_id) AS (
        VALUES ${values}
      ),
      updated AS (
        UPDATE ${table} target
        SET ${CREATED_BY_COLUMN} = mapping.user_id
        FROM mapping
        WHERE target.${ID_COLUMN} = mapping.id
          AND target.${CREATED_BY_COLUMN} IS NULL
        RETURNING target.${ID_COLUMN}
      )
      SELECT COUNT(*)::int AS updated_count
      FROM updated;
    `;

    const result = await db.execute(sql.raw(updateQuery));
    updatedTotal += toNumber((result.rows[0] as { updated_count?: unknown } | undefined)?.updated_count);
  }

  return updatedTotal;
}

async function runRoleBasedFallbackStep(
  policy: RoleFallbackPolicy,
  users: UserCandidate[],
): Promise<number> {
  const missingIds = await getMissingIds(policy.table);
  if (missingIds.length === 0) {
    return 0;
  }

  const eligibleUserIds = selectCandidatesByPolicy(users, policy);
  if (eligibleUserIds.length === 0) {
    console.log(`   ⚠️  fallback rôles (${policy.label}): aucun utilisateur éligible`);
    return 0;
  }

  if (dryRun) {
    console.log(
      `   [dry-run] fallback rôles (${policy.label}): ${missingIds.length} lignes, ${eligibleUserIds.length} utilisateur(s) éligible(s)`,
    );
    return 0;
  }

  const updated = await applyRoundRobinFallback(policy.table, missingIds, eligibleUserIds);
  console.log(
    `   🎯 fallback rôles (${policy.label}): ${updated} lignes (${eligibleUserIds.length} utilisateur(s), round-robin)`,
  );
  return updated;
}

async function runInferenceStep(step: BackfillStep): Promise<{ updated: number; remaining: number }> {
  const missingBefore = await getMissingCount(step.table);
  if (missingBefore === 0) {
    console.log(`⏭️  ${step.label}: rien à backfiller`);
    return { updated: 0, remaining: 0 };
  }

  if (step.sources.length === 0) {
    console.log(`⚠️  ${step.label}: aucune source d'inférence disponible (${missingBefore} à compléter)`);
    return { updated: 0, remaining: missingBefore };
  }

  console.log(`🔎 ${step.label}: ${missingBefore} lignes sans created_by`);

  if (dryRun) {
    console.log(`   [dry-run] sources utilisées: ${step.sources.length}`);
    return { updated: 0, remaining: missingBefore };
  }

  const candidateExpression = step.sources.length === 1
    ? step.sources[0]
    : `COALESCE(${step.sources.join(",\n")})`;

  const updateQuery = `
    WITH candidates AS (
      SELECT
        ${step.alias}.${ID_COLUMN} AS id,
        ${candidateExpression} AS inferred_created_by
      FROM ${step.table} ${step.alias}
      WHERE ${step.alias}.${CREATED_BY_COLUMN} IS NULL
    ),
    updated AS (
      UPDATE ${step.table} target
      SET ${CREATED_BY_COLUMN} = candidates.inferred_created_by
      FROM candidates
      WHERE target.${ID_COLUMN} = candidates.id
        AND target.${CREATED_BY_COLUMN} IS NULL
        AND candidates.inferred_created_by IS NOT NULL
      RETURNING target.${ID_COLUMN}
    )
    SELECT COUNT(*)::int AS updated_count
    FROM updated;
  `;

  const updateResult = await db.execute(sql.raw(updateQuery));
  const updated = toNumber((updateResult.rows[0] as { updated_count?: unknown } | undefined)?.updated_count);
  const remaining = await getMissingCount(step.table);

  console.log(`   ✅ ${updated} inférés, ${remaining} restants`);
  return { updated, remaining };
}

async function runFallbackStep(table: string, label: string, adminId: number): Promise<number> {
  const missingBefore = await getMissingCount(table);
  if (missingBefore === 0) {
    return 0;
  }

  if (dryRun) {
    console.log(`   [dry-run] fallback admin (${label}): ${missingBefore} lignes`);
    return 0;
  }

  const fallbackQuery = `
    WITH updated AS (
      UPDATE ${table}
      SET ${CREATED_BY_COLUMN} = ${adminId}
      WHERE ${CREATED_BY_COLUMN} IS NULL
      RETURNING ${ID_COLUMN}
    )
    SELECT COUNT(*)::int AS updated_count
    FROM updated;
  `;

  const fallbackResult = await db.execute(sql.raw(fallbackQuery));
  const updated = toNumber((fallbackResult.rows[0] as { updated_count?: unknown } | undefined)?.updated_count);
  console.log(`   🛟 fallback admin (${label}): ${updated} lignes`);
  return updated;
}

function createActivitySource(alias: string, entityTypes: string[]): string {
  const entities = entityTypes.map((entityType) => `'${entityType}'`).join(", ");
  return `
    (
      SELECT al.user_id
      FROM activity_logs al
      WHERE al.user_id IS NOT NULL
        AND al.entity_id = ${alias}.id
        AND lower(al.action) IN ('create', 'created')
        AND lower(al.entity_type) IN (${entities})
      ORDER BY al.created_at ASC, al.id ASC
      LIMIT 1
    )
  `;
}

async function buildPartsSources(alias: string): Promise<string[]> {
  const sources: string[] = [];

  if (await tableHasColumns("parts_stock_movements", ["part_id", "created_by", "movement_type", "created_at", "id"])) {
    sources.push(`
      (
        SELECT psm.created_by
        FROM parts_stock_movements psm
        WHERE psm.part_id = ${alias}.id
          AND psm.created_by IS NOT NULL
        ORDER BY
          CASE WHEN psm.movement_type = 'initial' THEN 0 ELSE 1 END ASC,
          psm.created_at ASC,
          psm.id ASC
        LIMIT 1
      )
    `);
  }

  if (await tableHasColumns("activity_logs", ["user_id", "entity_id", "entity_type", "action", "created_at", "id"])) {
    sources.push(createActivitySource(alias, ["part", "parts", "piece", "inventory_part"]));
  }

  return sources;
}

async function buildVehicleSources(alias: string): Promise<string[]> {
  const sources: string[] = [];

  if (await tableHasColumns("activity_logs", ["user_id", "entity_id", "entity_type", "action", "created_at", "id"])) {
    sources.push(createActivitySource(alias, ["vehicle", "vehicule", "truck"]));
  }

  if (await tableHasColumns("status_history", ["vehicle_id", "updated_by_id", "created_at", "id"])) {
    sources.push(`
      (
        SELECT sh.updated_by_id
        FROM status_history sh
        WHERE sh.vehicle_id = ${alias}.id
          AND sh.updated_by_id IS NOT NULL
        ORDER BY sh.created_at ASC, sh.id ASC
        LIMIT 1
      )
    `);
  }

  if (await tableHasColumns("work_orders", ["vehicle_id", "created_by", "created_at", "id"])) {
    sources.push(`
      (
        SELECT wo.created_by
        FROM work_orders wo
        WHERE wo.vehicle_id = ${alias}.id
          AND wo.created_by IS NOT NULL
        ORDER BY wo.created_at ASC, wo.id ASC
        LIMIT 1
      )
    `);
  }

  return sources;
}

async function buildSupplierSources(alias: string): Promise<string[]> {
  const sources: string[] = [];

  if (await tableHasColumns("purchase_orders", ["supplier_id", "created_by", "order_date", "created_at", "id"])) {
    sources.push(`
      (
        SELECT po.created_by
        FROM purchase_orders po
        WHERE po.supplier_id = ${alias}.id
          AND po.created_by IS NOT NULL
        ORDER BY po.order_date ASC NULLS LAST, po.created_at ASC, po.id ASC
        LIMIT 1
      )
    `);
  }

  if (await tableHasColumns("supplier_invoices", ["supplier_id", "validated_by", "approved_by", "paid_by", "created_at", "id"])) {
    sources.push(`
      (
        SELECT COALESCE(si.validated_by, si.approved_by, si.paid_by)
        FROM supplier_invoices si
        WHERE si.supplier_id = ${alias}.id
          AND COALESCE(si.validated_by, si.approved_by, si.paid_by) IS NOT NULL
        ORDER BY si.created_at ASC, si.id ASC
        LIMIT 1
      )
    `);
  }

  if (await tableHasColumns("activity_logs", ["user_id", "entity_id", "entity_type", "action", "created_at", "id"])) {
    sources.push(createActivitySource(alias, ["supplier", "suppliers", "fournisseur"]));
  }

  return sources;
}

async function buildClientSources(alias: string): Promise<string[]> {
  const sources: string[] = [];

  if (await tableHasColumns("missions", ["client_id", "created_by", "created_at", "id"])) {
    sources.push(`
      (
        SELECT m.created_by
        FROM missions m
        WHERE m.client_id = ${alias}.id
          AND m.created_by IS NOT NULL
        ORDER BY m.created_at ASC, m.id ASC
        LIMIT 1
      )
    `);
  }

  if (await tableHasColumns("client_invoices", ["client_id", "created_by", "created_at", "id"])) {
    sources.push(`
      (
        SELECT ci.created_by
        FROM client_invoices ci
        WHERE ci.client_id = ${alias}.id
          AND ci.created_by IS NOT NULL
        ORDER BY ci.created_at ASC, ci.id ASC
        LIMIT 1
      )
    `);
  }

  if (await tableHasColumns("activity_logs", ["user_id", "entity_id", "entity_type", "action", "created_at", "id"])) {
    sources.push(createActivitySource(alias, ["client", "clients", "customer"]));
  }

  return sources;
}

async function buildBackfillSteps(): Promise<BackfillStep[]> {
  const steps: BackfillStep[] = [];

  if (await tableHasColumns("vehicles", [ID_COLUMN, CREATED_BY_COLUMN])) {
    steps.push({
      label: "Véhicules",
      table: "vehicles",
      alias: "v",
      sources: await buildVehicleSources("v"),
    });
  } else {
    console.log("⚠️  Table vehicles sans colonne created_by: étape ignorée");
  }

  if (await tableHasColumns("parts", [ID_COLUMN, CREATED_BY_COLUMN])) {
    steps.push({
      label: "Pièces",
      table: "parts",
      alias: "p",
      sources: await buildPartsSources("p"),
    });
  } else {
    console.log("⚠️  Table parts sans colonne created_by: étape ignorée");
  }

  if (await tableHasColumns("suppliers", [ID_COLUMN, CREATED_BY_COLUMN])) {
    steps.push({
      label: "Fournisseurs",
      table: "suppliers",
      alias: "s",
      sources: await buildSupplierSources("s"),
    });
  } else {
    console.log("⚠️  Table suppliers sans colonne created_by: étape ignorée");
  }

  if (await tableHasColumns("clients", [ID_COLUMN, CREATED_BY_COLUMN])) {
    steps.push({
      label: "Clients",
      table: "clients",
      alias: "c",
      sources: await buildClientSources("c"),
    });
  } else {
    console.log("⚠️  Table clients sans colonne created_by: étape ignorée");
  }

  return steps;
}

async function run(): Promise<void> {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║      BACKFILL created_by (vehicles, parts, suppliers, clients)      ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log(`Mode: ${dryRun ? "DRY RUN (aucune écriture)" : "WRITE"}`);
  console.log(`Fallback rôles: ${fallbackRoleBased ? "activé" : "désactivé"}`);
  console.log(`Fallback admin: ${fallbackAdmin ? "activé" : "désactivé"}\n`);

  const steps = await buildBackfillSteps();
  if (steps.length === 0) {
    console.log("Aucune étape exécutable trouvée.");
    return;
  }

  const summary: BackfillResult = {
    inferred: 0,
    roleBasedFallback: 0,
    fallback: 0,
    remaining: 0,
  };

  for (const step of steps) {
    const inference = await runInferenceStep(step);
    summary.inferred += inference.updated;
    summary.remaining += inference.remaining;
  }

  if (fallbackRoleBased) {
    const users = await getActiveUserCandidates();
    console.log(`\n🎛️  Fallback par rôles métier (${users.length} utilisateur(s) actif(s))`);

    for (const policy of ROLE_BASED_POLICIES) {
      if (!steps.some((step) => step.table === policy.table)) {
        continue;
      }
      const updated = await runRoleBasedFallbackStep(policy, users);
      summary.roleBasedFallback += updated;
    }
  }

  if (fallbackAdmin) {
    const adminUserId = await getAdminUserId();
    if (!adminUserId) {
      console.log("\n⚠️  Aucun utilisateur admin actif trouvé pour le fallback.");
    } else {
      console.log(`\n🛟 Fallback admin sur les valeurs restantes (user_id=${adminUserId})`);
      for (const step of steps) {
        const updated = await runFallbackStep(step.table, step.label, adminUserId);
        summary.fallback += updated;
      }
    }
  }

  let remainingAfter = 0;
  for (const step of steps) {
    remainingAfter += await getMissingCount(step.table);
  }

  console.log("\n════════════════════ RÉSULTAT ════════════════════");
  console.log(`Inférés: ${summary.inferred}`);
  console.log(`Fallback rôles: ${summary.roleBasedFallback}`);
  console.log(`Fallback admin: ${summary.fallback}`);
  console.log(`Restants sans created_by: ${remainingAfter}`);
  console.log("═══════════════════════════════════════════════════");
}

run()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("❌ Backfill échoué:", error);
    await pool.end();
    process.exit(1);
  });

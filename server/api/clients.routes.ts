import { Router } from "express";
import { db } from "../db";
import { clients, users } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { insertClientSchema } from "@shared/schema";
import { authenticate, authorize } from "../middleware/auth";
import { ZodError } from "zod";
import { AppError } from "../lib/app-error";
import { parseRouteId } from "../lib/route-id";
import { moduleLogger } from "../lib/logger";
import { withLogContext } from "../lib/error-log-context";
import { STAFF_ROLES, canReadFinanceReceivable } from "@shared/constants/roles";

const log = moduleLogger("clients");
const router = Router();
router.use(authenticate);
const updateClientSchema = insertClientSchema.partial();

type ClientRow = typeof clients.$inferSelect;
type ClientWithCreator = ClientRow & { createdByName: string | null };

const MANAGER_ROLES = ["admin", "secretary", "logistics"] as const;

/** Taux de retenue (lot F1) : données finance, hors de la fiche client vue par le reste du personnel. */
export const CLIENT_FINANCE_FIELDS = [
  "withholdingVatRate",
  "withholdingIsRate",
  "withholdingIsBase",
  "withholdingUpdatedBy",
] as const;

export function withoutFinanceFields<T extends Partial<ClientRow>>(client: T): Omit<T, (typeof CLIENT_FINANCE_FIELDS)[number]> {
  const copy: Record<string, unknown> = { ...client };
  for (const field of CLIENT_FINANCE_FIELDS) delete copy[field];
  return copy as Omit<T, (typeof CLIENT_FINANCE_FIELDS)[number]>;
}

/** Fiche client telle que la voit l'appelant : taux de retenue réservés aux rôles de lecture finance. */
function forViewer<T extends Partial<ClientRow>>(client: T, role: string | undefined) {
  return canReadFinanceReceivable(role) ? client : withoutFinanceFields(client);
}

function parsePositiveInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim();
    if (normalized.length === 0) {
      return null;
    }

    const parsed = Number.parseInt(normalized, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

function parseClientId(rawId: string): number {
  return parseRouteId(rawId, "Identifiant client invalide");
}

function sanitizeUpdateData(
  values: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  );
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const code = (error as { code?: string }).code;
  return code === "23505";
}

function broadcastClientUpdate(
  eventType: "client_created" | "client_updated" | "client_deleted",
  client: ClientWithCreator,
): void {
  const broadcastUpdate = (global as any).broadcastUpdate;
  if (typeof broadcastUpdate !== "function") {
    return;
  }

  broadcastUpdate(eventType, {
    entity: "client",
    entityId: client.id,
    // Diffusé à tout le personnel : sans les taux de retenue.
    payload: { client: withoutFinanceFields(client) },
    // Fiche d'un client de flotte (coordonnées, créateur) : le personnel, jamais un compte client (§11).
    scope: { type: "roles", roles: [...STAFF_ROLES] },
  });
}

async function withCreatorNames(clientRows: ClientRow[]): Promise<ClientWithCreator[]> {
  const creatorIds = Array.from(
    new Set(
      clientRows
        .map((client) => parsePositiveInteger(client.createdBy))
        .filter((value): value is number => value !== null),
    ),
  );
  const creatorNameById = new Map<number, string>();

  if (creatorIds.length > 0) {
    const creatorRows = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, creatorIds));

    for (const creator of creatorRows) {
      creatorNameById.set(creator.id, creator.name);
    }
  }

  return clientRows.map((client) => {
    const creatorId = parsePositiveInteger(client.createdBy);
    return {
      ...client,
      createdByName: creatorId ? creatorNameById.get(creatorId) ?? null : null,
    };
  });
}

async function getClientWithCreator(clientId: number): Promise<ClientWithCreator | null> {
  const [result] = await db
    .select({
      client: clients,
      createdByName: users.name,
    })
    .from(clients)
    .leftJoin(users, eq(clients.createdBy, users.id))
    .where(eq(clients.id, clientId));

  if (!result) {
    return null;
  }

  return {
    ...result.client,
    createdByName: result.createdByName ?? null,
  };
}

// GET /api/clients - Liste tous les clients
router.get("/", async (req, res, next) => {
  try {
    const allClients = await db
      .select()
      .from(clients)
      .where(eq(clients.isActive, true))
      .orderBy(clients.name);

    const clientsWithCreator = await withCreatorNames(allClients);

    return res.json(clientsWithCreator.map((client) => forViewer(client, req.user?.role)));
  } catch (error) {
    return next(withLogContext(error instanceof AppError ? error : new AppError(500, "Erreur serveur", { cause: error }), { event: "Get clients error" }));
  }
});

// GET /api/clients/all - Liste active + archivée (réservée profils gestion client)
router.get("/all", authorize([...MANAGER_ROLES]), async (req, res, next) => {
  try {
    const allClients = await db
      .select()
      .from(clients)
      .orderBy(clients.name);

    const clientsWithCreator = await withCreatorNames(allClients);
    return res.json(clientsWithCreator.map((client) => forViewer(client, req.user?.role)));
  } catch (error) {
    return next(withLogContext(error instanceof AppError ? error : new AppError(500, "Erreur serveur", { cause: error }), { event: "Get all clients error" }));
  }
});

// GET /api/clients/:id - Détails d'un client
router.get("/:id", async (req, res, next) => {
  try {
    const clientId = parseClientId(req.params.id);

    const client = await getClientWithCreator(clientId);
    if (!client) {
      return res.status(404).json({ message: "Client non trouvé" });
    }

    return res.json(forViewer(client, req.user?.role));
  } catch (error) {
    return next(withLogContext(error instanceof AppError ? error : new AppError(500, "Erreur serveur", { cause: error }), { event: "Get client error" }));
  }
});

// POST /api/clients - Créer un nouveau client
router.post("/", authorize(["admin", "secretary", "logistics"]), async (req, res, next) => {
  try {
    const clientData = req.body;

    // Validate client data
    const validatedData = insertClientSchema.parse(clientData);

    // Create client
    const createdBy = parsePositiveInteger(req.session?.userId);
    const [newClient] = await db
      .insert(clients)
      .values({
        ...validatedData,
        createdBy,
      })
      .returning();

    const createdClient = await getClientWithCreator(newClient.id);
    if (!createdClient) {
      throw new AppError(500, "Client créé mais introuvable");
    }

    broadcastClientUpdate("client_created", createdClient);
    return res.status(201).json(forViewer(createdClient, req.user?.role));
  } catch (error) {
    // Corps invalide : 400 avec les champs en cause, via le gestionnaire central.
    if (error instanceof ZodError) return next(error);
    if (isUniqueViolation(error)) {
      return res.status(409).json({
        message: "Un client avec ce nom existe déjà",
      });
    }
    return next(withLogContext(error instanceof AppError ? error : new AppError(500, "Erreur lors de la création du client", { cause: error }), { event: "Create client error" }));
  }
});

// PATCH /api/clients/:id - Modifier un client
router.patch("/:id", authorize([...MANAGER_ROLES]), async (req, res, next) => {
  try {
    const clientId = parseClientId(req.params.id);

    const validatedData = updateClientSchema.parse(req.body ?? {});
    const updateData = sanitizeUpdateData(validatedData);
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ message: "Aucune donnée à mettre à jour" });
    }

    const [updatedClient] = await db
      .update(clients)
      .set({
        ...updateData,
        updatedAt: new Date(),
      })
      .where(eq(clients.id, clientId))
      .returning();

    if (!updatedClient) {
      return res.status(404).json({ message: "Client non trouvé" });
    }

    const hydratedClient = await getClientWithCreator(updatedClient.id);
    if (!hydratedClient) {
      throw new AppError(500, "Client mis à jour mais introuvable");
    }

    broadcastClientUpdate("client_updated", hydratedClient);
    return res.json(forViewer(hydratedClient, req.user?.role));
  } catch (error) {
    if (error instanceof ZodError) return next(error);
    if (isUniqueViolation(error)) {
      return res.status(409).json({
        message: "Un client avec ce nom existe déjà",
      });
    }
    return next(withLogContext(error instanceof AppError ? error : new AppError(500, "Erreur lors de la mise à jour du client", { cause: error }), { event: "Update client error" }));
  }
});

// DELETE /api/clients/:id - Archivage logique
router.delete("/:id", authorize([...MANAGER_ROLES]), async (req, res, next) => {
  try {
    const clientId = parseClientId(req.params.id);

    const [archivedClient] = await db
      .update(clients)
      .set({
        isActive: false,
        updatedAt: new Date(),
      })
      .where(eq(clients.id, clientId))
      .returning();

    if (!archivedClient) {
      return res.status(404).json({ message: "Client non trouvé" });
    }

    const hydratedClient = await getClientWithCreator(archivedClient.id);
    if (!hydratedClient) {
      throw new AppError(500, "Client archivé mais introuvable");
    }

    broadcastClientUpdate("client_deleted", hydratedClient);
    return res.json(forViewer(hydratedClient, req.user?.role));
  } catch (error) {
    return next(withLogContext(error instanceof AppError ? error : new AppError(500, "Erreur lors de l'archivage du client", { cause: error }), { event: "Archive client error" }));
  }
});

// PATCH /api/clients/:id/restore - Restaurer client archivé
router.patch("/:id/restore", authorize([...MANAGER_ROLES]), async (req, res, next) => {
  try {
    const clientId = parseClientId(req.params.id);

    const [restoredClient] = await db
      .update(clients)
      .set({
        isActive: true,
        updatedAt: new Date(),
      })
      .where(eq(clients.id, clientId))
      .returning();

    if (!restoredClient) {
      return res.status(404).json({ message: "Client non trouvé" });
    }

    const hydratedClient = await getClientWithCreator(restoredClient.id);
    if (!hydratedClient) {
      throw new AppError(500, "Client restauré mais introuvable");
    }

    broadcastClientUpdate("client_updated", hydratedClient);
    return res.json(forViewer(hydratedClient, req.user?.role));
  } catch (error) {
    return next(withLogContext(error instanceof AppError ? error : new AppError(500, "Erreur lors de la restauration du client", { cause: error }), { event: "Restore client error" }));
  }
});

export default router;

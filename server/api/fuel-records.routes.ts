import { Router, type NextFunction, type Request, type Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../lib/app-error";
import { withLogContext } from "../lib/error-log-context";
import { broadcastFuelRecordChanged } from "../lib/fuel-record-realtime";
import { moduleLogger } from "../lib/logger";
import { idParam } from "../lib/route-helpers";
import { withoutFuelCardBalance } from "../lib/fuel-balance-scope";
import { ownerScopeOf } from "../lib/client-scope";
import { parseQueryId, parseRouteId } from "../lib/route-id";
import { assertVehicleSubresourcesReadable } from "../lib/vehicle-subresource-guard";
import { FUEL_CARD_MANAGER_ROLES, FUEL_READ_ROLES } from "@shared/constants/roles";
import { fuelRecordCancelSchema } from "@shared/constants/fuel-record-cancel";
import type { FuelRecord } from "@shared/schema";
import { authorize, isAnyUser, isFuelRecordWriter } from "../middleware/auth";
import { FuelService } from "../services/fuel-service";
import { storage } from "../storage";

const log = moduleLogger("fuel-records");
const router = Router();
const fuelService = new FuelService();

/*
 * Chemins encore servis par server/routes.ts (gelé). Ce routeur est monté avant registerRoutes :
 * il garde ou filtre ici, puis passe la main au gestionnaire historique par next().
 */

/**
 * POST et PATCH /api/fuel-records renvoient la ligne brute : `balance` et `fuelBalance` (solde de
 * la carte) partaient chez le chef d'atelier, qui saisit des pleins sans lire la trésorerie. La
 * réponse est filtrée au moment de l'envoi, quand la garde de routes.ts a chargé `req.user`.
 */
function maskFuelCardBalanceInResponse(req: Request, res: Response, next: NextFunction) {
  const send = res.json.bind(res);
  res.json = (body: unknown) => send(withoutFuelCardBalance(req.user, body));
  next();
}
router.post("/fuel-records", isFuelRecordWriter, maskFuelCardBalanceInResponse, (_req, _res, next) => next());
router.patch("/fuel-records/:id", isFuelRecordWriter, maskFuelCardBalanceInResponse, (_req, _res, next) => next());

/**
 * Agrégats carburant de la flotte : pilotage seulement, plus le client, que routes.ts cloisonne à
 * ses véhicules (ownerScopeOf). Chauffeur, technicien, magasinier et lecteur n'ont aucun écran
 * qui les lit.
 */
router.get("/fuel-records/statistics", authorize([...FUEL_READ_ROLES, "client"]), (_req, _res, next) => next());

/**
 * Pleins d'un véhicule, sortis de server/routes.ts (gelé) : même cloison que les autres lectures
 * rattachées au véhicule. Par ce chemin, un client ne lit que les pleins de son véhicule, et plus
 * une fois le véhicule retiré ; le personnel lit tout, véhicule retiré compris. Les filtres
 * `?vehicleId=` de `/fuel-records` et `/fuel-records/consumption-history` passent par la même garde (L1b).
 */
router.get("/fuel-records/vehicle/:vehicleId", isAnyUser, async (req, res, next) => {
  try {
    const vehicleId = parseRouteId(req.params.vehicleId, "ID de véhicule invalide");
    await assertVehicleSubresourcesReadable(req, vehicleId);
    const records = await fuelService.getFuelRecordsByVehicleId(vehicleId);
    return res.status(200).json(
      records.map((record: FuelRecord) => ({
        ...record,
        pricePerLiter: record.quantity > 0 ? Number(record.cost) / record.quantity : 0,
        totalCost: Number(record.cost),
      })),
    );
  } catch (err) {
    if (err instanceof AppError) return next(err);
    return next(withLogContext(new AppError(500, "Erreur serveur", { cause: err }), { event: "lecture des pleins du véhicule en échec" }));
  }
});

const INVALID_VEHICLE_FILTER = "ID de véhicule invalide.";

/** Véhicules dont un lecteur voit les pleins sans filtre : tous pour le personnel, les siens pour un client (retirés exclus). */
async function readableVehicles(req: Parameters<typeof ownerScopeOf>[0]) {
  const ownerScope = ownerScopeOf(req);
  const list = ownerScope === null ? await storage.listAllVehicles() : await storage.getVehiclesByOwner(ownerScope);
  return list.vehicles;
}

const withPrice = (record: FuelRecord) => ({
  ...record,
  pricePerLiter: record.quantity > 0 ? Number(record.cost ?? 0) / record.quantity : 0,
  totalCost: Number(record.cost ?? 0),
});

/**
 * Liste des pleins, sortie de server/routes.ts (gelé). Avec `?vehicleId=`, même garde que le chemin
 * `/fuel-records/vehicle/:vehicleId` (near miss de L1 : le chemin était fermé, le filtre restait ouvert).
 * Sans filtre, un client ne lit que les pleins de ses véhicules non retirés.
 */
router.get("/fuel-records", isAnyUser, async (req, res, next) => {
  try {
    const vehicleId = parseQueryId(req.query.vehicleId, INVALID_VEHICLE_FILTER);
    let records: FuelRecord[];
    if (vehicleId !== undefined) {
      await assertVehicleSubresourcesReadable(req, vehicleId);
      records = await fuelService.getFuelRecordsByVehicleId(vehicleId);
    } else {
      records = [];
      for (const vehicle of await readableVehicles(req.user)) {
        records.push(...(await fuelService.getFuelRecordsByVehicleId(vehicle.id)));
      }
      records.sort((a, b) => (b.date ? new Date(b.date).getTime() : 0) - (a.date ? new Date(a.date).getTime() : 0));
    }
    return res.status(200).json(records.map(withPrice));
  } catch (err) {
    if (err instanceof AppError) return next(err);
    return next(withLogContext(new AppError(500, "Erreur serveur", { cause: err }), { event: "lecture des pleins en échec" }));
  }
});

type HistoryWindow = { shift: (d: Date, now: Date) => void; format: "day" | "month" };
const MONTH_WINDOW: HistoryWindow = { shift: (d, now) => d.setMonth(now.getMonth() - 1), format: "day" };
// Map, pas un objet littéral : `?period=constructor` ne doit pas lire une clé héritée d'Object.prototype.
const HISTORY_WINDOWS = new Map<string, HistoryWindow>([
  ["week", { shift: (d, now) => d.setDate(now.getDate() - 7), format: "day" }],
  ["month", MONTH_WINDOW],
  ["quarter", { shift: (d, now) => d.setMonth(now.getMonth() - 3), format: "month" }],
  ["year", { shift: (d, now) => d.setFullYear(now.getFullYear() - 1), format: "month" }],
]);

/**
 * Historique de consommation pour le graphique, sorti de server/routes.ts (gelé). Même cloison que
 * la liste : garde du véhicule avec `?vehicleId=`, véhicules lisibles sinon. Période inconnue : le mois.
 */
router.get("/fuel-records/consumption-history", isAnyUser, async (req, res, next) => {
  try {
    const vehicleId = parseQueryId(req.query.vehicleId, INVALID_VEHICLE_FILTER);
    const window = (typeof req.query.period === "string" && HISTORY_WINDOWS.get(req.query.period)) || MONTH_WINDOW;
    const now = new Date();
    const limitDate = new Date();
    window.shift(limitDate, now);

    type Dated = Awaited<ReturnType<typeof storage.getFuelRecordsByVehicleId>>[number] & { date: string };
    const inWindow = (record: Awaited<ReturnType<typeof storage.getFuelRecordsByVehicleId>>[number]): record is Dated =>
      typeof record.date === "string" && new Date(record.date) >= limitDate;

    let vehicleIds: number[];
    if (vehicleId !== undefined) {
      await assertVehicleSubresourcesReadable(req, vehicleId);
      vehicleIds = [vehicleId];
    } else {
      vehicleIds = (await readableVehicles(req.user)).map((vehicle) => vehicle.id);
    }
    const records: Dated[] = [];
    for (const id of vehicleIds) records.push(...(await storage.getFuelRecordsByVehicleId(id)).filter(inWindow));

    const history: Record<string, { date: string; quantity: number; cost: number; count: number }> = {};
    for (const record of records) {
      const d = new Date(record.date);
      const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const key = window.format === "day" ? `${month}-${String(d.getDate()).padStart(2, "0")}` : month;
      history[key] ??= { date: key, quantity: 0, cost: 0, count: 0 };
      history[key].quantity += record.quantity;
      history[key].cost += Number(record.cost ?? 0);
      history[key].count += 1;
    }
    return res.status(200).json(Object.values(history).sort((a, b) => a.date.localeCompare(b.date)));
  } catch (err) {
    if (err instanceof AppError) return next(err);
    return next(withLogContext(new AppError(500, "Erreur serveur", { cause: err }), { event: "historique de consommation carburant en échec" }));
  }
});

/**
 * Suppression d'un plein, sortie de server/routes.ts (gelé). Montée avant registerRoutes :
 * Express sert la première déclaration. La suppression passe par le service, qui prend le
 * verrou de la carte carburant (le solde est une somme sur fuel_records).
 *
 * Deux familles de rôles : le chef d'atelier supprime un plein physique (garde historique), les
 * gestionnaires de la carte supprimaient en plus un plein qui a mouvementé la carte (suppression
 * douce, tracée). Le service tranche sous verrou, après relecture de la ligne : 403 au chef d'atelier
 * sur un plein qui a mouvementé la carte, 404 sur une ligne absente ou déjà supprimée.
 */
router.delete("/fuel-records/:id", authorize([...FUEL_CARD_MANAGER_ROLES, "workshop_manager"]), async (req, res, next) => {
  try {
    const id = idParam(req.params.id, "Identifiant d'enregistrement de carburant");
    const user = req.user!; // authorize() a déjà refusé toute requête sans utilisateur
    const deleted = await fuelService.deleteFuelRecord(id, { id: user.id, role: user.role });
    if (!deleted) throw new AppError(404, "Enregistrement de carburant non trouvé");
    log.info({ requestId: req.requestId, fuelRecordId: id, userId: user.id }, "Plein carburant supprimé");
    broadcastFuelRecordChanged(id, req.requestId);
    return res.status(204).send();
  } catch (err) {
    if (err instanceof AppError) return next(err);
    return next(withLogContext(new AppError(500, "Erreur serveur", { cause: err }), { event: "Delete fuel record error" }));
  }
});

/**
 * Annulation tracée d'un plein validé (correction : annuler, puis saisir un nouveau plein). Mêmes
 * rôles que la suppression ; le service tranche sous verrou (403 selon que le plein a mouvementé
 * la carte, 409 budget soldé, rejeu du même motif = 200 sans écriture).
 */
router.post("/fuel-records/:id/cancel", authorize([...FUEL_CARD_MANAGER_ROLES, "workshop_manager"]), async (req, res, next) => {
  try {
    const id = idParam(req.params.id, "Identifiant d'enregistrement de carburant");
    // Seul le motif est retenu du corps : aucun autre champ ne peut atteindre la base.
    const { reason: rawReason } = req.body ?? {};
    const { reason } = fuelRecordCancelSchema.parse({ reason: rawReason });
    const user = req.user!;
    const result = await fuelService.cancelFuelRecord(id, { id: user.id, role: user.role }, reason);
    if (!result) throw new AppError(404, "Enregistrement de carburant non trouvé");
    if (!result.replayed) {
      log.info({ requestId: req.requestId, fuelRecordId: id, userId: user.id }, "Plein carburant annulé");
      broadcastFuelRecordChanged(id, req.requestId);
    }
    return res.status(200).json(withoutFuelCardBalance(req.user, result.record));
  } catch (err) {
    if (err instanceof AppError || err instanceof ZodError) return next(err);
    return next(withLogContext(new AppError(500, "Erreur serveur", { cause: err }), { event: "Cancel fuel record error" }));
  }
});

export default router;

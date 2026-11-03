import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

/**
 * Prix d'achat du véhicule (`vehicles.purchasePrice`) : réservé à admin, logistique et secrétariat.
 *
 * Toute requête qui lit la table `vehicles` sans projection explicite (`select()` vide,
 * `{ vehicle: vehicles }`, `getTableColumns(vehicles)`) ramène la colonne du prix, ainsi que
 * `row_to_json(v.*)` en SQL. Si le résultat atteint une réponse HTTP ou une trame temps réel,
 * le prix fuit : c'est arrivé par la jointure des pneus et par le calcul des coûts de mission
 * (prix / 1000, donc récupérable).
 *
 * Les occurrences existantes sont gelées ci-dessous, chacune avec sa justification (masquée en aval
 * par `redactVehiclePrice[Deep]`, ou jamais servie). La liste doit rester strictement égale :
 * - une occurrence nouvelle fait échouer le test : préférer une projection explicite
 *   (`{ id: vehicles.id, registrationNumber: vehicles.registrationNumber }`), sinon masquer la
 *   sortie puis ajouter l'entrée ici avec sa justification ;
 * - une occurrence supprimée fait aussi échouer le test : retirer l'entrée.
 *
 * Limite assumée de `redactVehiclePriceDeep` : un objet n'est reconnu comme véhicule que s'il porte
 * `purchasePrice` ET `registrationNumber`. Une projection qui ne prendrait que `purchasePrice` ne serait
 * pas masquée : c'est la raison d'être de ce test, qui interdit de lire la colonne sans le déclarer.
 */
const FROZEN: Record<string, string> = {
  "server/api/vehicles.routes.ts#1": "check-alerts : ne sert que des compteurs d'alertes, aucune fiche véhicule en sortie",
  "server/services/excel-export-service.ts#1": "export carburant : seule l'immatriculation de la jointure est écrite dans le classeur",
  "server/services/excel-export-service.ts#2": "export missions : seule l'immatriculation de la jointure est écrite dans le classeur",
  "server/services/excel-export-service.ts#3": "export carburant : seule l'immatriculation de la jointure est écrite dans le classeur",
  "server/services/export-service.ts#1": "export « complet » : réservé à admin par EXPORT_ROLE_MATRIX, qui lit le prix",
  "server/services/fuel-card-service.ts#1": "lecture interne pour l'affectation de carte : aucun champ véhicule renvoyé",
  "server/services/fuel-card-service.ts#2": "lecture interne pour l'affectation de carte : aucun champ véhicule renvoyé",
  "server/services/mileage-service.ts#1": "mise à jour du kilométrage : la route de synchronisation masque le véhicule renvoyé (routes.ts)",
  "server/services/operations-service.ts#1": "liste des missions du jour : les routes /api/operations masquent par redactVehiclePriceDeep",
  "server/services/operations-service.ts#2": "liste des missions : les routes /api/operations masquent par redactVehiclePriceDeep",
  "server/services/preventive-maintenance-service.ts#1": "contrôle des échéances : le véhicule sert au calcul, seuls des ordres de travail sont renvoyés",
  "server/services/preventive-maintenance-service.ts#2": "contrôle des échéances : le véhicule sert au calcul, seuls des ordres de travail sont renvoyés",
  "server/services/preventive-maintenance-service.ts#3": "génération d'OT : le véhicule ne sert qu'à nommer l'ordre, jamais renvoyé",
  "server/services/preventive-maintenance-service.ts#4": "prochaines maintenances : le résultat est reprojeté (immatriculation seule)",
  "server/services/tires-service-simplified.ts#1": "pneus montés d'un véhicule : la route GET /api/vehicles/:id/tires masque par redactVehiclePriceDeep",
  "server/services/vehicle-activation-service-final.ts#1": "code mort, importé nulle part",
  "server/services/vehicle-activation-service-fixed.ts#1": "code mort, importé nulle part",
  "server/services/vehicle-activation-service-working.ts#1": "code mort, importé nulle part",
  "server/services/vehicle-documentation-service.ts#1": "documents et statuts : les routes /api/vehicles masquent par redactVehiclePriceDeep",
  "server/services/vehicle-list-service.ts#1": "liste des véhicules : la route masque par redactVehiclePriceDeep",
  "server/services/vehicle-status-service.ts#1": "indicateurs de flotte : agrégats de statut, aucune fiche renvoyée",
  "server/services/vehicle-status-service.ts#2": "indicateurs de flotte : agrégats de statut, aucune fiche renvoyée",
  "server/services/vehicle-status-service.ts#3": "indicateurs de flotte : agrégats de statut, aucune fiche renvoyée",
  "server/services/vehicle-status-service.ts#4": "changement de statut : retour void",
  "server/storage.ts#1": "getVehicle : les routes appelantes masquent ou n'en lisent que des champs d'identification",
  "server/storage.ts#2": "getVehicleByRegistration : idem",
  "server/storage.ts#3": "getVehicles : les routes appelantes masquent",
  "server/storage.ts#4": "listAllVehicles : les routes appelantes masquent ou n'en font que des agrégats",
  "server/storage.ts#5": "getVehiclesByOwner : les routes appelantes masquent ou n'en font que des agrégats",
  "server/services/vehicle-deletion-service.ts#row_to_json": "instantané d'archive en base ; service non servi (la route importe vehicle-deletion-service-trigger)",
  "server/services/vehicle-deletion-service-simple.ts#row_to_json": "instantané d'archive en base ; service non servi (la route importe vehicle-deletion-service-trigger)",
};

const root = fileURLToPath(new URL("../../..", import.meta.url));
const serverDir = join(root, "server");

function serverSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "_archive" || name === "node_modules") return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return serverSources(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

/** Argument équilibré du `.select(` qui précède la position donnée, ou null s'il n'y en a pas. */
function selectArgument(source: string, position: number): string | null {
  const start = source.lastIndexOf(".select(", position);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start + ".select".length; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")") {
      depth--;
      if (depth === 0) return source.slice(start + ".select(".length, i);
    }
  }
  return null;
}

function isWholeRow(argument: string): boolean {
  return argument.trim() === "" || /:\s*vehicles\s*[,}\n]/.test(argument) || /getTableColumns\(\s*vehicles\s*\)/.test(argument);
}

function findWholeVehicleReads(source: string, key: string): string[] {
  const found: string[] = [];
  const fromVehicles = /\.(?:from|leftJoin|innerJoin|rightJoin)\(\s*vehicles\b/g;
  let ordinal = 0;
  for (let match = fromVehicles.exec(source); match; match = fromVehicles.exec(source)) {
    const argument = selectArgument(source, match.index);
    if (argument !== null && isWholeRow(argument)) found.push(`${key}#${++ordinal}`);
  }
  if (/row_to_json\(\s*v\.\*\s*\)/.test(source)) found.push(`${key}#row_to_json`);
  return found;
}

describe("lectures entières de la table vehicles (prix d'achat)", () => {
  const found = serverSources(serverDir).flatMap((path) => {
    const key = relative(root, path).replace(/\\/g, "/");
    return findWholeVehicleReads(readFileSync(path, "utf8"), key);
  });

  it("aucune occurrence hors de la liste gelée, et aucune entrée périmée", () => {
    expect([...found].sort()).toEqual(Object.keys(FROZEN).sort());
  });

  it("chaque entrée gelée porte une justification", () => {
    for (const [entry, reason] of Object.entries(FROZEN)) {
      expect(reason.length, entry).toBeGreaterThan(15);
    }
  });

  it("le détecteur repère une lecture entière et ignore une projection explicite", () => {
    const whole = "const r = await db.select().from(vehicles).where(x);";
    const nested = "db.select({ vehicle: vehicles, id: a.id }).from(a).leftJoin(vehicles, eq(1, 1));";
    const columns = "db.select(getTableColumns(vehicles)).from(vehicles);";
    const projected = "db.select({ id: vehicles.id, registrationNumber: vehicles.registrationNumber }).from(vehicles);";
    expect(findWholeVehicleReads(whole, "f")).toEqual(["f#1"]);
    expect(findWholeVehicleReads(nested, "f")).toEqual(["f#1"]);
    expect(findWholeVehicleReads(columns, "f")).toEqual(["f#1"]);
    expect(findWholeVehicleReads(projected, "f")).toEqual([]);
    expect(findWholeVehicleReads("SELECT row_to_json(v.*) FROM vehicles v", "f")).toEqual(["f#row_to_json"]);
  });
});

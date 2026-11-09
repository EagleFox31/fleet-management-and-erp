import { routeSignature } from "./route-guard-scan";

/**
 * Table du balayage de la cloison client (AGENTS.md §11, decision #255) : une route ouverte a un client
 * (`isAnyUser`) qui vise un objet par son identifiant. Elle est lue par le contrat
 * `tests/contract/client-scope-sweep.contract.test.ts` (comportement) et par la garde
 * `tests/unit/server/client-scope-sweep-guard.test.ts` (aucune route ouverte ne manque a la table).
 *
 * `attendu` : statut commun a l'objet d'un autre client et a l'identifiant absent. Famille vehicule = 403 ;
 * famille ordre de travail = 404 (convention en vigueur) ; verification de plaque = 200 `{exists:false}`.
 */
export type SweepKind = "vehicle" | "plate" | "workOrder" | "wfDocument" | "wfSession" | "user";
export type SweepMethod = "GET" | "DELETE";
export type SweepRoute = {
  label: string;
  kind: SweepKind;
  method: SweepMethod;
  /** Chemin avec un seul parametre `:id`, remplace par l'identifiant a tester. */
  template: string;
  attendu: number;
  /** Faux : pas de cas « le client lit son propre objet » (ex. suppression). */
  lecturePropre?: boolean;
  /** Vrai : la reponse 200 porte un corps, comparé entre l'etranger et l'absent. */
  comparerCorps?: boolean;
  /** Sous-chaine que le corps de la lecture de son propre objet doit contenir (sinon une route qui renvoie [] a tous resterait verte). */
  corpsPropre?: string;
};

export const SWEEP_ROUTES: SweepRoute[] = [
  { label: "documents d'un vehicule", kind: "vehicle", method: "GET", template: "/api/vehicles/:id/documents", attendu: 403 },
  { label: "historique de statut", kind: "vehicle", method: "GET", template: "/api/vehicles/:id/status-history", attendu: 403 },
  { label: "historique du kilometrage", kind: "vehicle", method: "GET", template: "/api/vehicles/:id/mileage/history", attendu: 403 },
  { label: "pleins d'un vehicule", kind: "vehicle", method: "GET", template: "/api/fuel-records/vehicle/:id", attendu: 403 },
  { label: "verification de plaque", kind: "plate", method: "GET", template: "/api/vehicles/check/:id", attendu: 200, comparerCorps: true, corpsPropre: '"exists":true' },
  { label: "document de workflow (lecture)", kind: "wfDocument", method: "GET", template: "/api/workflows/documents/:id", attendu: 403 },
  { label: "document de workflow (suppression)", kind: "wfDocument", method: "DELETE", template: "/api/workflows/documents/:id", attendu: 403, lecturePropre: false },
  { label: "documents d'une session de workflow", kind: "wfSession", method: "GET", template: "/api/workflows/:id/documents", attendu: 200, comparerCorps: true, corpsPropre: "propre.pdf" },
  { label: "etat d'un brouillon d'acquisition", kind: "wfSession", method: "GET", template: "/api/workflows/vehicle-acquisition/:id", attendu: 200, comparerCorps: true, corpsPropre: "-s-propre" },
  { label: "profil d'un utilisateur", kind: "user", method: "GET", template: "/api/users/:id", attendu: 403 },
  { label: "ordre de travail", kind: "workOrder", method: "GET", template: "/api/work-orders/:id", attendu: 404 },
  { label: "lignes de travail", kind: "workOrder", method: "GET", template: "/api/work-orders/:id/items", attendu: 404 },
  { label: "pieces de l'ordre de travail", kind: "workOrder", method: "GET", template: "/api/work-orders/:id/parts", attendu: 404 },
  { label: "rotations de pneus", kind: "workOrder", method: "GET", template: "/api/work-orders/:id/tire-rotations", attendu: 404 },
  { label: "demandes de pieces en attente", kind: "workOrder", method: "GET", template: "/api/work-orders/:id/pending-part-requirements", attendu: 404 },
];

/** Routes deja balayees par un autre contrat : `fragment` doit y figurer (la garde le verifie). */
export type CoveredElsewhere = { method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"; template: string; file: string; fragment: string; exact?: boolean };
export const COVERED_ELSEWHERE: CoveredElsewhere[] = [
  // Chemins construits par appel (`relative(alertPath(":id"))`) : le scan les retient sous leur texte illisible (échec fermé).
  { method: "POST", template: '/api/:illisible(relative(ALERT_READ_ALL_PATH))', file: "tests/contract/alerts-inbox.contract.test.ts", fragment: '"POST", ALERT_READ_ALL_PATH', exact: true },
  { method: "PATCH", template: '/api/:p(`${relative(alertPath(":p"))}/read`)', file: "tests/contract/alerts-inbox.contract.test.ts", fragment: '"PATCH", `${alertPath(foreign)}/read`', exact: true },
  { method: "DELETE", template: '/api/:p(relative(alertPath(":p")))', file: "tests/contract/alerts-inbox.contract.test.ts", fragment: '"DELETE", alertPath(foreign)', exact: true },
  { method: "GET", template: "/api/vehicles/:id", file: "tests/contract/client-unknown-vs-foreign.contract.test.ts", fragment: "/api/vehicles/${foreignVehicle}" },
  { method: "GET", template: "/api/vehicles/:id/documents/:type", file: "tests/contract/client-unknown-vs-foreign.contract.test.ts", fragment: "/api/vehicles/${id}/documents/autre" },
  { method: "GET", template: "/api/maintenance-schedules/vehicle/:id", file: "tests/contract/client-unknown-vs-foreign.contract.test.ts", fragment: "/api/maintenance-schedules/vehicle/${id}" },
  { method: "GET", template: "/api/work-orders/vehicle/:id", file: "tests/contract/client-unknown-vs-foreign.contract.test.ts", fragment: "/api/work-orders/vehicle/${id}" },
  { method: "GET", template: "/api/vehicles/:id/mileage", file: "tests/contract/client-unknown-vs-foreign.contract.test.ts", fragment: "/api/vehicles/${id}/mileage" },
  { method: "GET", template: "/api/vehicles/:id/tires", file: "tests/contract/client-unknown-vs-foreign.contract.test.ts", fragment: "/api/vehicles/${id}/tires" },
  { method: "GET", template: "/api/documents/:id/download", file: "tests/contract/client-unknown-vs-foreign.contract.test.ts", fragment: "/api/documents/${foreignDocument}/download" },
  { method: "GET", template: "/api/document-renewals/requests/:id/proof", file: "tests/contract/document-renewal-proof-download.contract.test.ts", fragment: "/api/document-renewals/requests/${id}/proof" },
  { method: "PATCH", template: "/api/workflows/vehicle-acquisition/:id", file: "tests/contract/r2-vehicle-acquisition-guards.contract.test.ts", fragment: "${URL}/${s}" },
  { method: "PATCH", template: "/api/workflows/vehicle-acquisition/:id/complete", file: "tests/contract/r2-vehicle-acquisition-guards.contract.test.ts", fragment: "${URL}/${s}/complete" },
  { method: "PATCH", template: "/api/workflows/vehicle-acquisition/:id/abandon", file: "tests/contract/r2-vehicle-acquisition-guards.contract.test.ts", fragment: "${URL}/${s}/abandon" },
  { method: "PATCH", template: "/api/workflows/active/:id/abandon", file: "tests/contract/r2-vehicle-acquisition-guards.contract.test.ts", fragment: "/api/workflows/active/${s}/abandon" },
  { method: "POST", template: "/api/workflows/:id/documents", file: "tests/contract/r2-vehicle-acquisition-guards.contract.test.ts", fragment: "/api/workflows/${s}/documents" },
  { method: "GET", template: "/api/clients/:id/statement", file: "tests/contract/client-statement.contract.test.ts", fragment: 'get(clientStatementPath(MAX_DB_INTEGER_ID), "client")', exact: true },
];

/** Exclusions : la raison est obligatoire, la liste ne peut que rétrécir (la garde en fige la taille). */
export type Exclusion = { method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"; template: string; raison: string };
export const EXCLUSIONS: Exclusion[] = [
  {
    method: "GET",
    template: "/api/alerts/type/:type",
    raison: "Le parametre est un type d'alerte, pas un objet : la liste est lue par l'identifiant de session, jamais par un identifiant de la requete.",
  },
];
export const MAX_EXCLUSIONS = 1;

export const signatureOf = (route: { method: string; template: string }) => routeSignature(route.method, route.template);

/** Lignes de la table qui ne correspondent plus a aucune route ouverte au client (route supprimee, renommee ou desormais restreinte). */
export function staleRows(found: string[]): string[] {
  const seen = new Set(found);
  return [...SWEEP_ROUTES, ...COVERED_ELSEWHERE, ...EXCLUSIONS].map(signatureOf).filter((signature) => !seen.has(signature));
}

/** Signatures ouvertes a un client qui ne figurent ni au balayage, ni ailleurs, ni aux exclusions. */
export function missingFromSweep(found: string[]): string[] {
  const known = new Set<string>([...SWEEP_ROUTES, ...COVERED_ELSEWHERE, ...EXCLUSIONS].map(signatureOf));
  return found.filter((signature) => !known.has(signature));
}

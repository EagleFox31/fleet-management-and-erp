import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, sep } from "path";
import { fileURLToPath } from "url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Portée temps réel fermée par défaut (LESSONS_LEARNED, « Portée temps réel fermée par
 * défaut »). Une portée absente ou invalide n'envoie plus rien (`server/lib/realtime-scope.ts`) ;
 * un événement n'atteint tout le monde, clients compris, que par `scope: { type: "broadcast" }`.
 * Trois fuites vers des clients sont passées par là (#53, #127, #151).
 *
 * Ce test gèle les `type: "broadcast"` explicites de `server/` : fichier et nombre, sans numéro de
 * ligne. La liste ne peut que rétrécir : restreindre un événement à une portée rôle/user fait
 * baisser le compte, il faut alors diminuer la valeur ci-dessous. Toute hausse échoue.
 *
 * `server/lib/realtime-scope.ts` (qui interprète la portée) et `server/_archive/` sont exclus.
 *
 * Chaque entrée porte sa justification. Les événements d’ordre de travail ne sont plus ici : ils partent
 * au personnel (`server/lib/work-order-realtime-scope.ts`), jamais à un client.
 */
const KNOWN_BROADCASTS: Record<string, { count: number; why: string }> = {
  "shared/contracts/realtime-events.ts": {
    count: 3,
    why: "type RealtimeScope (1) + portées par défaut de fuel_price_changed et vehicle_document_type_changed (2), prix et types de papier lus par tous les profils",
  },
};

const serverDir = fileURLToPath(new URL("../../../server", import.meta.url));
const repoDir = fileURLToPath(new URL("../../..", import.meta.url));

function serverSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "_archive" || name === "node_modules") return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return serverSources(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

function currentBroadcasts(): Record<string, number> {
  const counts: Record<string, number> = {};
  // Les portées par défaut des événements vivent aussi dans le contrat partagé.
  const sources = [...serverSources(serverDir), join(repoDir, "shared/contracts/realtime-events.ts")];
  for (const path of sources) {
    const rel = relative(repoDir, path).split(sep).join("/");
    if (rel === "server/lib/realtime-scope.ts") continue;
    const n = (readFileSync(path, "utf8").match(/type:\s*["']broadcast["']/g) ?? []).length;
    if (n > 0) counts[rel] = n;
  }
  return counts;
}

type ScopeCall = { rel: string; line: number; name: string; kind: "literal" | "forward" | "opaque" | "missing" };

const KINDS = new Set(["roles", "user", "broadcast"]);

/**
 * Portées calculées, donc non lisibles à la revue (variable ou appel de fonction). Fichier et
 * nombre ; la liste ne peut que rétrécir. Une portée écrite en clair n'y figure pas.
 */
const OPAQUE_SCOPES: Record<string, number> = {
"server/api/document-renewals.routes.ts": 2,
  "server/api/drivers-management.routes.ts": 1,
  "server/api/drivers.routes.ts": 1,
  "server/api/finance-receivables.routes.ts": 1,
  "server/api/fuel-anomalies.routes.ts": 1,
  "server/api/fuel-vouchers.routes.ts": 1,
  "server/api/part-requirements.routes.ts": 3,
  "server/api/parts-catalog.routes.ts": 1,
  "server/api/parts-used.routes.ts": 1,
  "server/api/technician-work-orders.routes.ts": 1,
  "server/api/time-tracking.routes.ts": 1,
  "server/api/vehicle-document-types.routes.ts": 1,
  "server/api/vehicle-documents.routes.ts": 5,
  "server/api/work-order-items.routes.ts": 1,
  "server/api/work-order-parts.routes.ts": 6,
  "server/api/workshop-labor-rates.routes.ts": 1,
  "server/lib/alert-broadcast.ts": 1,
  "server/lib/document-renewal-center-events.ts": 1,
  "server/lib/fuel-record-realtime.ts": 1,
  "server/lib/vehicle-realtime.ts": 1,
  "server/routes.ts": 4,
  "server/services/incident-service.ts": 1,
  "server/services/preventive-maintenance-service.ts": 1,
  "server/services/procurement-service.ts": 2,
  "server/services/technician-work-orders-service.ts": 1,
};

/** Analyse AST des appels à `broadcastUpdate` et à ses alias locaux (`const broadcast = global.broadcastUpdate`). */
function scopeScan(): ScopeCall[] {
  const calls: ScopeCall[] = [];
  for (const path of serverSources(serverDir)) {
    const rel = relative(repoDir, path).split(sep).join("/");
    if (rel === "server/lib/realtime-scope.ts") continue;
    const text = readFileSync(path, "utf8");
    if (!/broadcastUpdate/.test(text)) continue;
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const aliases = new Set(["broadcastUpdate"]);
    const collect = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        if (isGlobalBroadcastRef(node.initializer)) aliases.add(node.name.text);
      }
      if (ts.isBindingElement(node) && ts.isIdentifier(node.name) && (node.propertyName ?? node.name).getText(source) === "broadcastUpdate") {
        aliases.add(node.name.text);
      }
      ts.forEachChild(node, collect);
    };
    collect(source);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
        if (aliases.has(name)) {
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
          calls.push({ rel, line, name, kind: classify(node, source) });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return calls;
}

/** `(global as any).broadcastUpdate`, `globalThis.broadcastUpdate` : accès à la propriété, parenthèses et `as` ignorés. */
function isGlobalBroadcastRef(expr: ts.Expression): boolean {
  let node = expr;
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) node = node.expression;
  return ts.isPropertyAccessExpression(node) && node.name.text === "broadcastUpdate";
}

function classify(call: ts.CallExpression, source: ts.SourceFile): ScopeCall["kind"] {
  const [, payload] = call.arguments;
  // Enveloppe qui relaie telle quelle une trame déjà construite (`broadcastUpdate(event, data)`).
  if (call.arguments.length === 2 && ts.isIdentifier(call.arguments[0]) && payload && ts.isIdentifier(payload)) return "forward";
  if (!payload || !ts.isObjectLiteralExpression(payload)) return "missing";
  const scope = payload.properties.find(
    (p): p is ts.PropertyAssignment | ts.ShorthandPropertyAssignment =>
      (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name.getText(source) === "scope",
  );
  if (!scope) return payload.properties.some(ts.isSpreadAssignment) ? "opaque" : "missing";
  if (!ts.isPropertyAssignment(scope) || !ts.isObjectLiteralExpression(scope.initializer)) return "opaque";
  const type = scope.initializer.properties.find(
    (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(source) === "type",
  );
  return type && ts.isStringLiteral(type.initializer) && KINDS.has(type.initializer.text) ? "literal" : "opaque";
}

const ADVICE =
  "utiliser une portée rôle/user ; un broadcast doit être ajouté à la liste avec justification " +
  "(KNOWN_BROADCASTS dans tests/unit/server/broadcast-hygiene.test.ts)";

describe("hygiène des broadcasts temps réel", () => {
  it("aucun nouveau type: \"broadcast\" dans server/", () => {
    const now = currentBroadcasts();
    const added = Object.entries(now)
      .filter(([file, n]) => n > (KNOWN_BROADCASTS[file]?.count ?? 0))
      .map(([file, n]) => `${file} : ${n} au lieu de ${KNOWN_BROADCASTS[file]?.count ?? 0}`);
    expect(added, `Broadcast ajouté sans justification : ${ADVICE}`).toEqual([]);
  });

  it("la liste gelée ne garde que des broadcasts qui existent encore (elle ne peut que rétrécir)", () => {
    const now = currentBroadcasts();
    const stale = Object.entries(KNOWN_BROADCASTS)
      .filter(([file, { count }]) => (now[file] ?? 0) < count)
      .map(([file, { count }]) => `${file} : ${now[file] ?? 0} au lieu de ${count}`);
    expect(stale, "Broadcast supprimé ou restreint : diminuer ou retirer l'entrée de KNOWN_BROADCASTS").toEqual([]);
  });

  it("chaque appel de broadcastUpdate (et alias) porte une portée explicite", () => {
    // Sans portée l'événement est muet (realtime-scope.ts) : il faut le voir à la revue.
    const missing = scopeScan().filter((c) => c.kind === "missing").map((c) => `${c.rel}:${c.line} ${c.name}(…)`);
    expect(missing, 'Appel sans portée explicite (il ne partirait à personne) : ajouter scope: { type: "roles" | "user" | "broadcast", … }').toEqual([]);
  });

  it("une portée calculée (variable, appel) ne peut qu'être retirée de la liste gelée", () => {
    const counts: Record<string, number> = {};
    for (const c of scopeScan()) if (c.kind === "opaque") counts[c.rel] = (counts[c.rel] ?? 0) + 1;
    const added = Object.entries(counts)
      .filter(([file, n]) => n > (OPAQUE_SCOPES[file] ?? 0))
      .map(([file, n]) => `${file} : ${n} au lieu de ${OPAQUE_SCOPES[file] ?? 0}`);
    expect(added, "Portée non littérale ajoutée : écrire scope: { type: \"roles\" | \"user\", … } en clair, ou la justifier dans OPAQUE_SCOPES").toEqual([]);
    const stale = Object.entries(OPAQUE_SCOPES)
      .filter(([file, n]) => (counts[file] ?? 0) < n)
      .map(([file, n]) => `${file} : ${counts[file] ?? 0} au lieu de ${n}`);
    expect(stale, "Portée calculée supprimée ou rendue littérale : diminuer ou retirer l'entrée de OPAQUE_SCOPES").toEqual([]);
  });

  it("chaque entrée a une justification", () => {
    for (const [file, { why }] of Object.entries(KNOWN_BROADCASTS)) {
      expect(why.trim().length, file).toBeGreaterThan(10);
    }
  });
});

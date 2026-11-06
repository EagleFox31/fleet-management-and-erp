import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

/**
 * Cloison des événements d'ordre de travail (AGENTS.md §11, lot B).
 *
 * Règle : une trame qui porte l'objet OT (`workOrder`), une pièce utilisée (`partUsed`) ou une
 * demande de pièce (`requirement`) part en `workOrderCostScope()` (personnel hors chauffeur) ;
 * une trame d'identifiants peut partir en `workOrderStaffScope()`. Analyse statique des fichiers
 * d'émission : le contrôle porte sur le texte de l'appel, scope compris.
 *
 * Les comptes sont en égalité stricte : ajouter ou retirer une émission oblige à mettre la liste
 * à jour, donc à relire sa portée.
 */
const repoDir = fileURLToPath(new URL("../../..", import.meta.url));

const EMITTERS: Record<string, { cost: number; staff: number }> = {
  "server/api/part-requirements.routes.ts": { cost: 2, staff: 1 },
  "server/api/parts-used.routes.ts": { cost: 1, staff: 0 },
  "server/api/technician-work-orders.routes.ts": { cost: 1, staff: 0 },
  "server/api/work-order-items.routes.ts": { cost: 0, staff: 1 },
  "server/api/work-order-parts.routes.ts": { cost: 5, staff: 1 },
  "server/routes.ts": { cost: 2, staff: 2 },
  "server/services/incident-service.ts": { cost: 1, staff: 0 },
  "server/services/preventive-maintenance-service.ts": { cost: 1, staff: 0 },
  "server/services/procurement-service.ts": { cost: 0, staff: 2 },
  // Un seul appel `broadcast`, dont la portée est un ternaire (coûts pour work_order_*, personnel
  // sinon) : il compte une fois dans chaque colonne. La trame réduite au propriétaire est en `user`.
  "server/lib/db-event-relay.ts": { cost: 1, staff: 1 },
};

/** Texte de chaque appel `broadcastUpdate(` / `broadcast(`, parenthèses équilibrées. */
function emissions(source: string): string[] {
  const calls: string[] = [];
  const start = /(?:broadcastUpdate|\bbroadcast)\(/g;
  for (const match of source.matchAll(start)) {
    let depth = 0;
    let end = match.index! + match[0].length - 1;
    for (; end < source.length; end++) {
      if (source[end] === "(") depth++;
      else if (source[end] === ")" && --depth === 0) break;
    }
    const text = source.slice(match.index!, end + 1);
    if (/scope\s*:/.test(text)) calls.push(text);
  }
  return calls;
}

const carriesWorkOrderObject = (call: string): boolean =>
  /(?:^|[\s{,.])(?:workOrder|partUsed|requirement)\s*[:,}\r\n]/.test(call.replace(/scope\s*:[^,\n]*/, ""));

describe("portée des émissions d'ordre de travail", () => {
  for (const [file, expected] of Object.entries(EMITTERS)) {
    const calls = emissions(readFileSync(join(repoDir, file), "utf8")).filter(
      (call) => /workOrder(?:Cost|Staff)Scope\(\)/.test(call),
    );
    const cost = calls.filter((call) => call.includes("workOrderCostScope()"));
    const staff = calls.filter((call) => call.includes("workOrderStaffScope()"));

    it(`${file} : comptes gelés (coûts ${expected.cost}, personnel ${expected.staff})`, () => {
      expect({ cost: cost.length, staff: staff.length }).toEqual(expected);
    });

    it(`${file} : une trame qui porte workOrder, partUsed ou requirement part en workOrderCostScope()`, () => {
      const wrong = staff.filter(carriesWorkOrderObject).map((call) => call.split("\n")[0]);
      expect(wrong, "passer l'émission en workOrderCostScope()").toEqual([]);
    });
  }

  it("aucune émission du périmètre ne retombe en broadcast", () => {
    for (const file of Object.keys(EMITTERS)) {
      const source = readFileSync(join(repoDir, file), "utf8");
      const bad = emissions(source).filter((call) => /type:\s*["']broadcast["']/.test(call) && !call.includes("fuel_card_recharged"));
      expect(bad, file).toEqual([]);
    }
  });
});

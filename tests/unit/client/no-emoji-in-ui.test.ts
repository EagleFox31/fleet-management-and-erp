import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

// AGENTS.md §4 : aucun emoji dans l'UI (icone lucide-react a la place).
// Plages bornees : emoji et pictogrammes (U+1F000-1FAFF), symboles et dingbats (U+2600-27BF), etoiles et ronds
// (U+2B50, U+2B55), selecteur d'emoji (U+FE0F) et touche encadree (U+20E3). Les lettres accentuees, les fleches
// typographiques (U+2190-21FF), les puces, tirets et guillemets ne sont pas touches.
export const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2B55}\u{FE0F}\u{20E3}]/u;

const root = process.cwd();
const walk = (d: string): string[] =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : /\.(tsx?|jsx?)$/.test(e.name) ? [join(d, e.name)] : []));

const scan = (src: string) =>
  src.split(/\r?\n/).flatMap((l, i) => (EMOJI.test(l) ? [i + 1] : []));

// Cliquet : lignes avec emoji par fichier a l'introduction du garde-fou (dette a migrer vers lucide-react).
// Le compte d'un fichier ne peut que baisser ; un nouveau fichier ne peut pas en recevoir ; un fichier assaini sort de la liste.
const GELES: Record<string, number> = {
  "client/src/components/dashboard/expiring-cpc-alert.tsx": 1,
  "client/src/components/dashboard/expiring-docs-alert.tsx": 1,
  "client/src/components/dashboard/overdue-orders-alert.tsx": 1,
  "client/src/components/inventory/part-table.tsx": 3,
  "client/src/components/management/executive-corridor-map.tsx": 1,
  "client/src/components/procurement/procurement-tutorial-modal.tsx": 3,
  "client/src/components/vehicles/mileage-update-form.tsx": 1,
  "client/src/components/vehicles/vehicle-form.tsx": 6,
  "client/src/components/workflows/vehicle-acquisition-workflow.tsx": 4,
  "client/src/hooks/use-animated-error.ts": 17,
  "client/src/hooks/use-workflow-persistence.ts": 2,
  "client/src/lib/form-drafts.ts": 1,
  "client/src/pages/dev/profiles.tsx": 3,
  "client/src/pages/inventory/[id].tsx": 1,
  "client/src/pages/missions/new.tsx": 1,
  "client/src/pages/procurement/invoices/index.tsx": 1,
  "client/src/pages/procurement/orders/[id].tsx": 1,
  "client/src/pages/reports/index.tsx": 4,
  "client/src/pages/settings.tsx": 7,
  "client/src/pages/technician/fleet-status.tsx": 9,
  "client/src/pages/workflows/vehicle-acquisition.tsx": 4,
};

describe("aucun nouvel emoji dans client/src", () => {
  const counts = () => {
    const out: Record<string, number> = {};
    for (const f of walk(resolve(root, "client/src"))) {
      const n = scan(readFileSync(f, "utf8")).length;
      if (n) out[relative(root, f).split(sep).join("/")] = n;
    }
    return out;
  };

  it("aucun fichier ne depasse son compte gele (nouveau fichier = 0)", () => {
    expect(Object.entries(counts()).filter(([f, n]) => n > (GELES[f] ?? 0))).toEqual([]);
  });

  it("la liste gelee ne contient que des fichiers qui ont encore des emoji", () => {
    const now = counts();
    expect(Object.keys(GELES).filter((f) => !now[f]), "fichiers assainis : les retirer de GELES").toEqual([]);
  });

  it("le detecteur voit un emoji dans un JSX fictif", () => {
    expect(scan('<Button>\n  Valider \u{2705}\n</Button>')).toEqual([2]);
    expect(scan('<p>\u{1F680} Lancement</p>')).toEqual([1]);
    expect(scan('<p>Alerte \u{26A0}\u{FE0F}</p>')).toEqual([1]);
  });

  it("le detecteur laisse passer accents, fleches typographiques, puces et guillemets", () => {
    expect(scan('<p>Entr\u00E9e en stock \u2192 Sortie \u2190 \u2022 \u00AB a \u00BB \u2014 \u20AC \u2026</p>')).toEqual([]);
  });
});

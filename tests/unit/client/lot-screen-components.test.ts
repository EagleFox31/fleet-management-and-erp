import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LOT_SCREENS } from "@/config/lot-screens";

/**
 * Garde-fou : un écran importé dans `lot-screen-components.ts` sans entrée dans la table
 * reste sur la page vide (« Cet écran n'est pas encore disponible »). Cas réel : cinq
 * écrans importés le 30 octobre 2026 sans leur ligne, dont les sauvegardes.
 * Lecture du source : le module importe les pages React, inutiles ici.
 */
const source = readFileSync(resolve(__dirname, "../../../client/src/config/lot-screen-components.ts"), "utf-8");

function importedComponents(text: string): string[] {
  const names: string[] = [];
  for (const m of text.matchAll(/^import\s+(?!type\b)([\s\S]*?)\s+from\s+["'][^"']+["'];/gm)) {
    const clause = m[1].trim();
    const named = clause.match(/\{([\s\S]*)\}/);
    if (named) {
      for (const part of named[1].split(",")) {
        const name = part.trim().replace(/^type\s+/, "");
        if (name && !part.trim().startsWith("type ")) names.push(name.split(/\s+as\s+/).pop()!.trim());
      }
    }
    const def = clause.replace(/\{[\s\S]*\}/, "").replace(/,\s*$/, "").trim();
    if (def && !def.startsWith("*")) names.push(def);
  }
  return names.filter((n) => /^[A-Z]/.test(n));
}

function tableEntries(text: string): Array<[string, string]> {
  const body = text.match(/LOT_SCREEN_COMPONENTS[^=]*=\s*\{([\s\S]*?)\n\};/);
  if (!body) throw new Error("table LOT_SCREEN_COMPONENTS introuvable");
  return [...body[1].matchAll(/["']?([\w-]+)["']?\s*:\s*(\w+)/g)].map((m) => [m[1], m[2]]);
}

describe("table des écrans du lot", () => {
  const entries = tableEntries(source);

  it("lit au moins un import et une entrée (le garde-fou n'est pas vide)", () => {
    expect(importedComponents(source).length).toBeGreaterThan(0);
    expect(entries.length).toBeGreaterThan(0);
  });

  it("chaque composant importé a son entrée", () => {
    const mapped = new Set(entries.map(([, component]) => component));
    expect(importedComponents(source).filter((name) => !mapped.has(name))).toEqual([]);
  });

  it("chaque entrée correspond à un écran déclaré dans lot-screens.ts", () => {
    const ids = new Set(LOT_SCREENS.map((s) => s.id));
    expect(entries.map(([id]) => id).filter((id) => !ids.has(id))).toEqual([]);
  });

  it("le parseur détecte un import sans entrée (contre-épreuve)", () => {
    const broken = source.replace(/[ \t]*"pending-invoices": PendingInvoicesScreen,/, "");
    const mapped = new Set(tableEntries(broken).map(([, c]) => c));
    expect(importedComponents(broken).filter((n) => !mapped.has(n))).toEqual(["PendingInvoicesScreen"]);
  });
});

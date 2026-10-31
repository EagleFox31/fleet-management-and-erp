import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const dossier = path.resolve(__dirname, "../../../.claude/hooks");
const script = (nom: string) => path.join(dossier, `${nom}.mjs`);
const charger = async (nom: string) => import(/* @vite-ignore */ pathToFileURL(script(nom)).href);

const bash = (command: string) => ({ tool_name: "Bash", tool_input: { command } });

function lancer(nom: string, entree: unknown) {
  return spawnSync("node", [script(nom)], { input: JSON.stringify(entree), encoding: "utf8" });
}

describe("garde-lecture-seule", () => {
  const refuses = [
    "git commit -m x",
    "git push origin main",
    "git -C ../fm-api checkout main",
    "gh pr merge 12 --squash",
    "gh pr comment 12 --body ok",
    "gh api repos/o/r/issues -X POST",
    "rm -rf dist",
    "sed -i 's/a/b/' fichier.ts",
    "npm install lodash",
    "echo x > fichier.txt",
    "cat a >> b.log",
    "tee sortie.txt",
  ];
  const autorises = [
    "git diff origin/main...HEAD",
    "git log --oneline -5",
    "gh pr view 12 --json state",
    "gh pr diff 12",
    "gh api repos/o/r/pulls/12",
    "node node_modules/typescript/bin/tsc --noEmit -p . 2>&1 | tail -n 20",
    "node node_modules/vitest/vitest.mjs run --reporter=dot 2>/dev/null",
    "grep -rn 'a=>b' server",
  ];

  it.each(refuses)("refuse : %s", async (commande) => {
    const { decide } = await charger("garde-lecture-seule");
    expect(decide(bash(commande))).toMatch(/lecture seule/);
  });

  it.each(autorises)("laisse passer : %s", async (commande) => {
    const { decide } = await charger("garde-lecture-seule");
    expect(decide(bash(commande))).toBeNull();
  });

  it("ignore les outils autres que Bash", async () => {
    const { decide } = await charger("garde-lecture-seule");
    expect(decide({ tool_name: "Read", tool_input: { file_path: "a" } })).toBeNull();
  });

  it("sort avec le code 2 (bloquant), pas 1", () => {
    const r = lancer("garde-lecture-seule", bash("git push"));
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/lecture seule/);
  });

  it("sort avec 0 sur une commande de lecture", () => {
    expect(lancer("garde-lecture-seule", bash("git status --short")).status).toBe(0);
  });
});

describe("garde-commit-propre", () => {
  const refuses = [
    'git commit -m "fix\n\nCo-Authored-By: Someone <noreply@anthropic.com>"',
    'git commit -m "Generated with a tool"',
    'git commit -m "Claude a corrigé le calcul"',
    'gh pr create --title t --body "avec Anthropic"',
    'git commit -m "correctif \u{1F916}"',
  ];
  const autorises = [
    'git commit -m "corrige le calcul du solde"',
    'git commit -m "ajoute les hooks de .claude/hooks"',
    'git commit -m "docs: agents dans .claude/agents/fleet-api.md"',
    'gh pr create --title "T-45 pointage" --body "RAIDER review : couvert"',
    "git status",
    'echo "Co-Authored-By: x"',
  ];

  it.each(refuses)("refuse : %s", async (commande) => {
    const { decide } = await charger("garde-commit-propre");
    expect(decide(bash(commande))).toMatch(/refusé/);
  });

  it.each(autorises)("laisse passer : %s", async (commande) => {
    const { decide } = await charger("garde-commit-propre");
    expect(decide(bash(commande))).toBeNull();
  });

  it("sort avec le code 2 sur un trailer d'attribution", () => {
    const r = lancer("garde-commit-propre", bash('git commit -m "x\n\nCo-Authored-By: A <a@b.c>"'));
    expect(r.status).toBe(2);
  });
});

describe("garde-journal", () => {
  const commit = (hash: string, fichiers: string[]) => ({ hash, sujet: `commit ${hash}`, fichiers });

  it("signale un commit de code sans entrée de journal", async () => {
    const { commitsSansJournal } = await charger("garde-journal");
    const r = commitsSansJournal([commit("aaa1111", ["server/api/x.routes.ts"])]);
    expect(r).toEqual([{ hash: "aaa1111", sujet: "commit aaa1111" }]);
  });

  it("accepte un commit de code qui porte son entrée de journal", async () => {
    const { commitsSansJournal } = await charger("garde-journal");
    const r = commitsSansJournal([commit("bbb2222", ["server/api/x.routes.ts", "docs/journal/api-1.md"])]);
    expect(r).toEqual([]);
  });

  it("n'exige rien d'un commit qui ne touche que des journaux ou un ADR", async () => {
    const { commitsSansJournal } = await charger("garde-journal");
    const r = commitsSansJournal([
      commit("ccc3333", ["docs/adr/0002-x.md"]),
      commit("ddd4444", ["docs/journal/fe-1.md"]),
    ]);
    expect(r).toEqual([]);
  });

  it("accepte le journal de couverture comme journal", async () => {
    const { commitsSansJournal } = await charger("garde-journal");
    const r = commitsSansJournal([commit("eee5555", ["tests/unit/a.test.ts", "docs/qa/JOURNAL_COUVERTURE.md"])]);
    expect(r).toEqual([]);
  });

  it("laisse finir l'agent quand stop_hook_active est vrai (pas de boucle)", () => {
    const r = lancer("garde-journal", { stop_hook_active: true, cwd: process.cwd() });
    expect(r.status).toBe(0);
  });
});

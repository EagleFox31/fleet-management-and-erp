import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, sep } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

/**
 * Pas de montant dans les journaux. Un appel `log.*` / `console.*` dont les arguments portent une
 * valeur monétaire (clé ou interpolation nommée prix, coût, montant, solde, TTC…, ou un `${…} FCFA`)
 * met des données financières dans les journaux, lus bien au-delà des rôles finance.
 * Le mot seul dans le message (« fuel balance error ») ne compte pas : seule la valeur compte.
 * Cliquet : les appels existants sont gelés par fichier, le compte ne fait que baisser.
 * Journaliser l'identifiant de l'objet (facture, budget, pièce) suffit à retrouver le montant en base.
 */
const FROZEN: Record<string, number> = {
  "server/api/mission-price.routes.ts": 1,
  "server/services/client-billing-service.ts": 4,
  "server/services/excel-export-service.ts": 1,
  "server/services/fuel-card-service.ts": 4,
  "server/services/fuel-service.ts": 1,
  "server/services/mission-budgets-service.ts": 1,
  "server/services/procurement-service.ts": 1,
  "server/services/vat-billing-service.ts": 1,
};

const LOG_CALL = /\b(?:log|logger|console|[A-Za-z]+Log(?:ger)?)\.(?:debug|info|warn|error|trace|fatal|log)\s*\(/g;
// Segment camelCase entier : `totalTTC`, `unitPrice`, `amounts`, mais pas `notValidated` (« tVa ») ni `costume`.
const MONEY_NAME = /\b\w*(?:[Pp]rice|[Cc]ost|[Aa]mount|[Bb]alance|[Pp]ayable|[Mm]ontant|[Pp]rix|TTC|TVA|Ttc|Tva)s?(?![a-z])\w*/g;
// Noms qui contiennent un terme monétaire sans porter de montant.
const NOT_AN_AMOUNT = /(?:Error|Err|Changed|Id|Ids|Count|Mode|Type|Currency|Rate)$/;
const CURRENCY_AFTER_VALUE = /\$\{[^}]*\}\s*(?:XAF|FCFA)\b/;

/** Arguments de l'appel qui commence à `start` (parenthèses équilibrées, chaînes respectées). */
function callArguments(src: string, start: number): string {
  let i = start;
  let depth = 1;
  let quote: string | null = null;
  for (; i < src.length && depth > 0; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
  }
  return src.slice(start, i - 1);
}

/** Code des arguments sans le texte des chaînes ; les expressions `${…}` d'un gabarit restent. */
function codeOnly(args: string): string {
  return args
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, (tpl) => (tpl.match(/\$\{[^}]*\}/g) ?? []).join(" "));
}

function logsAmount(args: string): boolean {
  if (CURRENCY_AFTER_VALUE.test(args)) return true;
  return (codeOnly(args).match(MONEY_NAME) ?? []).some((name) => !NOT_AN_AMOUNT.test(name));
}

function scan(serverDir: string, root: string): Record<string, number> {
  const counts: Record<string, number> = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (entry === "_archive" || entry === "node_modules") continue;
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith(".ts")) {
        const src = readFileSync(path, "utf8");
        for (const m of src.matchAll(LOG_CALL)) {
          if (!logsAmount(callArguments(src, m.index! + m[0].length))) continue;
          const file = relative(root, path).split(sep).join("/");
          counts[file] = (counts[file] ?? 0) + 1;
        }
      }
    }
  };
  walk(serverDir);
  return counts;
}

const root = fileURLToPath(new URL("../../..", import.meta.url));

describe("pas de montant dans les journaux", () => {
  const counts = scan(join(root, "server"), root);

  it("aucun nouvel appel de log qui porte un montant", () => {
    const over = Object.entries(counts)
      .filter(([file, n]) => n > (FROZEN[file] ?? 0))
      .map(([file, n]) => `${file} : ${n} (gelé ${FROZEN[file] ?? 0})`);
    expect(over, "journaliser l'identifiant de l'objet, pas le montant").toEqual([]);
  });

  it("cliquet : un compte gelé qui baisse doit être abaissé", () => {
    const stale = Object.entries(FROZEN)
      .filter(([file, n]) => (counts[file] ?? 0) < n)
      .map(([file, n]) => `${file} : ${counts[file] ?? 0} (gelé ${n})`);
    expect(stale).toEqual([]);
  });

  it("le détecteur voit la valeur, pas le mot", () => {
    for (const hit of [
      "{ amount: data.amount }, \"recharge\"",
      "{ invoiceId, newBalance: result.newBalance }, \"paiement\"",
      "`Total: ${Math.round(totalTTC)} FCFA`",
      "`estimated cost: ${estimatedCost} XAF`",
      "`${unitPrice} x ${qty}`",
      "{ oldPrice: num(m.agreedPrice) }, \"prix convenu modifié\"",
    ]) {
      expect(logsAmount(hit), hit).toBe(true);
    }
    for (const miss of [
      "\"Get fuel card balance error:\", error",
      "{ err: fuelBalanceError, requestId }, \"fuel balance error\"",
      "{ err, date }, \"prix du carburant illisible\"",
      "{ budgetId: id, amountsChanged: result.amountsChanged }, \"budget corrigé\"",
      "`Fetching top ${limit} suppliers by amount...`",
      "{ partId, quantity }, \"coût estimé calculé\"",
      "{ missing, notValidated, outdated }, \"contraintes\"",
    ]) {
      expect(logsAmount(miss), miss).toBe(false);
    }
  });
});

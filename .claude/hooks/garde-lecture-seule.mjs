#!/usr/bin/env node
// PreToolUse (Bash) des agents en lecture seule : refuse toute commande qui écrit
// (fichier, dépôt local ou distant, PR, installation). Code de sortie 2 = blocage.
import { pathToFileURL } from "node:url";

const GIT_ECRITURE =
  /\bgit\s+(?:-C\s+\S+\s+)?(commit|push|merge|rebase|reset|checkout|switch|add|rm|mv|stash|cherry-pick|am|apply|clean|restore|tag|pull|fetch\s+--prune|branch\s+-[dDmM]|worktree\s+(add|remove|prune))\b/;
const GH_ECRITURE =
  /\bgh\s+(pr\s+(merge|comment|review|edit|close|reopen|create|ready|checkout)|issue\s+(create|comment|edit|close|reopen)|release\s+(create|delete|edit)|repo\s+(delete|edit|create)|workflow\s+run|api\b[^|;&\n]*(-X|--method)\s*(POST|PUT|PATCH|DELETE))/i;
const FICHIER_ECRITURE = /(^|[\s;&|(])(rm|mv|cp|mkdir|rmdir|touch|tee|truncate|ln|chmod|chown)\s/;
const SED_EN_PLACE = /\bsed\s+(-[a-zA-Z]*i|--in-place)/;
const INSTALLATION = /\b(npm|pnpm|yarn)\s+(install|i|ci|add|remove|uninstall|publish|link|update|up)\b/;
const REDIRECTION = /(?<![=-])>{1,2}\s*(?!\/dev\/null|&)[^\s&|;]+/;

export function decide(input) {
  if (!input || input.tool_name !== "Bash") return null;
  const commande = String(input.tool_input?.command ?? "");
  // Neutralise les redirections de flux sans effet : 2>&1, >&2, >/dev/null.
  const nette = commande.replace(/\d*>&\d+/g, " ").replace(/\d*>>?\s*\/dev\/null/g, " ");
  const motifs = [
    [GIT_ECRITURE, "commande git qui modifie le dépôt"],
    [GH_ECRITURE, "commande gh qui écrit sur GitHub"],
    [FICHIER_ECRITURE, "commande qui crée, déplace ou supprime un fichier"],
    [SED_EN_PLACE, "sed en place"],
    [INSTALLATION, "installation ou modification de dépendances"],
    [REDIRECTION, "redirection vers un fichier"],
  ];
  for (const [motif, nom] of motifs) {
    if (motif.test(nette)) {
      return `Agent en lecture seule : ${nom}. Rapporte le constat à l'appelant au lieu d'agir.`;
    }
  }
  return null;
}

async function main() {
  let brut = "";
  for await (const morceau of process.stdin) brut += morceau;
  let input;
  try {
    input = JSON.parse(brut);
  } catch {
    process.stderr.write("garde-lecture-seule : entrée illisible, commande non contrôlée.\n");
    process.exit(0);
  }
  const raison = decide(input);
  if (raison) {
    process.stderr.write(`${raison}\n`);
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

#!/usr/bin/env node
// PreToolUse (Bash) : refuse un commit ou une PR dont le texte contient un trailer
// d'attribution ou une mention d'outil d'IA. Code de sortie 2 = blocage.
import { pathToFileURL } from "node:url";

const COMMANDE_PUBLIANTE = /\bgit\s+(?:-C\s+\S+\s+)?(commit|tag)\b|\bgh\s+(pr|issue)\s+(create|edit|comment)\b|\bgh\s+release\s+(create|edit)\b/;

const INTERDITS = [
  [/co-authored-by\s*:/i, "trailer Co-Authored-By"],
  [/generated\s+(with|by)\b/i, "mention « generated with »"],
  [/noreply@anthropic\.com/i, "adresse d'attribution"],
  [/\banthropic\b/i, "mention d'Anthropic"],
  // « claude » seul, hors chemin (.claude/, /claude/, claude-code, claude.md).
  [/(?<![./\w-])claude(?![\w/.-])/i, "mention de Claude"],
  [/\p{Extended_Pictographic}/u, "emoji (dont l'emoji robot)"],
];

export function decide(input) {
  if (!input || input.tool_name !== "Bash") return null;
  const commande = String(input.tool_input?.command ?? "");
  if (!COMMANDE_PUBLIANTE.test(commande)) return null;
  const trouves = INTERDITS.filter(([motif]) => motif.test(commande)).map(([, nom]) => nom);
  if (trouves.length === 0) return null;
  return `Commit ou PR refusé : ${trouves.join(", ")}. Le message décrit uniquement le changement technique.`;
}

async function main() {
  let brut = "";
  for await (const morceau of process.stdin) brut += morceau;
  let input;
  try {
    input = JSON.parse(brut);
  } catch {
    process.stderr.write("garde-commit-propre : entrée illisible, commande non contrôlée.\n");
    process.exit(0);
  }
  const raison = decide(input);
  if (raison) {
    process.stderr.write(`${raison}\n`);
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

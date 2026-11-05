# Nettoyage des exclusions de contraste et garde-fou emoji

## Quoi
- `EXCLUS_HISTORIQUE` est vidée : les deux couples historiques sans lien au code (badge CPC sur carte muted, destructive/10 ancien) sont supprimés de `scripts/contrast-semantic-text.mjs`. Le test fige désormais la liste à `[]` et exige 4,5 sur tous les couples.
- Nouveau `tests/unit/client/no-emoji-in-ui.test.ts` (règle AGENTS.md §4). Plages bornées : U+1F000-1FAFF, U+2600-27BF, U+2B50, U+2B55, U+FE0F, U+20E3 ; accents, flèches typographiques, puces et guillemets passent.

## Constat
Le balayage trouve 94 lignes avec emoji dans 22 fichiers de `client/src` (surtout `playful-error-messages.tsx`, `use-animated-error.ts`, `technician/fleet-status.tsx`, `settings.tsx`). Elles sont gelées par fichier (cliquet : le compte ne peut que baisser, un nouveau fichier ne peut pas en recevoir, un fichier assaini sort de la liste). La migration vers lucide-react est un lot séparé.

## Preuve
Mutations rouges : emoji dans un JSX fictif (`<p>Bravo …</p>`) dans un nouveau fichier, et emoji ajouté à un fichier gelé. Le détecteur est testé sur emoji, sélecteur FE0F, accents et flèches.

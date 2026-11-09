# Journaux de travail — lot recette du 2 novembre 2026

Chaque agent consigne ici ce qu'il fait, quand, comment, pourquoi et comment le tester.
Règle fixée par l'ADR 0001 §13 (`docs/adr/0001-lot-recette-2026-11-02.md`).

## Un fichier par agent

| Agent | Fichier |
|---|---|
| Orchestrateur | `orchestrateur.md` |
| Architecte | `sol.md` |
| Base de données 1 et 2 | `db-1.md`, `db-2.md` |
| Backend 1 et 2 | `be-1.md`, `be-2.md` |
| API 1 et 2 | `api-1.md`, `api-2.md` |
| Frontend 1 et 2 | `fe-1.md`, `fe-2.md` |
| Produit | `pe.md` |
| c7, métier argent | `c7-argent.md` |
| c7, déploiement et exploitation | `c7-deploiement.md` |
| Agent de test (session tests) | `docs/qa/journal/<AAAA-MM-JJTHHMM>-<slug>.md`, un fichier par entrée (voir son README) |

Un agent n'écrit que dans son fichier, déjà créé avec son en-tête : il y ajoute ses entrées à
partir du modèle ci-dessous. Le nom du fichier reprend le suffixe du worktree
(`../fm-be-1` → `be-1.md`).

## Règles

1. Une entrée par commit, dans le **même commit** que le changement.
2. Les entrées s'ajoutent en bas, dans l'ordre chronologique. On ne réécrit pas une entrée
   passée : une correction ajoute une entrée qui renvoie à l'ancienne.
3. Horodatage avec fuseau, pris de la machine : `date -Iseconds`.
4. « Comment tester » doit pouvoir être rejoué par la QA sans lire le code.
5. Aucun secret, mot de passe ni jeton dans le journal.
6. Un incident ou quasi-incident va dans `docs/analysis/LESSONS_LEARNED.md` ; l'entrée y renvoie.

## Retrouver qui a fait quoi

```bash
grep -rn "T-11a" docs/journal/             # toutes les entrées d'une tâche
grep -rn "server/lib/export" docs/journal/ # qui a touché un fichier
grep -n "^## " docs/journal/be-1.md        # chronologie d'un agent
```

## Modèle d'entrée

```markdown
## 2026-10-31T09:42:10+01:00 — T-11a — Table des rôles par export

- **Agent** : be-1 · **Branche** : `lot/be/T-11a-export-roles` · **Commit** : `<sha court>`
- **Statut** : fait | en cours | bloqué (raison)
- **Quoi** : ce qui change pour l'utilisateur ou le système, en une ou deux phrases.
- **Comment** : fichiers touchés, approche retenue, choix Adopt / Adapt / Learn / Build.
- **Pourquoi** : besoin ou décision d'origine (P-xx, D-xx, ADR §x).
- **Comment tester (QA)** :
  - Prérequis : compte, rôle, données, drapeau à activer.
  - Étapes : 1. … 2. … 3. …
  - Attendu : résultat visible ou code HTTP.
  - Preuve automatisée : `node --env-file=.env node_modules/vitest/vitest.mjs run --config vitest.contract.config.ts tests/contract/<fichier>` → `N passed`.
- **RAIDER** : couvert … ; ne s'applique pas … (pourquoi).
- **Reste / risques** : ce qui n'est pas fait, ce qui dépend d'un autre agent.
```

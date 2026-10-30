# Journal — Frontend 1 (`fe-1`)

Worktree : `../fm-fe-1`. Modèle d'entrée et règles : `README.md`.
Entrées ajoutées en bas, dans l'ordre chronologique, une par commit.

## 2026-10-30T13:56:05+01:00 — T-09 — Squelette client : drapeaux, routes et menu du lot

- **Agent** : fe-1 · **Branche** : `lot/fe/T-09-squelette-client` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : `useFeature(key)`, `FeatureGate`, routes et entrées de menu de tous les écrans du lot vers des pages vides ; entrées finance (Trésorerie) et Distribution masquées par drapeau.
- **Comment** : table déclarative `client/src/config/lot-screens.ts` (route, rôles, drapeau, menu) ; `components/lot-routes.tsx` génère les routes (posées avant les routes à `:id` dans `App.tsx`) ; `sidebar.tsx` injecte les entrées par rôle et filtre par drapeau. Un écran livré s'enregistre dans `config/lot-screen-components.ts` (une ligne), sans retoucher App/sidebar. Défauts de `FEATURE_FLAGS` tant que `GET /api/feature-flags` n'a pas répondu. Reuse : Build (60 lignes, pas de dépendance). Les entrées QHSE, GPS et tarifs n'existent pas dans le menu actuel : rien à masquer, les clés restent prêtes.
- **Pourquoi** : plan 06 T-09, ADR §6 ; débloque fe-2, sol (T-51, T-53) et pe (T-36).
- **Comment tester (QA)** :
  - Prérequis : compte admin ; serveur sans surcharge de drapeaux.
  - Étapes : 1. Menu Administration : Comptes verrouillés, Journal d'audit, Types de document, Sauvegardes, Périmètre. 2. Chaque entrée affiche la page vide. 3. Aller sur /fuel/vouchers : page introuvable (drapeau coupé). 4. Compte technicien sur /admin/backups : page introuvable.
  - Attendu : aucune page blanche.
  - Preuve automatisée : `node node_modules/vitest/vitest.mjs run tests/unit/client/use-feature.test.ts` → 6 passed ; tsc global zéro erreur.
- **RAIDER** : R/A table et drapeaux découverts ; I rendu sans état ; D aucune route existante modifiée ; scoped : client seul.
- **Reste / risques** : rôles des écrans SHOULD à ajuster par leur tâche (champ `roles` de la table).

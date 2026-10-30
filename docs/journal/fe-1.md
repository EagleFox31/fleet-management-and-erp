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

## 2026-10-30T13:57:44+01:00 — T-50 — Câblage temps réel des événements du lot

- **Agent** : fe-1 · **Branche** : `lot/fe/T-50-temps-reel` (sur T-09) · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : les 7 événements de `REALTIME_EVENTS` invalident leurs clés ; `work_order_updated` réinterroge aussi `/api/kpi`, `part_requirement_updated` le stock et les demandes magasin.
- **Comment** : `useRealTimeSync.ts` : un `case` par événement qui appelle `invalidateCatalogEvent(nom)`, lecture de `invalidates` du catalogue (une seule source) ; satellites ajoutés pour `vehicle_document_type_changed` (véhicules, documents) et `backup_failed` (alertes). Adapt de la structure existante.
- **Pourquoi** : AGENTS §2 couche 2 et 3, plan 06 T-50.
- **Comment tester (QA)** :
  - Preuve automatisée : `node node_modules/vitest/vitest.mjs run tests/unit/client/realtime-catalog-wiring.test.ts` → 12 passed ; tsc global zéro erreur.
  - Preuve de trame WebSocket : T-55 (deux comptes).
- **RAIDER** : D cases existants inchangés ; I invalidations sans effet de bord ; scoped client.
- **Reste / risques** : la clé `/api/vehicle-documents` est une hypothèse de satellite, à confirmer au branchement T-32b.

## 2026-10-30T14:03:00+01:00 — T-31a — Écrans admin sécurité (comptes verrouillés, journal d'audit, message de verrouillage)

- **Agent** : fe-1 · **Branche** : `lot/fe/T-31a-admin-securite` (sur T-50 et mocks T-09b) · **Commit** : voir `git log`
- **Statut** : fait (partie a, contre les mocks msw ; la partie b attend les routes réelles)
- **Quoi** : page Comptes verrouillés (liste, déverrouillage confirmé), page Journal d'audit (filtres utilisateur, objet, période, pagination), message « Compte verrouillé jusqu'à HH:MM » à la connexion.
- **Comment** : pages enregistrées dans `config/lot-screen-components.ts` ; réponses validées par les schémas de `shared/contracts/auth-lockout` et `audit-logs` ; déverrouillage par `useSingleFlightMutate`, id passé par les variables, ligne retirée du cache, puis invalidation de `/api/users` et `/api/audit-logs` ; erreurs par `userMessageOf`. `useAuth` expose `loginLockMessage` (le 429 y était avalé). Reuse : Adapt de `PremiumDataTable`, `AlertModal`, `Pagination`.
- **Pourquoi** : plan 06 T-31a, contrat P-03 et P-04.
- **Comment tester (QA)** :
  - Prérequis : compte admin ; mocks actifs ou routes réelles.
  - Étapes : 1. Administration, Comptes verrouillés : déverrouiller une ligne, elle disparaît. 2. Journal d'audit : filtrer par objet puis par période inversée (message d'erreur, aucune requête). 3. Se tromper 5 fois de mot de passe : le message indique l'heure de fin.
  - Preuve automatisée : `tests/unit/client/lockout-message.test.ts` + `use-feature.test.ts` → 10 passed ; tsc global zéro erreur.
- **RAIDER** : R tables et contrats partagés ; I déverrouiller deux fois = no-op côté liste ; D login inchangé hors message ; scoped client.
- **Reste / risques** : branchement réel (T-31b) ; `userId` du filtre saisi en numéro faute de sélecteur d'utilisateurs.

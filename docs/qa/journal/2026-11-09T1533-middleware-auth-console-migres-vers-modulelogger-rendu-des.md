## 2026-11-09T15:33:00+01:00 — Middleware auth : console.* migrés vers moduleLogger ; rendu des onglets Alertes (magasin) et Inventaire (atelier)

- **Statut** : fait (PR brouillon)
- **Quoi** :
  - `server/middleware/auth.ts` : les 5 `console.log` migrés vers `moduleLogger("auth")` (aucun supprimé). Niveaux : contrôle à chaque requête et accès autorisé en debug, refus (non authentifié, rôle non autorisé) en info. Champs : requestId, method, path, userId, role, allowedRoles. Ni corps, ni cookie, ni session entière. Statuts HTTP inchangés ;
  - `tests/unit/server/auth-no-console.test.ts` : aucun `console.*` dans auth.ts, passage par `moduleLogger("auth")`, aucun champ sensible journalisé. Rouge avant : 5 `console.log` relevés ;
  - `money-stock-render-error-states.test.ts` : onglet Alertes du magasin (`warehouse-alert-summary-unavailable`) et tuile « Stock bas / épuisé » de l'atelier (onglet Inventaire). Les primitives `Tabs` sont remplacées dans le test pour choisir l'onglet actif, sans changement du produit.
- **Comment tester (QA)** : `npx vitest run tests/unit/server/auth-no-console.test.ts tests/unit/client/money-stock-render-error-states.test.ts`. Rouge avec `statsFailed` (magasin) et `stockStatsFailed` (atelier) forcés à `false` : 4 tests rouges dont les deux nouveaux onglets ; vert sinon.
- **RAIDER** : D : statuts et comportement du middleware inchangés ; failure memory : garde-fou de code contre le retour du `console.*`. Revue sécurité requise (auth.ts).
- **Reste / risques** : environ 1 000 `console.*` restent côté serveur ailleurs.


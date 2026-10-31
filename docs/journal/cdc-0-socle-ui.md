# Journal — CDC-0b socle client (`cdc-0-socle-ui`)

Worktree : `../fm-cdc-0-socle-ui`. Modèle d'entrée et règles : `README.md`.
Entrées ajoutées en bas, dans l'ordre chronologique, une par commit.

## 2026-10-31T23:01:24+01:00 — CDC-0b — Socle client des écarts du cahier des charges

- **Agent** : fe (lot CDC-0b) · **Branche** : `lot/fe/CDC-0-socle-ui` · **Commit** : voir `git log`
- **Statut** : fait ; navigateur non joué (écrans vides derrière des drapeaux coupés)
- **Quoi** : pose une fois, côté client, les registres partagés du chantier CDC. 5 événements temps réel, 8 écrans déclarés (pages vides « Bientôt disponible »), 2 dépendances. Drapeaux coupés (défaut) : aucune entrée de menu, aucune route active, l'application est identique à `main`.
- **Comment** :
  - `shared/contracts/realtime-events.ts` + `client/src/hooks/useRealTimeSync.ts`, modifiés ensemble, un `case` littéral par événement : `part_sale_validated`, `part_sale_cancelled`, `part_sale_invoiced` (invalident `/api/part-sales`, `/api/parts`, `/api/warehouse`, `/api/kpi`), `vehicle_position_updated` (`/api/vehicle-positions`), `import_batch_applied` (`/api/vehicles`, `/api/work-orders`, `/api/kpi`, aucun toast). `/api/mission-advisories` s'ajoute à `incident_reported` (catalogue) et à `work_order_updated` (hook, événement réutilisé donc hors catalogue). Couche 3 seulement : aucun émetteur n'existe, les lots fonctionnels émettront. Portées déclarées par rôles (`PART_SALE_READ_ROLES`, `GPS_VIEW_ROLES`, `IMPORT_INTERVENTION_ROLES`).
  - `client/src/config/cdc-screens.ts` : 8 écrans (`part-scanner`, `part-labels`, `part-sales`, `fleet-map`, `telemetry-devices`, `kpi-reports`, `maintenance-report`, `excel-import`), chacun avec id, chemin, drapeau, rôles (constantes de `shared/constants/roles.ts`), API appelées et entrée de menu. Type `CdcScreen` = `LotScreen` avec drapeau et rôles obligatoires.
  - `client/src/config/cdc-screen-components.ts` : pages en `lazy`, une par écran (`client/src/pages/cdc/<id>.tsx`), toutes sur `CdcComingSoon` (`client/src/components/cdc/coming-soon.tsx`, tokens du design system).
  - `client/src/components/lot-routes.tsx` et `client/src/components/layout/sidebar.tsx` itèrent `[...LOT_SCREENS, ...CDC_SCREENS]`. `App.tsx` inchangé : `renderLotRoutes()` passe avant `/inventory/:id` et `/vehicles/:id`. Ajout d'une frontière `Suspense` autour du composant d'écran : le dépôt n'en avait aucune, un composant `lazy` (déjà utilisé par `scope`) faisait tomber l'arbre.
  - Dépendances, versions exactes, lock mis à jour par `npm install --package-lock-only` : `qrcode` 1.5.4 (MIT), `@types/qrcode` 1.5.6 (dev), `barcode-detector` 3.2.3 (MIT, tire `zxing-wasm` 3.1.6). `node_modules` non touché. Aucun import dans ce lot : ils servent au lot #3.
  - `tests/unit/client/cdc-screens.test.ts` : rôles de l'écran = rôles du montage serveur (table `tests/support/cdc-mounts.ts`), drapeau déclaré et repris par le montage, ids et chemins uniques face au lot recette et à `App.tsx`, page et entrée de composant présentes, contre-épreuve du comparateur de rôles.
  - Choix : Adopt (`qrcode`, `barcode-detector`, validés par l'architecte) ; Build pour le registre (pas d'équivalent).
- **Pourquoi** : les lots #3, #4, #6, #7, #8, #9 ne touchent ensuite que leur page et leurs fichiers ; ADR 0001 §1 et §6.
- **Comment tester (QA)** :
  - Prérequis : aucun (écrans vides).
  - Étapes : 1. Sans `FEATURE_FLAGS`, ouvrir l'application en administrateur : aucune entrée « Scanner une pièce », « Ventes de pièces », « Carte de la flotte », « Import Excel » dans le menu ; `/inventory/scan` affiche « Page introuvable ». 2. `FEATURE_FLAGS=part-qr=on`, magasinier : « Scanner une pièce » et « Étiquettes des pièces » sous Gestion de stock, page « Bientôt disponible ». 3. Même drapeau, comptable : aucune entrée, `/inventory/scan` introuvable.
  - Attendu : voir les étapes.
  - Preuve automatisée : `node node_modules/vitest/vitest.mjs run --reporter=dot` ; `node node_modules/typescript/bin/tsc --noEmit -p .`.
- **RAIDER** : couvert R (registre déclaratif, rôles et drapeaux importés), A (aucun nom de dépôt en dur), I (aucune écriture, rejouable), D (suites existantes vertes sans édition de test, drapeaux coupés = application inchangée), E (tokens, aucun `console.*`, imports sans doublon), failure memory (garde-fou rôles écran/API) ; sans objet : migration, sécurité serveur.
- **Reste / risques** :
  - `lot-routes.tsx` ne contient pas de `?next=` (la ligne 16 redirige vers `/login` seul) et `login` ne le lit pas : les liens QR vers `/inventory/scan` d'un utilisateur déconnecté atterrissent sur la connexion puis sur le tableau de bord. À traiter par le lot #3 (ou #10a), non inventé ici.
  - `part-labels` : aucune route d'étiquette n'est montée ; le test borne l'écran à `PART_LABEL_ROLES` (sous-ensemble de `PART_SCAN_ROLES`). Le lot #3 doit garder sa route par ce groupe.
  - `kpi-reports` : rôles `KPI_VIEWER_ROLES`, comparés à la garde `isManagementOrAdmin` de `server/middleware/auth.ts` ; le lot #7 (ajout du chef d'atelier) changera les deux ensemble.
  - `excel-import` : l'écran s'ouvre à `IMPORT_INTERVENTION_ROLES` (montage) ; les autres types d'import restent `IMPORT_ROLES` (administrateur), le lot #9 masque ces choix au chef d'atelier.

## 2026-10-31T23:23:18+01:00 — CDC-0b — Rebase de la base d'intégration sur la branche distante retenue

- **Agent** : fe (lot CDC-0b) · **Branche** : `lot/fe/CDC-0-socle-ui` · **Commit** : fusion b6818d4 puis ce commit
- **Statut** : fait
- **Quoi** : la branche distante `lot/int/CDC-0-base` (e7aa8f2 = schéma 53c8b89 + socle 73bf623 + `main` 76ff0f3) est la base retenue ; elle est fusionnée dans cette branche (`--no-ff`), sans conflit. Mon intégration locale (4820561) n'est plus utilisée.
- **Comment** : `git fetch origin` puis `git merge --no-ff origin/lot/int/CDC-0-base`. Aucun fichier du lot modifié.
- **Pourquoi** : le diff de la PR ne doit montrer que les fichiers du lot.
- **Comment tester (QA)** : `git diff --name-only origin/lot/int/CDC-0-base...HEAD` ne liste que les fichiers de l'entrée précédente ; `tsc --noEmit -p .` : 0 erreur ; `vitest run` : 72 fichiers, 922 tests verts.
- **RAIDER** : D (suites vertes après fusion) ; sans objet : les autres principes, aucun code changé.
- **Reste / risques** : aucun.

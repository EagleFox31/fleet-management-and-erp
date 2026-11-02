# Lessons Learned

## 2026-08-29 — Instrumenter avant d'optimiser (cache dashboard Direction)

### Constat
Le dashboard Direction a reçu 4 tables cache, 5 triggers et une migration de
backfill **sans mesure du temps de réponse avant/après**. Sur une flotte de
6 véhicules et quelques centaines de factures, deux scans SQL complets peuvent
tenir en quelques dizaines de millisecondes — le remède peut coûter plus cher
que le mal (complexité permanente, logique métier en SQL non testée).

Parallèle avec `refetchType: "none"` le même matin : hypothèse séduisante,
application immédiate, régression.

### Règles
1. **Chronométrer avant de corriger** : `npm run benchmark:management-dashboard`
   (inclut `SELECT 1` pour isoler la latence Neon).
2. **Gate de retrait** : si le ping Neon ≈ le temps dashboard, l'agrégation SQL
   n'est pas le goulot — ne pas ajouter tables cache/triggers.
3. **Filet de tests** : l'agrégation HT Direction se teste via le **service**
   TypeScript (`tests/integration/management-dashboard-service.test.ts`), pas
   via des tables SQL parallèles où HT/TTC peut diverger silencieusement.

### Décision août 2026
Cache `management_daily_metrics` **retiré** après benchmark : year (475 ms) <
week (809 ms artefact cold start) malgré 52× plus de jours. Index dates conservés.

---

## 2026-08-29 - Dériver les types métier du schéma, jamais les recopier

### Constat
Le type `AppRole` existait en **quatre exemplaires divergents** :

| Fichier | `management` | `driver` |
|---|---|---|
| `server/middleware/auth.ts` | oui | non |
| `server/types/auth-session.d.ts` | non | oui |
| `server/api/suppliers.routes.ts` | non | non |
| `shared/constants/supplier-ratings.ts` (`SupplierRatingRole`) | non | non |

Conséquence : ajouter le rôle `management` au schéma cassait la compilation dans
`supplier-invoices.routes.ts` et `routes.ts` — deux fichiers **sans rapport**
avec la Direction. La quatrième copie n'est apparue qu'après unification des
trois premières : la plus permissive masquait les suivantes.

C'est la **quatrième occurrence** du même motif dans le projet, après les
libellés de statut des demandes de pièces, les permissions de sortie de stock et
les groupes de rôles chauffeur.

### Règle Projet (obligatoire)
- Un type qui **énumère des valeurs métier** se dérive de `shared/schema.ts`, il
  ne se recopie pas :
  ```ts
  export type AppRole = NonNullable<typeof users.$inferSelect>["role"];
  export const ALL_APP_ROLES = users.role.enumValues as readonly AppRole[];
  ```
- **Si une valeur est lue des deux côtés, elle vit dans `shared/`.** Vaut pour
  les rôles, les statuts, les libellés, les seuils.
- Élargir un type dérivé n'est sûr que si le `switch` qui le consomme a un
  `default` : `SupplierRatingRole` refuse tout par défaut, donc un nouveau rôle
  n'obtient aucun droit tant qu'on ne l'a pas décidé — le bon défaut.

### Signal à reconnaître
Une erreur de compilation dans un fichier qui n'a rien à voir avec ce qu'on
vient de modifier. C'est presque toujours une table de vérité dupliquée.

### Anti-patterns à éviter
- Recopier une union de chaînes « pour éviter un import ».
- Corriger l'erreur là où elle sort plutôt que là où elle naît : ajouter le rôle
  manquant à la copie fautive aurait tenu jusqu'au rôle suivant.

---

## 2026-08-29 - Marge Direction : ne jamais mélanger HT et TTC

### Constat
`management-dashboard-service.ts` calculait le résultat brut ainsi :

```
CA HT − (carburant + maintenance + fournisseurs)
```

Les recettes étaient bien accumulées en HT (`invoice.amountHT`), mais la charge
fournisseurs lisait `COALESCE(totalTTC, totalAmount, amountHT, 0)` — donc **TVA
comprise**. La TVA sur achats étant récupérable, elle était comptée comme une
charge : à 19,25 %, sur 10 M FCFA d'achats dans la période, la marge affichée au
DG manquait **1,9 M FCFA**, et l'écart grandit avec le volume.

Le défaut était **visible dans la documentation** : `DIRECTION-DASHBOARD.md`
annonçait « Charge fournisseurs → `supplier_invoices.total_ttc` » deux lignes
au-dessus de « Résultat brut → CA **HT** − charges ».

### Règle Projet (obligatoire)
- **Nommer les variables avec leur base fiscale** : `invoicedHT`, `expensesHT`.
  Un mélange saute alors aux yeux à la relecture.
- Un `COALESCE` en cascade n'est légitime **qu'entre colonnes équivalentes**.
  Empiler `totalTTC`, `totalAmount` et `amountHT` « au cas où » revient à laisser
  la base fiscale du résultat dépendre de quelle colonne est nulle.
- Vérifier la contrepartie avant de conclure : ici, quelle colonne était
  réellement accumulée côté recettes.

### Méthode : lire le document et le code ensemble
Le tableau de formules d'un document de chantier se lit **ligne contre ligne**.
Les incohérences d'unité (HT/TTC, litres/pourcentage, unités/références) s'y
voient avant d'exister en base.

### Anti-patterns à éviter
- Filtrer la sortie de `tsc` sur les fichiers qu'on vient de toucher **et en
  conclure que le projet compile**. Cette habitude a masqué plusieurs heures
  durant un `ClientDashboard` référencé sans import dans `App.tsx`, et une
  erreur préexistante dans `tires/index.tsx`. Le décompte qui fait foi :
  `npx tsc --noEmit | grep -c "error TS"` sur tout le projet.
- Laisser du code correct **qui a l'air faux** sans commentaire. Deux calculs de
  charges paraissaient bugués (double comptage pièces, ambiguïté carburant) ;
  ils étaient justes. Un commentaire qui dit *ce que casserait l'inversion*
  vaut mieux qu'un commentaire qui affirme que c'est correct : une conclusion se
  conteste, un mécanisme se vérifie.
- Neutraliser une propriété de style dans une variante sans énumérer ce qu'elle
  portait. `KpiTile` en mode `featured` ignore `valueClassName` — qui portait le
  rouge du déficit : un résultat négatif se serait affiché **en blanc sur vert**.
  Un état « mis en avant » doit pouvoir annoncer une mauvaise nouvelle.

---

## 2026-08-20 - Schéma Drizzle ≠ colonnes réelles : brancher `init-database.ts`

### Constat
Les colonnes d'audit `parts.updated_by` / `tires.created_by` existaient en Neon
parce qu'un SQL avait été exécuté à la main. Sur une **base vierge** (nouvelle
branche Neon, autre environnement), elles n'auraient **pas** été créées : l'app
aurait planté au premier `INSERT` ou `PATCH`.

Trois oublis empilés :

1. **`init-database.ts`** ne créait que `parts.created_by`, pas le reste du lot
   audit parts/tires.
2. **`server/db/migrations/20260818_parts_tires_audit_columns.sql`** existait mais
   n'était référencé nulle part au démarrage.
3. **`BOOTSTRAP_SQL_FILES`** ne lisait que `server/db/triggers/`, pas `migrations/`.

### Règle Projet (obligatoire)
- **`shared/schema.ts` documente l'intention**, `init-database.ts` **matérialise**
  la base. Les deux doivent avancer ensemble.
- Toute nouvelle colonne : `ALTER TABLE … ADD COLUMN IF NOT EXISTS` dans
  `initializeDatabase()`, plus un fichier idempotent dans
  `server/db/migrations/` si le changement mérite une trace datée.
- Ne pas compter sur `drizzle-kit push` global (effets de bord sur d'autres
  tables) ni sur une exécution SQL manuelle ponctuelle.

### Signal à reconnaître
« Ça marche chez moi » après un SQL manuel dans Neon, alors qu'aucune ligne
correspondante n'existe dans `init-database.ts`.

---

## 2026-08-20 - Pièces et pneus : un objet métier, une table UI

### Constat
L'inventaire pneus était en **grille de cards** avec bouton « voir » redondant,
`canAdjustStock` déclaré mais jamais branché, et toast « accès refusé » sur des
actions affichées à tort. Les pièces utilisaient déjà `PremiumDataTable` +
`part-table.tsx`.

### Règle Projet (obligatoire)
- **Même objet métier → même composant tableau** (`part-table` / `tire-table`).
- Pas de bouton « voir » si la ligne ouvre déjà le détail.
- **Masquer** les actions interdites, ne pas les montrer puis bloquer au clic.
- Réutiliser `rowClassName`, pagination, colonnes triables et dialogue d'ajustement
  stock — copier le pattern, pas réinventer une card grid.

---

## 2026-08-20 - Suivre toute la chaîne de données, et ne jamais réénumérer un objet

### Constat
Le dashboard magasinier affichait deux fois le même nombre, sous deux libellés
différents, et « 0 unités physiques » en permanence. Trois défauts empilés sur le
**même chemin de données** :

1. **Un champ mal nommé.** `GET /api/parts/statistics` renvoyait
   `totalItems: sum(parts.quantity)` — une somme de quantités, pas un décompte
   de fiches. L'UI l'affichait sous le libellé « pièces ». Le chiffre était donc
   juste, mais désignait autre chose que ce qui était écrit.
2. **Un champ inexistant.** Le hook lisait `data.totalQuantity`, absent de la
   réponse. `parseInt(undefined || '0')` donnait `0`, sans erreur ni avertissement.
3. **Une recomposition qui jetait les champs.** `useWarehouse` ne renvoie pas la
   réponse de la requête mais un objet `derivedStatistics` reconstruit en
   énumérant les champs un par un. Tout champ ajouté en amont y disparaissait.

Le piège : corriger les points 1 et 2 n'a **rien changé à l'écran**, parce que le
point 3 annulait le travail juste après. Il a fallu remonter la chaîne complète.

### Règle Projet (obligatoire)
- **Recomposer un objet, c'est étaler puis surcharger** — jamais réénumérer :

```ts
// Correct: seuls les champs recalculés sont remplacés
return { ...stats, lowStockCount, outOfStockCount };

// Interdit: tout nouveau champ en amont est perdu en silence
return { totalParts: stats?.totalParts ?? 0, lowStockCount, outOfStockCount };
```

- **Un nom de champ doit dire ce que la valeur contient.** `count(id)` se nomme
  `totalParts`, `sum(quantity)` se nomme `totalQuantity`. Un `totalItems`
  ambigu finit toujours affiché sous le mauvais libellé.
- **Avant de corriger un chiffre faux, tracer la chaîne entière** :
  requête SQL → réponse API → `select` du hook → transformation dérivée →
  composant. Le défaut peut être à chaque étage, et il peut y en avoir plusieurs.

### Signal à reconnaître
Une valeur **obstinément à `0`** est presque toujours une lecture de champ
inexistant, pas un vrai zéro métier : `parseInt(undefined || '0')` et
`valeur ?? 0` échouent silencieusement. Vérifier d'abord que le champ existe
réellement dans la réponse, avant de chercher côté base.

### Anti-patterns à éviter
- Réénumérer les champs dans une transformation dérivée.
- Nommer un agrégat autrement que ce qu'il agrège.
- Conclure qu'une correction est faite sans avoir vérifié le rendu final :
  ici, deux étages sur trois étaient corrigés et l'écran affichait toujours `0`.
- Affirmer un diagnostic d'architecture sans l'avoir vérifié — j'ai annoncé
  « deux endpoints, deux requêtes réseau » alors que les trois requêtes
  partagent la même clé et sont dédupliquées par React Query en un seul appel.

## 2026-08-18 - Un seul QueryClient, et instrumenter avant de corriger

### Constat
Pendant des mois, la couche temps réel était **entièrement inerte** sans que rien
ne le signale. `client/src/main.tsx` importait le client de requêtes par chemin
relatif (`./lib/queryClient`) alors que tout le reste du code utilise l'alias
(`@/lib/queryClient`). Vite résolvait les deux comme deux modules distincts, donc
**deux instances de `QueryClient`** coexistaient : le `QueryClientProvider` en
utilisait une, `useRealTimeSync` écrivait dans l'autre.

Conséquence : les ~50 événements WebSocket, chaque `invalidateQueries`, chaque
`setQueryData` et le `resyncCriticalData` sur ses 47 clés critiques tombaient
dans un cache que personne ne rend. L'application ne se mettait à jour que par
les `refetchInterval` de polling.

Mesures avant/après le correctif (une ligne dans `main.tsx`) :
affichage d'un OT chez un autre profil, **4 412 – 8 722 ms → 1 543 ms**.

### Règle Projet (obligatoire)
- **Le `QueryClient` est un singleton.** Toujours l'importer via l'alias
  `@/lib/queryClient`, jamais par chemin relatif. La même règle vaut pour tout
  module qui porte un état partagé.
- Un symptôme de latence "à peu près égale à un `refetchInterval`" doit faire
  suspecter en premier lieu que **le temps réel n'atteint pas sa cible**, pas
  qu'il est lent.

### Méthode : instrumenter avant de corriger
La cause a été trouvée avec **deux `console.log`** dans `patchWorkOrderCaches`
(nombre de queries appariées, taille du cache), après qu'une heure de lecture de
code ait échoué. Une première tentative de correctif, faite sur une hypothèse non
vérifiée (`refetchType: "none"` pour empêcher un refetch d'écraser le patch), a
cassé le rendu de l'application et a dû être annulée.

Ordre à respecter sur un bug de synchronisation :
1. mesurer le délai réel (trame reçue vs. rendu à l'écran) ;
2. tracer le chemin de données jusqu'à identifier l'étape qui n'a pas d'effet ;
3. corriger seulement ensuite.

### Anti-patterns à éviter
- Importer un singleton par deux specifiers différents (alias + relatif).
- Corriger un symptôme sur une hypothèse non vérifiée, dans du code partagé par
  des dizaines d'appelants.
- Conclure "c'est lent" sans avoir vérifié que le mécanisme s'exécute réellement.

## 2026-08-17 - Tester le temps réel: la trame, pas l'écran

### Constat
La première version du test e2e temps réel (`e2e/06-realtime-work-orders.spec.ts`) attendait
l'apparition d'un OT à l'écran avec un timeout de 15 s. Or la liste des OT se rafraîchit toute
seule toutes les 7 s (`refetchInterval` dans `work-order-table.tsx`). Le test passait donc au vert
**même WebSocket coupé**: il validait le polling, pas la synchronisation. Il connectait de surcroît
les deux sessions avec le même compte, ce qui ne prouvait rien sur la diffusion inter-profils.

### Règle Projet (obligatoire)
Un test de la couche 2 (**temps réel inter-profils**) doit:
1. jouer **deux comptes de rôles différents** — jamais deux onglets du même utilisateur;
2. observer la **trame WebSocket** reçue par le profil observateur (`page.on("websocket")`),
   pas seulement le rendu final;
3. borner toute assertion UI **en dessous** de l'intervalle de polling de l'écran concerné.

### Anti-patterns à éviter
- Assertion UI dont le timeout dépasse le `refetchInterval` de la page: le polling la satisfait.
- Réutiliser `storageState` entre deux contextes navigateur en croyant tester deux profils.
- Conclure « le temps réel fonctionne » sans avoir vérifié le `scope` de l'événement émis
  (`broadcast`, `user`, `roles`) — un event scopé `user` n'atteindra jamais un autre profil.

## 2026-03-08 - Synchronisation Workflow (Instantané + Temps Réel)

### Constat
- Une action métier pouvait réussir côté API mais rester incohérente en UI sans actualisation manuelle.
- Le suivi inter-profils (secrétaire/admin/magasinier/atelier) n'était pas toujours aligné en direct.

### Règle Projet (obligatoire)
- Toute transition métier doit inclure **3 couches**:
1. **Instantané UI local**: mise à jour immédiate du cache/état après succès mutation.
2. **Temps réel inter-profils**: émission d'un événement WebSocket métier dédié.
3. **Resync ciblé**: invalidation/refetch des queries impactées (détail + liste + stats).

### Checklist avant validation d'une feature workflow
1. L'utilisateur qui déclenche l'action voit la mise à jour sans refresh.
2. Un autre profil connecté voit la mise à jour sans refresh.
3. Les badges/KPI/listes liés sont cohérents (pas de décalage d'état).
4. Le détail et la liste affichent le même statut métier.
5. Les logs backend montrent l'étape métier et l'événement émis.

### Anti-patterns à éviter
- Ajouter une mutation sans événement temps réel.
- Invalider seulement la page courante et oublier les écrans satellites (dashboards, listes, stats).
- Nommer les statuts avec des labels techniques non métier (`awaiting_parts`, etc.) dans l'UI finale.

### Application immédiate
- Le flux factures fournisseurs suit cette règle:
1. création
2. validation
3. approbation
4. saisie règlement
5. rapprochement

Chaque étape déclenche désormais:
- update locale UI,
- event realtime,
- invalidations ciblées.

## 2026-10-28 - Routes API ouvertes sans session

### Constat
- `/api` n'a pas de garde globale (`server/app.ts`) : chaque route doit poser la sienne.
- Le routeur missions n'en posait aucune et attribuait la création à l'utilisateur 1 par repli (`|| 1`).
- `POST /api/auth/register` était public et acceptait `role` : création d'un admin sans connexion.
- Routes de test et de développement exposées (génération d'OT, effacement de tous les OT).

### Cause racine
- Sécurité opt-in route par route, sans contrôle automatique : un oubli ne se voyait nulle part.
- Classification : défaut de conception (garde par défaut absente) + absence de garde-fou.

### Résolution
- Gardes ajoutées (missions au montage, register `isAdmin`, technicien borné à lui-même), routes de test supprimées, repli `|| 1` retiré.

### Prévention (vérifiable)
- `tests/contract/api-auth-guard.contract.test.ts` : toute route `/api` sans garde marquée (`sessionGuard` dans `server/middleware/auth.ts`) hors liste blanche fait échouer le test.
- `tests/contract/api-auth-sessions.contract.test.ts` : 401 anonyme, 403 hors rôle, auteur réel d'une mission.

### Règle Projet (obligatoire)
- Une nouvelle garde de session passe par `authenticate`, `authorize` ou `isAdmin` (marqués) ; un middleware maison non marqué n'est pas reconnu par le test.
- Ajouter une route à la liste blanche est une décision de sécurité, justifiée en commentaire.
- Jamais d'identifiant utilisateur par défaut : sans session, 401.

## 2026-10-28 - Ajout de pièce à un OT : 500 sans prix, coût fixé par le client

### Constat
- Scénario `docs/qa/E2E PANNE-OT-REAPPRO-FACTURE`, étape 4 : `POST /api/work-orders/:id/parts` avec `{ partId, quantity }` renvoyait 500.
- La route transmettait `req.body` tel quel : sans `unitPrice`, l'insertion `parts_used.unit_price` (NOT NULL) échouait ; avec, le client choisissait le prix imputé à l'OT.

### Cause racine
- Corps de requête propagé directement au stockage, sans contrat d'entrée. L'UI envoyait le prix du catalogue, ce qui masquait le défaut.
- Classification : contrat d'API implicite + donnée de confiance prise côté client.

### Résolution
- La route construit la ligne : `partId`, `quantity` et `unitPrice` lu dans le catalogue (`server/routes.ts`).

### Prévention (vérifiable)
- `tests/contract/work-order-parts.contract.test.ts` : ajout sans prix → 201, prix catalogue, stock décrémenté ; un prix client est ignoré ; stock épuisé → 400.

### Règle Projet (obligatoire)
- Un montant (prix, coût) imputé côté serveur se lit en base, jamais dans le corps de la requête.

## 2026-10-29 - Sortie de stock vers l'OT : double sortie possible

### Constat
- `POST /api/work-orders/:id/part-requirements/:rid/issue` décrémentait le stock **avant** la transition `received -> issued`. Deux clics simultanés sortaient la pièce deux fois ; une transition refusée laissait le stock déjà décrémenté.
- `recordStockMovement` lisait la quantité, la recalculait en JS puis l'écrivait : deux sorties concurrentes sur la même pièce perdaient une mise à jour.
- Le mouvement de réception était attribué au demandeur, pas au magasinier (dette AGENTS §9).

### Cause racine
- Effet de bord exécuté hors de la transaction qui porte le changement de statut ; pas de garde de concurrence sur le statut ni sur la quantité.
- Classification : condition de course + ordre des opérations.

### Résolution
- `updatePartRequirement` : compare-and-set `WHERE status = statut lu` en transaction ; hook `onTransition(tx)` pour l'effet métier, annulé avec la transition.
- Stock : `quantity = quantity ± n RETURNING`, sortie gardée par `quantity >= n` (`requireAvailable`) ; mouvement attribué à l'acteur.

### Prévention (vérifiable)
- `tests/integration/part-requirements-idempotence.test.ts` (réceptions et sorties concurrentes, rejeu, hook en échec).
- `tests/contract/error-contract-and-issue-idempotence.contract.test.ts` (double POST → un 200, un refus, stock décrémenté une fois ; stock insuffisant → demande reste `received`).

### Règle Projet (obligatoire)
- Toute transition qui déplace du stock ou de l'argent passe par `onTransition` dans la transaction du statut, jamais avant.

## 2026-10-29 - Erreurs techniques affichées, logs supprimés

### Constat
- Des routes renvoyaient `error.message` (SQL, stack, messages Zod anglais) ; l'UI l'affichait tel quel, parfois en JSON.
- Lors d'un correctif, des `console.log` ont été supprimés au lieu d'être migrés : les devs perdaient la trace.

### Cause racine
- Pas de contrat d'erreur partagé ni de logger : chaque route improvisait son format et son journal.
- Classification : absence de contrat transverse.

### Résolution
- Contrat `ApiErrorBody` (`shared/errors.ts`) ; `server/middleware/error-handler.ts` (requestId, journal d'accès, garde de sortie qui normalise toute réponse ≥ 400, 5xx = message générique + référence) ; `AppError` pour les erreurs métier.
- Logger pino `server/lib/logger.ts` (`moduleLogger`), secrets masqués ; `client/src/lib/logger.ts` côté navigateur ; `userMessageOf` pour tout affichage.

### Prévention (vérifiable)
- `tests/unit/server/error-handler.test.ts`, `tests/unit/client/api-error.test.ts`, contrat d'erreur dans `tests/contract/error-contract-and-issue-idempotence.contract.test.ts`.

### Règle Projet (obligatoire)
- Jamais `error.message` dans une réponse ou un toast ; le détail va au logger avec le `requestId`.
- Un log ne se supprime pas : il se migre vers `moduleLogger` / `clientLogger`.

## 2026-10-29 - Corps invalide renvoyé en 500

### Constat
- `POST /api/part-requirements` et `POST`/`PATCH /api/clients` renvoyaient 500 « Erreur serveur » sur un corps incomplet : l'utilisateur ne savait pas quel champ corriger.

### Cause racine
- Demande de pièce : aucun `parse` Zod, le corps allait jusqu'à l'`INSERT` et échouait sur une contrainte `NOT NULL`.
- Clients : le `catch` local transformait la `ZodError` en 500 au lieu de la laisser au gestionnaire central.
- Classification : validation absente ou interceptée par un `catch` générique.

### Résolution
- `insertPartRequirementSchema.parse` avant le service ; `if (error instanceof ZodError) return next(error)` dans les `catch` concernés (le gestionnaire central produit le 400 avec les champs).

### Prévention (vérifiable)
- `tests/contract/api-role-guard-and-validation.contract.test.ts` : 7 POST principaux, rôle interdit → 403 au contrat, rôle autorisé + corps vide → 400 lisible ; une demande valide reste acceptée.

### Règle Projet (obligatoire)
- Tout POST/PATCH valide son corps avec Zod, et un `catch` local ne convertit jamais une `ZodError` en 500 : `next(error)`.
- Tout nouveau POST principal s'ajoute à la table `CASES` du test ci-dessus.

## 2026-10-29 - Modification de véhicule perdue en silence

### Constat
- Depuis le formulaire, enregistrer un véhicule dont une date (achat, assurance) était laissée vide renvoyait 200 mais **rien** n'était enregistré, y compris les autres champs modifiés.
- `PATCH /api/work-orders/:id` avec un type invalide (`duration: "longtemps"`) renvoyait 500.

### Cause racine
- Le formulaire envoie `""` pour une date vide ; Postgres refuse `""` pour un horodatage.
- `storage.updateVehicle` avalait l'erreur et renvoyait `undefined`, la route répondait quand même 200.
- Ces deux PATCH de `server/routes.ts` passaient `req.body` au stockage sans aucune validation.
- Classification : validation absente + erreur avalée par la couche stockage.

### Résolution
- `server/lib/column-validation.ts` : `prepareColumnUpdate(table, body)` dérive le contrôle des colonnes Drizzle (entier, décimal, date, booléen, énumération, obligatoire), convertit `""` en `null` hors colonnes texte et renvoie les erreurs par champ.
- PATCH véhicule et OT : 400 `AppError` avec `fieldErrors` ; PATCH véhicule renvoie 500 si le stockage n'a rien mis à jour.

### Prévention (vérifiable)
- `tests/unit/server/column-validation.test.ts` (niveau U).
- `tests/contract/api-role-guard-and-validation.contract.test.ts` : PATCH véhicule, OT, fournisseur, client avec type invalide → 400 nommant le champ ; PATCH véhicule « formulaire » avec dates vides → 200 et base modifiée ; démarrer puis terminer un OT → 200 et base modifiée.

### Règle Projet (obligatoire)
- Une route qui transmet `req.body` au stockage sans schéma Zod passe par `prepareColumnUpdate`.
- Un stockage qui renvoie `undefined` sur une mise à jour n'est jamais traduit en 200.

## 2026-10-29 - Nettoyage des tests bloqué par les alertes

### Constat
- `npm run test:contract` : tous les tests verts, mais un fichier en échec dans `afterAll` (`alerts_user_id_users_id_fk`) et des utilisateurs `TEST-` laissés en base.

### Cause racine
- Affecter ou faire avancer un OT crée des alertes nominatives ; `notifyWorkOrderProgress` part sans attente et peut arriver **après** le ménage des alertes.
- Classification : effet asynchrone non attendu dans le nettoyage.

### Résolution
- `tests/support/cleanup.ts` : suppression des alertes des utilisateurs de test avant leur suppression, rejouée jusqu'à 5 fois si une alerte tardive bloque la clé étrangère ; même ménage dans `cleanupOrphanTestRows`.

### Prévention (vérifiable)
- Contrat complet vert (7 fichiers) et zéro utilisateur `TEST-` restant après exécution.

### Règle Projet (obligatoire)
- Toute table qui référence `users` et peut être alimentée par un test est purgée dans `cleanupCreated` avant les utilisateurs.

## 2026-10-29 - PATCH pièce : texte d'erreur exposé et champs d'audit modifiables

### Constat
- `PATCH /api/parts/:id` renvoyait `error.message` au client en 500 (pièce inconnue, référence en double, mais aussi toute erreur SQL).
- Le corps pouvait réécrire `id`, `createdBy`, `createdAt` de la fiche ; un type invalide (`quantity: "beaucoup"`) donnait 500.
- `PATCH /api/tires/:id` validait avec Zod mais son `catch` transformait la `ZodError` en 500 ; `PATCH /api/fault-catalog/:id` et `/api/vehicle-tires/:id` passaient `req.body` brut.

### Cause racine
- Routes historiques de `server/routes.ts` sans validation, et `catch` générique qui renvoie le message brut.
- Classification : validation absente + fuite de détail technique + champ serveur accepté du client (T4).

### Résolution
- Pièce : champs d'audit retirés du corps, `prepareColumnUpdate(parts)`, « Pièce non trouvée » -> 404, référence en double -> 409, sinon 500 générique journalisé.
- Pneu : `ZodError` -> `next(error)`. Panne et pneu monté : `prepareColumnUpdate`.
- `console.error` de ces routes migrés vers `moduleLogger("routes")`.

### Prévention (vérifiable)
- `tests/contract/api-role-guard-and-validation.contract.test.ts` : `PATCH_CASES` pièce, pneu, panne ; T4 pièce (champs d'audit ignorés) ; 404 et 409 au contrat.

### Règle Projet (obligatoire)
- Un `catch` ne renvoie jamais `error.message` : une erreur métier connue devient une `AppError` avec son statut.

## 2026-10-29 - Règlement fournisseur : facture payable deux fois

### Constat
- `POST /api/supplier-invoices/:id/settlements` acceptait deux règlements du montant total sur la même facture : double clic, retry réseau ou deux onglets.
- Un règlement saisi mais pas encore rapproché n'était pas déduit : 100 000 saisis sur 119 250, un second de 20 000 passait.
- Un second rapprochement du même règlement renvoyait 500 avec le texte de l'erreur ; toute erreur du service sortait en 500 avec `details: error.message`.

### Cause racine
- Le contrôle « montant <= solde » lisait `invoice.balance`, qui ne baisse qu'au rapprochement bancaire.
- Lecture puis insertion sans verrou ni transaction : deux saisies simultanées voyaient le même solde.
- Aucune clé d'idempotence : la référence de paiement n'était pas comparée aux règlements existants.
- Classification : course critique (T7) + règle métier sur un état incomplet + fuite de détail technique.

### Résolution
- `recordInvoiceSettlement` : transaction, verrou `FOR UPDATE` sur la facture ; même référence et même montant -> règlement existant rendu (`replayed`) ; même référence, autre montant -> 409 ; reste à régler = solde - règlements saisis non rapprochés.
- `reconcileInvoiceSettlement` : compare-and-set `recorded -> reconciled` ; un rejeu rend l'état courant et resynchronise le solde (idempotent).
- `markInvoiceAsPaid` (route legacy) : retour immédiat si la facture est déjà payée.
- Route : rejeu -> 200 « Ce règlement était déjà enregistré. », sans diffusion WebSocket, justificatif téléversé supprimé ; erreurs -> `next(error)` (`AppError` 400/404/409).

### Prévention (vérifiable)
- `tests/integration/supplier-settlement-idempotence.test.ts` : rejeu, saisies simultanées (même référence et références différentes), règlement en attente déduit, référence réutilisée, double rapprochement, facture non approuvée (7 cas, 6 rouges avant correctif).
- `tests/contract/supplier-settlement-idempotence.contract.test.ts` : 201 puis 200 même id, un seul justificatif sur disque, 409 lisible au contrat, double rapprochement 200/200 (2 rouges sur 3 avant correctif).

### Règle Projet (obligatoire)
- Un contrôle de plafond (montant, quantité) compte aussi les opérations en attente, et se fait sous verrou dans la même transaction que l'écriture.
- Une saisie financière a une clé d'idempotence métier (ici la référence de paiement) : le rejeu rend l'existant, il n'écrit pas.

## 2026-10-29 - Encaissement client : paiement perdu, trop-perçu et solde NaN

### Constat
- `POST /api/billing/invoices/:id/payments` lisait le solde, l'écrivait, puis insérait le paiement, sans transaction ni verrou : deux paiements simultanés lisaient le même solde et le second écrasait le premier (paiement enregistré mais non déduit).
- Aucun plafond : un paiement supérieur au solde passait, le solde devenait négatif ; une facture annulée acceptait un paiement.
- Aucune clé d'idempotence : un retry réseau ou un second onglet créait un second paiement.
- Validation réduite à `!amount` : `amount: "abc"` donnait `parseFloat` = `NaN`, écrit tel quel dans `balance` ; un mode de paiement inconnu sortait en 500 avec le texte SQL.

### Cause racine
- Lecture-calcul-écriture hors transaction (lost update) et règle de plafond absente.
- Classification : course critique (T7) + validation absente (T3) + fuite de détail technique.

### Résolution
- `recordPayment` : transaction, verrou `FOR UPDATE` sur la facture ; référence identique et même montant -> paiement existant rendu (`replayed: true`) ; autre montant -> 409 ; facture annulée ou montant supérieur au solde -> 409 ; facture inconnue -> 404.
- Route : schéma Zod (montant positif, date, mode dans l'énumération de la colonne), erreurs -> `next(error)`, pas de diffusion sur un rejeu.
- Écran facture client : toast via `userMessageOf`.

### Prévention (vérifiable)
- `tests/integration/client-payment-idempotence.test.ts` (8 cas, 8 rouges avant correctif ; le cas « deux paiements partiels simultanés » est une vraie course, rouge de façon non déterministe sur l'ancien code).
- `tests/contract/client-payment-idempotence.contract.test.ts` (7 cas, 5 rouges avant correctif) : 403, 400 lisibles avec solde intact, rejeu 200 même id, 409 lisible.

### Règle Projet (obligatoire)
- Un solde se lit et s'écrit sous verrou, dans la même transaction que l'écriture qui le justifie.
- Un montant reçu du client passe par un schéma (nombre fini, positif) avant tout calcul.

## 2026-10-29 - Double clic : deux paiements, deux ajustements de stock

### Constat
- Sur la facture client, un double clic sur « Confirmer » enregistrait deux paiements (mesuré en e2e : 65 ms d'écart). Sans référence de paiement, le serveur ne peut pas distinguer un rejeu d'un second versement (choix assumé dans 9f9ca09).
- Même chose sur l'ajustement de stock de l'inventaire : deux mouvements, quantité ajustée deux fois.
- Les deux boutons portaient pourtant `disabled={mutation.isPending}`.

### Cause racine
- `isPending` ne passe à `true` qu'au rendu suivant ; le second clic d'un double clic arrive avant ce rendu et relance `mutate`.
- Classification : course côté client (T7), protection d'affichage prise pour une protection fonctionnelle.

### Résolution
- `client/src/lib/single-flight.ts` + `client/src/hooks/use-single-flight.ts` : verrou pris de façon synchrone dans le gestionnaire de clic, rendu au `onSettled` de la mutation (succès ou erreur).
- Branché sur l'encaissement client (`pages/operations/invoices/[id].tsx`) et l'ajustement de stock (`components/inventory/part-table.tsx`).

### Prévention (vérifiable)
- `tests/unit/client/single-flight.test.ts` (second envoi ignoré, verrou rendu après succès, après échec, après exception).
- `e2e/07-double-submit-integrity.spec.ts` : `dblclick` réel, vérité lue en base ; rouge sans la garde (2 paiements, 2 mouvements), vert avec.

### Règle Projet (obligatoire)
- Un bouton qui écrit de l'argent ou du stock passe par `useSingleFlightMutate`. `disabled={isPending}` reste pour l'affichage, il ne protège rien.

## 2026-10-29 - Ajustement de stock : mise à jour perdue, retrait plafonné en silence

### Constat
- `partsService.updateStock` lisait la quantité puis la réécrivait sans transaction ni verrou : deux ajustements simultanés de +3 sur 10 écrivaient tous deux 13 et traçaient deux mouvements « 10 -> 13 ». L'historique disait +6, le stock +3.
- Un retrait au-delà du stock était ramené à 0 sans erreur, avec un mouvement qui mentait sur la quantité sortie.
- `adjustment: "abc"` arrivait en `NaN` jusqu'au SQL : 500 avec le texte de l'erreur. Pièce inconnue : 500 au lieu de 404.

### Cause racine
- Lecture-calcul-écriture hors transaction (lost update), même motif que la réception de pièce (179015d) et les paiements (676de75, 9f9ca09).
- Plafonnement silencieux au lieu d'un refus ; validation absente à la route.
- Classification : course critique (T7) + validation absente (T3) + fuite de détail technique.

### Résolution
- Service : transaction, `FOR UPDATE` sur la pièce, mouvement écrit dans la même transaction (`createStockMovement(movement, tx)`), `AppError` 400 (entier non nul), 404, 409 lisible (« Retrait impossible : 5 unité(s) en stock, 8 demandée(s). »).
- Route : schéma Zod (entier non nul, raison obligatoire), erreurs -> `next(error)` ; le `console.error` est remplacé par la journalisation du gestionnaire central (warn 4xx, error 5xx).
- Écran : toast via `userMessageOf`.

### Prévention (vérifiable)
- `tests/integration/parts-stock-adjustment.test.ts` (7 cas, rouge avant correctif : 12 au lieu de 15 sur 5 ajustements simultanés).
- `tests/contract/parts-stock-adjustment.contract.test.ts` (8 cas, 6 rouges avant correctif) : 403 technicien, 400 lisibles stock intact, 409, 404, deux ajustements simultanés additionnés.

### Règle Projet (obligatoire)
- Toute quantité de stock se lit et s'écrit sous verrou, dans la même transaction que son mouvement.
- Un retrait impossible se refuse ; il ne se plafonne jamais en silence.

## 2026-10-29 - Near miss : purge de test qui casse un e2e en cours

### Constat
- Pendant une exécution des specs e2e 07 et 08, un test s'est retrouvé sur l'écran de connexion : son utilisateur `TEST-` venait d'être supprimé de la base (`GET /api/auth/me` 404, clé étrangère violée sur `user_onboarding`).

### Cause racine
- Un test d'intégration lancé en parallèle : `setup-integration.ts` appelle `cleanupOrphanTestRows`, qui supprime toutes les lignes `TEST-` sans distinction de propriétaire. Les deux suites partagent la base de dev.
- Classification : interférence entre suites (état partagé), pas un défaut du produit.

### Résolution
- Specs rejouées seules : vertes.

### Prévention (vérifiable)
- `e2e/README.md` (section Données de test) : interdiction de lancer intégration ou contrat pendant les specs 07 et 08, avec le symptôme à reconnaître.

### Règle Projet (obligatoire)
- Une seule suite qui écrit en base à la fois. Avant d'accuser le code d'un échec e2e intermittent, vérifier qu'aucune autre suite ne tournait.

## 2026-10-29 - Toast d'erreur effacé par une alerte temps réel

### Constat
- Paiement au-delà du solde : le 409 et son message s'affichaient, puis disparaissaient en moins d'une seconde, remplacés par « Document expiré ». Vu en e2e (spec 08, T3), une exécution sur deux.

### Cause racine
- `TOAST_LIMIT = 1` dans `client/src/hooks/use-toast.ts` (valeur par défaut du composant). Chaque événement `alert_created` affiche un toast (`useRealTimeSync`) et évince celui qui était visible, quel que soit son importance.
- Classification : erreur lisible côté serveur rendue illisible par l'interface.

### Résolution
- `TOAST_LIMIT = 3` : les toasts s'empilent, le plus ancien sort au quatrième.

### Prévention (vérifiable)
- `tests/unit/client/toast-limit.test.ts` (rouge avec la limite à 1).
- `e2e/08-role-actions-and-error-toast.spec.ts` (T3) rejoué 3 fois de suite.

### Règle Projet (obligatoire)
- Un toast d'erreur doit rester lisible même si une notification arrive juste après ; ne pas redescendre la limite à 1.

## 2026-10-29 - Planification : modifications perdues, puis 404 sur toute édition

### Constat
- Le formulaire de planification de maintenance envoyait tous ses champs ; seul `isActive` était enregistré, sans erreur.
- Une fois la route corrigée, toute édition ou suppression de planification répondait 404.

### Cause racine
- `PATCH /api/maintenance-schedules/:id` était déclarée deux fois dans `server/routes.ts`. Express sert la première, qui n'écrivait que `isActive` ; la complète, déclarée plus bas, ne s'exécutait jamais.
- `storage.getMaintenanceSchedule` était un bouchon d'une ligne (`return undefined`) : la vérification d'existence échouait toujours.
- Classification : code mort qui a l'air vivant (route dupliquée, méthode bouchon appelée).

### Résolution
- Une seule route : 404 si absente, `prepareColumnUpdate` (400 par champ), colonnes connues seulement, `id` et `createdAt` ignorés.
- `getMaintenanceSchedule` implémentée.

### Prévention (vérifiable)
- `tests/unit/server/routes-hygiene.test.ts` : liste gelée des routes en double dans `server/routes.ts` (rouge sur la version précédente).
- `tests/unit/server/storage-stubs.test.ts` : liste gelée des bouchons de `storage.ts` appelés par le serveur (rouge sans l'implémentation).
- `tests/contract/secondary-routes-validation.contract.test.ts` : édition complète depuis le corps du formulaire.

### Règle Projet (obligatoire)
- Avant de corriger une route de `server/routes.ts`, chercher une autre déclaration du même verbe et chemin ; avant d'appeler une méthode de `storage`, vérifier qu'elle n'est pas un bouchon.

## 2026-10-29 - Mot de passe en clair dans les journaux

### Constat
- `POST /api/users` journalisait `req.body` par `console.log`, mot de passe compris.

### Cause racine
- Journal de débogage resté en place, hors du logger : le masquage `*.password` de `moduleLogger` ne s'appliquait pas à `console.*`.
- Classification : fuite de secret dans les journaux.

### Résolution
- Logs migrés vers `moduleLogger("routes")` sans le corps. Le seul autre corps journalisé (création d'OT) passe par `log.debug`, donc par le masquage.

### Prévention (vérifiable)
- `tests/unit/server/routes-hygiene.test.ts` : aucun `console.*` contenant `req.body` dans `server/` (rouge sur la version précédente, lignes 535 et 2119).

### Règle Projet (obligatoire)
- Un corps de requête ne se journalise que par `moduleLogger`, jamais par `console.*`.

## 2026-10-29 - Erreurs de validation rendues en 404 ou en valeur tronquée

### Constat
- PATCH utilisateur avec `createdAt` en chaîne (corps renvoyé tel quel par la page techniciens) et PATCH document avec une date invalide : réponse 404 « introuvable ».
- E-mail déjà pris au PATCH utilisateur : 404 au lieu de 409.
- Carburant : `parseFloat("12abc")` enregistrait 12, `"abc"` enregistrait `NaN`, un POST sans coût donnait un 500.
- `POST /api/fault-catalog` sans corps : 500 ; `validatedBy` accepté du client.

### Cause racine
- `catch` qui répondait 404 quelle que soit l'erreur, et conversions numériques sans contrôle.
- Classification : erreur avalée et donnée corrompue en silence.

### Résolution
- Schémas Zod ou `prepareColumnUpdate`, erreurs passées à `next()` (400 par champ, 409 explicite), nombres de formulaire convertis puis validés, champs tenus par le serveur retirés du corps.

### Prévention (vérifiable)
- `tests/contract/secondary-routes-validation.contract.test.ts` (15 cas, 13 rouges sans les correctifs).

### Règle Projet (obligatoire)
- Un `catch` ne choisit pas le statut : il passe l'erreur à `next()`. Pas de `parseFloat` / `parseInt` sur un corps de requête sans validation du résultat.

## 2026-10-29 - Valider ou refuser une demande visait la demande précédente

### Constat
- Sur `/inventory/requests`, les boutons Valider et Refuser envoyaient le PATCH à la demande sélectionnée au clic précédent, ou à `/api/part-requirements/undefined` au premier clic.

### Cause racine
- Le bouton appelait `setSelectedRequest(request)` puis `mutate()` dans le même clic, et la `mutationFn` lisait `selectedRequest`. TanStack Query v5 applique les options de `useMutation` dans un `useEffect` : la fonction exécutée est celle du rendu précédent.
- Classification : fermeture périmée (état React lu avant son application).

### Résolution
- L'id voyage dans les variables de la mutation (`{ id, data }`) ; envoi par `useSingleFlightMutate`.

### Prévention (vérifiable)
- Checklist : règle ci-dessous, reprise dans AGENTS.md §10. Pas de test automatique : il faudrait un e2e sur une liste à au moins deux demandes, à ajouter avec le module demandes.

### Règle Projet (obligatoire)
- Une `mutationFn` ne lit pas un état React modifié dans le même gestionnaire : l'identifiant ciblé passe par les variables de `mutate`.

## 2026-10-30 - Garde des bouchons aveugle aux objets vides

### Constat
- Near miss. `tests/unit/server/storage-stubs.test.ts` listait deux bouchons encore appelés. Le troisième, `getWorkOrdersByOwner`, n'y figurait pas : tout client voyait une liste d'OT vide, sans erreur.

### Cause racine
- La détection ne reconnaissait que `return undefined | null | false | 0 | []`. Ce bouchon renvoyait `{ workOrders: [], total: 0 }`.
- Classification : garde-fou trop étroit (faux négatif silencieux).

### Résolution
- La détection reconnaît aussi un objet dont tous les champs sont vides ; `getWorkOrdersByOwner` est implémenté. Liste gelée désormais vide.

### Prévention (vérifiable)
- `storage-stubs` échoue sur tout bouchon appelé, objet vide compris (rouge sur la version précédente de `server/storage.ts`).

### Règle Projet (obligatoire)
- Un garde-fou par motif se valide sur au moins un cas réel de chaque forme qu'il prétend couvrir, pas seulement sur la forme qui l'a motivé.

## 2026-10-30 - OR Drizzle non parenthésé dans and()

### Constat
- La liste d'OT d'un technicien filtrée par statut renvoyait aussi ses OT d'autres statuts.

### Cause racine
- `and()` entoure la liste de parenthèses mais pas chaque fragment `sql` imbriqué : `sql\`a = x OR a IS NULL\`` suivi d'un filtre de statut donnait `a = x OR a IS NULL AND statut = y`, et `AND` passe avant `OR`.
- Classification : priorité d'opérateurs SQL dans un fragment brut.

### Résolution
- Parenthèses explicites dans le fragment (`getWorkOrdersForTechnician`).

### Prévention (vérifiable)
- `tests/integration/storage-former-stubs.test.ts` : un OT terminé du technicien n'apparaît pas dans sa liste filtrée sur « en attente ».

### Règle Projet (obligatoire)
- Un `OR` écrit dans un `sql` brut s'entoure de parenthèses ; préférer `or(...)` de Drizzle, qui les pose.

## 2026-10-30 - Paramètre de requête utilisé comme segment de chemin disque

### Constat
- `POST /api/workflows/:sessionId/documents` écrivait le fichier sous `uploads/workflows/<sessionId>/<documentType>_...` : avec `sessionId = ..%2F..%2Fx` (Express décode `%2F`) ou `documentType = ../../x`, tout utilisateur connecté écrivait un fichier hors de `uploads/`.
- Les deux téléchargements (`/api/documents/:id/download`, `/api/workflows/documents/:id`) servaient n'importe quel chemin stocké en base, `/package.json` compris.
- Le nettoyage des workflows abandonnés faisait un `rmSync(recursive)` sur `uploads/workflows/<sessionId>` : un identifiant `..` visait le dossier du projet (méthode non appelée aujourd'hui).
- Dans le même service, l'INSERT `vehicle_documents` du transfert était une chaîne interpolée : une apostrophe dans le nom du fichier cassait la requête ou injectait du SQL (méthode non appelée aujourd'hui).

### Cause racine
- Une valeur venue du client (paramètre d'URL, champ de formulaire, nom de fichier d'origine) était concaténée à un chemin ou à du SQL sans contrôle, et un chemin lu en base était traité comme sûr.
- Classification : traversée de répertoire et injection SQL, entrée non validée.

### Résolution
- `isSafePathSegment` (`server/lib/uploaded-file.ts`) sur `sessionId` ; `documentType` contrôlé contre l'énumération du schéma ; extension réduite aux caractères alphanumériques ; `path.basename` sur le nom d'origine.
- Lecture et suppression par `uploadedFileCandidates`, qui refuse tout chemin hors de `uploads/`.
- `db.insert(vehicleDocuments)` à la place de la chaîne SQL.

### Prévention (vérifiable)
- Unitaire `tests/unit/server/uploaded-file.test.ts` (`isSafePathSegment`), intégration `tests/integration/workflow-document-transfer.test.ts`, contrat `tests/contract/fuel-records-and-document-paths.contract.test.ts` (400 sur les deux traversées, 404 sur un chemin stocké hors de `uploads/`, non-régression des formes stockées existantes).

### Règle Projet (obligatoire)
- Une valeur de requête ne devient un segment de chemin qu'après `isSafePathSegment` ; un chemin lu en base ne s'ouvre, ne se sert et ne se supprime que par `uploadedFileCandidates`.
- Pas de SQL construit par interpolation de chaîne : `db.insert`/`db.update` ou le gabarit `sql\`\`` de Drizzle, qui paramètre.

## 2026-10-30 - Documents d'un client lisibles par un autre client

### Constat
- `GET /api/vehicles/:id/documents`, `.../documents/:type`, `GET /api/documents/:id/download`, `GET /api/vehicles/documents/all`, les listes d'expiration et de statistiques, et les deux lectures de documents de workflow n'exigeaient qu'une session : un client lisait et téléchargeait les documents (carte grise, assurance) de n'importe quel véhicule. Les ids sont séquentiels.
- `PUT /api/vehicles/:id/mileage` et `.../maintenance-position` : un client modifiait le véhicule d'un autre client.

### Cause racine
- `authenticate` vérifie la session, pas le rôle ni le propriétaire, et ne charge pas `req.user` : la route ne pouvait pas savoir qu'elle servait un client. Chaque route faisait (ou oubliait) son propre `role === 'client' && ownerId !== id`.
- Classification : contrôle d'accès horizontal manquant (IDOR).

### Résolution
- `isAnyUser` (`server/middleware/auth.ts`) : toute session valide, avec `req.user` et le rôle normalisé.
- Garde unique `server/lib/client-scope.ts` : `canAccessOwned` (objet isolé, 403) et `ownerScopeOf` (liste filtrée). Le personnel n'est pas filtré et ne coûte aucune lecture. Documents de workflow : filtre sur l'auteur du workflow, pas sur `sessionId`, qui n'est pas unique.

### Prévention (vérifiable)
- Unitaire `tests/unit/server/client-scope.test.ts` ; contrat `tests/contract/vehicle-documents-client-scope.contract.test.ts` (client A refusé sur B, client autorisé sur les siens, personnel autorisé partout, `sessionId` réutilisé). Sans correctif : 8 rouges sur 11.

### Règle Projet (obligatoire)
- Une route qui lit ou modifie un véhicule, ou ce qui en dépend, ouverte à un client, passe par `isAnyUser` puis `canAccessOwned` / `ownerScopeOf`. Jamais `authenticate` seul.

### Récidive (2026-11-01) : liste de véhicules lisible par un client

Mise à jour de cette entrée : la même classe de défaut est revenue sur une route non listée.

#### Constat
- `GET /api/vehicles` (`server/routes.ts`, déclaration héritée) n'exigeait que `authenticate`. Un compte client recevait tous les véhicules (immatriculation, VIN, marque). Un commentaire « Temporairement, tous les utilisateurs voient tous les véhicules » restait en place.
- Découvert par la relecture de la PR #77 : `it.fails` dans `tests/contract/lists-pagination-filters.contract.test.ts`.

#### Cause racine
- La prévention du 30 octobre visait les routes documents et kilométrage. La liste de véhicules n'était pas dans son inventaire : la cloison était appliquée route par route, sur une liste écrite à la main.
- Le TODO « temporairement » sur un accès n'était suivi par aucun contrôle.
- Classification : contrôle d'accès horizontal manquant (IDOR), récidive.

#### Résolution
- Commit `854ce30` : `/` et `/all` passent en `isAnyUser` dans `server/api/vehicles.routes.ts`, et la requête est filtrée par `ownerScopeOf` dans `server/services/vehicle-list-service.ts`.
- `server/app.ts` monte `/api` (ligne 108) avant `registerRoutes` (ligne 109) : le routeur sert donc la requête. La déclaration héritée `server/routes.ts:958` reste en code mort, avec son TODO. Elle se supprime à part, avec son double.

#### Prévention (vérifiable)
- Contrat `tests/contract/vehicles-lists-client-scope.contract.test.ts` : tableau `LISTS` (`/api/vehicles?limit=1000`, `/api/vehicles/all`, `/api/vehicles/all-with-status`). Pour chaque liste : le client ne voit que son véhicule, le personnel voit les deux, sans session 401.
- Rouge avant correctif : non démontré. Le fichier a été ajouté dans le même commit que le correctif.
- Insuffisance constatée : `tests/contract/api-auth-guard.contract.test.ts` vérifie qu'une garde de session existe, et accepte `authenticate`. Il ne voit donc pas l'absence de cloison.
- Prévention manquante : un contrôle automatique qui échoue sur toute route `/api` lisant ou modifiant un véhicule (liste ou identifiant) gardée par `authenticate` seul, sans `isAnyUser`, `isStaff`, `authorize` ni `ownerScopeOf` / `canAccessOwned`. À produire par fleet-testeur.
- Résidus non couverts par `854ce30`, vérifiés par lecture de `server/routes.ts` (déclarations sous `authenticate` seul) : `GET /api/vehicles/:id` (ligne 1036), `/check/:registrationNumber` (1016), `/:id/mileage` (3534), `/:id/mileage/history` (3550), `/check-alerts` (4102, lit `storage.getVehicles()`), `/:vehicleId/status-history` (4502), `/:vehicleId/tires` (5027). Leur contrôle de propriétaire n'a pas été relu dans cette passe.

#### Règle Projet (obligatoire)
- Une liste d'objets possédés passe par `isAnyUser` + `ownerScopeOf`, avec un cas de contrat client sur cette liste.
- Un TODO « temporairement » ou « pour l'instant » sur un accès se traite comme un défaut ouvert : il se corrige ou il se consigne comme résidu daté dans le journal, jamais en commentaire seul.
- Ce qui doit être cloisonné ne se liste pas à la main : la prévention cible la classe (routes d'un objet possédé), pas une liste de chemins.

### Seconde récidive (2026-11-02) : lectures véhicule, pleins et routes masquées

#### Constat
- `GET /api/vehicles/:id/mileage`, `.../mileage/history`, `.../status-history`, `.../tires` et `GET /api/fuel-records/vehicle/:id` étaient gardés par `authenticate` seul : un client lisait le kilométrage, l'historique de statut, les pneus et les pleins de n'importe quel véhicule.
- `GET /api/vehicles/check/:registrationNumber` répondait 403 à un client pour la plaque d'un autre client : le 403 révélait l'existence du véhicule. Désormais `exists: false`, comme pour une plaque inconnue.
- `GET /api/vehicles/check-alerts` et `GET /api/vehicles/archived`, déclarées dans `server/routes.ts`, étaient mortes : `/api/vehicles/:id`, déclarée avant elles, les masquait. Elles sont déplacées dans `server/api/vehicles.routes.ts` (lignes 124 et 190), avant `/:id`.

#### Cause racine
- Même cause que le 30 octobre : `authenticate` ne charge pas le rôle, et la cloison reposait sur une convention écrite à la main sur chaque route (`isAnyUser` ou `isStaff`), pas sur un refus par défaut.
- La garde statique censée détecter ce cas avait un angle mort : `tests/unit/server/vehicle-routes-guard.test.ts` ignorait le préfixe de montage des routeurs de `server/api/`. Un `router.get("/:id/leak", authenticate)` dans `vehicles.routes.ts` (monté sous `/api/vehicles`) était lu hors périmètre, donc passait.
- Le test de garde n'avait pas été éprouvé par mutation : son existence ne prouvait pas qu'il échoue.
- Classification : contrôle d'accès horizontal manquant (IDOR), récidive ; faux négatif de la garde statique.

#### Résolution
- Routes passées en `isAnyUser` avec `canAccessOwned` / `ownerScopeOf` ; `check/:registrationNumber` répond `exists: false` au client pour une plaque d'un autre.
- Garde statique corrigée : préfixes de montage résolus depuis `server/api/index.ts` (`mountPrefixes`). Prouvé par mutation temporaire (rapporté par la session source, non rejoué lors de cette passe).
- Commit `57ff6bf` (branche `fix/lot2-cloison-itfails`, PR #80).

#### Prévention (vérifiable)
- `tests/unit/server/vehicle-routes-guard.test.ts` (présent dans `57ff6bf`) : test « un chemin relatif d'un routeur monté sous /vehicles est résolu avec son préfixe » (lignes 100-108) et « aucune nouvelle route véhicule n'est gardée par authenticate seul » (ligne 116).
- Limite : `KNOWN_AUTHENTICATE_ONLY` (ligne 19) tolère encore `get /api/vehicles/:id` au motif d'un contrôle « fait dans le handler ». La garde ne vérifie pas ce contrôle.
- `tests/contract/vehicle-reads-client-scope.contract.test.ts` (présent dans `57ff6bf`, version de la branche modifiée et non commitée à la date de cette entrée) : HTTP réel sur les lectures listées ci-dessus, avec client sur le sien 200, sur un autre 403, personnel 200, anonyme 401 ; `check` (`exists` à `false`), `check-alerts` et `archived` (admin 200, client 403).
- Rouge avant correctif : non vérifié lors de cette passe.
- La prévention manquante du 2026-11-01 (ligne 817) est partiellement produite par le test statique. Elle reste à compléter : une route véhicule gardée par `authenticate` seul doit échouer aussi en HTTP. À produire par fleet-testeur.

#### Règle Projet (obligatoire)
- Une garde statique ne compte comme prévention qu'après une mutation qui la fait échouer (route volontairement mal gardée, test rouge, puis retrait). Une garde non mutée est une hypothèse.
- Une route déclarée après une route paramétrée (`/:id`) se teste en HTTP : la lecture statique la voit verte alors qu'elle ne répond jamais.
- Une liste gelée de routes tolérées porte un motif daté et un contrôle nommé dans un test HTTP ; un contrôle « fait dans le handler » sans test HTTP est un résidu à consigner.

## 2026-10-31 - Écran ouvert à un rôle que son API refuse

### Constat
- Pointage : écran ouvert au secrétariat, à la direction et à la logistique ; l'API ne servait que l'administration et la direction en lecture. La logistique, qui saisit, voyait un 403.
- Mouvements de pneus : écran ouvert à la logistique et au secrétariat (403), absent pour le technicien et la direction, que l'API autorisait.
- Coût véhicule et factures en attente : même écart, dans les deux sens.

### Cause racine
- Les rôles d'un écran du lot sont déclarés dans `client/src/config/lot-screens.ts`, ceux de sa route dans `server/api/*.routes.ts`, en deux listes recopiées à la main sans contrat entre elles. Chaque correction d'un côté laissait l'autre diverger.
- Classification : source de vérité dupliquée, absence de contrat client/serveur.

### Résolution
- Groupes de rôles nommés dans `shared/constants/roles.ts` (`TIME_TRACKING_READ_ROLES`, `TIME_TRACKING_WRITE_ROLES`, `TIRE_MOVEMENT_ROLES`, `PENDING_INVOICE_ROLES`, `VEHICLE_COST_ROLES`, `STAFF_ROLES`), importés par l'écran et par la route.

### Prévention (vérifiable)
- Unitaire `tests/unit/client/lot-screen-api-roles.test.ts` : pour chaque écran de `LOT_SCREENS`, lit dans la source les gardes de la route qu'il appelle (montage compris) et échoue si l'écran s'ouvre à un rôle refusé, ou si l'API sert un rôle sans écran hors exception écrite. Un écran non déclaré, ou une garde illisible, fait aussi échouer le test. Contrôlé par mutation : un rôle ajouté à l'écran seul fait échouer le test.

### Règle Projet (obligatoire)
- Un écran du lot et la route qu'il lit tirent leurs rôles du même groupe de `shared/constants/roles.ts`. Un nouvel écran se déclare dans le test garde-fou avec sa route ; un écart volontaire s'y écrit avec sa raison.

## 2026-10-31 - Heure de fin de verrou décalée du fuseau du serveur

### Constat
- `/admin/users/locked` affichait la fin de verrou une heure trop tard à Douala (UTC+1) et gardait dans la liste un compte déjà déverrouillé pendant une heure. Le message de connexion, lui, était juste.

### Cause racine
- `users.locked_until` est un `timestamp` sans fuseau. `pg` y écrit une `Date` en heure locale ; Drizzle relit ce type comme de l'UTC. Écriture par un pilote, lecture par l'autre : deux conventions d'heure sur la même colonne. En UTC (CI) l'écart est nul, donc invisible.
- Classification : convention de fuseau implicite, test aveugle à l'environnement.

### Résolution
- La liste lit par le store qui écrit (`DbLockoutStore.listLocked`, même pilote), plus par Drizzle.

### Prévention (vérifiable)
- Contrat `tests/contract/auth-lockout-timezone.contract.test.ts` : processus fixé à `Africa/Douala`, fin de verrou renvoyée à la seconde près, compte sorti de la liste à l'instant de fin.
- Unitaire `tests/unit/server/lockout-columns-read-path.test.ts` : échoue si un fichier de `server/` ou `shared/` hors liste nomme `locked_until` / `last_failed_login_at`, ou si une lecture Drizzle `users.lockedUntil` / `users.lastFailedLoginAt` apparaît hors du schéma. Angle mort écrit dans le test : une ligne `users` entière renvoyée sans nommer ces champs.

### Correction de fond prévue
- Passer `users.locked_until` et `users.last_failed_login_at` en `timestamptz` (migration idempotente et `init-database.ts`, lot base de données). Volontairement hors de ce correctif : changer le type sans reprendre les valeurs déjà écrites en heure locale les décalerait. Le garde-fou ci-dessus se retire avec cette migration.

### Règle Projet (obligatoire)
- Une colonne `timestamp` sans fuseau se lit avec le pilote qui l'écrit. Un test qui touche à l'heure fixe un fuseau non UTC, sinon il ne prouve rien.

## 2026-11-01 - Alerte d'un autre compte marquée lue ou supprimée

### Constat
- `PATCH /api/alerts/:id/read` et `DELETE /api/alerts/:id` écrivaient par id seul : n'importe quel compte connecté marquait lue ou supprimait l'alerte d'un autre. Les ids sont séquentiels.

### Cause racine
- `storage.markAlertAsRead(id)` / `storage.deleteAlert(id)` ne prennent pas l'utilisateur ; la route ne le passait pas. Les routes existaient en double dans `server/routes.ts`, la seconde copie (morte) n'était pas meilleure.
- Classification : contrôle d'accès horizontal manquant (IDOR), même classe que l'incident du 2026-10-30. Répétition : contrôle renforcé ci-dessous.

### Résolution
- `server/api/alerts.routes.ts` + `server/services/alert-inbox-service.ts` : écritures filtrées sur `id` et `user_id` de session, 404 hors périmètre.

### Prévention (vérifiable)
- Contrat `tests/contract/alerts-inbox.contract.test.ts` (alerte d'un autre compte : 404, rien ne change). Sans correctif : 5 rouges sur 6.
- Hygiène `tests/unit/server/alerts-write-hygiene.test.ts` : `UPDATE` / `DELETE` sur `alerts` limités à une liste gelée ; plus aucun appel à `storage.markAlertAsRead` / `deleteAlert`. Rouge sur main (4 appels).

### Règle Projet (obligatoire)
- Une écriture sur une ligne nominative (alerte, préférence, brouillon) filtre sur l'utilisateur de session dans la requête SQL elle-même, jamais par un contrôle après lecture.

## 2026-11-01 - Compte supprimé toujours connecté

### Constat
- Après `DELETE /api/users/:id` (soft delete), le compte se reconnectait par `POST /api/auth/login`, et une session ouverte avant la suppression restait valide (gardes de rôle, `GET /api/auth/me`, routes gardées par `authenticate` seul).

### Cause racine
- `storage.getUser` / `getUserByUsername` rendent aussi les lignes `deleted_at` non nulles ; la connexion et les gardes ne lisaient pas `deletedAt`. La suppression n'effaçait pas les sessions (table `session`), seule la désactivation fermait les WebSocket.
- Classification : contrôle d'authentification manquant sur un état métier (cycle de vie du compte). `pin-login` et `userService.authenticateUser` le faisaient déjà : contrôle présent sur un chemin, absent sur l'autre.

### Résolution
- Refus de `deletedAt` dans `POST /api/auth/login`, `authorize`, `isAdmin`, `GET /api/auth/me`.
- `revokeUserAccess` (`server/lib/user-sessions.ts`) : efface les sessions du compte et ferme ses connexions temps réel, appelée par la suppression et par la désactivation.

### Prévention (vérifiable)
- Contrat `tests/contract/users-admin-soft-delete.contract.test.ts` : connexion refusée, session révoquée (route `authenticate` seule), désactivation révoquée, et seconde ligne de défense (`deletedAt` écrit hors route : gardes et profil refusent). Sans correctif : 3 rouges.
- Limite connue : cette seconde ligne ne couvre que `authorize`, `isAdmin` et `/api/auth/me`. Les routes gardées par `authenticate` seul et le WebSocket ne relisent pas le compte : si l'effacement des sessions échoue (deux essais, journalisés en erreur), le cookie y reste valide jusqu'à son expiration. Correctif durable : faire relire le compte par `authenticate`.

### Règle Projet (obligatoire)
- Un changement d'état qui retire un droit (suppression, désactivation, rôle) coupe aussi les sessions déjà ouvertes, pas seulement les connexions futures.

## 2026-11-01 - Fichier de contrat en échec alors que tous ses tests passent

### Constat
- Plusieurs fichiers de contrat (PR #65, #66, #67) sortaient « 1 failed » avec tous leurs tests verts. Le `afterAll` global (`cleanupOrphanTestRows`, `tests/support/setup-contract.ts`) levait une erreur de clé étrangère.

### Cause racine
- Le ménage supprime les comptes TEST, mais des tables pointant vers `users` n'étaient pas vidées avant : `document_renewal_centers.created_by` (renouvellement rapide), après `fuel_prices.created_by` plus tôt.
- Course : le job d'alertes en tâche de fond écrit des alertes pour les comptes de test entre la suppression des alertes et celle des comptes (`alerts_user_id_users_id_fk`).
- Le même job écrit des échéances d'autres documents de la base pour toute secrétaire : une assertion « alertes restantes du compte » sans filtre sur ses propres documents devient instable.
- Classification : ménage de test incomplet, répété (troisième FK). Contrôle renforcé ci-dessous.

### Résolution
- `tests/support/cleanup.ts` : centres et demandes de renouvellement des comptes TEST supprimés ; alertes resupprimées juste avant les comptes ; trois essais, puis seule la course `alerts_user_id` est tolérée (avertissement stderr). Toute autre erreur fait échouer.
- `tests/contract/document-quick-renew-alerts.contract.test.ts` : assertion restreinte aux préfixes de ses deux documents (`documentExpiryDedupeKeyPrefixes`).

### Prévention (vérifiable)
- Une nouvelle FK vers `users` oubliée dans le ménage fait échouer le hook global (erreur relevée, pas avalée) : elle se voit au premier fichier de contrat.
- Preuve : DOC3 rouge avant (FK `alerts_user_id`, puis alerte d'un autre document), vert après.

### Règle Projet (obligatoire)
- Toute table qui référence `users` et peut être écrite par un compte de test se vide dans `cleanupOrphanTestRows` avant la suppression des comptes.
- Une assertion sur les alertes d'un compte filtre sur les objets créés par le test : le job en tâche de fond écrit pour tous les comptes.

## 2026-11-01 - it.fails qui contient sa mise en place

### Constat
- Cinq PR de tests (#67, #68, #70, #71, #72) ont été recalées en relecture : un `it.fails(...)` contenait aussi la création du véhicule, du plan ou de la mission, ou le POST d'une fixture.

### Cause racine
- `it.fails` passe au vert dès que son corps lève, quelle qu'en soit la raison. Un setup en 500 ou une coupure Neon fait donc passer le test sans prouver le défaut visé.
- Classification : piège de l'outil, répété cinq fois malgré la relecture. Contrôle automatique requis.

### Résolution
- `tests/unit/server/it-fails-hygiene.test.ts` parcourt `tests/**/*.test.ts` et `e2e/**/*.spec.ts`, repère les `it.fails` / `test.fail` dont le corps appelle une fabrique (`create*`, `seed*`, `make*`, `insert*`, `open*`, `new*`, `setup*`, `db.insert`, `.save`) hors assertion directe sur son statut, ou fait plus d'une requête HTTP.
- Les occurrences présentes sur main sont gelées (liste explicite, qui ne peut que rétrécir).

### Prévention (vérifiable)
- Une nouvelle occurrence fait échouer le test unitaire, avec la règle et la correction dans le message.
- Preuve : un `it.fails` fautif déposé dans `tests/contract/` fait passer le test à rouge (1 failed, clé `fichier::titre` listée) ; retiré, vert.

### Règle Projet (obligatoire)
- Un `it.fails` ne contient que l'appel visé et l'assertion métier ; la mise en place va dans `beforeAll` ou un `it` témoin.

## 2026-11-01 - Sonde de test : débits NaN écrits, solde global de la carte empoisonné

### Constat
- Premier passage de `fuel-card-routes.contract.test.ts` (FUEL1) : 8 échecs, `balance` à `null`, un débit « solde insuffisant » accepté en 201. La suite avait elle-même écrit des débits dont la quantité valait NaN.

### Cause racine
- Produit : `POST /api/fuel-card/consumption` ne valide ni quantité ni prix (`fuel-card-service.ts` ~215-231) : NaN accepté, SUM devient NaN pour toute la carte, et `cost > balance` (comparaison avec NaN toujours fausse) désactive le garde de solde.
- Test : les sondes de défauts étaient jouées au milieu du fichier, sur une carte au solde global, et leur ligne n'était supprimée qu'en fin de fichier. Classification : sonde destructive sur état partagé, sans ménage immédiat ni filet.

### Résolution
- Sondes déplacées en fin de fichier, jouées une seule fois en `beforeAll`, ligne supprimée aussitôt (`probe()`), id enregistré avant la suppression.
- Filet : `afterAll` balaie tout `fuel_records` daté de 2031 (année réservée à ce fichier). Base vérifiée : 0 ligne NaN après le premier passage.

### Prévention (vérifiable)
- Rejeu du fichier : solde fini à la fin, second passage identique (idempotence). Le balayage 2031 retire toute ligne laissée par une suppression en échec.
- Limite : un crash du processus avant `afterAll` laisse la ligne jusqu'au passage suivant, qui la balaie.

### Règle Projet (obligatoire)
- Une sonde qui écrit une valeur capable de fausser un agrégat global (NaN, négatif) supprime sa ligne dans la minute, enregistre son id avant, et le fichier balaie sa plage de dates réservée en `afterAll`.

## 2026-11-02 - Période KPI démesurée : plusieurs secondes de calcul puis 500

### Constat
- `GET /api/kpi/*` et `GET /api/exports/kpi-report` acceptaient `to=9999-12-30` ou `2026-02-31`. Le calcul des mois de la période bouclait plusieurs secondes avant une 500.

### Cause racine
- `isoDateSchema` ne contrôle que la forme `AAAA-MM-JJ`, pas la date ni son étendue. La boucle `monthKeysBetween` (`server/lib/kpi-rules.ts`) est linéaire en nombre de mois. Classification : entrée utilisateur non bornée qui pilote un coût de calcul.

### Résolution
- `shared/contracts/kpi-period.ts` : date réelle du calendrier, années 2000-2100, 36 mois civils au plus ; réponse 400 lisible.

### Prévention (vérifiable)
- `tests/unit/shared/kpi-period.test.ts` : les quatre schémas refusent période démesurée, date inexistante et années hors bornes.
- `tests/contract/kpi-cdc.contract.test.ts` : 400 sans détail technique sur ces cas, pour les KPI et le rapport.

### Règle Projet (obligatoire)
- Tout paramètre de requête qui fixe la taille d'un calcul (période, pagination, profondeur) est borné dans son schéma Zod partagé ; `isoDateSchema` seul ne suffit pas pour une période.

### Suite (relecture de #108) : borne implicite et fuseau
- Constat : (1) `from` seul laissait le serveur compléter `to` par aujourd'hui, donc `from=2001-01-01` contournait le plafond de 36 mois ; (2) le contrôle ajouté pour cela lisait « aujourd'hui » en UTC alors que le serveur le lit à Douala : entre 00:00 et 01:00 à Douala, `?from=<jour de Douala>` sans `to` donnait un 400 (`from > to`).
- Cause racine : une borne complétée par le serveur n'était pas contrôlée avec la même valeur que celle qu'il utilise ; le jour courant était calculé à deux endroits, dans deux fuseaux. Classification : règle dupliquée entre contrat et serveur.
- Résolution : `kpiPeriodIssue` contrôle la période réelle (`to` = jour courant) ; `KPI_TIME_ZONE` et `isoDateInZone` vivent dans `shared/contracts/kpi-period.ts`, `server/lib/kpi-rules.ts` les importe, plus aucune redéclaration.
- Prévention (vérifiable) : `tests/unit/shared/kpi-period.test.ts` (`from` seul au-delà de 36 mois refusé ; à 00:30 Douala, soit 23:30 UTC la veille, `from` = jour de Douala accepté, lendemain refusé).
- Règle : une valeur par défaut complétée côté serveur se contrôle avec la même fonction, importée du contrat, et un jour métier se calcule une seule fois, dans un fuseau nommé.

## 2026-11-02 - Brouillon d'acquisition recréé après la clôture, abandon qui touchait l'acquisition terminée

### Constat
- Après l'activation d'un véhicule, la base contenait deux lignes sous le même `sessionId` : `completed` et `in_progress`. Le bandeau « Workflows en cours » affichait un brouillon fantôme. Le bouton « Abandonner » appelait `PATCH /api/workflows/active/:sessionId/abandon`, dont le service ne filtrait pas sur `in_progress` : il passait aussi l'acquisition terminée à `abandoned`.

### Cause racine
- Client : `updateData` programme un enregistrement à 500 ms. Si ce minuteur ou un PATCH déjà en route arrive après `completeWorkflow()`, le repli POST de la mutation recrée un brouillon. `sessionClosed` ne bloquait que les futurs appels de `saveWorkflow`.
- Serveur : `workflowReminderService.abandonWorkflow` filtrait sur `userId` + `sessionId` seulement, alors que la route jumelle `workflowService.abandonWorkflow` filtre déjà sur `in_progress`. Deux services pour la même transition, un seul gardait l'invariant.

### Résolution
- Minuteurs d'enregistrement annulés à la clôture, mutation qui ne PATCH ni ne POST plus une fois la session close ; le bandeau appelle la route `vehicle-acquisition` ; filtre `in_progress` ajouté au service des rappels.

### Prévention (vérifiable)
- `tests/integration/workflow-abandon-pair.test.ts` : paire `completed` + `in_progress`, l'abandon ne change que la seconde, sur les deux services (rouge avant le filtre sur le service des rappels, vert après).
- `e2e/16-vehicle-acquisition-resume.spec.ts` : après activation, aucun brouillon `in_progress` ne subsiste pour la session.

### Règle Projet (obligatoire)
- Toute transition de statut qui cible un `sessionId` ou un identifiant partagé filtre sur le statut d'origine attendu, dans chaque service qui l'expose. Une clôture annule les écritures différées en attente, pas seulement les futures.

## 2026-11-02 - Rôle de session lu dans des décisions d'autorisation

### Constat
- Après correction d'ADM2-3 (`/api/purchase-orders`), la même lecture `req.session.role` décidait encore des accès dans les renouvellements de documents (5 routes), les missions (4 handlers) et les besoins en pièces : un compte rétrogradé gardait ses droits jusqu'à la déconnexion.

### Cause racine
- Le rôle de session est figé à la connexion ; `authenticate` seul ne pose pas `req.user`, donc les handlers lisaient la session par commodité. Le défaut avait été corrigé là où il était signalé, sans balayer les routeurs voisins.

### Résolution
- Routeurs montés sous `isAnyUser` / `isStaff` (rôle relu en base) et handlers lisant `req.user.role`.

### Prévention (vérifiable)
- `tests/unit/server/session-role-guard.test.ts` : aucune lecture de `session.role` dans `server/api/` hors liste gelée (étiquettes d'audit `actorRole`, écriture à la connexion PIN) ; la liste ne peut que diminuer.

### Règle Projet (obligatoire)
- Une décision d'accès lit `req.user.role`, posé par `authorize` / `isAnyUser` / `isStaff`. Corriger un défaut de classe impose de balayer tout le dépôt, pas seulement la route signalée.

## 2026-11-02 - Import Excel des factures : trois contournements successifs de la même garde

### Constat
- `POST /api/supplier-invoices/import` (SheetJS 0.20.3) a été contourné trois fois en relecture, à chaque fois sous les plafonds annoncés (5 Mo téléversés, 5000 lignes) :
  1. tailles du zip sous-déclarées (répertoire central = 1, en-tête local = 0) : SheetJS décompressait sans limite ;
  2. bit 3 (data descriptor) avec une taille locale de 300 Mo : 6 Ko téléversés, 1,4 Go de RSS ;
  3. une seule cellule en colonne XFD sur chacune de 302 478 lignes (1,3 Mo téléversés, feuille de 15 Mo) : 147,6 s de boucle d'événements bloquée dans le comptage des lignes, plus de 300 s si la cellule contient une espace.

### Cause racine
- La garde imitait le parseur de SheetJS au lieu de lui donner une entrée canonique : chaque écart entre les deux lectures du zip (taille locale, data descriptor) était une porte.
- Chaque passe était dimensionnée sur un fichier moyen, pas sur l'entrée la plus défavorable : `cells.some(...)` parcourt une ligne dense jusqu'à sa `length`, et une cellule en XFD en fait un tableau creux de 16 384. Le refus au-delà de 5000 lignes ne venait qu'après la boucle, et les lignes blanches n'étaient jamais comptées. Classification : coût proportionnel à une valeur déclarée (largeur, hauteur, taille) au lieu du contenu présent.

### Résolution
- `canonicalWorkbookArchive` (`server/lib/xlsx-import-guard.ts`) décompresse réellement chaque entrée sous un budget (15 Mo) et reconstruit une archive neuve : SheetJS ne lit jamais le tampon téléversé.
- `compactImportSheet` (`server/lib/supplier-invoice-import-sheet.ts`) : hauteur contrôlée en O(1) (`length` du tableau dense), lignes présentes parcourues sans plafond (8 accès par ligne au plus : 0,27 s sur 1 048 575 lignes à cellule en XFD ; un plafond refusait les modèles à formules tirées sans rien gagner), en-tête lu par `for…in` (cellules présentes seulement), lignes de données lues par accès direct aux 8 colonnes attendues, `sheet_to_json` appliqué à une feuille compacte (en-tête + lignes retenues, colonnes attendues).

### Prévention (vérifiable)
- `tests/contract/supplier-invoice-import-hardening.contract.test.ts` : `xfd` et `xfdblank` (40 000 lignes d'une cellule en XFD, générées en mémoire) sous un en-tête, traités en moins de 2 s (rien à importer) ; data descriptor et ZIP64 avec bornes mémoire ; `<dimension>` large ou absente.
- `tests/unit/server/supplier-invoice-import-sheet.test.ts` : ligne au-delà de 1 048 576, lignes larges en temps borné, modèle à formules tirées (20 000 lignes calculées vides) accepté, colonne obligatoire absente de l'en-tête nommée dans le refus.
- `tests/unit/server/xlsx-import-guard.test.ts` : archive de sortie sans bit 3 ni extra, tailles locales = tailles réelles.

### Règle Projet (obligatoire)
- Un analyseur de fichier téléversé donne à la bibliothèque une entrée canonique reconstruite, jamais l'octet reçu. Chaque passe sur ce fichier est mesurée sur son entrée la plus défavorable (largeur, hauteur, creux, valeurs blanches) et porte un test de borne de temps ou de mémoire, rouge sur le code précédent.

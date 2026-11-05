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
- `tests/unit/server/session-role-guard.test.ts` : aucune lecture de `session.role` dans tout `server/` (portée étendue le 2 novembre 2026, voir l'entrée « WebSocket : rôle figé en session ») hors liste gelée (étiquettes d'audit `actorRole`, écriture à la connexion PIN) ; la liste ne peut que diminuer.

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
## 2026-11-02 - Postgres local pour intégration et contrat : le bootstrap n'était pas « from scratch »

### Constat
- Mise en place d'un Postgres Docker (`docker-compose.test.yml`) et d'une CI (`.github/workflows/ci.yml`) pour sortir les suites intégration et contrat de la latence Neon. Premier passage : 34 fichiers d'intégration en échec dès `setupFiles`, `relation "users" does not exist`.
- Second near miss : wsproxy refusait toute connexion, `address postgres:5432postgres:5432: too many colons`.
- Trois tests échouent en local : `part-requirement-received-by` (régression produit, pas infra : `ensureAutoSupplierInvoiceFromOrder` lève « montant HT > 0 » sur une commande dont `totalAmountHT` reste à 0, contrôle ajouté par c3f3260 après le test c06fa45) ; `management-dashboard-service` ×2 dans le passage complet, verts seuls (déjà noté flaky le 2026-10-30, journal de couverture l.171). Note du 2026-11-02 : les deux sont
  résolus depuis, `received-by` par #110 sur `main`, le tableau de bord par a7aabc1/6db199a (voir l'entrée
  « test classé instable qui dépendait de la date du jour »).

### Cause racine
- `initializeDatabase()` (`server/init-database.ts`) ne crée aucune table : il suppose un `drizzle-kit push` initial jamais rejoué, et n'avait jamais tourné sur une base vide. L'idempotence (`IF NOT EXISTS`) masquait l'absence de création.
- `APPEND_PORT` de wsproxy est concaténé tel quel à `address=` ; le driver Neon envoie déjà `host:port`.
- La branche Neon de test porte 6 tables absentes de `shared/schema.ts` (`destination_rates`, `idempotency_keys`, `import_batches`, `operation_costs`…) : écritures d'autres branches sur une base partagée. Triggers identiques (7/7).

### Résolution
- `npm run test:db:schema` (`drizzle-kit push --force` sur le port TCP direct 54320) avant la première suite, appelé par `test:db:up` et par chaque job CI.
- `APPEND_PORT` retiré, `ALLOW_ADDR_REGEX` restreint à `^postgres:5432$`.
- `server/db.ts` : `DATABASE_WS_PROXY` (sans protocole) bascule le driver sur un proxy en clair ; absent = Neon, inchangé.

### Prévention (vérifiable)
- La CI part d'une base vide à chaque job : toute dépendance à un état Neon préexistant (table hors schéma, ligne de référence) casse en CI avant de casser ailleurs.
- Les 6 tables hors schéma ne sont pas reproduites en local : un test qui en dépend échouera en CI, c'est voulu. Les porter dans `shared/schema.ts` + `init-database.ts` (AGENTS.md §5) ou les retirer.
- Durées mesurées le 2026-11-02 : intégration 53 s en local (34 fichiers) ; contrat et référence Neon dans `docs/plans/ci-postgres-local.md`.

### Règle Projet (obligatoire)
- Toute table ou colonne existe dans `shared/schema.ts` **et** se crée par `test:db:schema` + `initializeDatabase()` sur une base vide. Une base Neon partagée n'est pas une source de vérité de schéma.


## 2026-11-02 - WebSocket : rôle figé en session (3e réapparition d'ADM2-3)

### Constat
- Après la correction des routeurs HTTP (#102), l'upgrade WebSocket (`server/index.ts`) lisait encore `session.role` : un utilisateur dont le rôle change garde l'ancien sur sa connexion temps réel.

### Cause racine
- La garde `session-role-guard` ne balayait que `server/api/` ; `server/index.ts` était hors portée. Son motif d'exception acceptait aussi une comparaison (`session.role === "admin"`).

### Résolution
- L'upgrade relit le compte par `findActiveSessionUser` (même fonction qu'`authenticate`) : compte supprimé → 401, panne de base → 500 sans détail, journalisée par `moduleLogger("websocket")`.

### Prévention (vérifiable)
- `tests/unit/server/session-role-guard.test.ts` balaie tout `server/` ; les formes d'exception refusent `===` (`=(?!=)`), une nouvelle décision d'accès dans un fichier gelé échoue.

### Règle Projet (obligatoire)
- Un défaut de classe se corrige sur tous les points d'entrée (HTTP, WebSocket, tâches planifiées), et la garde couvre tout `server/`.


## 2026-11-02 - Test « instable » qui dépendait de la date du jour

### Constat
- `tests/integration/management-dashboard-service.test.ts` (2 cas) échouait en CI et était classé « flaky connu » : delta attendu 250 000, reçu 0.

### Cause racine
- La période `month` va du 1er à aujourd'hui (`invoiceDate <= endIso`). Le test datait ses factures au 15 et au 16 : hors période du 1er au 14 de chaque mois. Second défaut masqué : `toBe` sur une différence de totaux flottants (249999.99999999977).

### Résolution
- Jour borné à la date du jour (`Math.min(day, now.getDate())`), deltas monétaires en `toBeCloseTo(x, 2)`. CI de #109 verte (6db199a).

### Prévention (vérifiable)
- Le job `integration` de la CI tourne sur chaque PR : un test dépendant de la date réapparaît dans la première quinzaine du mois au lieu d'être noyé dans Neon.

### Règle Projet (obligatoire)
- Avant de classer un test « flaky », vérifier s'il dépend de la date, de l'heure ou du fuseau. Une donnée de test datée doit tomber dans la période testée quel que soit le jour d'exécution ; un montant calculé se compare au centime, jamais par `toBe`.

## 2026-11-02 - Supprimer une panne ou une pièce liée répondait 500 (clé étrangère sans onDelete)

### Constat
- `fault_catalog_parts` référençait `fault_catalog` et `parts` sans `onDelete` : supprimer une panne qui avait des pièces associées, ou une pièce citée par une panne, levait une violation de clé étrangère (23503) devenue une 500 « Erreur serveur ». Les routes d'association (variantes, spécifications, pièces de panne) n'existaient pas non plus.

### Cause racine
- Table créée par `drizzle-kit push` à partir d'un schéma sans règle de suppression, jamais exercée par un test : la suppression d'un parent ayant des enfants n'avait aucun cas de contrat. Premier correctif trop large : tout passer en CASCADE aurait permis à la suppression d'une pièce d'effacer silencieusement une partie du catalogue de pannes, et un dédoublonnage groupé sur (panne, pièce) seul aurait supprimé des lignes de quantité ou d'option différentes.

### Résolution
- Panne parent : CASCADE (supprimer une panne emporte ses lignes). Pièce : RESTRICT, et `deletePart` répond 409 « Pièce utilisée dans le catalogue de pannes » avant toute écriture. Dédoublonnage limité aux lignes strictement identiques (panne, pièce, quantité, optionnel) ; si des lignes divergentes subsistent, l'index unique n'est pas posé et un WARNING le dit.

### Prévention (vérifiable)
- `tests/contract/fault-catalog-lifecycle.contract.test.ts` : suppression d'une panne avec pièces (204, liens supprimés), suppression d'une pièce liée (409, rien supprimé).
- `tests/integration/parts-catalog-children-migration.test.ts` : cas 1/false, 4/true, 1/false (divergence conservée, index non posé, WARNING) et cas de doublons identiques.
- `tests/unit/server/parts-catalog-children-schema.test.ts` : la migration et sa réplique dans `init-database.ts` restent identiques.

### Règle Projet (obligatoire)
- Toute clé étrangère déclare son `onDelete` en choisissant explicitement entre CASCADE (l'enfant n'a pas de sens sans le parent) et RESTRICT (le parent est une donnée de référence), avec un test de suppression du parent portant des enfants. Une migration qui supprime des lignes ne supprime que ce qu'elle peut prouver redondant.

## 2026-11-02 - vi.mock inopérant dans les contrats selon l'ordre des shards

### Constat
- CI de #117 (tests seuls, sans rapport) : `document-renewal-centers.contract.test.ts` échoue sur le shard contract 4, « un 409 levé par le résolveur reste un 409 », 201 reçu au lieu de 409. main verte, même code.

### Cause racine
- Le test forçait le 409 par `vi.mock` du résolveur. `vitest.contract.config.ts` tourne en `isolate: false` + un worker (volontaire, #109) : le cache de modules est partagé entre fichiers. Si un fichier précédent du shard a déjà chargé les routes, elles gardent le vrai résolveur, le mock ne s'applique pas, le centre est créé. #117 ajoutait des fichiers, la répartition des shards a changé.

### Classification
- Défaut de test (isolation), pas défaut produit : l'unicité normalisée et la course réelle étaient couvertes par d'autres cas, verts.

### Résolution
- Panne provoquée en base : trigger `BEFORE INSERT` temporaire levant `23505` pour le seul nom du test, supprimé dans le `finally`. Le vrai résolveur prend son chemin de course (`isUniqueViolation` → AppError 409). Le test vérifie aussi qu'aucun centre n'est créé.

### Prévention (vérifiable)
- `tests/unit/server/contract-no-vi-mock.test.ts` échoue sur tout `vi.mock` / `vi.doMock` sous `tests/contract`. Règle dans `tests/README.md` § Pattern.

### Règle Projet (obligatoire)
- Un mock de module suppose un cache de modules isolé par fichier. Avant d'en écrire un, vérifier `isolate` dans la config de la suite ; sinon simuler la panne au niveau de la ressource (base, réseau) ou injecter la dépendance.

## 2026-11-03 - Contraintes CDC posées en SQL seulement, absentes après drizzle-kit push

### Constat
- CI de #119 sur 8ee48b2 : jobs integration et contract (1) rouges (`cdc-schema-idempotence`, `kpi-cdc` : « ok » ou 500 reçus au lieu de 23514 / 23505 / 409). La PR annonçait pourtant des contrats verts : la preuve venait d'une base locale préparée autrement, la CI n'avait pas été relue.

### Cause racine
- Les CHECK de `workshop_labor_rates`, `import_batches`, `idempotency_keys`, l'UNIQUE `(user_id, key)` et `work_orders_due_mileage_check` n'étaient déclarés que dans `20261101_cdc_ecarts.sql`. La recette des tests et de la CI fait `drizzle-kit push` puis `initializeDatabase()` : les tables existent déjà, `CREATE TABLE IF NOT EXISTS` et `ADD COLUMN IF NOT EXISTS` sont sautés avec leurs contraintes. Drizzle nommait en outre l'unique de date `..._effective_from_unique`, alors que le service attend `..._effective_from_key` pour répondre 409.

### Classification
- Dérive de schéma entre Drizzle et SQL, plus défaut de preuve (CI non vérifiée avant de l'annoncer).

### Résolution
- 0ed84c5 : CHECK et UNIQUE déclarés aussi dans `shared/schema.ts` sous le nom que Postgres leur donne. `work_orders` étant déclarée deux fois dans le schéma, `work_orders_due_mileage_check` est réconciliée par un bloc DO idempotent (`pg_constraint`, `NOT VALID`) dans la migration et `init-database.ts`. CI 8/8.

### Prévention (vérifiable)
- Les jobs CI integration et contract partent d'un `drizzle-kit push` sur base neuve : toute contrainte absente de Drizzle fait échouer `cdc-schema-idempotence.test.ts` (cas refusés 23514 / 23505).
- `tests/unit/server/cdc-schema-drift.test.ts` garde la migration et `CDC_SCHEMA_STATEMENTS` identiques.
- Fermé (condition C1 du go/no-go) : une base déjà poussée avec un schéma antérieur à 0ed84c5 n'avait pas ces contraintes. Le démarrage les repose (#122, réserves de relecture dans le lot suivant) : CHECK `NOT VALID` puis validés, UNIQUE dans l'ordre de colonnes du schéma. Un écart restant (doublons, valeurs hors contrainte) est journalisé en `warn` par `reportCdcConstraintGaps` (`moduleLogger("init-database")`) : un `RAISE WARNING` seul n'atteint pas les logs applicatifs. Test : `tests/integration/cdc-schema-idempotence.test.ts`, « réconciliation des contraintes ».
- Règle : un signal émis en SQL (`RAISE WARNING`, `NOTICE`) n'est pas un log. Ce qui doit être vu en production est relu côté application et journalisé par `moduleLogger`.

### Règle Projet (obligatoire)
- Une contrainte écrite en SQL est aussi déclarée dans Drizzle, sous le même nom, ou réconciliée par un bloc DO idempotent. Une PR n'annonce « CI verte » qu'après `gh pr checks` sur sa tête.

## 2026-11-03 - Second drizzle-kit push en échec (index colonne puis expression)

### Constat
- Signalé par la session CDC : sur une base déjà poussée, `drizzle-kit push` plante en ZodError (« Expected string, received null »). Reproduit sur origin/main seul : le premier push sur base neuve passe, le second échoue. La CI ne le voyait pas (un seul push par base neuve) ; le push d'une base existante (Neon, dev) était cassé depuis #116.

### Cause racine
- `ux_part_specifications_part_name` sur `(part_id, lower(specification_name))`. drizzle-kit 0.30.6 relit les index en découpant `pg_get_expr(indexprs)` en tableau et l'indexe par la position de la colonne dans l'index : l'expression en position 2 lit l'élément 2 d'un tableau qui n'en a qu'un, donc null. De plus, `is_expression` vaut pour tout l'index : une colonne simple mêlée à une expression, même placée après, est relue comme expression et ne correspond jamais au schéma. Une virgule, un guillemet ou une accolade dans une expression casserait aussi ce découpage.

### Classification
- Défaut d'outillage (bug drizzle-kit) révélé par un choix de schéma ; aucun effet sur les données ni sur l'API.

### Résolution
- Index remplacé par `ux_part_specifications_name_part` sur `(lower(specification_name), part_id)`, les deux éléments déclarés en `sql` (`sql\`${table.partId}\``) : même unicité, `idx_part_specifications_part_id` sert déjà les lectures par pièce. La migration rejouée pose le nouvel index puis retire l'ancien (pas de fenêtre sans unicité).
- Near miss en relecture : une première version mettait l'expression en tête mais gardait `table.partId` en colonne. Le ZodError disparaissait et les push étaient verts, mais chaque push DROP puis recréait l'index (OID changé), d'où une fenêtre sans unicité. « Push vert » n'était pas une preuve de convergence.
- Vérifié : OID de l'index identique après push successifs (base neuve et base portant l'ancien index), contrat `parts-catalog-crud` (homonyme insensible à la casse → 409) vert.

### Prévention (vérifiable)
- `tests/unit/shared/schema-index-introspection.test.ts` parcourt tous les index de `shared/schema.ts` et échoue sur un index mêlant colonne simple et expression, ou sur une virgule, un guillemet ou une accolade dans une expression ; vérifié rouge sur l'ancien index et sur la première version du correctif.

### Règle Projet (obligatoire)
- Dans un index qui contient une expression, toutes les colonnes s'écrivent `sql\`${table.col}\``. Une convergence de schéma se prouve par l'absence d'écriture au second passage (OID stable ou « No changes »), pas par un passage vert. Le garde-fou sera retiré quand drizzle-kit corrigera son introspection, preuve par un double push à l'appui.

## 2026-11-03 - Fusion de main qui débranche le point d'entrée d'une branche de sécurité (#56)

### Contexte
- #56 (CDC-10a) cloisonne le cache PWA par utilisateur. Ses garanties de démarrage (déconnexion hors ligne envoyée avant `/api/auth/me`, magasin hors ligne activé à la restauration, expiration sur 401) vivaient dans `getCurrentUser()`.

### Cause racine
- main (163a20a) a remplacé l'amorçage de `useAuth` par `checkSession()`. La fusion de main dans #56 (cc01c19) a gardé la version de main : `getCurrentUser` est devenu du code mort, sans conflit Git ni test rouge, car les tests visaient la fonction et non le chemin d'appel.
- Effet : une déconnexion faite hors ligne n'était plus envoyée au redémarrage ; le cookie de 30 jours reconnectait le compte précédent pour la personne suivante sur l'appareil (cloison §11 cassée). Détecté en relecture (fleet-relecteur, fleet-securite) avant fusion.

### Classification
- Near miss, sécurité (cloison entre comptes), introduit par une résolution de fusion.

### Résolution
- `client/src/lib/session-resume.ts` : composition injectable (déconnexion différée → `/me` → activation ou expiration), seul chemin d'amorçage, appelée par `useAuth` via `resumeSession`. `getCurrentUser` supprimé (un seul chemin).

### Prévention (vérifiable)
- `tests/unit/client/session-resume.test.ts` : ordre logout avant `/me`, aucune restauration si la déconnexion est en attente, activation et expiration ; et garde-fou textuel qui échoue si `useAuth` amorce par `checkSession` seul.

### Règle Projet (obligatoire)
- Une garantie de sécurité se teste sur son point d'entrée réel, pas seulement sur la fonction qui la porte. Après toute fusion de main dans une branche de sécurité, relire les fichiers en conflit résolu côté main et rejouer l'e2e concerné.
- Toute purge locale liée à l'identité a pour pendant une révocation serveur garantie (déconnexion différée rejouée avant toute reprise de session). L'identité gardée en mémoire se synchronise entre onglets (réserves R2 et S1, lot #10c).

## 2026-11-03 - Une règle, une source

### Constat
- Pendant P3-2 lot 1 (PR #126), trois symptômes du même défaut, corrigés dans la branche `fix/p3-2-echeances` (75dbb99, d9a8f81, 7c12906, f16ee00) :
  1. Un papier expiré (assurance, visite, plaque) créait un OT atelier qui immobilisait le véhicule à tort.
  2. Le lancement de mission (`PUT /api/missions/:id/status`) et l'éligibilité à l'affectation (`getMissionEligibility`, `shared/constants/vehicle-eligibility.ts`) ne tranchaient pas le jour J de la même façon : le lancement laissait partir un véhicule dont l'échéance tombait le jour même.
  3. Le miroir `vehicles.*` (`licensePlateExpiry`, `insuranceExpiry`, `technicalInspectionDate`) n'était pas recalculé à la suppression d'un document, et le dépôt pouvait faire reculer la date.

### Cause racine
- La même règle (« quand un papier est-il expiré, et quel document compte ? ») était écrite à plusieurs endroits : le service préventif, `alert-service`, `missions.routes.ts`, `getMissionEligibility`, et une copie locale du miroir dans `document-renewals.routes.ts`. Chaque copie avait sa propre date de référence et sa propre règle de « dernier document ».
- Classification : source de vérité dupliquée (règle métier recopiée entre service, route et écran), défaut de contrat entre les chemins qui décident.

### Résolution
- Règle d'éligibilité unique : `getMissionEligibility` est appelée au lancement comme à l'affectation ; le lancement n'ajoute que les motifs de conformité qui ne sont pas déjà énoncés. Jour J bloqué (`isExpiredOnOrBeforeToday` dans `missions.routes.ts`, même sémantique que `joursDepuis`).
- Par type de document, seule l'échéance la plus lointaine compte au lancement.
- Lib unique `server/lib/vehicle-document-mirror.ts` (`syncVehicleDocumentMirror` mode `later` = GREATEST au dépôt, mode `set` pour un renouvellement ; `recomputeVehicleDocumentMirror` à la suppression). `document-renewals.routes.ts` et `vehicle-documents.routes.ts` l'utilisent ; la copie locale est supprimée.
- Le papier ne crée plus d'OT atelier : `vehicles.status` reste inchangé, l'alerte renvoie vers le renouvellement.

### Résiduel connu (non corrigé dans #126)
- `missions.routes.ts` garde `isDateExpired` (jour J encore valide) pour le permis chauffeur (lancement, l. ~2341 ; préparation, l. ~1415) et `isDocumentTypeValid` (l. ~584, appelée l. ~1412, ~2724 et ~2860 : demandes de renouvellement et préparation). Un document qui expire aujourd'hui est donc refusé au lancement mais non réclamé par les demandes de renouvellement. Ces lignes relèvent encore de la même règle dupliquée.

### Prévention (vérifiable)
- `tests/contract/mission-document-expiry.contract.test.ts` (existe dans la branche) :
  - « P3-2 papier dans la fenêtre d'alerte » : aucun OT atelier pour assurance, visite et plaque, alerte avec lien, statut inchangé.
  - « jour J : un papier qui expire aujourd'hui bloque, comme l'éligibilité » : lancement refusé pour une assurance échue ce jour.
  - « P3-2 R2 : un document saisi par erreur puis supprimé » : le miroir revient à l'échéance restante et l'affectation est refusée.
  - Rouge avant correctif : non rejoué par moi ; le corps de #126 l'affirme pour « document orphelin » et « jour J ».
- `tests/contract/vehicle-documents-upload.contract.test.ts` (existe) : dépôt qui met le miroir à jour, dépôt plus ancien qui ne fait pas reculer le miroir (GREATEST), second dépôt à la même échéance sans écriture ni `vehicle_updated`, parité de la lib avec `PATCH /api/documents/:id` (alias compris), échec de synchro en 500 lisible sans ligne ni fichier, suppression qui recalcule le miroir.
- `tests/unit/shared/vehicle-eligibility.test.ts` (existe) : « accepte une échéance encore valable, refuse dès le jour J ».
- `tests/integration/preventive-maintenance-lifecycle.test.ts` (existe) : `it.fails` « l'OT issu d'un plan échu immobilise aussi le véhicule » (sur origin/main l. 212) remplacé par `describe("P3-2")` vert : OT ouvert, véhicule opérationnel, idempotent au second passage.
- `tests/unit/server/write-routes-ratchet.test.ts` et `tests/unit/server/support/write-routes-frozen.ts` : la liste gelée ne peut que diminuer ; #126 retire `post /api/vehicles/:vehicleId/documents`.
- `tests/unit/server/it-fails-hygiene.test.ts` et `tests/unit/server/routes-hygiene.test.ts` (existent) : garde-fous des `it.fails` et des doublons de routes.
- Prévention manquante, à confier à fleet-testeur :
  - Garde-fou qui interdit `isDateExpired` (jour J valide) et toute écriture directe des colonnes miroir `vehicles.*` hors de `server/lib/vehicle-document-mirror.ts`. Écritures directes existantes : `server/routes.ts` l. 1428, 1433, 1438 (PATCH `/api/documents/:id`, fichier gelé). Aucun test de ce type n'existe.
  - Test de lancement du permis chauffeur au jour J.
- Non trouvé dans la branche : un garde-fou « licenseExpiry=2 » dans `missions.routes.ts`, et un verrou d'import de la lib miroir. Ils ne sont pas cités comme prévention.

### Règle Projet (obligatoire)
- Une règle métier qui décide (expiré ou non, éligible ou non, jour J) vit en une seule fonction importée par tous les chemins qui décident (service, route, alerte, écran). Une copie locale est une dette à supprimer dans la même PR.
- Pour une règle de date, le test porte sur le jour J exact, sur chaque chemin qui décide, pas seulement sur le chemin qu'on vient de corriger.
- Avant d'annoncer une règle unifiée, rechercher les autres occurrences de la fonction (`grep -rn <nom>`) et les lister dans la PR ; une occurrence restante se déclare comme résiduel, pas comme corrigée.
- Récurrence : même classe que « Écran ouvert à un rôle que son API refuse » (2026-10-31) et « Borne KPI complétée par le serveur » (2026-11-02). Les corrections précédentes étaient ponctuelles ; cette entrée exige un garde-fou qui compare les chemins décideurs.

## 2026-11-03 - Garde d'idempotence : clé libérée sur une connexion coupée (#131)

### Contexte
- `server/middleware/idempotency-guard.ts` libérait la clé sur `close`. Si la connexion coupait pendant que la route écrivait, la réponse partait ensuite sans être enregistrée, et le réessai du client réexécutait l'écriture : le doublon que la garde devait empêcher.

### Cause racine
- `close` ne dit pas « la route a échoué » mais « le client n'écoute plus ». La garde confondait perte de connexion et échec connu.

### Classification
- Near miss, intégrité des écritures (doublon hors ligne), relevé en relecture avant fusion.

### Résolution
- Rien n'est libéré sur `close` ; sur `finish`, la clé n'est libérée que si aucune réponse n'a été enregistrée ; une route qui ne répond jamais laisse expirer la réservation (arrêt du serveur compris).
- Même passage : `.catch` journalisé sur l'envoi différé (M1) ; compte supprimé → 401 avant toute réservation (B3).

### Prévention (vérifiable)
- `tests/unit/server/idempotency-guard.test.ts` : « connexion coupée puis réponse 200 » (reserve puis complete, le second passage rejoue sans exécuter la route) ; rouge avec l'ancienne garde.

### Règle Projet (obligatoire)
- Une garde d'idempotence ne libère une clé que sur une réponse connue (5xx, 401, 403, 408, 429, ou fin sans réponse enregistrée), jamais sur une perte de connexion.

## 2026-11-03 - Valider une valeur, en employer une autre (#130)

### Contexte
- `POST /api/vehicles/:vehicleId/documents` validait `parseInt(req.params.vehicleId)`. La destination multer construisait le dossier avec la chaîne brute : `path.join("./uploads/documents", "vehicle-" + brut)`.
- `1..%2F..%2F..%2F..%2Fx` (Express décode `%2F`) passait `parseInt` (1) et créait `x` à la racine du dépôt. Relevé par la relecture sécurité de #126, hors de son périmètre.

### Cause racine
- La validation et l'usage ne portaient pas sur la même valeur. `parseInt` n'est pas une validation : il tronque.
- La règle existait déjà (AGENTS.md §9, `isSafePathSegment`) mais aucun contrôle automatique ne la faisait respecter dans les stockages multer.

### Classification
- Near miss, sécurité (traversée de chemin), route réservée au personnel (`isWorkshopManager`).

### Résolution (#133)
- `isVehicleIdSegment` (entier positif sans zéro en tête, borné à l'int Postgres) valide avant multer : 400 « ID de véhicule invalide ».
- La destination multer revalide par `vehicleDocumentDirectory`, qui vérifie le confinement par `isInsideDirectory` (`server/lib/uploaded-file.ts`, partagé avec `uploadedFileCandidates`).
- Une erreur disque à la création du dossier devient une `AppError` 500 générique, sans chemin.

### Prévention (vérifiable)
- `tests/unit/server/multer-storage-hygiene.test.ts` : dans les options de tout `multer.diskStorage` de `server/`, une ligne qui lit `req.params|body|query|headers` doit passer la valeur à un validateur de segment. Rouge démontré sur l'ancien `upload.ts`.
- `tests/contract/vehicle-documents-upload-path.contract.test.ts` : 3 profondeurs de remontée, `12abc`, `007`, identifiant hors int → 400 `ApiErrorBody`, aucun dossier créé ; échec disque → 500 générique. Rouge démontré avant correctif (dossier `pwn130-*` à la racine, 500).
- `tests/unit/server/upload-vehicle-directory.test.ts` : bornes de l'identifiant et `isInsideDirectory` (`uploads/documents-x` refusé).

### Règle Projet (obligatoire)
- Un paramètre qui devient un segment de chemin se valide par une expression complète (ou `isSafePathSegment`), jamais par `parseInt`/`Number`, et **la valeur validée est celle qui sert**.
- Le confinement se vérifie par `isInsideDirectory` sur des chemins résolus, jamais par préfixe de chaîne.

## 2026-11-03 - Garde au montage trop large, 3e occurrence : écritures des missions (#129)

### Constat
- `PATCH /api/missions/:id` n'avait aucune garde de rôle : le routeur `missions` est monté derrière `authenticate` et `isStaff`. Chauffeur, technicien, magasinier, direction et chef d'atelier modifiaient coût carburant, budgets, dates, chauffeur et véhicule d'une mission (200, écriture constatée par le contrat avant correctif).
- La relecture (c7) a relevé la même ouverture sur `POST /api/missions` (le schéma d'insertion accepte `status` et `workflowData.budgetPlan`), `PUT /api/missions/:id/status` et `POST /api/operations/missions/from-fuel`.

### Cause racine
- Même classe que les entrées « cloison client » (30 octobre et 2 novembre) : la garde du montage (`isStaff`) répond à « est-ce du personnel ? », pas à « ce rôle peut-il écrire ici ? ». Chaque route d'écriture devait ajouter sa propre garde, par convention, sans contrôle automatique.
- Les deux préventions précédentes étaient ciblées (lecture de `session.role`, routes véhicule) et ne couvraient pas les écritures des autres routeurs.
- Classification : contrôle d'accès vertical manquant ; 3e occurrence de la classe « garde au montage trop large ».

### Résolution
- `authorize([...MISSION_MANAGER_ROLES])` sur `PATCH /:id` ; listes de rôles dérivées de `MISSION_MANAGER_ROLES` (serveur, client, test).
- Lot 2 (après #131) : `POST /` réservé aux gestionnaires, `PUT /:id/status` aux gestionnaires et au chauffeur affecté (constante `MISSION_STATUS_ROLES`, cloison `router.param("id")`), `from-fuel` réservé aux gestionnaires.

### Prévention (vérifiable)
- Contrôle renforcé exigé par la récidive : `tests/unit/server/write-route-guards.test.ts`. Toute route `post|put|patch|delete` de `server/api/` doit déclarer `authorize(...)` ou un middleware `isXxx` sur sa déclaration ; les 45 routes existantes sans garde sont gelées dans `write-route-guards.frozen.ts`, la liste ne peut que diminuer. Prouvé par mutation : retirer la garde de `PATCH /missions/:id` fait échouer le test.
- Contrat `tests/contract/mission-patch-roles.contract.test.ts` : les rôles refusés sont dérivés de `ALL_APP_ROLES`, un rôle ajouté au schéma est testé d'office.

### Règle Projet (obligatoire)
- Une route d'écriture déclare ses rôles sur la route elle-même, même si le montage filtre déjà. Une garde de montage n'est qu'un plancher.

## 2026-11-03 - Fusion poussée avec des marqueurs de conflit (#142)

### Constat
- La fusion de `main` dans la branche de #142 (95fcdfe) a été commitée puis poussée alors que `server/services/preventive-maintenance-service.ts` contenait encore des marqueurs `<<<<<<<` / `>>>>>>>`. De plus, le bloc de test « rattrapage » était tronqué par une résolution faite au `sed`.
- Le défaut a été détecté localement, après le push : `tsc` (15 erreurs TS1185) et Vitest (« no tests »). Il a été corrigé par 4aec821, avant toute relecture ou fusion.

### Cause racine
- Seul le fichier signalé en premier (le test) a été résolu. Le second fichier en conflit n'a pas été vu : la sortie de `git status` était tronquée (`head -3`), et le commit de fusion a été fait avant le contrôle de compilation.
- Classification : near miss, processus de fusion. Aucun impact sur `main`.

### Résolution (4aec821)
- Les deux fichiers reprennent leur version d'avant la fusion. Cette version égale celle de `main` (#140 squashée) plus le rattrapage, ce qui est vérifié par `git diff 0faba1e origin/main`.

### Prévention (vérifiable)
- Avant tout commit de fusion : `git diff --name-only --diff-filter=U` doit être vide, puis `npm run check` doit être à 0.
- Gardes existantes :
  - Le job CI `typecheck` attrape les marqueurs dans un `.ts` / `.tsx` (TS1185).
  - Un `.json` mal formé casse l'installation ou le build.
- Garde manquante :
  - Aucun contrôle automatique pour un `.md`, un `.sql` ou un `.yml`. Un marqueur dans `docs/` ou dans une migration passerait la CI.
  - Candidat backlog : un test unitaire d'hygiène qui refuse `^(<{7}|>{7}|={7})( |$)` dans les fichiers suivis (hors `node_modules`), sur le modèle de `routes-hygiene.test.ts`.

### Règle Projet (obligatoire)
- Pas de commit de fusion tant que `git diff --name-only --diff-filter=U` n'est pas vide de sortie.
- Lire la liste complète des fichiers en conflit, jamais une sortie tronquée.

## 2026-11-03 - Une garde de route ne remplace pas une matrice rôle × transition (#141)

### Constat
- Le lot 2 des missions (#141) ouvre `PUT /api/missions/:id/status` aux gestionnaires et au chauffeur affecté (`MISSION_STATUS_ROLES`).
- La relecture a montré que le chauffeur pouvait **annuler** ou **clôturer** une mission. La garde vérifiait seulement que le rôle avait accès à la route, jamais la transition demandée.

### Cause racine
- Un même endpoint porte plusieurs transitions métier, et la garde de route répond à « ce rôle peut-il appeler la route ? ». La question réelle est « ce rôle peut-il faire **cette** transition ? ».
- Le contrat de la PR testait les gestionnaires sur `assigned -> cancelled`, mais pas le chauffeur sur les transitions qui lui sont interdites.
- Classification : contrôle d'accès vertical incomplet. C'est une variante de « garde au montage trop large » (#129), déplacée de la route vers la transition.

### Résolution
- Correctif sur #141 : 6c1c56f, fusionné dans `main` par 262b4a9.
  - `shared/constants/roles.ts` reçoit `DRIVER_MISSION_STATUS_TARGETS` (`in_progress`, `delivered`) et `canRoleSetMissionStatus(role, targetStatus)`.
  - La route consulte cette fonction pour chaque statut visé.
  - Le chauffeur affecté peut démarrer et livrer. Clôturer (`completed`, qui écrit le coût réel) et annuler restent aux gestionnaires.
  - Contrats ajoutés : `mission-lot2-roles` et `mission-from-fuel-roles`.

### Prévention (vérifiable)
- Un contrat par rôle et par transition interdite : pour chaque rôle de `MISSION_STATUS_ROLES` et chaque transition hors de sa liste, la réponse attendue est 403 `ApiErrorBody`, avec le statut en base inchangé.
- Les cas sont dérivés de la matrice elle-même, pas d'une liste écrite à la main. Une transition ajoutée sera ainsi testée d'office.

### Règle Projet (obligatoire)
- Une route qui change un statut contrôle le couple (rôle, transition), pas seulement le rôle.
- La matrice des transitions par rôle vit dans une constante partagée, consommée par le serveur et par le contrat.

## 2026-11-03 - « Aujourd'hui » compté de trois façons : jour J et fuseau des échéances (P3-2 lot 2b)

### Constat
- Pour une même échéance, le service de documentation, l'éligibilité mission et les alertes ne répondaient pas pareil : le jour J était « valide » ici, « expiré » là, et la date du jour était tantôt UTC (`toISOString`), tantôt locale (`getDate`). À 23:30Z (00:30 à Douala), une assurance échéant le lendemain bloquait l'un et pas l'autre.

### Cause racine
- La règle « qu'est-ce qu'un document expiré » et « quel est le jour courant » était recopiée dans chaque module (comparaisons `<` / `<=`, accesseurs locaux ou UTC), sans source unique ni test croisant les chemins.
- Classification : règle métier dupliquée, dérive silencieuse entre copies.

### Résolution
- Source unique `shared/constants/expiry-day.ts` (jour J expiré, `isExpiredOn`) bâtie sur `shared/lib/utc-day.ts` (`utcDateOnly`, `todayUtcDateOnly`) : la date du jour est la date UTC partout (service, éligibilité, statistiques, alertes, lancement de mission).
- Décalage accepté (décision produit) : le jour change à minuit UTC, soit 01:00 à Douala. De 00:00 à 01:00 à Douala, le jour J est encore la veille.

### Prévention (vérifiable)
- `tests/unit/server/document-expiry-day-j.test.ts` : temps figé à 23:30Z le 3/11 (expiré nulle part) et 00:00Z le 4/11 (expiré partout), sous `TZ=Africa/Douala` et `TZ=UTC`, sur les cinq chemins. Rouge démontré avec les anciens fichiers de production.

### Règle Projet (obligatoire)
- Une règle d'échéance et la date du jour passent par `shared/constants/expiry-day.ts`. Jamais de `new Date().toISOString().slice(0, 10)` ni d'accesseur local (`getDate`, `getFullYear`) pour comparer une échéance.

## 2026-11-03 - Portée temps réel fermée par défaut

### Constat
- Trois fuites de diffusion WebSocket vers des clients, corrigées une à une : #53, #127, et #151 (renouvellement de documents, pas encore fusionnée). Chaque fois, un événement destiné à une portée rôle ou nominative atteignait tous les comptes connectés, clients compris.

### Cause racine
- `normalizeScope` (`server/index.ts`) retombait en `broadcast` global dès que la portée était invalide : `userIds` vide ou contenant `null`, `roles` vide, objet sans cible, portée absente sans 3e argument. Une portée calculée qui se retrouvait vide (compte sans id, liste de rôles filtrée) partait donc à tout le monde. Le défaut était ouvert ; chaque appelant devait penser à fermer.
- Classification : défaut de sécurité par défaut ouvert (échec silencieux vers le plus permissif), répété trois fois.

### Résolution
- Règle extraite dans `server/lib/realtime-scope.ts` (module pur : `normalizeScope`, `resolveRecipients`). Portée absente ou invalide : aucun destinataire, avertissement `moduleLogger("websocket")` avec l'événement, l'entité et la forme de la portée, sans identifiant ni rôle. Le broadcast ne part que par `scope: { type: "broadcast" }`.
- Les 22 appels sans portée, soit 20 points d'émission (OT, demandes de pièce, lignes de travail, réception de pièces) reposaient sur le repli : rendus explicites à l'identique (broadcast), donc listés et justifiés dans le test d'hygiène. Restreindre ces événements est une décision produit à part.

### Prévention (vérifiable)
- `tests/unit/server/realtime-scope.test.ts` : rôle, userId, combinaison, portée invalide sans destinataire (15 formes), broadcast explicite, client tiers jamais atteint. Rouge démontré sur la règle copiée de main (16 échecs sur 23).
- `tests/unit/server/broadcast-hygiene.test.ts` : gèle les `type: "broadcast"` de `server/` (fichier et nombre, justification par entrée). Échoue sur tout ajout (« utiliser une portée rôle/user ; un broadcast doit être ajouté à la liste avec justification ») et sur toute entrée devenue fausse : la liste ne peut que rétrécir.

### Règle Projet (obligatoire)
- Fermé par défaut pour toute diffusion : une cible absente, vide ou invalide n'envoie rien et se journalise ; l'ouverture à tous se demande par écrit. Un événement multi-profils choisit une portée rôle ou nominative ; un nouveau broadcast s'ajoute à la liste gelée avec sa justification.

## 2026-11-03 - e2e intermittent : titre de toast dupliqué par l'annonce aria-live (DRV2-1)

### Constat
- `e2e/19-driver-space.spec.ts`, DRV2-1 (« la déclaration de panne du chauffeur est acceptée ») : rouge une fois sur trois environ, vert au rejeu isolé. Classé « instable » le 3/11 sans cause, rouge non reproduit sur 14 passages.
- Reproduit avec trace sur Postgres local : le POST de la panne rend 201, le toast est affiché, puis `strict mode violation: getByText('Problème signalé') resolved to 2 elements`.

### Cause racine
- Le Toast Radix annonce son contenu dans un `<span role="status" aria-live>` passager (« Notification Problème signalé… »). Si l'assertion tombe dans cette fenêtre, `getByText` sans `exact` (correspondance par sous-chaîne) trouve le titre et l'annonce.
- Classification : localisateur de test ambigu, dépendant du temps. Pas un défaut du produit.
- Near miss pendant le diagnostic : `response.text()` sur une réponse passée par le service worker PWA ne rend jamais la main (test bloqué jusqu'au timeout de 180 s, sur un 201).

### Résolution
- `getByText("Problème signalé", { exact: true })`. Le corps de la réponse n'est lu qu'en échec, borné à 5 s, et figure dans le message d'assertion.

### Prévention (vérifiable)
- `tests/unit/e2e/toast-title-exact-hygiene.test.ts` : tout `getByText("<titre>")` d'un e2e dont le texte est un titre littéral de `toast({ title })` du client doit porter `{ exact: true }`. Rouge démontré sur la spec 19 d'origine.

### Règle Projet (obligatoire)
- Un e2e affirme le titre d'un toast avec `{ exact: true }` (ou par rôle dans la région « Notifications »). Un rouge intermittent se qualifie avec une trace (`--repeat-each`, `trace: retain-on-failure`) avant d'être classé « instable ».
- Ne jamais lire `response.text()` / `body()` sans borne dans un e2e : l'app a un service worker.

## 2026-11-03 - Near miss : suite de contrat lancée avec `--env-file=.env` (base de production)

### Constat
- Un agent a lancé les tests de contrat avec `--env-file=.env`. Le `.env` racine porte `DATABASE_URL` vers la base Neon de production. Aucune écriture n'a eu lieu, par chance : `DATABASE_URL_TEST` était fourni.

### Cause racine
- Les scripts `test:integration` et `test:contract` chargeaient eux-mêmes `.env` (`node --env-file=.env`). `tests/support/setup-db.ts` retombait sur `DATABASE_URL` quand `DATABASE_URL_TEST` manquait. La seule garde reconnaissait un unique hôte de production codé en dur (`ep-bitter-term-ai6i3ey4`). `server/db.ts` donne en plus priorité à `DATABASE_URL_LISTENER` et `DATABASE_URL_DIRECT` pour la connexion d'écoute. Les unitaires n'avaient aucun setup.
- Classification : garde-fou incomplet (repli implicite vers la base de développement, marqueur codé en dur). Pas de défaut du produit.

### Résolution
- `e2e/helpers/production-guard.ts` : `assertSafeTestDatabase` (intégration, contrat) refuse (a) `DATABASE_URL`, `DATABASE_URL_LISTENER` ou `DATABASE_URL_DIRECT` différent de `DATABASE_URL_TEST`, (b) `DATABASE_URL_TEST` absent, sans repli, (c) un hôte de `TEST_DB_FORBIDDEN_HOSTS` / `E2E_PRODUCTION_DB_MARKERS` ou tout `*.neon.tech` sauf `ALLOW_NEON_TEST_DB=1`. `assertUnitDatabaseNotProduction` couvre les unitaires (`tests/support/setup-unit.ts`). Les messages n'affichent que l'hôte.
- Les scripts `test:integration` et `test:contract` ne chargent plus `.env`.

### Prévention (vérifiable)
- `tests/unit/server/test-db-guard.test.ts` : chaque refus (a, b, c), le cas local accepté, l'absence de mot de passe dans les messages, et le câblage (setup-db, setup-unit, scripts sans `--env-file`). Rouge sur le code d'avant, vert après.

### Règle Projet (obligatoire)
- Ne jamais charger le `.env` de production dans un lanceur de tests. Les suites reçoivent `DATABASE_URL_TEST` par variable d'environnement, jamais par repli sur `DATABASE_URL`.

### Forme générale de la leçon
- **Pas de repli implicite vers une base (ou une ressource) plus privilégiée.** Une valeur manquante se traduit par un refus explicite, pas par la valeur voisine disponible.
- **Refuser par défaut plutôt que par liste noire.** Un marqueur d'hôte interdit (liste noire) ne couvre que ce qu'on a pensé à nommer : l'URL illisible, le second hôte (`_LISTENER`, `_DIRECT`), l'autre branche Neon passaient. La garde exige ici une base de test explicite, identique pour toutes les variables, et traite tout ce qu'elle ne sait pas lire comme interdit. La liste noire n'est qu'une ceinture en plus.
- **Un message d'erreur est une sortie : ne jamais y recopier une entrée non vérifiée.** L'ancien extracteur d'hôte découpait l'URL à la main et citait un morceau de mot de passe quand celui-ci contenait `#` ou `/` ; l'hôte est maintenant lu par `new URL`, et « hôte illisible » remplace tout doute (`tests/unit/server/test-db-guard.test.ts`).

---

## 2026-11-03 — Carte carburant : contrôle du solde hors transaction (course check-then-act)

### Contexte
- Constat de fleet-securite : `recordConsumption` lisait le solde, le comparait au coût, puis insérait le débit, en trois allers-retours indépendants. Trois pleins simultanés de 600 FCFA sur un solde de 1 000 passaient tous (solde final −800).

### Cause racine
- Le solde n'est stocké nulle part : c'est `SUM(credit_amount) − SUM(debit_amount)` sur `fuel_records`. Il n'y a donc ni ligne à verrouiller (`SELECT … FOR UPDATE`) ni colonne à décrémenter par `UPDATE … WHERE balance >= montant`.
- Classification : course de concurrence (check-then-act) sur un agrégat dérivé. Un `CHECK (balance >= 0)` sur la colonne `fuel_records.balance` n'aurait rien empêché : cette colonne est un instantané, et chaque écriture concurrente y aurait mis un instantané positif mais faux.

### Résolution
- Contrôle et débit dans une même transaction, sérialisés par `pg_advisory_xact_lock(hashtext('fleetmaster_fuel_card'))`. La recharge prend le même verrou, pour que l'instantané `balance` de chaque ligne reste juste. Le 409 `INSUFFICIENT_BALANCE` reste le contrat.

### Prévention (vérifiable)
- `tests/integration/fuel-card-service.test.ts` « pleins simultanés… » : solde ramené à 1 000, trois pleins de 600 en parallèle, un seul passe et le solde final vaut 400. Rouge démontré avant la correction (3 réussites sur 3).

### Règle Projet (obligatoire)
- Tout contrôle de solde ou de stock suivi d'une écriture se fait dans une transaction avec un verrou (ligne, ou verrou consultatif si la valeur est un agrégat). Pour la carte carburant : toute écriture touchant `debit_amount` / `credit_amount`, suppression comprise, prend `lockFuelCard` dans sa transaction (source unique `server/lib/fuel-card-lock.ts` ; couverts depuis le 3/11 : `fuel-card-service` débit et recharge, `fuel-service` création, modification et suppression d'un plein, `DELETE /api/fuel-records/:id` sorti vers `server/api/fuel-records.routes.ts`. La validation d'un bon (`fuel-voucher-service`) ne touche pas aux montants. Une écriture liée à un débit, comme le journal de régularisation d'une mission, passe par `recordConsumption(data, withinTransaction)` pour partager sa transaction ; preuve : `tests/integration/fuel-card-lock-coverage.test.ts`, qui tient le verrou et vérifie que l'écriture attend). Un test de concurrence en est la preuve. Il ouvre les connexions du pool d'avance, sinon l'ouverture de connexion étale les appels et masque la course.

## 2026-11-03 — Tests d'hygiène rouges par intermittence sous charge

### Contexte
- `conflict-markers`, `role-labels`, `toast-title-exact-hygiene` et `part-requirement-labels-hygiene` échouaient par intermittence dans `npm test` complet et passaient seuls (constat aa).

### Cause racine
- Lectures synchrones de 700 à 1 800 fichiers, chacun avec son propre parcours (`readdirSync` et `statSync` par entrée). Certains fichiers relisaient les mêmes sources deux fois. Sur une machine chargée (suite parallèle, antivirus, autres sessions), ce test prenait de 1,3 à 10,9 s, même lancé seul, contre un timeout Vitest de 5 s par défaut.
- Classification : test lié au temps, pas un défaut du produit.

### Résolution
- `tests/support/repo-files.ts` : une seule liste `git ls-files` par worker (fichiers suivis et non suivis non ignorés, donc ni `node_modules` ni jonctions), des lectures asynchrones mémorisées, et `REPO_SCAN_TIMEOUT_MS` (60 s) explicite et justifié. Les quatre tests passent par ce module.

### Prévention (vérifiable)
- `npm test` complet ×5 : 1687/1687 à chaque passe. Gardes toujours actifs : un fichier non suivi planté (marqueur de conflit, `getRoleLabel`, libellé interdit, `getByText` de toast) fait échouer les cinq tests concernés.

### Règle Projet (obligatoire)
- Un test qui lit le dépôt passe par `tests/support/repo-files.ts` et déclare `REPO_SCAN_TIMEOUT_MS`. Pas de `readdirSync` récursif dans un test.

## 2026-11-03 - Lectures GET ouvertes au client : trois récidives, une garde qui se laissait tromper

### Constat
- Après #157 (lectures d'OT) et #163 (statistiques, rotations de pneus), un client lisait encore les pleins de carburant de toute la flotte (`GET /api/fuel-records`, `/statistics`, `/consumption-history`), le stock, les prix, les factures fournisseur et les KPI de flotte. Toutes ces routes étaient gardées par `authenticate` seul, qui ne connaît pas le rôle. Un id d'OT hors entier 32 bits sur `GET /api/work-orders/:id` donnait un 500, après avoir journalisé l'OT entier avant le contrôle d'accès.

### Cause racine
- Deux chemins vers la même donnée : #157 et #163 ont fermé la lecture par OT, pas la lecture par véhicule ni les agrégats. La prévention de #163 ne visait que les chemins `work-orders/:`, donc ne voyait rien ailleurs (récidive de la leçon du 2026-10-30 : la cloison se faisait route par route, sur une liste écrite à la main).
- La garde elle-même était contournable : un handler `async function (req, res)` ou un commentaire citant `assertWorkOrderReadable` suffisait, `isAnyUserX` passait par son préfixe, `isWorkflowDocumentWriter` (qui admet `client`) comptait comme garde de rôle, et un contrôle placé après l'envoi de la donnée était accepté.
- Classification : contrôle d'accès horizontal manquant (IDOR), récidive ; faux négatifs de la garde statique. Répétition : contrôle renforcé ci-dessous.

### Résolution
- `server/routes.ts` : carburant cloisonné sur les véhicules du client (`canAccessOwned`, `ownerScopeOf`), car l'écran client lit `/statistics` et `/api/statistics/fleet` ; données internes (pièces, factures, KPI, maintenance planifiée) en `isStaff` ; `GET /api/work-orders/:id` et `/api/parts/:id/*` refusent un id hors plage par un 400 ; le contenu de l'OT n'est plus journalisé.

### Prévention (vérifiable)
- `tests/support/route-guard-scan.ts` + `tests/unit/server/routes-hygiene.test.ts` : le scan classe les gardes d'après `server/middleware/auth.ts` (rôles réels, pas une liste écrite à la main), retire les commentaires, coupe l'en-tête au premier `async` / `function` / `(req`, exige le contrôle avant le premier envoi de donnée, juge les GET de `server/` portant une garde reconnue (`authenticate`, `is*` d'`auth.ts`, `guardBy*`, `garde*`, `authorize([...])` en ligne), routeurs montés sous `/work-orders` compris, et refuse toute lecture ouverte hors liste gelée (55 entrées à traiter, elle ne peut que rétrécir). Un cas négatif par contournement connu.
- Limites connues : une garde locale à un fichier (`const readers = authorize([...])`) ou nommée hors `is*` / `guardBy*` / `garde*` (`canAccessBilling`, `viewers`, `requireSession`) n'est pas classée, la route est vue comme publique et n'est pas jugée ; un `authorize([...])` posé au montage (`part-scans`) n'est pas lu ; un spread en ligne non résolu (`authorize([...X])`) est présumé restrictif ; le contrôle « avant l'envoi » est une position textuelle, pas un flux. Le durcissement en échec fermé suit au lot A4.
- Contrat `tests/contract/client-read-scope.contract.test.ts` (40 cas) : rouge sur les handlers de main (25 échecs sur 40), vert après.

### Règle Projet (obligatoire)
- Fermer une fuite de lecture, c'est fermer la classe : tous les chemins qui servent la même donnée (par objet, par liste, par agrégat). La garde qui l'empêche de revenir cible la classe des GET, pas la route corrigée, et se prouve par un cas négatif par contournement.

### Suite du 2026-11-03 (lot A4) : la garde passe en échec fermé
- Les limites notées plus haut sont en partie levées. `tests/support/route-guard-scan.ts` ne se fie plus à aucun nom : il classe chaque garde d'après sa source (restrictive, permissive, neutre ; `requireFeature` seul est neutre), tout identifiant inconnu est permissif, donc la route est signalée. Les gardes posées au montage (`apiRouter.use("/x", garde, routeur)`) et au niveau du routeur sont lues, et un garde de montage masque bien les GET de `routes.ts` sous le même préfixe. Une déclaration non analysable (`router.get(path, ...)` de `exports.routes.ts`) est comptée à part (`UNANALYSABLE_FROZEN`, 1 entrée justifiée), jamais ignorée. Une garde locale qui n'a pas de nom reconnu ne rend plus la route « publique » : elle est jugée.
- Limites restantes, sans motif présent dans `server/` à ce jour : alias d'import (`isAnyUser as isStaff`), redéfinition locale d'un nom de garde, `router.use(garde)` placé après la route (ordre non lu), répartiteur dont le corps appelle `next()` nu, marqueur cité dans une chaîne. Leçon : une garde se classe par sa définition résolue et sa position, jamais par son nom. Fixtures de contournement en backlog (garde-fous).
- Liste gelée des lectures ouvertes : 55 entrées avant A4, 25 après. Seules sortent les routes prouvées par contrat (pneus, inspections, rotations, catalogue de pannes, carte carburant `/api/fuel-card/*`). Restent, faute de contrat : alertes, workflows, utilisateurs, véhicules, `work-orders/:id` (contrôle de rôle en ligne), `auth/me`, onboarding, renouvellements, drapeaux de fonctionnalités, incidents, paramètres de notification, catalogue de main-d'oeuvre.
- Limite qui subsiste : le scan lit du texte, il ne vérifie pas qu'un contrôle de valeur (`canAccessOwned`, filtre `ownerScopeOf`) porte sur la bonne donnée. Ce point reste couvert par les contrats HTTP (`tests/contract/client-read-scope-tires.contract.test.ts`, 53 cas, rouge sur main puis vert).
- Trouvaille : `getLastInspection` et `getTireRotationDetails` de `tires-service-simplified.ts` étaient des bouchons renvoyant `undefined` ; les routes répondaient donc vide sans erreur. Implémentés.

## 2026-11-03 — Régularisation de plein de mission : un rejeu débitait deux fois

### Contexte
- Suite de la leçon « Carte carburant : contrôle du solde hors transaction ». `POST /api/missions/:id/fuel-records/regularize` débite la carte. Un double clic, ou un nouvel envoi après une coupure réseau, créait un second débit et une seconde entrée au journal de régularisation. Le bouton n'avait pas `useSingleFlightMutate`.
- Deux écritures concurrentes du journal pouvaient aussi s'effacer : `declare-no-refuel` contrôlait « aucun plein » hors verrou, et la transition de statut réécrivait `workflowData` à partir d'une copie lue avant.

### Cause racine
- Classification : écriture d'argent non idempotente (rejeu = nouvelle écriture), et lecture-modification-écriture de `missions.workflowData` sans sérialisation.
- `idempotencyGuard` (en-tête `Idempotency-Key`) n'a pas été repris : il est coupé par défaut (indicateur d'écritures hors ligne) et libère une clé périmée au bout de 60 s, ce qui ne suffit pas pour de l'argent.

### Résolution
- Clé de requête métier `requestKey` (générée par le client à la première tentative, conservée jusqu'au succès) enregistrée dans l'entrée de régularisation, donc atomique avec le débit. `recordConsumption(data, withinTransaction, { replay })` appelle `replay(tx)` sous le verrou de la carte, avant tout contrôle de solde : une entrée trouvée renvoie le plein existant (200, `replayed: true`, pas de diffusion), une même clé avec d'autres valeurs renvoie 409, et un plein supprimé depuis renvoie 409.
- Bouton « Ajouter le plein » envoyé par `useSingleFlightMutate`.
- `declare-no-refuel` relit la mission et contrôle l'absence de plein dans une transaction qui prend `lockFuelCard`.
- La transition de statut n'écrit `workflowData` que si la requête le modifie.

### Exceptions nommées (non couvertes par le verrou)
- `PATCH` budget de mission (`mergeMissionBudgetPlan`) et transition de statut **avec** modification de `workflowData` : lecture-modification-écriture sans verrou. Une entrée de régularisation écrite entre la lecture et l'écriture peut être perdue (le débit, lui, reste). Suite proposée : verrou de ligne `SELECT … FOR UPDATE` sur la mission, ou fusion `jsonb` en SQL.
- Restauration de sauvegarde (`server/routes.ts`, `db.delete(fuelRecords)` puis réinsertion) et suppression d'un véhicule en cascade (`server/storage.ts:937`) : suppressions de pleins hors verrou. Opérations admin rares, qui remplacent ou retirent l'historique entier : un débit concurrent n'y a pas de sens métier.

### Prévention (vérifiable)
- `tests/contract/mission-fuel-regularize-idempotent.contract.test.ts` : double POST simultané avec la même clé = un débit, une entrée, solde −200 ; nouvel envoi séquentiel rejoué ; même clé et autres valeurs = 409 ; clé invalide = 400 ; deux régularisations distinctes simultanées = deux entrées ; `declare-no-refuel` attend le verrou ; déclaration concurrente n'efface pas la régularisation.
- `tests/integration/fuel-card-lock-coverage.test.ts` : le rejeu est lu une seule fois, sous le verrou (`holdsAdvisoryLock`), sans débit ni écriture liée ; un échec de l'écriture liée annule le débit.
- Preuve par mutation, chaque mutant rend la suite rouge : sans rejeu (3 échecs), relecture de la copie périmée de `workflowData` (1), déclaration hors verrou (1), écriture liée hors transaction (2), rejeu avant le verrou (1). Aides partagées : `tests/support/fuel-card-lock.ts`.

### Règle Projet (obligatoire)
- Toute écriture d'argent déclenchée par un bouton porte une clé de requête métier, contrôlée sous le même verrou que l'écriture et enregistrée dans la même transaction. `useSingleFlightMutate` ne protège que du double clic, pas du nouvel envoi après coupure.
- Un écrivain de `workflowData` n'écrit que ce qu'il modifie. Une réécriture complète à partir d'une copie lue plus tôt est une exception nommée dans cette leçon.

## 2026-11-03 — Parc tronqué à 10 véhicules dans les totaux du personnel

### Contexte
- `storage.getVehicles()` pagine avec `limit = 10` par défaut. Sept appels sans argument l'employaient pour « tout le parc » :
  - pleins (`GET /api/fuel-records`), statistiques carburant, historique de consommation, statistiques technicien ;
  - trois contrôles d'alertes (`alert-service` : véhicules, plans de maintenance, consommation).
- Au-delà de 10 véhicules, les totaux du personnel et les alertes ignoraient en silence les plus anciens. Le côté client (`getVehiclesByOwner`) n'était pas touché.

### Cause racine
- Classification : valeur par défaut de pagination reprise par des appelants qui voulaient l'ensemble, sans erreur ni signal.

### Résolution
- `storage.listAllVehicles()` : tout le parc non supprimé, sans pagination, sans repli silencieux sur une liste vide. Les sept appels y passent.
- `getVehicles` garde son contrat paginé pour `GET /api/vehicles`.

### Prévention (vérifiable)
- `tests/unit/server/vehicles-unbounded-hygiene.test.ts` : aucun `getVehicles()` sans argument dans `server/`.
- `tests/integration/storage-list-all-vehicles.test.ts` : le véhicule hors première page est rendu, le supprimé exclu.
- `tests/contract/fuel-staff-whole-fleet.contract.test.ts` : le plein et les statistiques d'un véhicule hors des 10 plus récents sont présents.
- Mutant (retour à `getVehicles()`) : contrat 2/2 rouge, hygiène rouge.

### Règle Projet
- Une lecture « de tout le parc » appelle une méthode sans pagination nommée comme telle, jamais une méthode paginée sans argument.

### Suite du 3 novembre 2026 : exceptions levées, clé obligatoire
- **Budget et statut sous verrou de ligne** : le `PATCH` budget et la transition de statut avec modification relisent `workflowData` par `SELECT … FOR UPDATE` dans une transaction, puis fusionnent leur patch sur cette relecture. L'écriture de l'entrée de régularisation prend le même verrou de ligne. Ordre des verrous fixe : carte carburant puis ligne mission (statut et budget ne prennent que la ligne), donc pas d'interblocage. La première exception nommée ci-dessus est levée ; celle des suppressions admin reste.
- **Clé obligatoire, unique en base** : `fuel_records.request_key` avec index unique `ux_fuel_records_request_key` (migration `20261103_fuel_records_request_key.sql`, jumelle de `FUEL_RECORDS_REQUEST_KEY_SQL` dans `init-database.ts`). Sans clé : 400 « rechargez la page ». Une violation de l'index devient 409. Les régularisations antérieures (clé dans le journal seul) restent rejouables.
- **Plein normal couvert** : `POST /api/missions/:id/fuel-records` suit le même rejeu sous verrou.
- **Comparaison complète** : mission, véhicule, quantité, prix, date, station et notes ou motif. Un écart avec la même clé donne 409.
- **Client** : la clé est remise à zéro au succès, au 409 et à l'annulation. Deux onglets génèrent deux clés : c'est voulu, le verrou de carte sérialise les deux débits et chacun est un plein distinct aux yeux du serveur.
- **Prévention** : contrat (18 tests : course statut, course budget, rejeu après clôture, plein normal double, date/station/motif = 409) et unitaire de schéma (migration = constante, idempotente). Six mutants, tous rouges : statut sur copie périmée, budget sur copie périmée, verrou sans `FOR UPDATE`, station non comparée, plein normal sans rejeu, date non comparée.

### Suite (relecture sécurité) : une issue indéterminée conserve la clé

- **Contexte** : la première version remettait la clé à zéro à la fermeture de la fiche, quelle que soit l’issue de l’envoi.
- **Risque (sécurité, moyen)** : coupure réseau ou 5xx après l’écriture en base, puis le chauffeur ferme la fiche, la rouvre et renvoie. Une clé neuve donne un second débit de la carte. Le rejeu ne protège que si la clé survit à l’incertitude.
- **Règle générale** : une issue indéterminée doit conserver la clé. Seule une issue connue la libère : un succès ou un 4xx. L’annulation explicite ne libère pas une clé incertaine.
- **Résolution** : `client/src/lib/submission-key.ts` (`createSubmissionKeyStore`). La clé est rangée en `sessionStorage` par mission, partagée par la fiche mission et le tableau de bord chauffeur, et survit au rechargement. `isIndeterminateOutcome` couvre le réseau et le 5xx. Sur un 409 ou une issue incertaine, les deux écrans relisent les pleins, la mission et le solde.
- **Autres réserves levées** :
  - les notes comparées sont la seule partie saisie (`buildEnteredFuelNotes`) : une mission dont la destination ou le client a changé ne transforme plus un rejeu en 409 ;
  - l’index unique est posé dans un bloc `DO` qui avale `lock_not_available` et `unique_violation`, avec un avertissement au démarrage, comme `DRIVERS_USER_ID_UNIQUE_SQL` ;
  - un test d’intégration déclenche la vraie violation de `ux_fuel_records_request_key` et attend un 409 sans détail SQL. Il passe par le service sans rejeu, car en HTTP la recherche précède toujours l’insertion sous le verrou de carte.
- **Prévention** : unitaire `tests/unit/client/submission-key.test.ts`. Le mutant « 5xx traité comme connu » le fait échouer (3 tests).
- **Suivi (hors de cette correction)** : le statut de mission est contrôlé avant le verrou. Un plein normal rejoué après la clôture reçoit donc un 400 au lieu du rejeu.

## 2026-11-03 — Écriture de stock jugée suffisante sous `isStaff` au montage (lot A5)

### Contexte
- `POST /api/warehouse/stock-movement` (`server/api/warehouse.routes.ts`) écrit un mouvement d'entrée ou de sortie et met à jour `parts.quantity`. Le routeur est monté sous `isStaff` (`server/api/index.ts`) et la route ne portait que `authenticate` : chauffeur, technicien, secrétaire pouvaient l'appeler. Sa réponse 500 renvoyait `error.message`. Le doublon de `routes.ts` (`isInventoryManager`) était masqué par le routeur monté avant, donc la garde voulue n'était jamais servie.
- Même audit : `GET /api/dashboard/technician-stats` (toute la flotte), `GET /api/users/technicians` (noms du personnel) et `GET /labor-catalog` (barème) ouverts à un client ; `GET /api/vehicles/:id/tires` en 500 sur un id hors plage ; `GET /api/work-orders/:id` avec un contrôle de rôle recopié au lieu du helper `assertWorkOrderReadable`.

### Cause racine
- Classification : garde de rôle métier remplacée par une garde générique de montage. `isStaff` répond « est-ce du personnel », pas « est-ce le magasin » ; elle est posée au niveau du préfixe, donc une route d'écriture ajoutée dessous paraît protégée sans l'être.
- Le doublon masqué de `routes.ts` a entretenu l'illusion : le code lisible portait la bonne garde, le code servi non.

### Résolution
- `isPartsCatalogManager` (admin, warehouse) sur le mouvement de stock. Pas `isStockIssuer` : le chef d'atelier ne sort une pièce que par `POST /api/work-orders/:id/part-requirements/:id/issue` (dérogation motivée, décidée dans le service) ; le technicien demande, le magasinier sort. Aucun écran n'appelle cette route aujourd'hui. Données validées (`assertValidDbId`, quantité finie et positive), erreurs par `AppError`, pièce inconnue en 404, logs migrés vers `moduleLogger`.
- `isTechnician` sur `technician-stats` (aucun écran ne l'appelle), `isStaff` sur `/users/technicians` et `/labor-catalog` (les écrans client désactivent ces requêtes), `assertValidDbId` sur les pneus d'un véhicule, `assertWorkOrderReadable` sur le détail d'OT. Handlers morts `GET /api/vehicles` et `/all` de `routes.ts` supprimés après comparaison avec le routeur qui les masque.

### Prévention (vérifiable)
- `tests/contract/a5-role-guards.contract.test.ts` (45 cas, 19 rouges sur `main`) : refus 403 de chaque rôle non magasin avec stock inchangé, 400 sur données invalides, rôles autorisés en 201/200.
- Liste gelée des lectures ouvertes (`routes-hygiene.test.ts`) réduite de 6 entrées, `KNOWN_AUTHENTICATE_ONLY` de 2, `write-route-guards.frozen.ts` de 1.

### Règle Projet (obligatoire)
- Une écriture d'argent ou de stock porte une garde de rôle métier explicite sur la route (`isPartsCatalogManager`, `isStockIssuer`, `isInventoryManager`…), jamais `isStaff` ou `authenticate` seuls, même si le montage du routeur en pose déjà une.
- Une route déclarée à la fois dans un routeur `server/api/` et dans `routes.ts` : seule la première est servie ; vérifier laquelle porte la garde avant de la juger.

### Récurrence (3 novembre 2026) : débit de la carte carburant
- Même motif : `POST /api/fuel-card/consumption` (écriture d'argent) n'avait aucune garde de route sous `isStaff` ; technicien et chef d'atelier pouvaient débiter la carte de l'entreprise. Aucun écran ne l'appelle (`recordConsumption` du client n'a pas de consommateur ; le chauffeur passe par `POST /api/missions/:id/fuel-records`). Garde posée : `isFuelCardManager` (admin, logistics, secretary), comme `/recharge`.
- Prévention : `fuel-card-routes.contract.test.ts` (403 et solde inchangé pour workshop_manager et technician, rouges sur `main`), entrée retirée de `write-route-guards.frozen.ts`.

### Récurrence (3 novembre 2026, lot carte carburant 2) : les autres écritures du solde
- Le correctif de `/consumption` n'avait pas recensé les autres écritures qui modifient la somme du solde de `fuel_records`. Inventaire : `POST /api/fuel-card/consumption` (gardé), `POST /api/missions/:id/fuel-records` (seulement `isStaff` au montage : technicien, magasinier, chef d'atelier ou direction débitaient la carte ; désormais gestionnaires de mission plus chauffeur affecté), `POST /api/missions/:id/fuel-records/regularize` et `declare-no-refuel` (contrôle de rôle dans le corps du handler, pas en garde de route), `DELETE /api/fuel-records/:id` (encore ouvert, attend une décision métier) et `PATCH` des pleins (PR #205).
- Même lot : le corps de `/consumption` n'avait pas de schéma. Le code d'avant répondait déjà 400 lisible aux corps invalides, y compris `quantity:"abc"` (« La quantité doit être un nombre positif. », par le service) : ni NaN ni 500. Le gain est le schéma Zod, qui renvoie `errors` par champ et reprend les messages d'avant.
- Ordre des contrôles : sur le plein de mission, le contrôle du chauffeur affecté passe avant la comparaison des véhicules, sinon un chauffeur non affecté distingue 400 de 403 et devine le véhicule d'une mission hors de son périmètre.
- Prévention : `tests/contract/fuel-card-write-guards.contract.test.ts` (technician, workshop_manager et warehouse en 403 solde inchangé, chauffeur non affecté en 403, chauffeur affecté et gestionnaires en 201, six corps invalides en 400) ; entrée retirée de `write-route-guards.frozen.ts`.
- Règle : quand on garde une écriture d'argent, lister par grep toutes les routes qui écrivent la même table (`fuelRecords`, `fuel_records`) avant de conclure ; une garde dans le corps du handler ne vaut pas une garde de route.
- Suite (4 novembre 2026, lot A5) : `DELETE /api/fuel-records/:id` est désormais gardé. La route déclare `authorize([...FUEL_CARD_MANAGER_ROLES, "workshop_manager"])` ; le service relit la ligne sous `lockFuelCard` puis tranche : plein qui a mouvementé la carte (`hasMovedFuelCard`) réservé à admin, logistics, secretary (403 au chef d'atelier, rien d'écrit), suppression douce `deleted_at` / `deleted_by` ; plein physique : garde historique (admin, chef d'atelier), suppression définitive ; ligne supprimée : 404, PATCH compris.
- Même lot : une suppression douce n'est complète que si toutes les lectures filtrent `deleted_at`. Le grep de revue a trouvé des lectures arrivées avec `main` sans filtre (statistiques par véhicule, par station, bilan mensuel de `fuel-card-service`, triggers `mission-fuel` et `fuel-alerts`, liste `GET /api/fuel-records` qui passait par `storage.ts`), et le rejeu par `request_key` (`missions.routes.ts`) qui aurait renvoyé une ligne supprimée comme « déjà enregistrée » : il répond maintenant 409.
- Prévention : `tests/contract/fuel-record-soft-delete.contract.test.ts` (10 cas, 7 rouges sur `origin/main`) ; `tests/unit/server/fuel-records-soft-delete-schema.test.ts` (colonnes jumelles migration / init-database, triggers filtrés).

## 2026-11-03 — Deux tests rouges au hasard : un requestId aléatoire, un compteur global

### Contexte
- `part-scans-routes.test.ts` (404 normalisé) a échoué une fois sur `/sql/i` : le corps entier était contrôlé, et le `requestId` tiré par `nanoid(10)` valait « qrSqlREDR7 ».
- FUEL3 (`vehicles-tank-capacity.test.ts`) a échoué sur `n_tup_ins` 132 au lieu de 130 : le test vérifiait l'absence d'écriture au second démarrage à l'aide du compteur `pg_stat_user_tables`. Ce compteur est global à la table, il compte aussi les écritures des fichiers lancés en parallèle, et il est mis à jour en différé.

### Cause racine
L'assertion portait sur une donnée que le test ne contrôle pas : une valeur aléatoire incluse dans le texte contrôlé, et un compteur partagé par toute la base. 50 contrôles de fuite, dans 34 fichiers, suivaient le même motif (`JSON.stringify(x.body)).not.toMatch`). Avec `/i`, n'importe quel mot de trois lettres (sql, NaN…) pouvait sortir.

### Classification
Test non déterministe (flake), sans défaut produit.

### Résolution
- `leakText(body)` (`tests/support/api-error.ts`) retire le `requestId` du texte contrôlé, y compris dans « Référence : … ». `apiErrorProblems` s'en sert aussi.
- FUEL3 compare `xmin` et `md5` des lignes, hors lignes `TEST%` des autres fichiers, plus une sentinelle propre au test.

### Prévention (vérifiable)
- `tests/unit/leak-check-hygiene.test.ts` échoue sur tout `JSON.stringify(<x>.body)).not.toMatch` dans `tests/` ou `e2e/`.
- `part-scans-routes.test.ts` force `X-Request-Id: qrSqlREDR7` : l'ancien contrôle échoue de façon déterministe (mutation prouvée).
- Mutation FUEL3 : `UPDATE vehicles SET brand = brand` au démarrage rend le test rouge.

### Leçon généralisée
Un test ne vérifie que ce qu'il possède. Il faut retirer la part aléatoire avant de comparer, et mesurer ses propres lignes plutôt qu'un compteur partagé.

## 2026-11-03 — Couche 3 : quinze écrans satellites oubliés, une table déclarative

### Contexte
L'e2e P6 a montré que la réception d'une commande fournisseur laissait l'alerte stock bas affichée chez le chef d'atelier jusqu'au rechargement (#177). L'audit qui a suivi a trouvé quatorze autres écarts, dont sept hauts : stock, carburant, tableau de bord de gestion.

### Cause racine
Chaque `case` de `useRealTimeSync.ts` listait ses clés à la main. Un écran de compteur ajouté plus tard n'était rattaché à aucun événement, et `staleTime` (5 min, sans polling) le laissait périmé. Les clés TanStack se comparent élément par élément : `["/api/fuel-card"]` n'atteint pas `["/api/fuel-card/balance"]`.

Classification : oubli de contrat, récidive de la règle des 3 couches (AGENTS.md §2).

### Résolution
`client/src/lib/realtime-satellites.ts` : des groupes d'écrans par fait métier, et une table événement -> groupes, appliquée avant le `switch`. `parts_delivered`, `part_received`, `vehicle_mileage_updated`, `vehicle_maintenance_position_updated` et `work_order_awaiting_parts` sont désormais rafraîchis. L'émission de `alert_created` par ces flux est côté serveur.

### Prévention (vérifiable)
`tests/unit/client/realtime-satellites.test.ts` échoue dans ces cas :
- un événement de stock, d'argent ou de statut émis par le serveur est absent de la table ;
- un événement de stock ou d'argent ne porte pas de groupe de sa famille ;
- un écran satellite (compteur, statistique, tableau de bord) n'est rafraîchi par aucun événement ;
- une clé de groupe n'est posée par aucun écran.

Les listes gelées ne peuvent que diminuer. La preuve par mutation rend la suite rouge : entrée retirée ; groupe de stock remplacé.

### Règle Projet
Un écran de compteur ou de statistique s'inscrit dans un groupe de `realtime-satellites.ts` dans la PR qui le crée.

## 2026-11-03 — Renouvellement rapide : justificatif orphelin, ou supprimé alors que référencé

### Contexte
- `POST /api/document-renewals/quick-renew` reçoit un justificatif par multer, qui l'écrit dans `uploads/` avant le handler.
- Sur main avant #178 :
  - plusieurs refus (404 document, 400 visite technique, 404 et 400 demande) renvoyaient la réponse sans supprimer le fichier, qui restait orphelin ;
  - à l'inverse, un échec de `createAlert` APRÈS l'enregistrement passait par le `catch`, qui supprimait le fichier alors que la demande le référençait déjà. La demande affichait alors une preuve introuvable ;
  - les écritures (échéance, miroir véhicule, levée des alertes, demande) n'étaient pas en transaction : un échec au milieu laissait l'échéance avancée avec une réponse 500 ;
  - le centre agréé était créé avant les contrôles et restait en base même en cas de refus.

### Cause racine
- Classification : cycle de vie d'une ressource externe (un fichier) non lié au commit qui la référence.
- La suppression était écrite au cas par cas, refus par refus, au lieu de découler d'un seul fait : « une écriture validée référence-t-elle le fichier ? ».

### Résolution
- Drapeau `proofRecorded`, posé juste après le `db.transaction` qui écrit la demande. Le `finally` supprime le fichier tant qu'il est faux, quel que soit le chemin de sortie.
- Contrôles de la demande, puis résolution du centre, avant toute écriture. Une seule transaction couvre l'échéance, le miroir, la levée des alertes et la demande (`executor` optionnel sur `syncVehicleDocumentMirror` et `clearDocumentExpiryAlerts`).
- Alertes et diffusions au mieux après le commit : leur échec ne touche plus au fichier.

### Exceptions nommées
- Une coupure après un COMMIT non acquitté fait supprimer un fichier pourtant référencé. Cas théorique, accepté.
- Routes multer de `server/api` (récépissé, règlement fournisseur, dépôt de document véhicule) : revues le 5 novembre 2026, voir l'entrée « Justificatif de règlement fournisseur supprimé après enregistrement ». Hors `server/api`, vérifié le même jour : missions et commandes fournisseur (purchase-orders) n'ont aucune route multer ; `server/middleware/upload.ts` ne sert que ce dépôt de document véhicule ; la seule route multer de `server/routes.ts` (`POST /api/workflows/:sessionId/documents`, gelé) est en `memoryStorage` : `WorkflowDocumentService.saveWorkflowDocument` n'écrit le fichier qu'au moment de l'INSERT et le supprime si celui-ci est refusé. Rien d'autre à revoir selon ce patron.
- Les autres routes multer (récépissé, preuves) : revues le 5 novembre 2026, voir l'entrée « Justificatif de règlement fournisseur supprimé après enregistrement ».

### Prévention (vérifiable)
- `tests/contract/document-quick-renew-proof-lifecycle.contract.test.ts`, 8 cas : chaque refus supprime le fichier sans créer de centre ni avancer l'échéance ; un échec en transaction laisse tout inchangé ; un échec de notification conserve le fichier référencé ; une demande close donne 409.
- Copié sur main (3a7c0e3) : 8 rouges sur 8. Les deux assertions « aucun centre » échouent sans la résolution déplacée.

### Règle Projet (obligatoire)
- Un fichier téléversé n'est conservé qu'une fois qu'une écriture validée le référence. Supprimer dans un `finally` gardé par un drapeau posé après le commit, jamais refus par refus ; les effets de bord après le commit n'y touchent pas.

## 2026-11-03 — Alertes écrites en base sans trame temps réel (couche 2 oubliée, récidive)

### Contexte
- À la réception de pièces, `procurement-service` (`notifyDeliveryReceived` et `notifyPartReceived`) insérait des alertes pour le chef d'atelier et le technicien, sans émettre `alert_created`. La cloche et le toast restaient muets jusqu'au rechargement.
- Le renouvellement de document émettait bien la trame, mais avec une charge imbriquée `{ alert }` alors que `useRealTimeSync` lit une charge à plat : toast vide.
- Ce n'est pas la première fois : la couche 2 des transitions (AGENTS.md §2) avait déjà été oubliée sur d'autres écrans.

### Cause racine
- Classification : contrat implicite non outillé.
- Chaque site écrivait `db.insert(alerts)` puis construisait sa trame à la main, ou l'oubliait. Rien ne liait l'insertion à l'émission, et la forme attendue par le client n'était écrite nulle part côté serveur.
- Un envoi qui levait au milieu de la boucle coupait aussi les trames suivantes et `parts_delivered`.

### Résolution
- Un helper unique, `server/lib/alert-broadcast.ts` (`broadcastAlertCreated`) :
  - charge à plat ;
  - portée nominative, ou repli sur des rôles explicites, jamais de broadcast ;
  - ne lève jamais : un échec est journalisé par alerte.
- Les sites de procurement et de renouvellement passent par lui, avec `.returning()` sur l'insertion.

### Prévention (vérifiable)
- `tests/contract/procurement-alert-realtime.contract.test.ts` vérifie quatre points :
  - la trame est reçue par deux rôles distincts, et non par le magasinier ;
  - toute trame `alert_created` a une portée `user` ;
  - un envoi raté ne coupe pas la suite ;
  - la charge du renouvellement est à plat.
- Rouge sans le correctif : 3 sur 3 pour le lot initial (#180), puis 1 sur 4 pour le try/catch par alerte.
- À venir (backlog de) : un garde d'hygiène qui échoue sur tout `insert(alerts)` d'un fichier qui n'appelle ni `broadcastAlertCreated` ni `alert-service`.

### Règle Projet (obligatoire)
- Toute alerte écrite en base passe par `broadcastAlertCreated` après le commit (ou par `alert-service`, qui le fait). Ne jamais construire une trame `alert_created` à la main.

## 2026-11-03 — Événements d'ordre de travail diffusés à tous les comptes, clients compris

### Contexte
- Les trames d'OT (OT, pièces, demandes de pièce, pont des triggers Postgres) partaient en `scope: { type: "broadcast" }`, rendu explicite lors du passage à la portée fermée. Un client recevait titre, coûts et pièces de l'OT du véhicule d'un autre client.

### Cause racine
- Classification : dette de portée héritée. Le test d'hygiène gelait le comportement (« OT = historique ») sans le corriger ; aucun test ne jouait deux clients propriétaires.

### Résolution
- Portées `workOrderStaffScope` / `workOrderCostScope` (`server/lib/work-order-realtime-scope.ts`) ; le pont LISTEN/NOTIFY (`server/lib/db-event-relay.ts`) envoie `work_order_*` en `workOrderCostScope()` et `vehicle_status_changed` au personnel. Aucune trame d'OT vers un client. Seule exception : le propriétaire du véhicule reçoit une trame réduite `{ vehicleId, status }` de `vehicle_status_changed`, sans acteur (propriétaire lu en une requête ; nul ou lecture en échec, rien n'est envoyé), parce que l'écran client lit `/api/vehicles/:id` et que `useRealTimeSync` l'invalide sur cet événement.

### Prévention (vérifiable)
- `tests/contract/lotB-work-order-scope.contract.test.ts` : deux clients, un chauffeur, du personnel, destinataires résolus par le vrai `resolveRecipients` ; couvre les routes, le pont, incident-service, préventif, lignes de travail, awaiting-parts et procurement.
- `broadcast-hygiene.test.ts` : égalité stricte, les entrées d'OT sont retirées ; tout retour en broadcast échoue.
- `work-order-scope-hygiene.test.ts` : comptes gelés par fichier d'émission ; échoue si une trame qui porte `workOrder`, `partUsed` ou `requirement` n'est pas en `workOrderCostScope()`.

### Règle Projet (obligatoire)
- Un événement qui concerne un objet d'un véhicule part au personnel ; un client ne reçoit une trame que si un écran client l'écoute, réduite aux identifiants et au statut.
- Une trame qui porte l'objet OT (`workOrder`), une demande de pièce (`requirement`) ou une pièce utilisée (`partUsed`) part en `workOrderCostScope()` : titre, coûts et pièces ne vont ni aux clients ni au chauffeur. `workOrderStaffScope()` est réservé aux trames d'identifiants.

### Suite : statut du plein normal relu sous le verrou de ligne

- **Cause** : `POST /api/missions/:id/fuel-records` contrôlait le statut sur une lecture faite avant les verrous. Deux effets : un rejeu après clôture recevait 400 au lieu du plein enregistré, et une clôture concurrente laissait passer un débit sur une mission clôturée.
- **Résolution** : `assertMissionAcceptsFuel(tx)` relit le statut avec `FOR UPDATE` dans la transaction du débit, après le rejeu et avant le solde. Ordre des verrous : carte, puis ligne.
- **Clé incertaine et nouvelle saisie** : la clé incertaine n’est reprise que pour la même saisie (empreinte sans l’heure par défaut). L’empreinte contient le jour du plein, que le serveur compare, mais pas l’heure par défaut : une fiche rouverte le lendemain prend une nouvelle clé au lieu d’un 409. Une saisie corrigée après une issue incertaine (autre quantité, autre prix, autre jour) est une nouvelle intention et prend une nouvelle clé. Si le premier envoi avait abouti, il y a deux pleins : les deux écrans relisent les pleins après une issue incertaine, donc le premier est affiché avant la correction.
- **Prévention** : trois contrats (rejeu après clôture, plein neuf sur mission clôturée, clôture concurrente), dont deux rouges contre main ; unitaires de l’empreinte.

## 2026-11-03 — Mouvement de stock magasin : sortie ramenée à 0 et course de lecture (récidive)

### Contexte
- `POST /api/warehouse/stock-movement` (`stockAlertsService.recordStockMovement`) lisait la pièce hors transaction, puis écrivait le mouvement et le stock dans deux requêtes séparées.
- Une sortie supérieure au stock était ramenée à 0 par `Math.max(0, …)`, et le journal gardait un `newStock` qui ne correspondait pas à la quantité sortie.
- Trois sorties concurrentes de 4 sur un stock de 10 réussissaient toutes, et chacune partait de 10.
- Ce n'est pas la première fois : `POST /api/parts/:id/update-stock` avait le même défaut, corrigé par `partsService.updateStock`.

### Cause racine
- Classification : invariant métier non porté par la base ni par une transaction.
- La correction de `updateStock` n'avait pas été étendue aux autres écrivains de `parts.quantity`.

### Résolution
- Lecture `FOR UPDATE`, insertion du mouvement et mise à jour du stock dans une seule transaction.
- Sortie au-delà du stock : 409 lisible, rien n'est écrit. Pièce absente : 404. Quantité non entière ou nulle : 400.
- La route transmet les erreurs au gestionnaire central (`next`) et ne renvoie plus `error.message`.

### Prévention (vérifiable)
- `tests/contract/warehouse-stock-movement.contract.test.ts` : 409 avec stock et journal intacts, 404, 400 (décimal, hors entier SQL, débordement), trois sorties concurrentes (deux 201, un 409, chaîne previous → new continue), entrées concurrentes additionnées, trame en portée personnel. Rouge sur main sur chaque cas.
- À venir (backlog b7) : recenser tout écrivain de `parts.quantity` hors transaction verrouillée.

### Règle Projet (obligatoire)
- Toute écriture de `parts.quantity` relit la pièce `FOR UPDATE` dans la transaction qui écrit, et refuse en 409 un stock insuffisant. Ne jamais ramener un stock à 0 en silence.

### Prix du carburant : imposé côté serveur, pas seulement à l’écran (2026-11-03)

- **Contexte** : seuls admin et logistique fixent le prix du litre (décision du 31 octobre 2026). L’écran affichait le prix du jour en lecture seule pour les autres rôles, mais trois routes de débit (`POST /api/fuel-card/consumption`, `POST /api/missions/:id/fuel-records` et `/regularize`) prenaient le `unitPrice` du corps de la requête tel quel.
- **Cause racine** : la règle métier vivait dans l’interface seule. Un appel direct à l’API, par un chauffeur ou un secrétaire, débitait la carte au prix choisi par l’appelant.
- **Classification** : contrôle d’accès côté client seulement (argent).
- **Résolution** : `resolveFuelUnitPrice(role, prixEnvoyé, datePlein)` (`server/lib/fuel-unit-price.ts`). Le prix envoyé est retenu si `canWriteFuelPrice(role)`, sinon c’est `getFuelPriceAt(jour du plein)`. Le prix reste obligatoire dans le corps (contrat inchangé). L’empreinte de rejeu compare le prix retenu, donc un prix forgé différent sous la même clé est rejoué, pas refusé.
- **Prévention vérifiable** : `tests/contract/fuel-price-imposed.contract.test.ts`. Sans le contrôle du rôle, quatre cas passent au rouge.
- **Leçon** : une restriction affichée par l’écran (champ en lecture seule, bouton masqué) doit avoir son équivalent dans la route qui écrit. `declare-no-refuel` n’a pas de prix, il n’est pas concerné.
- **Limite connue** : le jour du prix est le jour UTC du plein, alors que l’écran prend le jour local (UTC+1). Cela n’a d’effet qu’entre minuit et 1 h, le jour d’un changement de prix.

## 2026-11-03 — Ajustement de stock rejoué au réessai (idempotence absente, puis clé libérée sur une issue incertaine)

### Contexte
- `POST /api/parts/:id/update-stock` n'était pas protégé : un réessai après une coupure réseau ou un 5xx appliquait l'ajustement une seconde fois.
- La garde d'idempotence existante (`server/middleware/idempotency-guard.ts`) libère la clé quand l'enregistrement de la réponse échoue, et reprend une clé restée « en cours » au bout de 60 s. Pour le stock, ces deux comportements rejouent l'ajustement : le commit a déjà eu lieu.

### Cause racine
- Classification : contrat implicite non outillé (la garde supposait que toute route pouvait être réexécutée une fois l'issue inconnue).
- Les options vivaient au niveau global : drapeau `idempotency`, délai de reprise, libération sur échec. Aucune route ne pouvait dire « une issue inconnue n'est jamais rejouée ».

### Résolution
- Options par route dans `server/lib/idempotency-config.ts` :
  - `keepKeyOnUncertainOutcome` garde la clé si l'enregistrement de la réponse échoue, sur toute 5xx et sur une fin sans JSON. Seuls 401, 403, 408 et 429, qui arrivent avant l'écriture, la libèrent ;
  - `staleSeconds: null` : la clé n'est jamais reprise, seule son expiration la libère ;
  - `ignoreFeatureFlag` : la route est protégée quel que soit le drapeau ;
  - `inProgressMessage` : 409 lisible « vérifiez le stock avant de réessayer ».
- Côté client, `sendWithSubmissionKey` (`client/src/lib/submission-key.ts`) et la portée `partStockKeyScope(id, delta)` :
  - le réessai de la même intention renvoie la même clé ;
  - une nouvelle intention (autre pièce, autre quantité, succès ou refus connu) en prend une nouvelle.
- Les deux écrans d'ajustement (fiche pièce, liste des pièces) envoient l'en-tête. Leurs envois passent par `useSingleFlightMutate`, donc un double clic ne peut pas envoyer deux fois la même clé en vol. Leurs toasts d'erreur affichent `userMessageOf`, c'est-à-dire le texte du 409.
- Compromis assumé, le même que pour le plein carburant : le 409 « vérifiez le stock » est une issue connue, donc il libère la clé côté client. Si la personne passe outre le message et renvoie le même delta, l'envoi part avec une nouvelle clé et ajuste le stock. La clé restée « en cours » côté serveur ne sert plus et n'est jamais purgée avant son expiration : une ligne par incident, sans risque.

### Prévention (vérifiable)
- `tests/contract/parts-update-stock-idempotency.contract.test.ts` :
  - même clé : rejeu, un seul mouvement ;
  - l'enregistrement de la réponse échoue après le commit : le réessai reçoit un 409 sans ajustement et la clé reste « en cours » ;
  - nouvelle clé : l'ajustement s'applique ;
  - sans clé : comportement inchangé.
  - Rouge sans le correctif serveur : 2 sur 4.
- Tests unitaires :
  - `tests/unit/server/idempotency-guard.test.ts` : drapeau coupé, statuts 5xx et 4xx avant écriture, fin sans JSON ;
  - `tests/unit/client/submission-key.test.ts` : même intention, nouvelle intention, en-tête aligné sur le serveur.
- `tests/integration/idempotency-store.test.ts` : `staleSeconds: null` ne reprend jamais une clé en cours.

### Règle Projet (obligatoire)
- Une route qui écrit du stock ou de l'argent et qui n'est pas rejouable sans risque déclare `keepKeyOnUncertainOutcome: true` et `staleSeconds: null`. Le client garde la clé tant que l'issue est inconnue, et change de clé à chaque nouvelle intention.

## 2026-11-03 — Main rouge en unitaire après une PR e2e seule (#194)

### Contexte
- #194 n'ajoutait qu'une spec e2e. Elle contenait `getByText("Erreur carburant")` sans `{ exact: true }`, que refuse la garde `tests/unit/e2e/toast-title-exact-hygiene.test.ts` (#155).
- La CI de la PR, puis celle de main, étaient vertes. Toutes les PR suivantes ont échoué en unitaire.

### Cause racine
- Classification : carte d'impact incomplète (exécution ciblée).
- Dans `.github/appfactory-impact.json`, les surfaces `e2e` et `scripts` n'activaient que `typecheck`. Or des gardes unitaires lisent ces répertoires :
  - les gardes de `tests/unit/e2e/` ;
  - les parcours `repoFiles` de `it-fails-hygiene` et de `leak-check-hygiene`.
- Un changement limité à ces répertoires ne lançait donc pas les tests qui les contrôlent.
- Facteur humain : l'auteur n'avait lancé que tsc, pas la suite unitaire, en se fiant au périmètre « e2e seul ».

### Résolution
- Spec corrigée dans #195 (`exact: true`).
- Les surfaces `e2e` et `scripts` activent aussi `unit`.

### Prévention (vérifiable)
- Les surfaces `e2e` et `scripts` portent maintenant la porte `unit` dans la carte d'impact.

### Règle Projet (obligatoire)
- Un répertoire lu par une garde unitaire déclenche la porte `unit` dans la carte d'impact.
- Quand on ajoute une garde qui lit un nouveau répertoire, on vérifie la surface de ce répertoire.
- En local, `tests/unit` se lance en entier avant toute PR, même limitée à e2e/.

## 2026-11-03 — Fichier de workflow orphelin quand l'enregistrement en base échoue

### Contexte
- `WorkflowDocumentService.saveWorkflowDocument` écrivait le fichier sous `uploads/workflows/<session>/` puis insérait la ligne `workflow_documents`. Un INSERT refusé (workflow supprimé entre-temps, contrainte) laissait le fichier sans ligne.

### Cause racine
- Classification : effet de bord non compensé. Deux écritures (disque, base) sans transaction commune, et aucune compensation de la première quand la seconde échoue.

### Résolution
- L'INSERT échoué supprime le fichier écrit (`fs.rmSync`, `force`), puis l'erreur d'origine remonte. Un échec du ménage est journalisé en `warn`, il ne masque pas l'erreur.

### Prévention (vérifiable)
- `tests/integration/workflow-document-orphan.test.ts` : workflow inexistant -> rejet et dossier de session vide. Rouge sans le correctif.

### Règle Projet (obligatoire)
- Un service qui écrit un fichier avant une ligne en base supprime ce fichier si l'écriture en base échoue. Les autres cas déjà couverts : documents véhicule, récépissé de renouvellement, preuves de règlement fournisseur.

### Carte grise : la check-list de lancement contredisait le lancement (2026-11-03)

- **Contexte** : `GET /api/missions/:id/launch-readiness` déclarait « Carte grise conforme » dès qu’un document existait. Le lancement (`PUT /status` → `in_progress`) refusait pourtant une carte grise expirée. La check-list affichait donc « prêt » pour une mission que le lancement rejetait.
- **Cause racine** : deux règles pour le même papier. `isDocumentTypeValid("carte_grise")` renvoyait `true` sans lire l’échéance ni le récépissé.
- **Résolution** : la check-list applique la règle du lancement. Une carte grise sans date ne bloque pas. Datée, elle bloque dès le jour de l’échéance (jour UTC). Le récépissé « plaque » lève l’échéance dépassée, et le détail le nomme. Les demandes de renouvellement depuis la mission, qui passent par la même fonction, proposent désormais une carte grise expirée.
- **Prévention vérifiable** : `tests/contract/mission-renewal-receipt.contract.test.ts`, bloc « carte grise : préparation alignée sur le lancement ». Sans le correctif, quatre cas passent au rouge.
- **Leçon** : un écran de préparation qui annonce un résultat doit appeler la même règle que l’action qu’il prépare. Reste à aligner : les colonnes miroir de `vehicles`, que le lancement contrôle par `getMissionEligibility` et que la check-list ignore encore.

## 2026-11-03 — La CI tournait sur chaque poussée d'une PR brouillon

### Contexte
- Les sessions ouvrent leurs PR en brouillon et y poussent plusieurs fois avant la relecture. Chaque poussée lançait la CI complète (intégration et contrat en shards sur Postgres), pour des états que personne ne fusionnerait.

### Cause racine
- Classification : déclencheur trop large. `pull_request` sans `types` réagit à `opened`, `synchronize` et `reopened`, brouillon ou non, et ignore `ready_for_review` : un brouillon passé en revue sans nouvelle poussée n'aurait eu aucun run.

### Résolution
- `ci.yml` et `build-android-apk.yml` : `types: [opened, synchronize, reopened, ready_for_review]`, et `if: github.event_name != 'pull_request' || !github.event.pull_request.draft` sur le job d'entrée (`impact`, dont dépendent tous les autres ; `build-android`). Le test explicite sur `event_name` garde le push sur `main` et le dispatch manuel hors de la condition, au lieu de compter sur `null == false`.

### Prévention (vérifiable)
- PR brouillon de test : run aux jobs sautés, aucun job exécuté ; passage en ready : run complet sur le même SHA.

### Règle Projet (obligatoire)
- Un nouveau workflow déclenché par `pull_request` porte les mêmes `types` et la même condition sur son job d'entrée. Un job qui ne dépend pas du job d'entrée doit porter la condition lui-même.

## 2026-11-03 — Le verrou de base de test était facultatif et nommé d'après l'URL

### Contexte
- `fuel-card-routes` (solde global de la carte) échouait par intermittence, même lancé seul sous `lot-tools/db-lock.mjs` : 3 échecs sur 7. Le solde prenait +10 000 entre deux appels, y compris autour d'un 403 qui n'écrit rien.

### Cause racine
- Classification : exclusion mutuelle contournable.
  - `db-lock.mjs` nommait son verrou d'après l'hôte de l'URL : `localhost:54320` et `postgres:5432`, qui désignent la même base locale, prenaient deux verrous différents.
  - Surtout, le verrou était opt-in : toute session qui lançait vitest directement écrivait sans s'exclure.

### Résolution
- `db-lock.mjs`, hors dépôt : clé normalisée par base.
- Dans le dépôt : verrou en base, `pg_advisory_lock(hashtext('fleet-test:' || current_database()))`, pris dans le `globalSetup` des suites intégration et contrat et tenu par une connexion dédiée jusqu'au teardown.
  - Même base, même verrou, sans dépendre de l'URL ni d'un script à penser à lancer.
  - Un crash libère le verrou.

### Prévention (vérifiable)
- `tests/integration/test-db-lock.test.ts` :
  - le passage en cours tient le verrou réel, et une seconde prise expire en nommant le détenteur ;
  - deux prises s'enchaînent ;
  - le délai est configurable.
- Deux passages lancés en même temps : le second affiche « en attente du verrou de test (pid …) » et ne démarre qu'à la fin du premier.

### Règle Projet (obligatoire)
- Une exclusion entre écrivains d'une ressource partagée vit dans la ressource elle-même (verrou en base), pas dans une convention d'appel que chacun doit penser à suivre.

## 2026-11-03 — Une alerte de stock écrite dans la transaction annulait la sortie de stock (quasi-incident)

### Contexte
- `storage.checkAndCreateStockAlerts` créait l'alerte de stock bas avec l'exécuteur de la transaction du mouvement (sortie de stock d'un OT). Constaté en écrivant le test d'intégration de la couche 2 (#202) ; aucun signalement utilisateur.

### Cause racine
- Classification : effet secondaire couplé à la transaction métier. Sous Postgres, une erreur SQL dans une transaction l'empoisonne : un insert d'alerte en échec (contrainte, compte supprimé) faisait annuler le mouvement, donc la sortie de stock. La trame `alert_created` pouvait aussi partir avant un commit qui n'aurait jamais lieu.

### Résolution
- #202 : l'alerte n'est plus écrite dans la transaction. `StockWriteOptions.afterCommit` reçoit l'effet, que l'appelant (`work-order-parts.routes.ts`) exécute après le commit ; hors transaction, l'alerte est créée directement. Un échec de l'alerte est journalisé (`moduleLogger`) sans remonter.

### Prévention (vérifiable)
- `tests/integration/stock-alert-broadcast.test.ts` : un déclencheur qui refuse l'insert d'alerte n'empêche ni la baisse de stock ni le mouvement ; une transaction annulée n'emporte ni alerte ni trame ; rien avant le commit.
- `tests/contract/stock-issue-alert-broadcast.contract.test.ts` : la sortie de stock HTTP réussit et notifie admins et magasiniers seulement.

### Règle Projet (obligatoire)
- Une notification (alerte, trame WebSocket, e-mail) déclenchée par une transition métier s'exécute après le commit, jamais avec l'exécuteur de la transaction. Mouvement en transaction sans `afterCommit` : l'alerte n'est pas créée et un avertissement est journalisé.

## 2026-11-03 — Plein débité de la carte, montants réécrits sans contrepartie

### Contexte
- `PATCH /api/fuel-records/:id` permettait à l'auteur ou à l'admin de changer la quantité, le coût, le véhicule ou la date d'un plein qui avait déjà débité la carte carburant.
- Le solde (somme des `creditAmount` et `debitAmount`) et les litres (somme des `quantity` débitées) ne suivaient pas le coût. La ligne et la carte divergeaient alors en silence.

### Cause racine
- Classification : invariant métier non gardé côté serveur.
- La route était héritée d'un écran de saisie manuelle, qui ne mouvemente pas la carte. Elle n'a pas été revue quand les débits de carte ont été écrits dans la même table.

### Résolution
- `server/lib/fuel-record-ledger-lock.ts` : si `debitAmount` ou `creditAmount` est non nul, un changement réel de ces 4 champs renvoie 409. Le message indique de passer par une régularisation, ou d'annuler le plein puis d'en saisir un nouveau.
- Notes, kilométrage et « plein complet » restent libres.
- Une ré-sauvegarde à l'identique passe : les valeurs sont normalisées, et la date se compare au jour.

### Prévention (vérifiable)
- `tests/unit/server/fuel-record-ledger-lock.test.ts` et le bloc « montants figés » de `tests/contract/fuel-records-and-document-paths.contract.test.ts`. Sans le verrou, 4 cas passent au rouge.

### Règle Projet (obligatoire)
- Une ligne qui entre dans un solde (carte, stock, facture) ne se corrige pas par un PATCH de ses montants. On passe par une écriture de contrepartie, ou par une annulation suivie d'une nouvelle saisie.

## 2026-11-03 — Garde statique des accès disque contournable (near miss, #210)

### Contexte
- `stored-path-hygiene.test.ts` doit vérifier qu'aucun accès disque de `server/` ne prend un chemin lu en base sans le borner à `uploads/` (AGENTS.md §9). Les deux relectures (sécurité, puis relecteur) l'ont jugé vert à tort sur des cas construits pour le contourner.

### Cause racine
- Classification : garde-fou fondé sur la présence de la borne, pas sur son lien avec l'argument.
  - Première version : il suffisait que la borne apparaisse dans le texte de la portée. Un commentaire, une borne sur une autre variable, ou une fonction englobante comme `registerRoutes` suffisaient.
  - Deuxième version : chaîne de dépendances trop large. `const p = req.body.p` héritait d'une garde posée sur `req.query.x`, parce que `req` y apparaissait. `uploadedFileCandidates(p)[0] ?? p` comptait aussi comme borné.

### Résolution
- Le lien est vérifié sur la structure de l'expression (`isBoundExpression`) :
  - résultat d'un appel de borne, ou accès et méthode sur ce résultat ;
  - variable dont toutes les déclarations sont bornées ;
  - variable reçue directement par `isInsideDirectory` ;
  - `??`, `||` et ternaire : chaque branche doit être bornée.
- La destination de `copyFile`, `cp` et `rename` est vérifiée elle aussi. Les alias d'un appel disque sont refusés. Une exception couvre un seul appel.

### Prévention (vérifiable)
- Cas de contournement dans `stored-path-hygiene.test.ts`, rouges avec les règles précédentes : borne sur une autre variable, en commentaire, via `path`, sur un autre champ de `req`, repli `?? p`, destination non bornée, alias.

### Règle Projet (obligatoire)
- Un garde-fou statique se prouve par ses cas de contournement, pas seulement par le code actuel : chaque règle de détection est livrée avec au moins un cas qui doit rester rouge. Ses limites (ici : résultat de la borne ignoré, réaffectation non suivie) sont écrites dans son en-tête.

## 2026-11-03 — Refus de transfert silencieux : document sorti du workflow sans arriver au véhicule (#228)

### Contexte
- `transferDocumentsToVehicle` saute un document dont le fichier source manque ou dont la destination sort du dossier du véhicule. Il marquait ensuite **tous** les documents de la session `isTransferred` : le document refusé disparaissait du workflow sans exister dans `vehicle_documents`.

### Cause racine
- Classification : effet de bord appliqué au lot, pas à l'élément. Le marquage portait sur la session entière, pas sur les ids réellement copiés. Le refus de sécurité ajouté par #210 en a fait une perte silencieuse.
- Corollaire (#231) : le rejeu n'est pas idempotent. Il ne filtre ni `isTransferred = false` ni `workflowId`, si bien qu'un second transfert duplique les lignes.

### Résolution
- Seuls les ids copiés sont marqués (`inArray`). Un refus est journalisé en `warn` avec sa raison. Le rejeu idempotent est suivi dans #231, la reprise des données déjà marquées dans #229.

### Prévention (vérifiable)
- `tests/integration/workflow-document-transfer.test.ts`, cas « fichier source disparu », rouge sans le correctif.
- À livrer avec #231 : le test « second transfert = zéro nouvelle ligne ».

### Règle Projet (obligatoire)
- Un refus laisse l'objet **visible et rejouable** : on ne marque que ce qui a réellement abouti. Le rejeu qui suit doit être idempotent (zéro écriture une fois convergé).

## 2026-11-03 — Route littérale masquée par un `/:id` frère (#222)

### Contexte
- `GET /api/suppliers/summary` répondait par le handler de `GET /api/suppliers/:id` (`id = "summary"`). La déclaration du résumé dans `server/routes.ts` n'était jamais atteinte : le routeur `suppliers.routes.ts` est monté avant `registerRoutes`, et son `/:id` capturait le littéral.

### Cause racine
- Classification : ordre de déclaration Express. Express sert la **première** route qui correspond. Un segment paramétré (`/:id`) déclaré avant un littéral frère (`/summary`) le masque, que les deux soient dans le même routeur ou que le paramétré vienne d'un routeur monté plus tôt.
- Aucun test ne visait la route littérale. Le seul test existant était un témoin `.fails` qui figeait le défaut.

### Résolution
- `/summary` déclaré dans `suppliers.routes.ts` **avant** `/:id`, la déclaration morte de `routes.ts` remplacée par un renvoi. Le témoin est devenu un contrat (200, tableau).

### Prévention (vérifiable)
- `tests/contract/suppliers-summary-capture.contract.test.ts`.
- Garde statique : `tests/unit/server/route-order-hygiene.test.ts` (PR séparée, session b7) reconstitue l'ordre de service (routeurs de `server/api/` dans l'ordre des montages, puis `routes.ts`) et échoue sur tout littéral masqué par un `/:param` déclaré avant lui. Sur le code d'avant #222, il trouve exactement `GET /api/suppliers/summary`.

### Règle Projet (obligatoire)
- Dans un routeur, déclarer les chemins littéraux (`/summary`, `/stats`, `/export`) **avant** le chemin paramétré du même niveau (`/:id`). Pour un littéral déplacé hors de `routes.ts`, vérifier qu'aucun routeur monté plus tôt n'a de `/:param` qui le capture.

## 2026-11-04 — Image Docker jamais construite, et migrations sautées sans erreur (near miss, #242 → #247)

### Contexte
- Le kit de déploiement de #242 n'avait jamais été construit pour de vrai. Au premier `docker compose build` (kit serveur de site, #247), quatre défauts sont apparus d'un coup :
  - `.dockerignore` excluait `attached_assets`, que l'écran de connexion importe : le build vite échouait ;
  - l'étape runtime ne copiait ni `server/db/migrations` ni `server/db/triggers` ;
  - `npm start` passait par `cross-env`, une dépendance de développement ;
  - avec `--omit=dev`, `dist/index.js` ne trouvait plus `vite`, qu'il importe statiquement.

### Cause racine
- Classification : livraison non prouvée, plus un échec silencieux. Le kit avait été relu, mais jamais exécuté.
- `applyMigrationSqlFiles` d'`init-database` faisait un `return` quand le dossier des migrations manquait. Une image incomplète aurait donc démarré, healthcheck vert, sur une base à laquelle il manquait colonnes et triggers. Personne ne l'aurait vu avant un écran en erreur.

### Résolution
- `init-database` lève une erreur si le dossier des migrations est absent, et le démarrage s'arrête. Les triggers échouaient déjà, par `readFile`.
- Le Dockerfile copie les migrations, les triggers et l'en-tête TAY, et lance `node dist/index.js`. `attached_assets` reste dans le contexte de build.
- Preuve réelle :
  - build, `docker compose --profile site up` et connexion par l'IP du LAN ;
  - un second `up` sans écriture ;
  - une sauvegarde et restauration `pg_dump` qui annule une modification.

### Prévention (vérifiable)
- `tests/unit/deploy/dockerfile-runtime.test.ts` vérifie que l'étape runtime copie migrations, triggers et en-tête, que `.dockerignore` n'exclut aucun dossier lu au build ou au démarrage, et que le conteneur démarre sans `cross-env`.

### Règle Projet (obligatoire)
- Un kit de déploiement n'est pas livré tant qu'il n'a pas été **construit et démarré pour de vrai** (build, `up`, connexion). Une relecture ne suffit pas.
- Une étape de démarrage qui ne trouve pas ce qu'elle doit appliquer **échoue**. Elle ne saute pas l'étape. Un saut volontaire se journalise en erreur, jamais en silence.

## 2026-11-03 — Une table sans contrainte d'unicité, un code qui suppose « une seule ligne » (#227)

### Contexte
- `assignments` n'a aucune unicité sur `mission_id` : la base accepte plusieurs chauffeurs par mission. Le code, lui, lisait « l'» affectation par `limit(1)` sans ordre, par `leftJoin` ou par `one(assignments)`.

### Cause racine
- Hypothèse d'unicité écrite seulement dans le code, jamais dans le schéma ni dans un test : tant qu'aucune mission n'avait deux lignes, tout passait.
- Conséquences observées dès qu'une seconde ligne existe : un chauffeur autorisé recevait 403 (le contrôle ne portait que sur la première ligne lue), une mission apparaissait deux fois dans les listes, le contrôle du véhicule dépendait de l'ordre de lecture.

### Résolution
- Règle d'autorisation lue sur l'ensemble des lignes, factorisée dans `server/lib/driver-scope.ts` ; lectures qui restent à valeur unique rendues déterministes (`orderBy`) ; jointures dédupliquées.

### Prévention (vérifiable)
- Contrat à deux chauffeurs sur une même mission (`fuel-card-write-guards.contract.test.ts`) : deux saisies acceptées, véhicule d'un autre chauffeur refusé, chauffeur hors mission et affectation annulée en 403, aucune mission dupliquée dans les listes d'opérations.

### Règle Projet (obligatoire)
- Toute lecture « une ligne par X » sur une relation que le schéma n'a pas bornée à un (`limit(1)`, `[0]`, `leftJoin` puis `.map`) est soit ordonnée et justifiée en commentaire, soit remplacée par une lecture sur l'ensemble. Décider si la relation est bien 1-1 ; si oui, le dire dans le schéma (contrainte), sinon le code doit supporter N.

## 2026-11-03 — Cliquet T1 : exclusion par nom contournée par alias, et liste négative (NO-GO n°2 et n°3, #235)

### Contexte
- Le cliquet T1 (`tests/unit/server/write-routes-ratchet.test.ts`) vérifie que chaque route d'écriture porte une garde de rôle. Deux relectures successives de #235 ont refusé la fusion.
  - NO-GO n°2 : le scanner refusait une liste de noms connus pour ne pas être des gardes (`authenticate`, `isAnyUser`...). Tout middleware absent de cette liste comptait comme garde : un alias `anyone`, un tableau `[isAnyUser]` ou un spread passaient.
  - NO-GO n°3 : la liste était devenue positive, mais `authorize([...])` sur place restait admis sauf s'il contenait le NOM `ALL_ROLES`. `authorize([...ALL_APP_ROLES])`, ou un alias local de tous les rôles, comptait comme garde alors qu'il vaut `isAnyUser`.

### Cause racine
- Classification : règle de sécurité appuyée sur un nom plutôt que sur une valeur.
  - Une liste négative ne contient que ce qu'on a pensé à refuser.
  - Une exclusion sur le nom d'une constante se contourne par une autre constante de même valeur, ou par un alias.
- Aggravant : selfScoped, une garde « tous rôles, compte de session seul », vérifiée par analyse du handler, a ouvert une surface d'analyse que chaque relecture trouvait contournable. Aucune route n'en avait encore besoin.

### Résolution
- Le scanner résout l'ensemble de rôles par valeur (`resolveRoles`). Il suit les littéraux, les spreads, les constantes locales et les alias, puis les exports de `shared/constants/roles`.
- `authorize(...)` n'est une garde que si cet ensemble exclut au moins un rôle de `ALL_APP_ROLES`. Un ensemble non résolu ne compte pas comme garde.
- La règle vaut pour :
  - `authorize` écrit sur place ;
  - les exports `is*` de `auth.ts` (`isAnyUser` est écarté par sa valeur) ;
  - les gardes locales et les gardes de montage, jugées sur leur définition dans leur fichier.
- selfScoped est retiré de la PR (YAGNI). Il fera l'objet d'une PR dédiée.

### Prévention (vérifiable)
- Cas rouges dans `write-routes-ratchet.test.ts` :
  - `authorize([...ALL_APP_ROLES])`, `authorize(ALL_APP_ROLES)` ;
  - alias local de tous les rôles, `[...STAFF_ROLES, "client"]`, ensemble non résolu ;
  - garde locale définie par `authorize([...ALL_APP_ROLES])` ou par `isAnyUser` ;
  - garde de montage sur tous les rôles ;
  - nom listé mais non défini dans son fichier.

### Règle Projet (obligatoire)
- Un contrôle d'accès se juge sur la valeur résolue, jamais sur le nom d'une constante.
- Une liste de gardes est positive : ce qui n'est pas reconnu ne protège pas.
- Une garde dont la validité dépend d'une analyse du handler n'entre qu'avec une route qui en a besoin, dans une PR dédiée.
- Un scanner de gardes se fonde sur l'origine du symbole (import résolu, définition unique et non mutée) et sur le source débarrassé de ses commentaires, jamais sur un nom. Écarts restants de ce scanner : issue #244.

## 2026-11-03 — Secret de session public par défaut : le serveur démarrait avec une clé connue de tous (#243)

### Contexte
- `server/middleware/session.ts` signait les cookies avec `process.env.SESSION_SECRET || "YaroFleetOSSecretKey"`. La valeur de repli figure dans le dépôt : un déploiement sans `SESSION_SECRET` démarrait sans alerte, et quiconque lit le code pouvait forger un cookie de session valide, donc se connecter sous n'importe quel compte.

### Cause racine
- Classification : configuration de sécurité par défaut non sûre (fail-open). Un repli pratique en développement s'appliquait aussi en production, et rien ne distinguait « secret absent » de « secret fourni ».
- Aggravant : Express sert le build de production dès que `NODE_ENV` n'est pas `development` ; un test sur `NODE_ENV === "production"` aurait laissé passer `Production`, `staging` ou une variable absente.
- Near miss lors de la correction : rogner le secret avant de signer aurait changé la clé d'un secret actuel entouré d'espaces et invalidé toutes les sessions ouvertes.

### Résolution
- `resolveSessionSecret` (`server/lib/session-secret.ts`) : repli seulement pour `NODE_ENV` dans une liste d'autorisation (`development`, `test`) ; ailleurs, démarrage refusé si le secret est absent, de moins de 32 caractères ou égal à une valeur publique du dépôt. Le message dit comment corriger et ne contient jamais la valeur. Le rognage sert à mesurer, la signature utilise la valeur brute.

### Prévention (vérifiable)
- `tests/unit/server/session-secret.test.ts` : refus en production (absent, vide, court, public), `NODE_ENV` hors liste traité comme la production, valeur brute conservée.
- Garde statique dans le même fichier : `session.ts` doit passer par `resolveSessionSecret(process.env` et ne contenir ni `SESSION_SECRET ||`/`??` ni le repli littéral.

### Règle Projet (obligatoire)
- Un secret n'a jamais de valeur par défaut hors d'une liste d'autorisation d'environnements de développement. En production, secret absent ou public = refus de démarrer, avec un message actionnable.
- Un environnement se teste par liste d'autorisation, jamais par `=== "production"`.
- Ne jamais normaliser (trim, casse) une clé de signature existante : on ne normalise que pour valider.

### Assurance et visite : la check-list jugeait l'échéance un jour plus tard que le lancement (2026-11-03)

- **Contexte** : une assurance ou une visite technique qui expire aujourd'hui était « conforme » dans `GET /api/missions/:id/launch-readiness`, puis refusée au lancement (`PUT /status` → `in_progress`). Même écart autour de minuit UTC.
- **Cause racine** : la check-list passait par `isDateExpired`, qui compare en jour local avec un `<` strict. C'est la règle du permis chauffeur. Le lancement passe par `isExpiredOnOrBeforeToday` (jour UTC, le jour de l'échéance bloque, `shared/constants/expiry-day.ts`). C'est la deuxième divergence entre ces deux chemins, après la carte grise.
- **Classification** : règle métier dupliquée, divergence de calcul de date.
- **Résolution** :
  - la check-list juge tous les papiers véhicule par `isExpiredOnOrBeforeToday` ;
  - un papier sans date reste invalide, sauf la carte grise ;
  - l'ancienne fonction est renommée `isDriverLicenseExpired`, réservée au permis.
- **Prévention vérifiable** :
  - `tests/contract/mission-renewal-receipt.contract.test.ts`, bloc « jour de l'échéance » : 2 cas passent au rouge sur l'ancienne règle ;
  - `tests/unit/server/mission-expiry-day-hygiene.test.ts` échoue si `isDocumentTypeValid` compare des dates elle-même, ou si la règle du permis sert à autre chose qu'au permis.
- **Leçon** : une règle de date se nomme d'après le papier qu'elle juge. Une fonction générique `isDateExpired` invite à la réutiliser pour un papier dont la règle est différente.

### Jour de l'échéance : une règle partagée renversée sans divergence (2026-11-03, #224)

- **Contexte** : décision produit (#224) : un papier est valable le jour de son échéance et expiré le lendemain, comme le permis. Jusque-là, P3-2 (D1, D2) rendait le jour J expiré pour les papiers, et le permis suivait sa propre règle au jour local.
- **Cause racine** : la règle du jour J existait en trois écritures : la source partagée (`isExpiredOn`, `<= 0`), deux calculs locaux qui la recopiaient (`alert-service.checkVehicleDocumentAlerts`, `GET /api/vehicles/alerts`, au jour local avec `setHours` et `Math.ceil`) et le permis (`isDriverLicenseExpired`, jour local, `<` strict). Basculer seulement la source aurait laissé les alertes dire « expiré » un jour où le lancement passe.
- **Classification** : règle métier dupliquée, changement de décision produit.
- **Résolution** :
  - `shared/constants/expiry-day.ts` : `isExpiredOn` à `days < 0`, nouveau `isDriverLicenseExpiredOn` ;
  - alertes (`alert-service`, `vehicles.routes`) rebranchées sur `toExpiryDateOnly` + `daysBetweenDateOnly`, jour UTC ;
  - `isExpiredOnOrBeforeToday` renommée `isPaperExpired` : son nom contredisait la nouvelle règle ;
  - le jour J reste signalé : alerte « expire bientôt », priorité haute, « dernier jour de validité ».
- **Prévention vérifiable** :
  - `tests/unit/server/document-expiry-day-j.test.ts` : J-1, J, J+1 sur les cinq verdicts papiers (éligibilité, statut, statistiques, liste, règle typée) et sur le permis, plus la bascule à minuit UTC sous Africa/Douala et UTC ;
  - contrats `mission-document-expiry` et `mission-renewal-receipt` : alertes, check-list et lancement à J et J+1, permis à J-1, J, J+1.
  - relecture : une troisième recopie (`getExpiredDocuments`, liste `expiredDocuments`, `new Date(échéance) < now`) avait échappé à la bascule. `tests/unit/server/expiry-day-local-math-hygiene.test.ts` échoue désormais sur toute comparaison locale d'une échéance dans `server/`, `client/src` et `shared/` (liste gelée de 6 fichiers client/CPC, qui ne peut que rétrécir).
- **Leçon** : un changement de règle partagée se fait sur la source ET sur chaque recopie. Avant de basculer, chercher les calculs qui reproduisent la règle sans l'importer (`setHours(0`, `<= 0` sur un nombre de jours) ; une fonction dont le nom décrit l'ancienne règle se renomme dans le même changement.

## 2026-11-03 — Passage 1→N : tout `limit(1)` sur la table enfant devient une écriture sur la mauvaise ligne (#240)

### Contexte
- #240 ouvre l'ajout et l'annulation d'affectations sur une mission (N chauffeurs). Les routes existantes lisaient « l'affectation » de la mission par `limit(1)` puis écrivaient sur son id.
- Effets relevés à la relecture sécurité (NO-GO) : `PUT /:id/status` réécrivait une affectation **annulée** en `in_progress` (elle reprenait sa part du CA et ses droits de saisie) ; un chauffeur annulé gardait l'accès à la mission et pouvait la lancer ; les contrôles de lancement ne portaient que sur le premier camion ; `PATCH /:id { assignment }` remplaçait « la première » ligne d'une mission à deux chauffeurs ; `DELETE` d'une affectation refusée la réécrivait en `cancelled`.
- Near miss pendant la correction : le `catch` du PATCH convertissait toute `AppError` en 500, le 409 prévu n'arrivait jamais. Seul le contrat l'a montré.

### Cause racine
- Classification : invariant de cardinalité implicite (suite de la leçon #227). Le code lecteur avait été revu pour N lignes, pas le code écrivain. Une écriture filtrée sur l'id seul ne revérifie pas l'état qui justifiait l'écriture.

### Résolution
- Statut : chauffeur → ses lignes actives (403 s'il n'en a aucune) ; personnel → toutes les lignes actives ; contrôles de lancement par ligne. Écritures conditionnées au statut lu. `canAccessMissionAsDriver` ignore les lignes `cancelled`/`rejected`. DELETE sous `FOR UPDATE`, no-op sur une ligne déjà nulle. PATCH : 409 au-delà d'une ligne vivante, erreurs passées au gestionnaire central.

### Prévention (vérifiable)
- `tests/contract/mission-multi-assignments.contract.test.ts` : 8 cas (7 rouges sur le code d'avant), dont le CA de la mission menée à terme sans la ligne annulée.
- `tests/unit/server/assignment-write-hygiene.test.ts` : échoue sur tout `update(assignments)` / `delete(assignments)` sans filtre `assignments.status` ou `assignments.driverId` (même coupé sur plusieurs lignes), et sur toute SQL brute ; 4 écritures relevées sur le code d'avant.

### Règle Projet (obligatoire)
- Quand une relation passe de 1 à N, recenser **toutes** les écritures sur la table enfant, pas seulement les lectures : chaque `limit(1)` suivi d'une écriture vise désormais une ligne arbitraire.
- Une écriture sur une ligne lue plus tôt se conditionne à l'état lu (`where id = ? and status = ?`).
- Un `catch` de route ne réécrit jamais une `AppError` en 500 : `next(error)`.

### Suppression douce d'une table : inventorier tous les lecteurs (4 novembre 2026, pleins carburant, #263)
- Contexte : `fuel_records` passe à la suppression douce (`deleted_at`). Le premier inventaire a filtré les services et les triggers de mission, mais a conclu à tort que `storage.getFuelRecordsByVehicleId` n'était plus appelée : elle l'est par `/api/fuel-records/statistics`, `/consumption-history` et `alert-service`. Les triggers d'alertes carburant ne sont par ailleurs pas rejoués au démarrage tant que leur fichier n'est pas dans `init-database.ts`.
- Cause racine : l'inventaire des lecteurs s'est fait de mémoire et par service, sans balayer `storage.ts` ni les fichiers SQL, et une affirmation « plus appelée » n'a pas été vérifiée par un grep des appels.
- Classification : lecteur oublié lors d'un changement de modèle (récurrence du « recenser toutes les écritures » de la relation 1 vers N, appliquée ici aux lectures).
- Résolution : filtre `deletedAt` dans `storage.getFuelRecordsByVehicleId` ; filtre `deleted_at` dans `fuel-alerts-triggers.sql`, qui reste NON posé au démarrage : rejoué sur PG 17, il échoue au 2e plein (agrégat sur fonction fenêtre, `format('%.1f')` invalide) et vise `user_id = 1` en clé étrangère ; sa réécriture est confiée à fleet-db ; PATCH concurrent d'une ligne supprimée = 404 et non 500.
- Prévention (vérifiable) : `tests/unit/server/fuel-records-deleted-at-hygiene.test.ts` échoue sur tout `.from(fuelRecords)`, `innerJoin(fuelRecords` ou `FROM|JOIN fuel_records` sous `server/` sans `deletedAt` / `deleted_at` dans l'instruction (appels multi-lignes vus, `storage.ts` et les SQL de triggers compris), avec une liste gelée d'exceptions justifiées une par une ; vu rouge en retirant le filtre de `storage.ts`. Contrat : `fuel-record-soft-delete.contract.test.ts` (statistiques et historique de consommation).
- Règle Projet : passer une table à la suppression douce commence par un grep de tous ses lecteurs (`storage.ts`, services, SQL brut, triggers), et toute affirmation « n'est plus appelée » se prouve par un grep des appelants.

## 2026-11-04 — Prix d'achat du véhicule : inventaire des sorties incomplet, fuites trouvées en relecture (#214)

### Contexte
- #214 réserve `vehicles.purchasePrice` à admin, logistique et secrétariat. La première passe masquait les routes véhicule recensées à la main : liste, détail, missions, export.
- La relecture a trouvé deux autres fuites :
  - `GET /api/vehicles/:vehicleId/tires` joignait le véhicule entier (`select()` vide sur `vehicle_tires` ⋈ `vehicles`), ce qui servait le prix à tout rôle ;
  - `GET /api/operations/missions/:id/costs` renvoyait `vehicleCost` = prix / 1000. Le prix restait donc récupérable, même sans apparaître en clair.

### Cause racine
- Classification : inventaire des sorties fait par les routes, pas par la donnée. Toute lecture de `vehicles` sans projection explicite (`select()` vide, `{ vehicle: vehicles }`, `getTableColumns(vehicles)`, `row_to_json(v.*)`) ramène la colonne. Le masquage ne couvrait que les routes connues.
- Une valeur dérivée par une opération réversible (division par une constante) reste une fuite. Contrôler l'absence du champ ne suffit pas.

### Résolution
- Pneus : la sortie passe par `redactVehiclePriceDeep`. Coûts de mission : `vehicleCost` et `breakdown.vehicle` valent `null` hors rôles autorisés, et `totalCost` n'inclut plus ce terme.

### Prévention (vérifiable)
- `tests/unit/server/vehicle-select-hygiene.test.ts` : gèle chaque lecture de `vehicles` sans projection explicite, avec sa justification (masquée en aval ou jamais servie). Une occurrence nouvelle ou disparue fait échouer le test.
- `tests/contract/vehicle-purchase-price-scope.contract.test.ts` : parcourt `ALL_APP_ROLES` sur chaque sortie, contrôle que les chiffres du prix sont absents du corps et que le prix / 1000 n'apparaît pas. 52 cas sur 89 rouges sur le code de main.

### Règle Projet (obligatoire)
- Pour restreindre la lecture d'une colonne, recenser par grep les lectures de la table, pas les routes. Une jointure ou un `select()` vide expose toutes les colonnes.
- Une valeur calculée à partir d'une donnée restreinte suit la même restriction, si le calcul est réversible.

## 2026-11-04 — Changer le code HTTP d'un catch d'authentification ouvre un oracle d'énumération (#254, #256)

### Contexte
- #256 a fait passer le `catch` de `POST /api/auth/login` de 401 à 503, pour qu'une panne de base ne se lise plus comme « identifiants invalides » et ne soit plus comptée par le verrouillage (#254).
- Relecture sécurité (NO-GO) : le corps n'était pas validé en type. Avec `{"username":"admin","password":1}`, `bcrypt.compare` (bcryptjs 3) lève. Cette branche n'est atteinte que si le compte existe et est actif : un compte existant répondait 503, un nom inconnu 401. Les 503 n'étant pas comptés par le verrouillage, l'énumération était illimitée.

### Cause racine
- Classification : canal auxiliaire introduit par un changement de code d'erreur. Avant #256, le `catch` aplatissait tout en 401 et masquait la différence. Il cachait l'oracle au lieu de l'empêcher. Rendre l'erreur honnête a rendu l'oracle visible.

### Résolution
- Corps validé par Zod en tête du handler (`username` et `password` en chaînes non vides, longueur bornée). 400 avant `getUserByUsername`, même réponse pour tout compte.

### Prévention (vérifiable)
- `tests/contract/auth-login-unavailable.contract.test.ts` : avec `password: 1` puis `password: {}`, sur un compte existant et sur un nom inconnu, la réponse est le même 400 et aucune recherche de compte n'a lieu. Sur le code d'avant, les deux cas échouent (503 contre 400). Le même fichier couvre aussi la panne de base et l'échec de `session.regenerate` (503, non comptés), plus le témoin 401 compté.

### Règle Projet (obligatoire)
- Sur une route d'authentification, valider le type du corps **avant** la recherche du compte.
- Avant de changer le code HTTP d'un `catch` d'authentification, recenser les branches qui ne lèvent que pour un compte existant (comparaison de hash, migration, session) : chacune devient un oracle dès que son code diffère de celui d'un compte inconnu.

## 2026-11-04 — Serveur dev démarré sur la base de production : aucun garde hors des tests (#259)

### Contexte
- Pour une preuve e2e, un serveur dev a été lancé avec `--env-file=.env`. Le `.env` racine pointe l'ancien Neon marqué production (`ep-bitter-term…`). Le serveur y a tourné environ 2 minutes : il a rejoué les migrations d'amorçage (`init-database.ts`) et l'`alert-service` a créé des alertes. Arrêt manuel, incident signalé.

### Cause racine
- Classification : garde-fou partiel. Playwright (`assertNotProductionDatabase`) et vitest (`assertSafeTestDatabase`, `assertUnitDatabaseNotProduction`) refusaient la base de production ; le serveur lui-même, et tout script qui importe `server/db.ts`, n'avait aucune vérification. Le garde protégeait l'outil de test, pas la connexion.

### Résolution
- Reconnaissance des marqueurs extraite dans `shared/production-database.ts` (source unique) ; `e2e/helpers/production-guard.ts` la réexporte sans copie.
- `server/lib/production-db-guard.ts` : hors `NODE_ENV=production`, refus de démarrer si `DATABASE_URL`, `DATABASE_URL_LISTENER` ou `DATABASE_URL_DIRECT` porte un marqueur (défaut + `E2E_PRODUCTION_DB_MARKERS`). Dérogation explicite `ALLOW_PRODUCTION_DATABASE=1`, journalisée en `warn`. Message sans URL ni mot de passe.
- Appelé dans `server/db.ts` avant tout `new Pool` : le serveur et tout script qui importe `server/db.ts` en héritent.
- #264 : `guardDatabaseConnection(source)` appelé aussi en tête des scripts à pool propre (`scripts/audit-dana-password.ts`, `audit-password.ts`, `audit-listed-passwords.ts`, `reset-listed-passwords.ts`) ; `schema-prod` du compose porte `NODE_ENV: production`.

### Prévention (vérifiable)
- `tests/unit/server/production-db-guard.test.ts` : refus en dev et sans `NODE_ENV`, sur les trois variables, marqueurs ajoutés, base locale acceptée, dérogation seulement sur `=1`, no-op en production, identité des fonctions réexportées (pas de copie), appel du garde avant `new Pool(` dans `server/db.ts`.
- `tests/unit/server/db-pool-hygiene.test.ts` (#264) : hors `server/db.ts` et `tests/`, tout fichier qui construit un pool ou un client (`new Pool(`, `neon(`, `new Client(`) appelle le garde avant, et tout import de valeur de `@neondatabase/serverless`, `pg` ou `postgres` (alias compris) s'accompagne d'un import de `production-db-guard`. Commentaires retirés avant la recherche : un garde commenté ne compte pas. Liste gelée (`test-workflow-reminders.js`) qui ne peut que rétrécir. Chaque cas (pool sans garde, garde après, import aliasé, garde commenté) a sa preuve rouge.
- `tests/unit/deploy/compose-prod-node-env.test.ts` : `schema-prod` garde `NODE_ENV: production`.
- #268 : `drizzle.config.ts` appelle le garde (`drizzle-kit push` refusé sur une base marquée, `tests/unit/server/drizzle-config-guard.test.ts`) ; `db-prod`, service Postgres de la prod VPS, est un marqueur par défaut.
- Preuve manuelle : `tsx server/index.ts` avec une URL portant le marqueur (hôte `.invalid`, aucune connexion) sort en erreur avant tout pool ; avec le Postgres local, `/api/health` répond 200.

### Règle Projet (obligatoire)
- Un garde-fou de base se place à la **connexion** (`server/db.ts`), pas seulement dans les runners de test : tout point d'entrée qui construit un pool en hérite.
- Les marqueurs de production ne se redéclarent pas : les importer depuis `shared/production-database.ts`.
- Pour un serveur, un seed ou un e2e local, passer `DATABASE_URL` en variable d'environnement (elle prime sur `--env-file`) vers le Postgres local.

## 2026-11-04 — Connexion : oracle de temps et mock qui rejette là où le code avale (#260)

### Contexte
Audit de sécurité de #256 (oracle du code HTTP sur `POST /api/auth/login`, déjà fermé).

### Cause racine
- Oracle de temps : pour un nom inconnu ou supprimé, le handler répondait 401 sans aucun calcul bcrypt (~70 ms de moins qu'un compte existant). La latence suffisait à énumérer les comptes.
- Garantie fictive : le contrat de #254 simulait la panne par `vi.spyOn(storage, "getUserByUsername").mockRejectedValueOnce(...)`. Or la vraie méthode avalait l'erreur et renvoyait `undefined` : une vraie coupure donnait 401 (« identifiants », échec compté par le garde) et le test restait vert. Même défaut pour les contrôles d'unicité du nom (création, modification) : une panne y valait « nom libre ».
- Les journaux de connexion portaient le nom saisi en clair ; un mot de passe tapé dans le champ identifiant y finissait.

### Classification
Sécurité (énumération de comptes, fuite de secret dans les journaux) + test à garantie fictive.

### Résolution
- Comparaison à un hash factice de coût 10 (`LOGIN_DUMMY_HASH`) quand le compte est inconnu ou supprimé.
- `storage.getUserByUsername` journalise par `storageLog` et relance l'erreur.
- Journaux de connexion : `usernameRef` (empreinte SHA-256 tronquée) ou `userId`, jamais le nom saisi.

### Prévention (vérifiable)
- `tests/contract/auth-login-unavailable.contract.test.ts` : espion sur `bcrypt.compare`, exactement 1 appel pour un compte existant comme pour un nom inconnu, même réponse ; panne simulée **sous** storage (`db.select().from(users)`), et `getUserByUsername` doit rejeter.
- Mutation rejouée : sans le hash factice ni la relance, 4 tests échouent.

### Règle Projet (obligatoire)
- Fermer l'oracle du code HTTP ne ferme pas celui du temps : chaque branche d'échec d'authentification fait le même travail coûteux.
- Un mock se place sous la couche qui gère l'erreur, jamais à sa place : simuler l'échec de la dépendance, pas le résultat que l'on espère du code testé.
- Une méthode de lecture qui sert à décider (existence, unicité, droit) ne transforme pas une panne en « absent ».
## 2026-11-04 — Tests instables : une « période vide » partagée et un délai calibré sur un test en mémoire (kpi-cdc, backup-db)

### Contexte
- `tests/contract/kpi-cdc.contract.test.ts` échouait par intermittence (« expected 1 to be +0 » sur les pannes de 2001).
- `tests/unit/deploy/backup-db.test.ts` échouait sous la charge de la suite complète (« Test timed out in 5000ms ») et passait lancé seul.

### Cause racine
- kpi-cdc : hypothèse d'état global. Le test supposait l'année 2001 vide, alors que `work-order-labor-rate` (contrat) et `work-order-cost` (intégration) y créent des OT correctifs, comptés comme pannes par `loadFailures`. Le nettoyage en `afterAll` ne protège pas : la base Docker de test est partagée entre sessions et suites, et un run interrompu laisse ses lignes. `kpi-service-cdc` (intégration) faisait la même hypothèse.
- backup-db : délai. Chaque test lance le script shell, qui enchaîne une dizaine de sous-processus. Sous Git Bash (Windows), `fork` est émulé : 1,1 s isolé, plus de 5 s en parallèle avec 168 fichiers.

### Résolution
- kpi-cdc et kpi-service-cdc : invariants plutôt que zéros absolus (une entrée par mois, total égal à la somme des mois, moyenne égale à total/mois, ventilation par véhicule égale au total).
- backup-db : dates calculées en JS (deux bash de moins par test) et `timeout: 30_000` sur le `describe`, à la mesure d'un script shell.

### Prévention (vérifiable)
- Reproduction : avec un OT correctif daté de 2001 posé en base, l'ancien kpi-cdc échoue et le nouveau passe, de même que kpi-service-cdc.
- 20 répétitions de chaque fichier, 3 passes complètes de `npm test`.

### Règle Projet (obligatoire)
- Un test sur une base partagée n'affirme jamais qu'une période ou une table est vide s'il ne l'a pas créée vide lui-même. Il affirme des invariants, ou il filtre sur ses propres identifiants.
- Un test qui lance un processus (bash, binaire) fixe un délai adapté à ce coût, et ne réserve pas aux pipes shell un calcul que le langage de test sait faire.

## 2026-11-04 — Compteur anti-force brute indexé sur la chaîne reçue (pin-login)

### Contexte
Le garde de verrouillage de `POST /api/auth/pin-login` passait avant la validation et indexait son compteur sur la chaîne brute de `userId`, alors que le handler appliquait `Number(userId)`. Les formes "12", "012" et "0012" ouvraient chacune un compteur distinct pour le même compte. Les échecs d'identification répondaient en outre par des statuts et des messages différents (401, 403) et sans comparaison bcrypt quand il n'y avait pas de hash.

### Cause racine
Clé du compteur et identité réelle du compte calculées à deux endroits, de deux façons. Le garde ne connaissait que la chaîne reçue.

### Résolution
- L'identifiant est validé (`^[1-9]\d{0,8}$`) puis ramené à sa forme canonique avant le garde, au montage de la route.
- Tous les échecs d'identification répondent le même 401 « Identifiants invalides », avec comparaison bcrypt factice.
- Le mot de passe d'un compte chauffeur n'est plus le PIN haché ; reprise idempotente des comptes existants au démarrage.

### Règle Projet (obligatoire)
- La clé d'un compteur anti-force brute est la forme canonique de l'identifiant, jamais la chaîne reçue.

### Prévention (vérifiable)
- Contrat `tests/contract/pin-login-hardening.contract.test.ts` : 5 PIN faux sur "id", puis les formes équivalentes sont verrouillées (429) ou refusées (400), et une seule clé `pin:<id>` existe en base.
- Intégration `tests/integration/driver-password-pin-revocation.test.ts` pour la reprise.

## 2026-11-04 — Routes libre-service : exception T1 déclarée, et un « mot de passe modifié » qui ne l'était pas (R1)

### Contexte
Huit routes d'écriture (mot de passe, accueil, préférences, boîte d'alertes) restaient gelées en T1 : sans garde de rôle, par nature, puisqu'elles servent tout compte connecté. La garde `selfScoped` de #235 jugeait le périmètre en analysant le handler, et chaque relecture la contournait.

### Cause racine
- Le cliquet T1 n'avait que deux issues, « garde de rôle » ou « gelée ». Aucune place pour une route légitimement ouverte à tous les rôles.
- En écrivant le contrat, on a vu que `POST /api/users/change-password` répondait 200 quand `storage.updateUser` échouait : la méthode avale l'erreur et renvoie `undefined`, et le handler ne regardait pas le retour.

### Classification
Outillage de garde-fou (exception non modélisée) + erreur avalée, l'utilisateur croyant son mot de passe changé.

### Résolution
- `tests/unit/server/support/write-routes-self-service.ts` : table déclarée, route par route, avec son contrat de périmètre et la donnée touchée.
- Les 4 routes de `routes.ts` déclarent `isAnyUser`, comme les routes d'alertes et de préférences.
- change-password répond 503 quand l'enregistrement n'a pas eu lieu.

### Prévention (vérifiable)
- `write-routes-ratchet.test.ts` : pour chaque entrée libre-service, la route existe, déclare `isAnyUser`, n'est ni gelée ni publique, et son contrat existe et contient l'appel déclaré. Mutation : `isAnyUser` retiré d'une route, le test échoue.
- `tests/contract/self-service-scope.contract.test.ts` : un client A agit avec l'`userId` de B dans le corps, et la ligne d'accueil comme le mot de passe de B restent inchangés. L'enregistrement non fait répond 503.

### Règle Projet (obligatoire)
- Une exception à un cliquet de sécurité se déclare par clé, avec sa preuve comportementale (un contrat). Elle ne passe jamais par l'analyse du code qu'elle exempte.
- Après un appel de storage qui renvoie `undefined` en cas d'erreur, tester le retour avant de répondre « fait ».

## 2026-11-04 — Near miss : exception de cliquet prouvée par la présence d'une chaîne (R1, audit)

### Contexte
L'audit de sécurité de #274 a relevé que la preuve exigée pour une route libre-service était la présence, dans le contrat, du texte de l'appel (`calls`). Le test « sans session : 401 sur chaque route » suffisait à la fournir.

### Cause racine
Le garde-fou contrôlait un indice (l'appel apparaît dans le fichier), pas la propriété visée (un compte A ne touche pas aux données de B).

### Classification
Near miss, outillage de garde-fou : contrôle plus faible que la règle qu'il porte. Aucune route n'était fautive.

### Résolution
- L'appel doit figurer dans un test dont le titre contient « autre compte ». Les quatre contrats concernés ont été renommés en ce sens.
- Le texte du handler ne doit lire aucun identifiant de compte de la requête (`req.params|query|body` vers `userId`, `user_id`, `ownerId`, `accountId`, accès direct ou déstructuration). C'est un motif de refus, jamais un critère d'acceptation : la preuve positive reste le contrat.

### Prévention (vérifiable)
- `write-routes-ratchet.test.ts` : `selfServiceProblems` refuse les quatre formes de lecture et un contrat dont seul un test 401 appelle la route (tests synthétiques).
- Mutations jouées : une ligne `req.body.userId` dans change-password fait échouer le cliquet ; « autre compte » retiré du titre du contrat des préférences aussi.

### Règle Projet (obligatoire)
- Un garde-fou d'exception vérifie la preuve elle-même, pas une trace qui l'accompagne. Avant de livrer, se demander quel test vide le satisferait.

## 2026-11-04 — Fiche véhicule : toute erreur de chargement se lisait « n'existe pas » (#255, #261)

### Contexte
- #255 : un client ouvrant le véhicule d'un autre client (403) lisait « Le véhicule n'existe pas ou a été supprimé ».
- #261 : même message sur une panne réseau ou une 5xx. L'utilisateur conclut à une suppression et ne réessaie pas, et la référence (requestId) n'est pas montrée.

### Cause racine
- Classification : deuxième défaut du même genre sur le même écran. La page branchait « non trouvé » sur `error || !vehicle`, sans regarder la nature de l'erreur. Corriger le seul 403 (#255) a laissé les autres catégories dans la branche « n'existe pas ».

### Résolution
- Fonction pure `vehicleUnavailable` (`client/src/lib/vehicle-load-error.ts`) : 403 → « Accès refusé » ; 404 ou réponse vide → « Véhicule non trouvé » ; tout le reste (401, 5xx, réseau, exception) → « Chargement impossible », message `userMessageOf` avec la référence, bouton « Réessayer ».

### Prévention (vérifiable)
- `tests/unit/client/vehicle-load-error.test.ts` : un cas par catégorie (401, 403, 404, réponse vide, 5xx avec corps, 5xx sans corps, réseau, exception technique). Seuls 404 et la réponse vide produisent « n'existe pas ».
- `e2e/24-client-space.spec.ts` : 403 réel dans le navigateur, puis 5xx et panne réseau simulées, puis relance réussie.

### Règle Projet (obligatoire)
- « N'existe pas » se déduit d'un 404 seulement, jamais d'une erreur quelconque. Un écran de détail classe son erreur par une fonction pure testée par catégorie, pas par `if (error)`.

## 2026-11-04 — Identifiants de connexion : empreinte salée pour les logs, les compteurs et l'audit (M2, M3)

### Contexte
L'audit de sécurité de #272 a relevé deux points. La référence de log du nom saisi était un SHA-256 non salé, qu'on inverse par dictionnaire. Les compteurs d'échecs (`login_attempts_by_username.username_normalized`) et l'audit de blocage d'un nom inconnu stockaient le nom saisi en clair, alors qu'un nom inconnu est souvent un mot de passe tapé dans le mauvais champ.

### Cause racine
La clé du compteur était le nom normalisé lui-même. Elle servait à la fois de clé de stockage et de critère pour le miroir sur `users`, si bien que personne ne s'est demandé ce qu'elle exposait au repos.

### Classification
Donnée sensible au repos et dans les journaux (fuite par saisie erronée), sans exploitation connue.

### Résolution
- `server/lib/login-identifier.ts` : HMAC-SHA256 sous une sous-clé dérivée du secret de session et du domaine `fleet:login-identifier:v1`. Le secret brut ne sert qu'à signer les cookies. `loginUsernameRef` (logs) en prend les 12 premiers caractères.
- `DbLockoutStore` stocke `pwdh1:<empreinte>`. Le nom saisi reste en mémoire, comme simple paramètre du miroir `users`. L'audit `lock` d'un nom inconnu porte l'empreinte.
- Reprise au démarrage (`migrateLoginIdentifiers`, dans `app.ts`), en une transaction :
  - les clés en clair (`pwd:<nom>`, clé brute) fusionnent vers l'empreinte, au maximum de chaque champ ;
  - seules les lignes d'audit `lock` à nom inconnu sont réécrites. C'est une modification d'historique assumée, et les autres lignes ne bougent pas ;
  - les logs ne portent que des compteurs.
- `server/services/user-service.ts` supprimé : aucun importeur. Son `getUserByUsername` avalait l'erreur, et son `authenticateUser` ne comparait pas de hash factice.
- Une rotation de `SESSION_SECRET` ou un changement de domaine remet les compteurs à zéro : c'est accepté, un verrou dure 15 minutes.

### Prévention (vérifiable)
- `tests/integration/login-lockout-db-store.test.ts` : ni la ligne du compteur ni l'audit d'un nom inconnu ne contiennent le nom saisi, et la normalisation est identique à celle du garde.
- `tests/integration/login-identifier-migration.test.ts` :
  - fusion de deux clés d'un même nom ;
  - réécriture du seul audit `lock` ;
  - un second démarrage ne fait qu'une lecture, sans transaction ni écriture.

### Règle Projet (obligatoire)
- Une saisie libre non authentifiée (nom, e-mail, téléphone) ne se stocke ni ne se journalise en clair. On passe par `loginIdentifierDigest` / `loginUsernameRef`.
- Une clé HMAC dérivée d'un secret existant porte un domaine versionné. On ne réutilise jamais le secret brut pour un second usage.
## 2026-11-04 — `npm run dev` redémarrait en boucle depuis #252, sans qu'aucune CI ne le voie

### Contexte
- #252 (image de prod `--omit=dev`) a remplacé l'import statique de `vite.config.ts` par `loadConfigFromFile` dans `server/vite.ts`.
- Vite 5 écrit alors `vite.config.ts.timestamp-<n>-<hash>.mjs` à la racine, l'importe puis le supprime. tsx watch suit tout fichier importé : la suppression relançait le serveur environ toutes les 10 s (mesuré : 10 « Restarting » en 100 s).
- Symptômes signalés par b7 : `npm run dev` instable, et le serveur e2e de Playwright (`webServer: npm run dev`) jamais prêt.

### Cause racine
- Classification : régression d'un mode d'exécution non couvert par la CI. La CI construit l'image et joue `node dist/index.js` ; aucun job ne lance `tsx watch`. La preuve « mode dev vérifié » de #252 était un appel ponctuel (`/` 200), pas une observation dans la durée : la boucle commence après le premier chargement.

### Résolution
- Script `dev` : `tsx watch --exclude "*.timestamp-*.mjs"`. `loadConfigFromFile` est conservé : c'est lui qui tient vite hors du bundle de prod (`tests/unit/deploy/runtime-deps.test.ts`). Vite 5.4 n'a pas d'option de chargement sans fichier temporaire (`configLoader: "runner"` arrive en 6.1).

### Prévention (vérifiable)
- `tests/unit/server/dev-watch-vite-config.test.ts` : tant que `server/vite.ts` utilise `loadConfigFromFile`, tout script `tsx watch` de `package.json` doit avoir un `--exclude` qui couvre `vite.config.ts.timestamp-*.mjs`. Rouge sur le `package.json` de main avant correctif.
- Preuve manuelle : `npm run dev` pendant 145 s sur Postgres local, 0 « Restarting », `/api/health` et `/` à 200.

### Règle Projet (obligatoire)
- Un changement du chargement de vite ou du démarrage serveur se vérifie aussi en `npm run dev` **dans la durée** (au moins 2 minutes, 0 « Restarting »), pas seulement en build de prod.
- Un fichier temporaire écrit dans le dépôt par un outil est exclu du watch et du `.gitignore`.

## 2026-11-04 — Changement de mot de passe : essais du mot de passe actuel sans limite

- **Contexte** : `POST /api/users/change-password` vérifie le mot de passe actuel, mais aucun compteur ne
  s'y appliquait, alors que la connexion est limitée depuis P-03.
- **Cause racine** : le garde de verrouillage ne savait lire sa clé que dans le corps (`username`). Une
  route authentifiée, dont la clé est le compte de session, ne pouvait pas l'utiliser.
- **Classification** : sécurité, contrôle absent sur un second point d'entrée du même secret.
- **Résolution** : `loginLockoutGuard` accepte `keyOf(req)`. Sur change-password, la clé vaut
  `cpw:<id de session>`, avec le même seuil et la même durée que la connexion. Ce compteur est à part de
  celui de la connexion : bloquer le changement ne bloque pas la connexion, et l'inverse non plus. Il
  n'a pas de miroir dans `users`, n'est jamais converti en empreinte par la reprise M3, et le
  déverrouillage admin le lève.
- **Prévention vérifiable** : `tests/contract/change-password-attempts.contract.test.ts` couvre
  plusieurs cas :
  - N échecs puis 429, même avec le bon mot de passe ;
  - les autres comptes et la connexion ne sont pas touchés ;
  - un succès remet le compteur à zéro ;
  - un corps invalide n'est pas compté ;
  - le déverrouillage admin lève ce verrou.

  `tests/integration/login-identifier-migration.test.ts` vérifie que la clé `cpw:` reste telle quelle.
- **Leçon** : tout point d'entrée qui vérifie un secret (mot de passe, PIN, code) passe par le même
  compteur. Un garde dont la clé est codée en dur sur le corps de la requête ne protège que la route
  pour laquelle il a été écrit.

## 2026-11-04 — Fichiers en ajout de fin : chaque fusion mettait les autres PR en conflit
- Erreur répétée (cinq allers-retours le 4 novembre) : LESSONS, `docs/journal/*.md` et `PASSATION*.md` ne reçoivent que des entrées de fin, mais deux PR qui ajoutaient chacune la sienne entraient en conflit à chaque fusion. Prévention : `merge=union` dans `.gitattributes`, vérifiée par `tests/unit/gitattributes-union.test.ts` (attributs + merge réel de deux branches). Limite : GitHub n'applique pas union côté serveur, le `git merge origin/main` local reste nécessaire mais ne conflicte plus. Règle : n'y écrire qu'en ajout de fin, jamais en réécriture (union dupliquerait la ligne modifiée des deux côtés).
## 2026-11-04 — Comptes e2e absents de la base de test : la passe ressemble à une série de défauts produit (#245)

### Contexte
- Passe e2e complète sur la base de test (`ep-plain-lake`). Les comptes par défaut des specs (`admin`/`admin123`, `terry`, `fatou`) n'y existent pas. Chaque spec a échoué à la connexion, une par une, avant que la cause commune soit identifiée. Les specs 24/25, qui lisent `RECETTE_PASSWORD`, se sont de plus skippées sans bruit tant que la variable n'était pas exportée.

### Cause racine
- Classification : hypothèse d'environnement implicite. Les valeurs par défaut de `e2e/helpers/auth.ts` ne valent que pour la base décrite par `docs/qa/COMPTES_ENVIRONNEMENT.md`. Rien ne vérifiait, avant la suite, que la base visée connaissait ces comptes : un refus de connexion apparaissait comme un échec de spec.

### Résolution
- `e2e/helpers/account-preflight.ts` : sonde `POST /api/auth/login` pour chaque compte (admin, chef d'atelier, magasinier), dédoublonné. Seul un 401/403 est imputé au compte ; un serveur muet ou en 5xx ne l'est pas (les specs le diront).
- Branché dans `e2e/global-setup.ts` : la suite s'arrête d'emblée avec un message qui nomme les comptes refusés, sans mot de passe, et rappelle les variables à renseigner. Dérogation explicite `E2E_SKIP_ACCOUNT_CHECK=1`.

### Prévention (vérifiable)
- `tests/unit/e2e/account-preflight.test.ts` : 401/403 retenus, `null`/500/503 non imputés, dédoublonnage, message sans mot de passe, et présence de l'appel bloquant dans `e2e/global-setup.ts`.

### Règle Projet (obligatoire)
- Avant une passe e2e sur une autre base que celle de `COMPTES_ENVIRONNEMENT.md`, renseigner `E2E_USERNAME` / `E2E_MANAGER_USERNAME` / `E2E_VIEWER_USERNAME` (et `*_PASSWORD`) avec les comptes de cette base, et exporter `RECETTE_PASSWORD` pour les specs de recette.
- Un skip silencieux n'est pas un vert : compter les skips dans le rapport de passe et en donner la cause.

## 2026-11-04 — Triggers d'alertes carburant : jamais exécutés, ils cassaient la saisie du 2e plein (retirés de #263, réécrits)

### Contexte
- `server/db/triggers/fuel-alerts-triggers.sql` n'était posé par aucun bootstrap. Installé à la main, il faisait échouer tout INSERT de plein à partir du 2e : `AVG(... LAG() OVER ...)` lève « aggregate function calls cannot contain window function calls ». Il formatait aussi par `%.1f` (non supporté par `format()`) et envoyait l'alerte à `user_id = 1` en dur.

### Cause racine
- Classification : code SQL jamais exécuté par un test. Un trigger n'est éprouvé qu'à l'INSERT ; aucune suite n'installait le fichier, et l'alerte n'était pas isolée de l'écriture métier.

### Résolution
- Fichier réécrit et ajouté à `BOOTSTRAP_SQL_FILES` (`server/init-database.ts`) :
  - moyenne sur une sous-requête de `lag()` (90 jours), `round()` au lieu de `%.1f` ;
  - destinataires par rôles dans `alert_recipient_settings` (réglage conservé au rejeu), préférence `in_app` respectée ;
  - déduplication `uq_alerts_user_dedupe` ;
  - bloc `EXCEPTION WHEN OTHERS THEN RAISE WARNING` : une alerte en échec n'annule jamais le plein.

### Prévention (vérifiable)
- `tests/integration/fuel-alerts-triggers.test.ts` installe le fichier et insère des pleins. Rouge sur l'original (4/5, erreur fenêtre/agrégat), vert sur la réécriture. `FUEL_ALERTS_SQL` permet de rejouer la preuve sur une autre version.
- `tests/unit/server/fuel-records-soft-delete-schema.test.ts` : fichier présent au bootstrap, ni `AVG(LAG`, ni `%.1f`, ni `VALUES (1,`, deux rattrapages d'exception, toutes les créations rejouables.

### Règle Projet (obligatoire)
- Un trigger posé au démarrage s'accompagne d'un test d'intégration qui l'installe et déclenche l'écriture qui l'appelle. Un effet secondaire (alerte, notification) attrape ses erreurs : il ne casse jamais l'écriture métier.
- Un fichier posé au démarrage modifie toutes les suites d'intégration : lancer la suite complète, pas seulement les tests du domaine (ici `recette-seed-reset` comptait 3 alertes, il en compte 5).
## 4 novembre 2026 - main rouge : signature de service changée, appelant de test oublié (#263)

### Contexte
#263 (suppression douce des pleins carburant) a ajouté un paramètre `actor` obligatoire à `FuelService.deleteFuelRecord`. Seul l'appelant de production (`fuel-records.routes.ts`) a été mis à jour ; `tests/integration/fuel-card-lock-coverage.test.ts` appelait encore `deleteFuelRecord(id)` : `TypeError: Cannot read properties of undefined (reading 'role')`, suite d'intégration rouge sur main.

### Cause racine
Le relecteur de #263 n'a rejoué que les tests carburant, pas la suite d'intégration complète. Un test d'intégration qui appelait le service n'a donc pas été exécuté.

### Résolution
Garde d'acteur en tête du service (`AppError` 401 au lieu d'un TypeError), test corrigé avec un acteur admin (le plein de la fabrique a mouvementé la carte : suppression douce, l'assertion d'origine « ligne absente » ne tenait plus), autres appelants recensés par grep (aucun autre).

### Prévention vérifiable
- La CI d'intégration est déjà un gate bloquant.
- Règle de relecture ajoutée à `AGENTS.md` §8 : tout changement de signature d'un service impose la suite d'intégration complète, rejouée par le relecteur.

### Leçon généralisée
Le périmètre de relecture se déduit de ce qu'un changement de signature peut casser (tous ses appelants), pas du domaine métier du diff.

## 2026-11-04 — Conflit de fusion résolu par `checkout --ours` : les changements de main dans tout le fichier perdus (near miss, #278)
- **Contexte** : fusion de main dans #278. `server/routes.ts` et `auth-login-unavailable.contract.test.ts` n'avaient qu'un bloc en conflit chacun ; je les ai résolus par `git checkout --ours <fichier>`.
- **Cause racine** : `--ours` remplace le fichier entier par la version de la branche. Il n'écarte pas seulement le bloc en conflit : toutes les modifications de main y disparaissent, même celles qui fusionnaient sans conflit. Ici, la validation de `PATCH /api/admin/users/:id/toggle` et la garde `isAnyUser` du libre-service ont été perdues.
- **Classification** : near miss, outillage git, régression silencieuse à la fusion. Elle a été vue avant le push par les cliquets `write-routes-ratchet` et les contrats R1/R8.
- **Résolution** : les deux fichiers repartent de `origin/main`, et seul le delta propre de la branche y est réappliqué.
- **Prévention vérifiable** :
  - après chaque fusion de main, `git diff origin/main --stat` ne doit lister que les fichiers du sujet ;
  - les suites unitaires et de contrat complètes sont rejouées avant le push (les cliquets de routes l'ont vu ici).
- **Leçon** :
  - `checkout --ours` ou `--theirs` ne résout un conflit que sur un fichier où l'on veut vraiment écarter l'autre côté en entier ;
  - sinon, on édite le bloc en conflit ;
  - pour un fichier en ajout de fin, `merge-file --union`.
## 4 novembre 2026 - un trigger d'effet secondaire casse les reprises d'historique (suivi de #287)

### Contexte
#287 a posé au démarrage des triggers d'alertes carburant. Trois chemins insèrent des pleins en masse sans couper leurs effets :
- la restauration de sauvegarde (`POST /api/admin/import-backup`) ;
- `scripts/import-7-fuel-records.ts` ;
- le seed.

La restauration vidait `alerts`, réinsérait les pleins (les triggers alertaient sur tout l'historique), puis réinsérait les alertes sauvegardées. Celles-ci heurtaient `uq_alerts_user_dedupe` (23505). Sans transaction, la base restait à moitié restaurée.

Deux défauts du trigger lui-même :
- `WHEN OTHERS` n'attrape pas `query_canceled` (57014) : un délai dépassé pendant l'alerte annulait le plein ;
- l'alerte n'avait pas de temps réel.

### Cause racine
La garde `fleetos.suppress_side_effects` existait déjà (CDC #9), mais aucun chemin de reprise ne la posait. L'ajout d'un trigger n'a pas déclenché la revue des écritures en masse sur la table.

### Résolution
- Restauration déplacée dans `server/api/admin-import-backup.routes.ts` et `server/services/backup-import-service.ts` : une transaction, `suppressSideEffects(tx)` avant toute écriture.
- Même garde pour le script d'import et pour le seed.
- `query_canceled OR OTHERS` dans les deux blocs d'exception.
  Conséquence assumée : un `pg_cancel_backend` volontaire pendant le calcul de l'alerte est lui aussi absorbé. Le plein est enregistré, seule l'alerte manque, avec un `RAISE WARNING`. On préfère perdre une alerte, recalculable, plutôt qu'un plein saisi.
- `pg_notify('fleet_events', alert_created)`, relayé par `db-event-relay` en trames nominatives.

### Prévention (vérifiable)
- `tests/unit/server/backup-import-service.test.ts` : la garde est posée avant la première écriture, et un échec annule tout.
- `tests/integration/fuel-alerts-triggers.test.ts` : reprise sans alerte et sans 23505 ; 57014 rattrapé (rouge sur main).
- `tests/integration/fuel-alerts-realtime.test.ts` (rouge sur main) et `tests/unit/server/db-event-relay-alerts.test.ts`.

### Leçon généralisée
Un trigger à effet secondaire s'accompagne du recensement des écritures en masse sur sa table (restauration, import, seed). Chacune pose la garde dans sa transaction. En PL/pgSQL, `WHEN OTHERS` ne couvre ni `query_canceled` ni `assert_failure`.
## 4 novembre 2026 - cycle d'alertes : requêtes par véhicule et ordres de travail plafonnés à 50 (#281)

### Contexte
Le cycle d'alertes (`AlertService.runAllAlertChecks`) faisait plusieurs requêtes par véhicule (plannings, historique carburant, liens de renouvellement), puis rechargeait toutes les alertes de chaque destinataire pour chaque alerte candidate. Mesure : 99 requêtes pour 2 véhicules neufs, 531 pour 12. En lisant le code, un second défaut est apparu : les ordres de travail passaient par `storage.getWorkOrders()`, plafonné par défaut à 50 lignes. Au-delà, les ordres de travail en retard n'étaient jamais alertés.

### Cause racine
- Le dédoublonnage était écrit candidate par candidate, en lecture complète (`getAlertsByUserId`), au lieu de s'appuyer sur la contrainte `uq_alerts_user_dedupe`.
- Le cycle réutilisait une méthode de liste paginée prévue pour l'UI, dont la limite par défaut est implicite.

### Résolution
- Les candidates sont mises en lot (`AsyncLocalStorage`) pendant le passage et émises à la fin, en un nombre fixe de requêtes, avec `ON CONFLICT DO NOTHING`.
- Les chargements sont groupés par véhicule.
- Les ordres de travail ouverts sont lus par une requête directe.
- L'alerte de consommation porte désormais la clé du trigger (`fuel-consumption:<plein>`) : une seule alerte par plein anormal.

### Prévention (vérifiable)
- `tests/integration/alert-cycle-query-count.test.ts` vérifie que 2 et 12 véhicules coûtent le même nombre de requêtes, avec une borne fixe. Il est rouge sur l'original (99 contre 531) et vérifie aussi le dédoublonnage rejoué et après lecture.

### Leçon généralisée
Un traitement planifié ne réutilise pas une méthode de liste UI sans vérifier sa limite par défaut. Un nombre de requêtes se fige par un test qui compte les requêtes sur deux tailles de données.

## 2026-11-04 — Near miss : serveur d'agent lancé avec `--env-file=.env` d'un worktree pointant la production (récidive de #259)

### Contexte
Pour la spec PWA de #279, un agent a démarré le serveur de son worktree (`.claude/worktrees/agent-a91de81a6c5dc3623`) par `NODE_ENV=development node --env-file=.env … server/index.ts`. Le `.env` de ce worktree portait une ligne `DATABASE_URL` vers l'ancien Neon de production. C'est le deuxième démarrage de serveur avec `--env-file=.env` de la journée. Le premier est le near miss de #259.

### Ce qui s'est passé
- Le `.env` définissait `DATABASE_URL` deux fois. La ligne 2 visait la production, une ligne plus bas visait la base de test. `node --env-file` garde la dernière valeur : le serveur a donc visé la base de test, par le seul hasard de l'ordre des lignes.
- Le log du serveur le confirme : connexion à la base de test seulement, l'URL wss des erreurs vise `ep-plain-lake`, aucune occurrence de `ep-bitter-term`. L'agent a été arrêté, et les lignes de production (la clé et un commentaire psql) ont été retirées du `.env` du worktree.
- La garde de #259 (`server/lib/production-db-guard.ts`, appelée par `server/db.ts`) était présente dans la branche, et active : `NODE_ENV=development`.
- Reproduction sur main, avec un `.env` factice dont l'hôte porte le marqueur (domaine `.invalid`, aucun contact réseau) : `node --env-file=<factice> … server/index.ts` s'arrête avant tout pool sur « Connexion refusée : DATABASE_URL vise la base de production ». La garde serveur lit la valeur effective : le chemin `--env-file` n'est pas un trou.
- Trou trouvé dans la garde e2e : `databaseUrlFromDotenv` (`e2e/helpers/production-guard.ts`) lisait la **première** ligne `DATABASE_URL`, alors que Node garde la **dernière**. Avec la base de test en premier et la production en dernier, la garde Playwright laissait passer un serveur qui aurait visé la production.

### Cause racine
La copie d'un `.env` racine dans un worktree emporte l'URL de production. Le brief de l'agent ne lui interdisait pas `--env-file=.env`. La garde de #259 protège l'exécution, mais pas la présence de l'URL dans les fichiers.

### Prévention (vérifiable)
- Garde au démarrage : `tests/unit/server/production-db-guard.test.ts`, plus la reproduction ci-dessus, rejouable en une commande. Aucun trou côté serveur (marqueur, `NODE_ENV`, chemin de démarrage).
- Clé en double : `databaseUrlFromDotenv` refuse un `.env` qui définit `DATABASE_URL` plus d'une fois (forme `export` comprise, lignes commentées et `DATABASE_URL_TEST` exclues). Le message ne contient pas l'URL. Test : `tests/unit/e2e/production-guard.test.ts`, rouge sur l'ancienne version, vert ensuite.
- Règle de brief, tenue par l'orchestrateur : un agent qui démarre un serveur force `DATABASE_URL` depuis `DATABASE_URL_TEST`, avec une garde d'hôte, et n'utilise jamais `--env-file=.env`. Les `.env` de worktree ne portent que `DATABASE_URL_TEST`.

### Leçon généralisée
Avant de coder un deuxième contrôle après une récidive, rejouer le scénario contre le premier : ici, la garde serveur tenait. La récidive vient du geste (`--env-file` sur un `.env` qui porte la prod) : c'est le brief et le contenu des `.env` qu'il faut corriger. Une clé en double dans un `.env` est un piège : l'ordre des lignes décide de la base visée, et tout lecteur maison doit soit reproduire la règle du chargeur réel, soit refuser l'ambiguïté.
## 4 novembre 2026 - verrou consultatif de sauvegarde instable en suite complète (#298)

### Contexte
`tests/integration/backup-production.test.ts` (verrou consultatif) échouait pendant la suite complète, fichier compris, et passait lancé seul.

### Cause racine
Le test prenait la clé de production (`hashtext('backup')`), commune à toute la base. La base de test locale est partagée entre sessions, et un serveur local dont le planificateur sauvegarde sur cette base tient cette clé : `tryAcquire()` renvoie `false` sans défaut du code.

Deux facteurs aggravants :
- le test ne rendait pas ses connexions en cas d'échec ;
- l'`afterAll` fermait `listenerPool`, partagé par toute la suite (`isolate: false`). Un `end()` bloqué sur une connexion non rendue fait échouer le fichier entier.

Reproduit : avec un détenteur externe de la clé sur la base de test, la version de main échoue (`expected false to be true`). La branche reste verte.

Risque voisin relevé : `listenerPool` lit `DATABASE_URL_LISTENER` et `DATABASE_URL_DIRECT` avant `DATABASE_URL`. Héritées d'un `.env`, elles feraient écouter et verrouiller les tests sur une autre base. `assertSafeTestDatabase` (`e2e/helpers/production-guard.ts`) refuse déjà des variables `_LISTENER` et `_DIRECT` qui divergent de la base de test. La garde de `server/db.ts` (`resolveListenerConnectionString`) est une seconde couche, au point où la connexion s'ouvre.

### Résolution
- Clé du verrou injectable : `createAdvisoryBackupLock(lockKey)`. Le test utilise une clé unique par passage, rend ses connexions en `finally` et ne ferme plus le pool partagé.
- `setup-db.ts` force les deux variables à la base de test, sur l'hôte direct (`deriveDirectConnectionString`, sans `-pooler.`).
  `assertSafeTestDatabase` accepte donc pour ces deux variables la forme directe de la base de test, et pour elles seules. Ce garde est rejoué avant chaque fichier sous `isolate:false`, où l'environnement est partagé : sans cette tolérance, le second fichier serait refusé sur une base de test Neon pooler.
- `resolveListenerConnectionString` refuse en `NODE_ENV=test` une variable dédiée qui vise une autre base.

### Prévention (vérifiable)
- `backup-production.test.ts` tient lui-même la clé de production pendant le test : il reste vert.
- `tests/unit/server/listener-connection.test.ts` (refus, message sans URL, épinglage par setup-db).

### Leçon généralisée
Un test d'intégration n'emprunte jamais une ressource globale de production (verrou consultatif, canal, nom fixe) sur une base partagée. Il prend une clé à lui, rend tout en `finally`, et ne ferme pas un pool partagé par la suite.

## 2026-11-04 — Fausse alerte « double entrée en stock » : test de concurrence qui ne forçait pas la course

### Contexte
`tests/integration/part-requirements-idempotence.test.ts` (« deux réceptions simultanées n'entrent le stock qu'une fois ») échouait 5 fois sur 5, seul et sous verrou, sur une base dédiée. L'échec se reproduisait sur `main` nu et même sur un commit qui était vert une heure plus tôt. Il annonçait 2 succès au lieu d'1, ce qui faisait craindre une double entrée en stock.

### Ce qui s'est passé
Le stock était juste : 5 → 7, un seul mouvement. Les deux appels partaient par `Promise.all`, mais la seconde requête lisait le statut **après** le commit de la première. Elle voyait alors `received → received`, prenait la branche sans changement de statut et rendait `success: true`. C'est le no-op voulu, que le test voisin « réception rejouée après coup » exige.

### Cause racine
Le test supposait que deux appels lancés ensemble lisent ensemble. L'entrelacement dépendait de la latence du pool et du proxy WebSocket : il a changé sans aucun commit et a fait basculer le résultat. Classification : test non déterministe, pas de régression du code.

### Résolution
Course forcée : une connexion tient `SELECT … FOR UPDATE` sur la demande. Le test attend que `pg_stat_activity` montre les deux `UPDATE` bloqués sur ce verrou, donc que les deux requêtes ont lu `ordered`, puis relâche le verrou. Le compare-and-set (`WHERE status = <lu>`) refuse alors exactement la seconde.

### Prévention (vérifiable)
- 5 passages verts sur base dédiée sous `lot-tools/db-lock.mjs`.
- Rouge prouvé : sans le compare-and-set du service, le test échoue (2 succès).

### Leçon généralisée
Un test de concurrence ne se contente pas de `Promise.all` : il force l'entrelacement qu'il prétend couvrir, par verrou de ligne, barrière ou advisory lock, et il attend un état observable (`pg_stat_activity`) au lieu d'un délai. Avant de conclure à une perte d'intégrité, mesurer l'invariant (stock, mouvements) et pas seulement le compte de succès.
## 2026-11-04 — Compteur anti-force brute lu puis écrit en deux temps

- **Contexte** : `loginLockoutGuard` protège la connexion par mot de passe (`pwd:`), par PIN (`pin:`) et
  le changement de mot de passe (`cpw:`). Un audit de sécurité a montré qu'une rafale de requêtes
  simultanées contournait le verrou. Sur la base de test, 20 PIN faux en parallèle donnaient 11 réponses
  401 (11 PIN vérifiés), et 20 mots de passe faux donnaient 20 réponses 401, pour un seuil de 5.
- **Cause racine** : la garde lisait l'état (`get`), laissait passer, et n'écrivait l'échec qu'à
  `res.on("finish")`, après le bcrypt. Toutes les requêtes parties avant la fin du premier bcrypt
  lisaient « non verrouillé ». L'écriture était atomique, mais la décision ne l'était pas.
- **Classification** : sécurité, condition de concurrence (TOCTOU) sur un contrôle anti-force brute.
  Elle était aggravée par :
  - un PIN de 4 chiffres ;
  - une liste des chauffeurs publique ;
  - aucune limite par IP.
- **Résolution** :
  - `LockoutStore.reserve` compte la tentative avant le handler, de façon atomique :
    lecture et écriture dans une transaction, sous verrou consultatif pris sur la clé (`pg_advisory_xact_lock`),
    `SELECT` de l'état puis upsert ;
  - au-delà du seuil, le verrou est posé et la requête refusée en 429 ;
  - en fin de requête :
    - 401 → `confirmFailure` (verrou au seuil) ;
    - 2xx → `reset` ;
    - 400 ou 5xx → `release` : la réponse ne dit rien du secret, et une panne n'est pas un échec de connexion
      (`auth-login-unavailable.contract.test.ts`). Seuls les 401 consomment le seuil, la borne tient ;
    - tout autre statut, ou une connexion coupée sans réponse, reste compté (le verrou expire seul) ;
  - compteur indisponible : la garde refuse en 503 sans appeler le handler (fermée sur panne), le refus n'est pas compté ;
  - lecture et écriture du compteur dans une transaction, sous `pg_advisory_xact_lock` pris sur la clé. Une
    première version en CTE `FOR UPDATE` ne verrouillait rien tant que la ligne n'existait pas : 20 réservations
    parallèles donnaient 20 audits `lock`. Le test d'intégration l'a vu ;
  - l'audit `lock` n'est écrit qu'au passage « non verrouillé → verrouillé » ;
  - en complément, un plafond d'échecs par IP est monté devant `/api/auth/login` et `/api/auth/pin-login`
    (`server/middleware/auth-ip-limit.ts`). Un succès n'y rend que son propre jeton et ne réinitialise pas
    la fenêtre. Seul le dernier saut est retenu (`trust proxy 1`). La mémoire est bornée.
- **Prévention vérifiable** :
  - `tests/contract/login-lockout-concurrency.contract.test.ts` (rouge sur l'ancien code) : 20 requêtes en
    `Promise.all`, au plus MAX réponses 401 ; limite par IP avec succès intercalés et X-Forwarded-For forgé ;
  - `tests/integration/login-lockout-db-store.test.ts` : 20 réservations parallèles, exactement MAX
    admises, un seul audit ;
  - `tests/unit/server/auth-ip-limit.test.ts` : rafale sur la garde, statuts rendus ou comptés, Map bornée,
    Retry-After, 503 sans vérification si le compteur est en panne.
- **Leçon** : un contrôle anti-force brute décide et compte dans la même écriture, avant le travail
  coûteux. « Lire, laisser passer, écrire après » n'est jamais atomique, même si chaque requête SQL
  l'est. Le test qui le prouve joue des requêtes simultanées. Des requêtes séquentielles ne verront
  jamais ce défaut.

## 2026-11-04 — `drizzle-kit push --force` tombé sur la base d'une autre session

- **Contexte** : après un redémarrage de Docker Desktop, Windows a réservé la plage de ports TCP 54299-54398,
  dont 54320 (base de test standard). Une pile de test alternative a été montée sur 55432 sans vérifier que
  ce port était libre ; il appartenait à la pile `c7test` d'une autre session.
- **Cause racine** : `DATABASE_URL=…@localhost:<port>` désigne un port, pas une pile. Le compose a échoué sur
  « port is already allocated » pour mon conteneur, mais la commande suivante, enchaînée, a poussé le schéma
  sur le conteneur qui tenait déjà le port.
- **Classification** : near miss, écriture sur une ressource partagée appartenant à un tiers. Schéma poussé
  identique à celui de `main` ; une divergence de schéma chez `c7test` aurait pu être modifiée en silence
  (`--force` accepte les pertes de données).
- **Résolution** : pile `fm-cpw` remontée sur 56432/56433 (fichier de ports hors dépôt), contrôle de ce qui
  écoute avant tout push, propriétaire de `c7test` prévenu par l'orchestrateur.
- **Prévention** :
  - ne jamais enchaîner `compose up` et `drizzle-kit push` sans `&&` ni contrôle : un échec du premier doit
    arrêter le second ;
  - avant un `push --force`, vérifier le propriétaire du port (`docker ps --format '{{.Names}} {{.Ports}}'`) ;
  - cibler la base par son nom propre à la session (`fleet_test_<session>`, `tests/README.md`).
- **Leçon généralisée** : une commande destructive vise une identité (projet, base), jamais seulement un port ;
  on vérifie ce qui répond avant de lui écrire.

## 4 novembre 2026 : changer le mot de passe ne coupait pas les autres sessions

- **Contexte** : `POST /api/users/change-password` écrivait le nouveau hash sans toucher à la table `session`.
- **Cause racine** : les sessions sont indépendantes du secret qui les a ouvertes ; seule la suppression du compte
  (`revokeUserAccess`) les révoquait.
- **Prévention vérifiable** : `tests/contract/change-password-revoke-sessions.contract.test.ts` (deux sessions du
  même compte : celle qui change reste à 200, l'autre passe à 401 ; mot de passe actuel faux : rien n'est révoqué ;
  autre compte intact) et `tests/integration/revoke-other-user-sessions.test.ts` (second appel = 0 suppression).
- **Leçon** : toute modification d'un secret d'authentification (mot de passe, PIN) révoque les autres sessions du
  compte et ferme leurs sockets ; la session courante est exclue par son identifiant, jamais par un filtre sur l'utilisateur seul.

## 4 novembre 2026 : le PATCH admin d'un utilisateur écrivait le PIN sans le hacher

- **Contexte** : `PATCH /api/users/:id` hachait `password` mais laissait passer `pin` tel quel vers la base, alors que `POST /api/auth/pin-login` compare le PIN reçu à un hash bcrypt.
- **Cause racine** : `insertUserSchema` est dérivé de la table (`createInsertSchema`) : il accepte toute colonne, y compris les colonnes secrètes. Seul le champ nommé explicitement dans le handler (`password`) était traité ; `pin` suivait le chemin générique.
- **Prévention vérifiable** : `tests/contract/admin-patch-user-pin.contract.test.ts` (PIN valide stocké en bcrypt, jamais renvoyé, `pin-login` fonctionne ; PIN invalide : 400 ; PIN vide ignoré). Reprise rétroactive `hashPlainUserPins` (`server/lib/pin-hash-migration.ts`, appelée par `initializeDatabase`) testée par `tests/integration/pin-hash-migration.test.ts` (clair haché, hash existant intact, second passage à 0 écriture).
- **Leçon** : un schéma d'insertion dérivé de la table accepte toute colonne secrète. Un secret écrit par une route générique passe par un hachage explicite, retiré du corps avant le `parse`, et une reprise idempotente traite les valeurs déjà stockées en clair.

## 4 novembre 2026 : un état partiel ne passe pas par une erreur 5xx

- **Contexte** : changement de mot de passe, première version : hash écrit, puis révocation des autres sessions qui
  pouvait échouer. Une AppError 5xx aurait fait croire à un échec du changement.
- **Cause racine** : `error-handler.ts:97` remplace toujours le message d'une 5xx par le message générique ;
  l'état partiel ne peut donc pas être annoncé par ce canal. Et deux écritures séparées laissent un état partiel.
- **Prévention vérifiable** : le hash et le DELETE des sessions sont dans une seule transaction ; le contrat
  `change-password-revoke-sessions` fait échouer le DELETE par un espion et vérifie : réponse >= 500, hash
  inchangé, ancien mot de passe valable, autre session valide. L'UPDATE conditionné à l'ancien hash est couvert
  par le contrat de deux changements concurrents (200 + 409).
- **Leçon** : un état partiel à annoncer à l'utilisateur ne passe jamais par une AppError 5xx. Il passe par une
  transaction (tout ou rien) ou par une réponse 2xx/4xx explicite. Les effets non transactionnels (sockets) se
  déclenchent après le commit.
## 2026-11-04 — Écarts de rapprochement : « Examiner » ouvrait `/procurement/invoices/undefined`

### Contexte
En écrivant la donnée de la spec e2e 04 (facture fournisseur en écart), le bouton « Examiner » de `/procurement/invoices/discrepancies` menait à `/procurement/invoices/undefined`. La spec était ignorée depuis longtemps faute de données : rien ne l'avait signalé.

### Cause racine
La page et l'API étaient désalignées sur les noms de champs. `client/src/pages/procurement/invoices/discrepancies.tsx` lit `id`, `totalAmountTTC`, `invoiceDate`, `status`, `purchaseOrderNumber`, ainsi que `totalDiscrepancyAmount` et `averageVariance` au niveau racine. `escalateDiscrepancies` (`server/services/three-way-matching-service.ts`) renvoyait `invoiceId`, `orderNumber`, etc. Chaque côté avait son propre type écrit à la main, et aucun test ne vérifiait la forme consommée par l'écran. Classification : contrat implicite non testé.

### Résolution
Correctif additif côté service : les champs lus par la page sont ajoutés (`id`, `supplierId`, `invoiceDate`, `totalAmountTTC`, `status`, `purchaseOrderNumber`, ainsi que les totaux racine), et les anciens sont conservés pour tout autre consommateur.

### Prévention (vérifiable)
- `tests/contract/purchase-order-three-way.contract.test.ts` exige ces champs sur l'élément de la facture créée, avec des totaux numériques. Rouge sur l'ancien service.
- La spec e2e 04 crée sa propre facture en écart et clique « Examiner » jusqu'au détail : elle n'est plus ignorée.

### Leçon généralisée
Un écran qui type à la main la réponse d'une route est un contrat implicite. Le test de contrat de la route doit affirmer les champs que l'écran lit, pas seulement le statut HTTP ou la présence de l'id. Une spec e2e ignorée faute de données ne protège rien : la donnée se crée dans la spec.

## 2026-11-04 — `trust proxy` fixé en dur : la limite par IP dépendait de la topologie

- **Contexte** : la limite d'essais de connexion par adresse IP lit `req.ip`, donc `X-Forwarded-For` jusqu'au
  nombre de sauts de confiance. Ce nombre était fixé à 1 dans `server/app.ts`.
- **Cause racine** : le réglage décrivait le seul déploiement derrière Caddy. Le profil `site` du compose
  publie l'application directement sur le réseau local : un client y choisit lui-même l'adresse comptée en
  forgeant l'en-tête, et le plafond par IP ne joue plus. Détecté par l'audit de sécurité du lot, avant tout
  usage de la limite sur ce profil.
- **Classification** : sécurité, configuration dépendante de l'environnement (hypothèse de topologie en dur).
  Near miss : aucune exploitation, la garde par compte restait active.
- **Résolution** : `TRUST_PROXY` lu par `trustProxyFromEnv` (défaut 1, `0` = aucun proxy de confiance) ;
  `app-site` fixe `TRUST_PROXY: "0"`.
- **Prévention (vérifiable)** :
  - `tests/contract/trust-proxy.contract.test.ts` : à `TRUST_PROXY=0`, un `X-Forwarded-For` changé à chaque essai
    ne contourne pas le plafond (rouge sans le correctif) ;
  - `tests/unit/server/trust-proxy.test.ts` : le profil `site` du compose fixe `TRUST_PROXY: "0"`, `vps` et
    `recette` ne le désactivent pas.
- **Leçon généralisée** : une valeur qui dépend de la topologie (sauts de proxy, hôtes de confiance, ports
  publiés) se déclare par profil de déploiement, avec un défaut sûr et un test qui lit la configuration de
  chaque profil. Elle ne se fixe pas en dur pour le cas de production.

## 2026-11-04 — Compte chauffeur : le mot de passe était dérivé du PIN

### Contexte
La création d'un compte chauffeur (`POST /api/drivers/:id/create-user`) posait le PIN haché comme mot de passe. Un PIN de quatre chiffres, qui sert à `pin-login` (limité par compte), ouvrait donc aussi `/api/auth/login`.

### Cause racine
Un second secret (le mot de passe) a été rempli avec la valeur d'un premier (le PIN) « pour que la colonne ne soit pas vide ». Le secret le plus faible fixait la force de l'autre, et changer le PIN pouvait remettre le même lien en place.

### Résolution
Mot de passe aléatoire à la création (`randomPasswordHash`), reprise idempotente des comptes existants au démarrage (`revokePinDerivedDriverPasswords`, garde `password = pin`, zéro écriture au second passage), PATCH administrateur sans recopie du PIN.

### Prévention (vérifiable)
- `tests/contract/pin-login-hardening.contract.test.ts` (E2) : le mot de passe créé diffère du PIN et refuse PIN et identifiant.
- `tests/contract/driver-account-secret.contract.test.ts` : après un changement de PIN par l'admin, ni l'ancien ni le nouveau PIN n'ouvrent `/api/auth/login`, seul le nouveau ouvre `pin-login`. Vu rouge quand le PATCH recopie le PIN dans le mot de passe.
- `tests/integration/driver-password-pin-revocation.test.ts` : reprise idempotente.

### Leçon généralisée
Un secret ne se dérive jamais d'un autre secret, même pour remplir une colonne obligatoire : donner à chaque secret sa propre valeur aléatoire, et tester que changer l'un n'ouvre pas l'autre.

## 2026-11-04 — Une CHECK de sécurité rend visible la valeur refusée dans les logs

- **Contexte** : CHECK `users_pin_bcrypt_check` (PIN en base = hash bcrypt ou NULL), relue par la sécurité avant fusion (#320).
- **Cause racine** : `POST /api/users` et `POST /api/auth/register` passaient `pin` brut à `storage.createUser` (`insertUserSchema` ne l'omet pas). Une écriture refusée renvoie 23514 avec `detail: "Failing row contains (…1234…)"`, journalisé tel quel : la contrainte qui protège le secret l'aurait écrit dans les logs. Le redact pino ne couvrait pas `err.detail`.
- **Classification** : near miss (détecté en relecture, jamais déployé) ; défaut de conception : contrainte posée sans avoir passé en revue chaque chemin d'écriture de la colonne.
- **Résolution** : PIN validé (4 chiffres) puis haché dans les deux routes de création (`server/lib/user-pin.ts`), 400 lisible au lieu de 500 ; `err.detail` et `err.where` masqués dans `server/lib/logger.ts`.
- **Prévention vérifiable** : `tests/contract/user-create-pin-hashed.contract.test.ts` (clair jamais écrit, 400 sur PIN invalide) ; `tests/unit/server/logger-redact.test.ts` (aucune valeur d'une ligne refusée ne sort dans le journal).
- **Leçon généralisée** : avant de poser une contrainte sur une colonne secrète, lister et tester chaque chemin d'écriture (routes, import de sauvegarde, scripts) ; un message d'erreur de base de données contient la donnée refusée, donc le redact doit couvrir `detail` et `where`.

### Complément (2026-11-04) — le masquage pino ne couvre pas `console.*`
Les `console.error("Error creating user:", error)` de `storage.createUser` et des routes de comptes affichaient l'erreur SQL brute, `detail` compris, hors de portée du `redact` pino. Migrés vers `moduleLogger` avec `{ err, requestId }` ; `tests/unit/server/accounts-no-console.test.ts` interdit tout `console.*` dans ces handlers et méthodes de stockage (liste gelée vide). Un log ne se supprime pas : il se migre.

### Complément (2026-11-04) — l'import valide le PIN comme les routes
L'import valide le PIN comme les routes, il ne se contente pas de le hacher : `restoreBackup` passe par `pinForRestore` (`server/lib/user-pin.ts`) : vide → NULL, nombre → haché, non conforme (hors 4 chiffres et hors `$2a/b/y`) → NULL + `warn` avec le seul nom d'utilisateur, hash repris tel quel. Hachage fait avant `db.transaction` (pas de N bcrypt sous verrous après les DELETE), un PIN exotique n'annule plus toute la restauration. Prévention : `tests/unit/server/user-pin.test.ts` et `backup-import-service.test.ts`.

## 2026-11-05 — Mission créée avec affectation : restée « planned » (trois chemins, deux règles)
- **Contexte** : démo logistique. Une mission créée avec véhicule et chauffeur restait `planned`, alors que les deux autres chemins d'affectation (PATCH `{ assignment }`, `POST /:id/assignments`) la passent à `assigned`.
- **Cause racine** : la règle « affectée => `assigned` » était écrite dans chaque chemin d'affectation, pas à un endroit. La création n'avait pas la sienne et aucun test ne couvrait « créer avec affectation ». Mission et affectation s'insérant hors transaction, une affectation en échec laissait aussi une mission orpheline. La création comparait enfin le CPC à `"FORMÉ"` sans normaliser, contrairement aux autres chemins (`normalizeCpcStatus`).
- **Résolution** : `POST /api/missions` insère mission et affectation dans une transaction ; `planned` + affectation => `assigned` (affectation `pending`) ; `draft` + affectation reste `draft` ; CPC normalisé comme ailleurs.
- **Prévention vérifiable** : `tests/contract/mission-create-assigned.contract.test.ts` (4 cas : `planned`+aff, `planned` seul, `draft`+aff, affectation refusée => aucune mission).
- **Leçon généralisée** : une transition d'état déclenchée par un fait (ici l'affectation) se teste sur chaque chemin qui crée ce fait, création comprise ; deux écritures liées vont dans une même transaction.
- **Couche 3** : `mission_created` et `mission_updated` invalident les mêmes clés (`["missions"]`, `realtime-satellites.ts`), donc rien à compléter : le statut `assigned` est aussi lu par les écrans « à venir » via la même invalidation.
- **Question ouverte (métier)** : `assigned` signifie ici « affectée » (affectation `pending`), alors que `PUT /:id/status` vers `assigned` passe l'affectation à `accepted`. Le sens de `assigned` (affectée ou acceptée par le chauffeur) reste à trancher ; aucun changement de `PUT /status` dans ce lot.
  Même incohérence, défaut antérieur : une mission `draft` avec affectation, puis `PUT /status` vers `planned`, donne `planned` avec une affectation `pending` (jamais `assigned`). Non traité ici.
- **Suite possible** : la création ne vérifie pas les conflits de planning (véhicule ou chauffeur déjà pris sur le créneau), contrairement à `POST /:id/assignments`.
### Complément (2026-11-05) — l'import valide aussi le mot de passe (#323)
`restoreBackup` insérait `users.password` tel quel : un clair d'une vieille sauvegarde était stocké en clair, puis refusé au login (le login n'accepte qu'un bcrypt ou un SHA-256 hérité). `passwordForRestore` (`server/lib/user-password.ts`) : bcrypt complet (motif strict, 60 caractères) ou SHA-256 hex minuscule → repris (le login migre le SHA-256, `server/routes.ts:213-234`) ; clair d'au moins `PASSWORD_MIN_LENGTH` → haché ; reste → hash aléatoire inutilisable + `warn` avec le seul username (ni valeur ni longueur). Leçon : chaque colonne secrète d'un import a son validateur, pas seulement celle qui porte une contrainte. Prévention : `tests/unit/server/user-password.test.ts`, `tests/contract/backup-import-password.contract.test.ts` (rouge vu sur le comportement de main).
## 2026-11-05 — Éligibilité CPC : une troisième copie locale de la règle avait dérivé

- **Contexte** : à l'étape 3 de l'assistant de mission, un chauffeur au CPC valide apparaissait « NON FORMÉ » et « Suivant » restait muet (#327).
- **Cause racine** : la règle existait en trois copies. `GET /api/drivers` recalculait `cpcStatus` depuis `cpcTrainingDate` (`cpc-training-service.ts`), les gardes de `missions.routes.ts` lisaient le statut enregistré (`drivers.cpc_status`), l'assistant relisait le statut recalculé. Date absente et statut enregistré valide : l'écran bloquait ce que le serveur acceptait. Le correctif naïf (ne lire que le statut enregistré) aurait ouvert l'inverse : aucune tâche planifiée ne remet `cpc_status` à jour, un chauffeur « FORMÉ » dont la formation a plus de 731 jours passait les quatre gardes (détecté en relecture sécurité avant fusion).
- **Classification** : divergence de règle entre affichage et garde ; near miss de régression réglementaire (détecté avant déploiement).
- **Résolution** : module unique `shared/constants/driver-cpc-eligibility.ts` (statut enregistré valide ET formation non expirée si la date existe, durée `CPC_VALIDITY_DAYS` partagée avec le service, jour d'expiration via `shared/constants/expiry-day.ts`), utilisé par les quatre gardes serveur et par l'assistant, qui affiche la raison du blocage.
- **Prévention vérifiable** : `tests/unit/shared/driver-cpc-eligibility.test.ts` (date absente, récente, expirée, jour J) ; `tests/unit/client/mission-wizard-rules.test.ts` ; `tests/contract/mission-driver-cpc-status.contract.test.ts` (400 sur création, PATCH, ajout d'affectation et lancement pour un chauffeur « FORMÉ » à J-800 ; FORME sans accent accepté ; `cpcStatusRecorded` exposé), vu rouge sans le correctif (6 échecs sur 7) puis vert.
- **Leçon généralisée** : un statut dérivé que l'on stocke sans recalcul planifié devient périmé en silence ; une garde réglementaire avec expiration juge la date, pas le statut. Une règle métier a un seul module partagé : toute copie locale finit par diverger.

## 2026-11-05 — Near miss : décalage J-1 à 23h30 UTC sur le calcul local du jour (cpc-training-service)

- **Contexte** : le statut CPC calculé par `cpc-training-service.ts` comparait des instants (millisecondes, jour local) au lieu de jours calendaires. Détecté en relecture de #327, corrigé par #333, avant tout incident constaté.
- **Cause racine** : le « jour courant » était pris avec les accesseurs locaux de `Date` et une division en millisecondes. Entre 23h00 et minuit UTC, le résultat basculait d'un jour : -1 jour restant le dernier jour valable, donc une formation encore valable passait « À FORMER », et une date future donnait FORMÉ sans formation faite. Le défaut ne se voyait qu'à certaines heures, aucun test à heure réelle ne pouvait le révéler.
- **Classification** : near miss, erreur de calcul de date dépendante de l'heure ; régression réglementaire évitée (détecté avant déploiement).
- **Résolution** : jour UTC unique via `shared/constants/expiry-day.ts` (`todayUtcDateOnly`, `addDaysToDateOnly`, `isExpiredOn`), seule source des échéances ; le service n'a plus de calcul local ; date de formation future refusée à la saisie (#333) et inéligible dans la règle partagée.
- **Prévention vérifiable** : garde-fou `tests/unit/server/expiry-day-local-math-hygiene.test.ts` (échoue sur tout accesseur local de date sur les chemins d'échéance, liste gelée) ; `tests/unit/server/cpc-training-service.test.ts` à heure simulée 23h30 UTC (le dernier jour valable reste valable) ; `tests/unit/shared/driver-cpc-eligibility-codes.test.ts` (FORMÉ à J+30 inéligible).
- **Leçon généralisée** : une échéance est une date sans heure, comparée en jours calendaires UTC par un seul module. Tout calcul de durée en millisecondes ou en jour local est un défaut latent qui ne se déclenche qu'à certaines heures : le test doit simuler l'heure (23h30 UTC), pas attendre qu'elle arrive.


## 2026-11-05 — Contrôle de lien : la référence était le dossier visé lui-même

- **Contexte** : #340 ajoutait `realPathStaysInside` à la copie des documents de workflow vers le dossier du véhicule. Relecture : le contrôle ne refusait rien (near miss, détecté avant fusion).
- **Cause racine** : la référence passée était `uploads/documents/vehicle-<id>`, calculée depuis l'id. Si ce dossier est lui-même une jonction vers l'extérieur, référence et candidat se résolvent tous deux dehors : le candidat reste « sous » la référence. Le contrôle venait en plus après le `mkdirSync`.
- **Classification** : garde de sécurité inopérante par mauvais choix de référence ; near miss.
- **Résolution** : référence = racine possédée `uploads/documents`, contrôle avant tout `mkdir` ; dossier refusé → aucun document transféré, `log.warn` sans chemin. Côté multer, un id valide dont le dossier mène dehors renvoie « Dossier de destination invalide » (plus « ID de véhicule invalide »).
- **Prévention vérifiable** : `tests/integration/workflow-document-transfer.test.ts` (jonction `vehicle-<id>` vers un dossier extérieur : rien copié, document non transféré) et `tests/contract/vehicle-documents-upload-path.contract.test.ts` (400 « Dossier de destination invalide », rien écrit dehors), rouges sur la version précédente, verts après.
- **Leçon généralisée** : la référence d'un contrôle de chemin réel est la racine de l'application, jamais un sous-dossier calculé depuis une donnée de requête ou un id : ce sous-dossier est précisément ce qu'un lien peut remplacer.
## 2026-11-05 — Conflit de planning : contrôle copié trois fois, absent de la création et du PATCH

- **Contexte** : suite de #328. `POST /api/missions` avec affectation et `PATCH /:id` (changement de véhicule, de chauffeur ou de dates) n'avaient aucun contrôle de conflit de planning ; seuls `POST /:id/assignments` et le lancement l'appliquaient.
- **Cause racine** : la règle existait en trois copies (`launch-readiness`, `POST /:id/assignments`, validation de lancement de `PUT /:id/status`) ; les chemins ajoutés ensuite ne l'ont pas reprise. Les deux contrôles lecture-puis-écriture n'étaient pas sérialisés : deux créations simultanées sur le même chauffeur passaient toutes deux.
- **Classification** : règle métier absente sur des chemins d'écriture (double affectation) ; course de lecture-puis-écriture.
- **Résolution** : `server/services/mission-planning.ts` (`findPlanningClash`, `planningClashMessage`, `lockPlanningResources`, `lockPlanningPairs`, `overlaps`, `ACTIVE_MISSION_STATUSES`) remplace les trois copies et alimente la création et le PATCH. Création et PATCH contrôlent dans la transaction, après `pg_advisory_xact_lock` pris dans un ordre global (tous les véhicules triés par id, puis tous les chauffeurs triés, dédoublonnés), avant l'écriture. Le PATCH prend d'abord la ligne mission `FOR UPDATE`, comme `POST /:id/assignments` : l'ordre inverse (verrous consultatifs puis ligne) interbloquait un PATCH et un ajout d'affectation sur le même véhicule (40P01, donc 500). Le PATCH écrit désormais l'affectation dans la transaction finale, avec la mission. Conflit : 409 « Conflit de planning : … ». Le PATCH ne contrôle que si la paire véhicule/chauffeur ou le créneau change ; un renvoi identique ne contrôle rien.
- **Prévention vérifiable** : `tests/contract/mission-planning-conflict-write.contract.test.ts` (9 cas, 6 rouges sans le contrôle ; la rafale de 2 créations est rouge 3 fois sur 3 sans le verrou ; la rafale PATCH de dates + ajout d'affectation sur le même véhicule est rouge 3 fois sur 3 sans le `FOR UPDATE` du PATCH) ; `tests/integration/mission-planning-clash.test.ts` (chevauchement, bords inclus, statuts ignorés).
- **Leçon généralisée** : une règle partagée entre plusieurs chemins d'écriture vit dans un seul module appelé par tous ; une garde « lire puis écrire » sur une ressource partagée se sérialise (verrou de transaction) et se prouve par un test en rafale. Deux familles de verrous (ligne et consultatif) exigent un seul ordre d'acquisition pour tous les appelants, prouvé par une rafale croisée.
- **Suivis** : `PUT /:id/status` vers `planned` ou `assigned` rejoue désormais le contrôle sous le même ordre de verrous (ligne mission, puis clés triées) ; `launch-readiness` et la validation de lancement lisent hors verrou (ils ne font qu'indiquer un blocage, sans écrire d'affectation) ; dans le PATCH, `liveAssignments` est lu avant la transaction : une affectation ajoutée entre la lecture et l'écriture n'est pas revue (suivi, hors de ce lot).
- **Suivis** : `PUT /:id/status` vers `planned` ou `assigned` ne rejoue pas le contrôle (branche empilée) ; `launch-readiness` et la validation de lancement lisent hors verrou (ils ne font qu'indiquer un blocage, sans écrire d'affectation) ; dans le PATCH, `liveAssignments` est lu avant la transaction : une affectation ajoutée entre la lecture et l'écriture n'est pas revue (suivi, hors de ce lot).

## 2026-11-05 — Fichier SQL de trigger présent mais jamais appliqué

- **Contexte** : revue des accès disque (lot 3). `server/db/triggers/vehicle-activation-triggers.sql` construisait des chemins de documents à partir d'un nom saisi.
- **Cause racine** : le fichier n'était pas dans `BOOTSTRAP_SQL_FILES` (`server/init-database.ts`) et rien d'autre ne l'appliquait ; il visait une table `workflows` qui n'existe pas. Sa présence dans le dépôt le faisait passer pour un automatisme en place.
- **Classification** : code mort trompeur (comportement supposé absent en base).
- **Résolution** : fichier supprimé, code mort, non appliqué.
- **Prévention vérifiable** : `tests/unit/server/bootstrap-sql-files.test.ts` échoue si un `.sql` de `server/db/triggers/` ou `server/db/functions/` n'est ni dans `BOOTSTRAP_SQL_FILES` ni dans la liste gelée `NOT_BOOTSTRAPPED_FROZEN` (avec raison) ; rouge avant la suppression. La liste gelée garde quatre fichiers d'alertes non appliqués, à installer ou supprimer.
- **Leçon généralisée** : un automatisme en base n'existe que s'il est appliqué au démarrage ; avant de corriger un trigger, vérifier qu'il est installé.

## 2026-11-05 — Justificatif de règlement fournisseur supprimé après enregistrement

- **Contexte** : revue des routes multer selon le patron de #178 (exception nommée de l'entrée sur le renouvellement rapide).
- **Constat** : `POST /api/supplier-invoices/:id/settlements` supprimait le justificatif dans son `catch`. Une diffusion temps réel qui levait après l'enregistrement donnait une 500 et supprimait le fichier d'un règlement pourtant créé. À l'inverse, les sorties anticipées (identifiant invalide, 401) laissaient le fichier orphelin.
- **Cause racine** : suppression écrite chemin par chemin au lieu de découler d'un seul fait : « une écriture validée référence-t-elle le fichier ? ».
- **Classification** : cycle de vie d'une ressource externe non lié au commit (récidive du cas #178 sur une autre route).
- **Résolution** : drapeau `proofRecorded` posé après l'enregistrement d'un nouveau règlement, suppression dans le `finally` tant qu'il est faux (au rejeu idempotent, il reste faux : le règlement existant garde son propre justificatif et le fichier reçu est supprimé), diffusion au mieux avec `log.error`. Le récépissé de renouvellement (`POST /requests/:id/receipt`) prend la même forme (`receiptRecorded`) ; sa diffusion était déjà au mieux.
- **Prévention vérifiable** : `tests/contract/supplier-settlement-proof-lifecycle.contract.test.ts` (identifiant invalide : 400 sans fichier laissé ; diffusion qui lève : 201 et justificatif conservé), 2 cas rouges sur main, verts après.
- **Contrôle renforcé (récidive)** : `tests/unit/server/multer-lifecycle-hygiene.test.ts` échoue si une route de `server/api` qui lit `req.file` n'a pas de drapeau `let x = false`, `x = true` et `finally { if (!x) … }`, sauf exception gelée avec raison et condition de dégel. Rouge sur le dépôt de document véhicule (même défaut, corrigé : contrat `vehicle-documents-upload-errors`, diffusion qui lève → 201, fichier conservé). `tests/unit/server/upload-delete-hygiene.test.ts` exige pour toute suppression de `server/api` une borne qui résout les liens.
- **Leçon généralisée** : toute route multer lie le sort du fichier à l'écriture qui le référence, par un drapeau et un `finally`, jamais par des suppressions dans les branches de refus ; les effets après commit ne lèvent jamais vers ce `finally`.
- **Suivis** : `PUT /:id/status` vers `planned` ou `assigned` rejoue désormais le contrôle sous le même ordre de verrous (ligne mission, puis clés triées) ; `launch-readiness` et la validation de lancement lisent hors verrou (ils ne font qu'indiquer un blocage, sans écrire d'affectation) ; dans le PATCH, `liveAssignments` est lu avant la transaction : une affectation ajoutée entre la lecture et l'écriture n'est pas revue (suivi, hors de ce lot).
- **Suivis** : `PUT /:id/status` vers `planned` ou `assigned` rejoue désormais le contrôle sous le même ordre de verrous (ligne mission, puis clés triées) ; `launch-readiness` et la validation de lancement lisent hors verrou (ils ne font qu'indiquer un blocage, sans écrire d'affectation) ; dans le PATCH et dans `PUT /status`, les affectations et le créneau sont lus avant la transaction : sous le verrou de ligne, `assertPlanningStateUnchanged` compare leur empreinte à la base et refuse (409 lisible « La mission vient d'être modifiée… ») si un écrivain concurrent est passé entre-temps, au lieu de contrôler l'ancienne paire. Prouvé de façon déterministe (une connexion tient le verrou, la paire est remplacée, le verrou est libéré) : rouge 2/2 sans la comparaison. Le 409 de `POST /` passe par le gestionnaire central (code, requestId).

## 2026-11-05 — Verrous des missions : un seul ordre d'acquisition pour tous les écrivains

- **Contexte** : relecture de #334, #339 et #346 (conflit de planning). Plusieurs chemins écrivent le créneau ou les affectations d'une mission : `POST /api/missions`, `PATCH /:id`, `POST /:id/assignments`, `PUT /:id/status` vers `planned` ou `assigned`.
- **Cause racine** : deux familles de verrous (ligne `missions` `FOR UPDATE`, verrous consultatifs `pg_advisory_xact_lock` par véhicule et par chauffeur) prises dans un ordre propre à chaque chemin. Le PATCH prenait les consultatifs avant la ligne, `POST /:id/assignments` l'inverse : un PATCH de dates et un ajout d'affectation sur le même véhicule s'interbloquaient (40P01, donc 500). Par ailleurs, ce qui était lu avant la transaction (créneau, affectations vivantes) servait à décider quoi contrôler : un écrivain concurrent le rendait périmé.
- **Classification** : concurrence, ordre de verrouillage non défini ; lecture-puis-écriture sans revalidation sous verrou.
- **Résolution** : ordre unique, dans cet ordre, pour tout chemin qui revendique un créneau :
  1. la ligne mission, `SELECT … FOR UPDATE` ;
  2. l'empreinte : `assertPlanningStateUnchanged` relit le créneau et les affectations retenues et la compare à ce qui a été lu avant la transaction (409 lisible « La mission vient d'être modifiée… » si elle diffère) ;
  3. les verrous consultatifs via `lockPlanningPairs` : tous les véhicules triés par id et dédoublonnés, puis tous les chauffeurs triés ;
  4. `findPlanningClash`, puis l'écriture, dans la même transaction.
  Les créations (mission pas encore verrouillable) prennent seulement les consultatifs triés. Les lectures indicatives hors verrou (`launch-readiness`, validation de lancement) n'écrivent pas et ne servent pas de garantie : l'invariant est tenu à l'entrée dans l'état actif.
- **Prévention vérifiable** : `tests/contract/mission-planning-conflict-write` (rafale PATCH de dates + ajout d'affectation sur le même véhicule : rouge 3/3 sans le verrou de ligne du PATCH), `tests/contract/mission-planning-stale-read` (déterministe : une connexion tient la ligne, la paire est remplacée, le verrou est libéré ; filtre des attentes sur `pg_blocking_pids`), `tests/contract/mission-planning-conflict-status`. Le cas « dates seules sans affectation vivante » est couvert par #346.
- **Leçon généralisée** : dès qu'une ressource se protège par deux familles de verrous, l'ordre d'acquisition est un contrat unique, écrit à un seul endroit et suivi par tous les appelants ; toute décision prise sur une lecture antérieure se revalide sous le verrou. Un test d'interblocage doit faire partager la même clé aux deux requêtes et, pour la lecture périmée, tenir le verrou depuis le test plutôt que compter sur un rythme.

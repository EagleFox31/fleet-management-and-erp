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

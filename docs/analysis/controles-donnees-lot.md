# Contrôles des données avant contraintes (T-63) et plan des branches de test (T-64)

Auteur : db-2 · Date : 2026-10-30 · Branche : `lot/db/T-63-controles`.
Méthode : transaction `BEGIN READ ONLY` suivie de `ROLLBACK`, `SELECT` uniquement, depuis un script
temporaire hors dépôt. Aucune écriture, aucune extension créée, aucune commande `neonctl`.
Aucune URL ni secret n'est reproduit ici.

## 1. Constats (T-63)

### 1.1 `DATABASE_URL` et `DATABASE_URL_TEST` pointent la même base

Les deux variables du `.env` sont identiques (même hôte poolé ; volumes et résultats strictement égaux).
Il n'existe donc **aucune base de test séparée** : les suites d'intégration et de contrat (qui exécutent
`initializeDatabase()` au démarrage, `tests/support/setup-integration.ts`) écrivent sur la base de
développement, et toute migration du lot s'y applique dès la première suite lancée.
Conséquence : le verrou `db-lock.mjs` sérialise les agents entre eux mais pas contre les serveurs de
développement (ports 51xx). T-64 (branches par worktree) devient la vraie parade, pas un confort.

### 1.2 Version et extensions

| Point | Résultat |
|---|---|
| Serveur | PostgreSQL **17.11** (Neon) |
| `btree_gist` | **disponible** (v1.7), non installée |
| Droits | rôle membre de `neon_superuser` : `CREATE EXTENSION btree_gist` est permis |
| `pg_trgm` | disponible (v1.6), non installée (non utilisée par le lot) |
| Taille de la base | 13 MB |
| Connexion | chaîne **poolée** (`-pooler`) : verrous de session non fiables, `pg_dump` à lancer sur la chaîne directe |

La note du plan sur `WITHOUT OVERLAPS` (PostgreSQL 18) ne s'applique pas : le serveur est en 17.

### 1.3 `pg_dump` local

Ni `pg_dump` ni `psql` ne sont installés sur le poste. Docker 29.8 est présent :
`docker run --rm postgres:17 pg_dump --version` donnerait un client 17.x, **compatible** avec le serveur
17.11 (règle : version majeure du client supérieure ou égale à celle du serveur). Non lancé ici (aucune
image tirée). T-19 / T-21 / T-62 doivent utiliser cette voie ou installer le client 17 ; un client 16
serait refusé par `pg_dump`.

### 1.4 Volumes des tables touchées (identiques sur les deux URL)

| Table | Lignes | Table | Lignes |
|---|---|---|---|
| `alerts` | 399 | `parts_used` | 12 |
| `activity_logs` | 28 | `work_orders` | 12 |
| `vehicle_documents` | 10 | `users` | 8 |
| `part_requirements` | 7 | `vehicles` | 7 |
| `fuel_records` | 2 | `tires` | 2 |
| `client_invoices` | 1 | `time_tracking`, `monthly_time_stats`, `vehicle_tires`, `tire_rotations`, `maintenance_schedules` | 0 |

Volumes faibles : `ADD COLUMN`, index et contraintes se posent en millisecondes. Les tables de pneus
(montage, rotations) sont **vides** : les lectures T-40 « mouvements de pneus » n'ont aucun jeu de
données, leurs tests créent le leur. Aucune des nouvelles tables du lot (`incidents`,
`vehicle_document_types`, `backup_runs`, `fuel_prices`, `notification_preferences`) n'existe encore, ni la
colonne `fuel_records.validation_status`.

### 1.5 Données incompatibles avec les futures contraintes

| Contrôle | Résultat | Effet |
|---|---|---|
| OT actifs (`pending`, `in_progress`, `awaiting_parts`) qui se chevauchent, même technicien | **3 paires** : (43,44), (43,58), (44,58), technicien 2 | l'`EXCLUDE` technicien **échouerait** |
| OT actifs qui se chevauchent, même véhicule | **3 paires** : (44,54), (44,58), (54,58), véhicule 6 | l'`EXCLUDE` véhicule **échouerait** |
| `end_date < start_date` | 0 | `GREATEST(…, start_date)` reste utile par sécurité |
| Doublons `(user_id, date)` dans `time_tracking` | 0 (table vide) | unicité T-07b posable |
| Doublons `(user_id, month, year)` dans `monthly_time_stats` | 0 (table vide) | unicité T-07b posable |
| `vehicle_documents.type` hors des 9 codes du seed + `autre` | **0** : `carte_grise` 3, `assurance` 3, `visite_technique` 3, `autre` 1 | le référentiel couvre l'existant |
| CHECK sur `vehicle_documents` | aucun | le type reste libre côté SQL |
| Coûts d'OT négatifs | 0 | sans objet |

Les OT en conflit (43, 44, 54, 58) sont tous sans `end_date` : le chevauchement vient de la règle
« fin nulle = ouvert à l'infini » (§2.1 du plan 03), pas de dates incohérentes.

## 2. Risques

1. **Règle « fin nulle = infini » trop forte pour l'usage réel.** Dans la base, tout OT non terminé a
   `end_date` nul : un technicien avec plusieurs OT en attente est la situation normale (3 OT actifs
   sur le technicien 2). La contrainte telle que dessinée interdirait ce flux courant et renverrait des
   409 sur des saisies légitimes, y compris dans les suites de l'autre session (T-23b le prévoit comme
   risque, les données le confirment).
2. **Contrainte absente sans bruit.** Le bloc `EXCEPTION WHEN exclusion_violation` du plan évite le
   plantage mais laisse la base sans filet sur la base de dev (3 + 3 conflits). Le garde applicatif doit
   rester le rempart principal.
3. **Base de test = base de dev** (§1.1) : une migration défaillante ou un jeu de test sale touche
   directement le développement ; les données de recette (véhicule 13, OT 62, etc.) y vivent aussi.
4. **Pas de client `pg_dump`** sur le poste : T-19 / T-21 / T-62 bloqués sans Docker ou installation.
5. **Chaîne poolée seule** : `pg_try_advisory_lock` de session et `pg_dump` exigent la chaîne directe.

## 3. Recommandations

1. **T-23b** : ne pas poser l'`EXCLUDE` sur « fin nulle = infini ». Deux options à trancher par db-1 /
   SOL : (a) borner une fin nulle par `start_date + duration` (colonne `duration`, en minutes) ;
   (b) restreindre l'`EXCLUDE` aux OT dont `start_date` et `end_date` sont renseignés
   (`WHERE … AND end_date IS NOT NULL`), les OT ouverts restant couverts par le garde applicatif.
   Dans tous les cas, ajouter une borne `start_date >= '2026-11-01'` pour ne pas réécrire l'historique :
   les 4 OT existants ne bloquent alors pas la pose.
2. **Ne pas corriger les 4 OT** (43, 44, 54, 58) : données existantes, la contrainte s'adapte aux
   données et non l'inverse.
3. **T-07b** : poser les index uniques de pointage sans précaution (tables vides, 0 doublon), migration
   idempotente.
4. **T-07a** : le seed `vehicle_document_types` doit contenir les 9 codes plus `autre` (existant couvert à
   100 %). Aucun rattrapage de données nécessaire.
5. **T-64** : créer les branches de test avant de fusionner une migration (§4) ; en attendant, lancer les
   suites sous verrou en sachant que la base de dev est partagée.
6. **T-19 / T-21 / T-62** : `docker run postgres:17` (ou client 17 installé), chaîne directe (hôte sans
   `-pooler`).
7. Refaire le contrôle sur la branche `recette` dès sa création (§5, rejouable en lecture seule).

## 4. Plan T-64 (aucune commande exécutée)

### 4.1 Branches de test par worktree

- Une branche Neon par worktree qui lance des suites, créée depuis la branche de dev : `test-sol`,
  `test-db-1`, `test-db-2`, `test-be-1`, `test-be-2`, `test-api-1`, `test-api-2`, `test-fe-1`, `test-fe-2`.
  Si le quota manque, regrouper par rôle (`test-db`, `test-be`, `test-api`, `test-fe`) sous verrou.
- Dans le `.env` de chaque worktree : `DATABASE_URL_TEST` = chaîne **directe** de sa branche. La
  `DATABASE_URL` de dev reste distincte de `DATABASE_URL_TEST` (corrige le constat 1.1).
- Branche `recette` depuis la dev, puis `recette-golden` figée après T-62 (plan 03, T-26b / T-60).
- Cycle de vie : réinitialiser une branche de test depuis son parent (« reset from parent ») après une
  suite qui s'est mal nettoyée ; supprimer les branches `test-*` au gel du lot.
- Quota : le plafond de branches et le calcul du plan Neon ne sont **pas connus** ; à confirmer par le
  propriétaire du compte avant de créer plus de 3 branches.
- Le compte `neonctl` connecté n'est pas celui du projet : les créations se font depuis la console Neon
  par le propriétaire, rien n'est automatisé ici.

### 4.2 Coût de rétention des sauvegardes sur 12 mois

Hypothèses (à valider par T-21) : dump `pg_dump -Fc` d'environ 10 à 25 % de la taille de la base (plan 03,
astuce 4) ; une sauvegarde par jour ; purge par âge à 12 mois (T-19).

| Taille de la base | Dump unitaire | 365 dumps conservés |
|---|---|---|
| 13 MB (état actuel) | environ 1,3 à 3,3 MB | environ 0,5 à 1,2 GB |
| 200 MB (recette chargée) | environ 20 à 50 MB | environ 7 à 18 GB |
| 2 GB (une année d'exploitation) | environ 200 à 500 MB | environ 73 à 183 GB |

Lecture : à l'état actuel la rétention est négligeable ; elle devient un coût réel au-delà de quelques GB.
Leviers, par ordre d'effet : (1) rétention dégressive (quotidien 30 jours, hebdomadaire 12 semaines,
mensuel 12 mois) qui divise le stock par 5 à 8 ; (2) compression du fichier custom avant chiffrement ;
(3) stockage hors Neon en classe froide. Les tarifs du stockage objet n'ont pas été recherchés : ne pas
chiffrer en FCFA avant d'avoir choisi le fournisseur. La restauration à un instant donné de Neon est une
seconde couche dont la fenêtre dépend du plan (à confirmer, sans promettre un RPO nul).
La table `backup_runs` reste négligeable (365 lignes par an).

## 5. Rejouer le contrôle

Script temporaire (non versionné) : `BEGIN READ ONLY`, les requêtes ci-dessous, `ROLLBACK`.
Requêtes clés : `pg_available_extensions` (nom `btree_gist`) ; auto-jointure de `work_orders` sur
`technician_id` puis `vehicle_id` avec `tsrange(start_date, GREATEST(COALESCE(end_date,'infinity'),
start_date),'[)') &&` ; `GROUP BY type` sur `vehicle_documents` ; `HAVING count(*) > 1` sur
`time_tracking (user_id, date)` et `monthly_time_stats (user_id, month, year)`.

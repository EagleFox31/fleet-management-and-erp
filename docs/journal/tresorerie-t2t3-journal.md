# Trésorerie T2/T3 : pleins, recharges et règlements fournisseur au journal

## 5 novembre 2026

### Quoi
- **T2, carte carburant** : un plein payé par carte écrit une sortie sur le compte `fuel_card`, et une recharge écrit une entrée. Si le compte source est indiqué (`sourceAccountId`), la recharge écrit aussi la sortie correspondante, avec le même groupe de virement.
- **T3, règlement fournisseur** : quand le règlement porte `treasuryAccountId`, il écrit une sortie sur ce compte. Le rejet du règlement écrit la contre-passation.
- **Lecture logistique** : le rôle logistique lit les comptes et le livre, mais seulement ceux de la carte carburant ; un autre compte renvoie 403.
- **Contraintes** : les CHECK et UNIQUE de trésorerie sont réconciliées au démarrage, sur le modèle du schéma CDC (#122). Elles portent les mêmes noms dans Drizzle, dans le SQL et dans `TREASURY_RECONCILED_CONSTRAINTS`.

### Comment
- `server/services/treasury-links.ts` : chaque écriture liée s'insère dans la transaction de l'opération source. Sa clé est dérivée de la source :

  | Écriture | Clé |
  |---|---|
  | Plein ou recharge | `fuel:<id>` |
  | Sortie du compte source d'une recharge | `fuel:<id>:source` |
  | Règlement fournisseur | `settlement:<id>` |
  | Contre-passation d'un rejet | `settlement:<id>:reject` |

  L'insertion se fait en `ON CONFLICT DO NOTHING`, donc un rejeu ne crée jamais de doublon.
- Il ne peut exister qu'une carte carburant active, garanti par `uq_treasury_accounts_active_fuel_card`. Les pleins savent ainsi sans ambiguïté sur quel compte écrire.
- Le rejet d'un règlement et sa contre-passation se font dans une seule transaction.
- Réconciliation des contraintes :
  - bloc `DO` en fin de `TREASURY_SCHEMA_STATEMENTS` ;
  - CHECK posée en `NOT VALID`, puis `VALIDATE` ;
  - UNIQUE renommée si elle existe sous un autre nom, par exemple le nom Drizzle par défaut `treasury_accounts_code_unique` ;
  - avertissement plutôt que démarrage bloqué en cas de doublons ;
  - `reportCdcConstraintGaps` prend désormais la liste en paramètre.
- La nouvelle CHECK `treasury_entries_category_check` est construite depuis `TREASURY_CATEGORIES` : il n'y a pas de copie de la liste à tenir à jour.

### Pourquoi
- Une écriture liée est toujours annulée avec son opération source : pas de ligne orpheline, pas de plein sans écriture.
- Sans réconciliation, une base créée par `drizzle-kit push` aurait gardé des noms d'unicité différents (`_unique` au lieu de `_key`). La prochaine poussée aurait alors posé une seconde contrainte.

### Suites connues
- L'écran de choix du compte source d'une recharge reste à faire ; l'API l'accepte déjà.

## 5 novembre 2026, reprise après relecture et audit de #469

### Quoi
- **Dérogation de rôle, décidée par l'utilisatrice** : `FUEL_RECHARGE_SOURCE_ROLES` (admin, secrétariat, logistique) peut choisir le compte qui paie une recharge. C'est une exception à `TREASURY_WRITE_ROLES`, limitée à cette seule action. La logistique ne saisit rien d'autre au journal. Un rôle hors de la liste qui envoie `sourceAccountId` reçoit 403, sans plein ni écriture.
- Le compte source doit être actif et de type banque ou caisse, jamais la carte.
- **Suppression d'un plein ou d'une recharge liée** : elle contre-passe ses écritures, avec les clés `fuel:<id>:reverse` et `fuel:<id>:source:reverse`. Le solde net est nul sur la carte comme sur la source, et l'historique est gardé.
- **Démarrage** :
  - deux cartes actives en base ne bloquent plus l'index `uq_treasury_accounts_active_fuel_card` : le démarrage émet un WARNING, et l'index sera posé une fois l'une des cartes désactivée ;
  - `treasury_entries.vehicle_id` et `mission_id` passent en `ON DELETE SET NULL`, puisque la restauration de sauvegarde supprime les véhicules.
- **Lecture logistique d'un livre** : le 403 tombe avant la lecture, avec la même réponse pour un compte absent.
- **Dates** : celles des contre-passations et le repli de la date d'un plein se lisent en Africa/Douala, et non en UTC.
- `POST /api/fuel-card/recharge` sort de la liste gelée du cliquet « tout corps lu est validé ».

### Comment
- `sourceAccountId` est validé par Zod : un nombre, ou une chaîne de chiffres, entier positif borné. Un `true` ou un tableau donnent 400.
- Une FK sans `ON DELETE` est remplacée sous le même nom, en une seule instruction `ALTER TABLE` (`DROP` puis `ADD`). C'est le seul `DROP` admis par `treasury-schema-drift.test.ts`.
- `reverseFuelLink` relit les lignes `fuel:<id>` et `fuel:<id>:source`, puis insère leurs inverses en `ON CONFLICT DO NOTHING`. Il s'exécute sous `lockFuelCard`, dans la transaction de la suppression.

### Pourquoi
- La logistique recharge la carte et sait d'où part l'argent. L'utilisatrice a préféré cette dérogation explicite et nommée à un circuit par le secrétariat.
- Une suppression douce garde la ligne de plein. Sans contre-passation, le solde de la carte au journal divergeait de son solde réel.

## 5 novembre 2026, réserves du contre-audit de #469

### Quoi
- Les blocs `DO` qui remplacent les FK véhicule et mission et posent l'index de la carte unique portent un `lock_timeout` de 5 s. Si le verrou n'est pas obtenu, le démarrage émet un WARNING et retente au démarrage suivant ; il ne bloque plus.
- `POST /api/fuel-card/recharge` valide le corps entier avec un schéma Zod strict (`rechargeBodySchema`). Une clé inconnue, `date: {}`, un montant `"100abc"` ou une origine de prix inconnue donnent 400, jamais 500.
- `activeFuelCardAccountId` lit la carte en `ORDER BY id`, ce qui la rend déterministe même avec deux cartes avant que l'index soit posé.

### Comment
- Le `set_config('lock_timeout', '5s', true)` est local à l'instruction. L'erreur `lock_not_available` est attrapée dans le bloc, qui est alors annulé en entier : rien n'est remplacé à moitié.
- Test d'intégration : une seconde session tient la table, le bloc rend la main sous 5 s avec le WARNING. Une fois le verrou libéré, le passage suivant répare.
- `sourceAccountId` reste brut dans le schéma : le rôle est contrôlé avant de lire l'identifiant. `fuel-recharge-source-roles.test.ts` fige cet ordre et la liste de la dérogation.

### Pourquoi
- Un `ALTER TABLE` qui attend un verrou sans limite gèle le démarrage derrière une simple lecture longue.
- Le corps était lu champ par champ, avec `parseFloat` : un type inattendu remontait jusqu'au service.

### Suites connues
- `server/storage.ts` (`deleteVehicle`) supprime les pleins du véhicule sans `reverseFuelLink`. Les écritures de trésorerie restent, avec un lien `fuel_record_id` à NULL. Hors de cette PR.
- Les FK `client_id` et `supplier_id` de `treasury_entries` restent sans `ON DELETE` : aucune suppression ne les vise (avis de l'audit).

## 5 novembre 2026, suppression définitive d'un véhicule

### Quoi
- `storage.deleteVehicle` contre-passe les écritures de trésorerie des pleins du véhicule avant de les supprimer, comme le fait la suppression unitaire d'un plein. Le solde net redevient nul sur la carte, et sur la source pour une recharge.
- La suppression se fait en une seule transaction : un échec n'en laisse aucune partie appliquée.

### Comment
- Sous `lockFuelCard`, `reverseFuelLink(tx, pleinId, acteur)` est appelé pour chaque plein, puis viennent les suppressions dans l'ordre des clés étrangères. Les `console.*` de la méthode sont migrés vers `moduleLogger("storage")`.
- La méthode n'a aujourd'hui aucun appelant. La route DELETE véhicule passe par `vehicle-deletion-service-trigger`, et `fuel_records.vehicle_id` reste en NO ACTION : un véhicule qui a des pleins y est refusé. Le correctif évite qu'un futur appelant crée des écritures orphelines.

### Suites connues
- `backup-import-service.ts` (restauration de sauvegarde) supprime tous les pleins sans toucher à la trésorerie : les écritures restent, avec `fuel_record_id` à NULL. Une PR séparée suivra ; l'option (inclure `treasury_*` dans la sauvegarde, ou contre-passer) est soumise avant de coder.
## 5 novembre 2026, écran du compte source d'une recharge

### Quoi
- Le formulaire de recharge de la carte carburant propose « Compte qui paie la recharge » : une banque ou une caisse active, ou « Non précisé » (entrée sur la carte seule, comme avant). Ce point ferme la suite connue du premier lot.
- `GET /api/fuel-card/source-accounts` liste ces comptes (id, code, libellé, type), sans aucun solde, pour `FUEL_RECHARGE_SOURCE_ROLES`. La liste est vide quand le drapeau finance est coupé, et le champ n'apparaît alors pas.

### Comment
- La mutation reçoit le corps en variables, figé au clic, et part par `useSingleFlightMutate`.
- Les trois couches :
  1. invalidations existantes (solde, historique, pleins, statistiques) ;
  2. l'événement `fuel_card_recharged` sur le groupe satellite « fuel » ;
  3. aucune clé ajoutée, la liste des comptes étant un référentiel.
- `realtime-satellites.test.ts` ne lit plus « count » dans « account » : la clé `/api/fuel-card/source-accounts` était prise pour un compteur.

### Pourquoi
- `GET /api/treasury/accounts` ne montre à la logistique que la carte : sans cette route, la dérogation ne pouvait pas servir à l'écran.
- Aucun solde n'est exposé : la logistique choisit un compte, elle ne lit pas la trésorerie.

# P3-2 — Récépissé de renouvellement (base)

Décision utilisateur (2026-11-03, `docs/plans/p3-2-echeances.md` §4) : une demande de renouvellement
en cours qui porte un **récépissé téléversé avec une date de validité** rend le véhicule éligible
jusqu'à cette date **incluse** ; ensuite, sans document définitif, blocage.

## Pourquoi de nouvelles colonnes

`proof_file_name` / `proof_file_path` / `new_expiry_date` sont posés au passage à `completed`
(`server/api/document-renewals.routes.ts`, téléversement `proofs/`) : c'est la **preuve de clôture**.
Les réutiliser pour un récépissé provisoire mélangerait deux pièces de sens opposé (provisoire / définitive).

## Colonnes (`document_renewal_requests`, toutes nullable, sans défaut)

| Colonne | Type | Rôle |
|---|---|---|
| `receipt_valid_until` | `date` | Dernier jour (inclus) où le récépissé couvre le véhicule |
| `receipt_file_name` | `text` | Nom d'origine du fichier, pour l'affichage |
| `receipt_file_path` | `text` | Chemin servi sous `uploads/`, posé par le serveur (multer), ouvert par `uploadedFileCandidates` |
| `receipt_uploaded_at` | `timestamp` | Quand le récépissé a été déposé |
| `receipt_uploaded_by` | `integer → users.id` | Qui l'a déposé |

Traçabilité (`uploaded_at`/`by`) retenue : ce fichier lève un blocage réglementaire (droit de rouler) ;
en cas de contrôle routier ou de litige, il faut savoir qui l'a déposé et quand, comme pour le stock
(AGENTS.md §5). `updated_at` de la demande ne suffit pas, il bouge à chaque modification.

## Invariant en base

`document_renewal_requests_receipt_complete` :
`CHECK (num_nulls(receipt_valid_until, receipt_file_path, receipt_file_name, receipt_uploaded_at) IN (0, 4))`.
Date de validité, fichier (chemin et nom) et date de dépôt vont ensemble : tous NULL ou tous renseignés.
Un récépissé incomplet ne débloque rien, la base le refuse quel que soit l'appelant. Violation : SQLSTATE
`23514`, `constraint = 'document_renewal_requests_receipt_complete'`. Message attendu côté serveur
(`AppError` 400) : « Le récépissé doit comporter un fichier et une date de validité. »

`receipt_uploaded_by` est **hors CHECK** (NULL admis : auteur non identifié, par exemple reprise
manuelle). Sa FK `document_renewal_requests_receipt_uploaded_by_users_id_fk` (sans `ON DELETE`, comme
`completed_by`) empêche de supprimer un utilisateur qui a déposé un récépissé. Violation : `23503`.

## Pose des contraintes (démarrage et migration)

- `SET LOCAL lock_timeout = '5s'` après le verrou consultatif : un verrou de table tenu ne bloque
  pas la table ; le bloc concerné lève un WARNING (`lock_not_available`) et le démarrage continue.
- Trois blocs `DO` distincts : colonnes, FK, CHECK. L'échec de l'un n'annule pas les autres.
- FK et CHECK posées `NOT VALID` si absentes, puis `VALIDATE CONSTRAINT` dans un sous-bloc qui
  piège seulement `foreign_key_violation` / `check_violation` (patron de #124) : une ligne non
  conforme laisse la contrainte `NOT VALID`, les écritures suivantes restent contrôlées.
- Une CHECK de même nom à l'ancienne définition (date et chemin seulement, commit 77b4700) est
  supprimée puis reposée dans le même bloc.
- `reportDocumentRenewalReceiptGaps` (`server/init-database.ts`) relit `pg_constraint` après le SQL
  et journalise par `moduleLogger` (`init-database`) chaque contrainte absente, non validée ou à
  l'ancienne définition, en la citant par son nom : le `RAISE WARNING` n'atteint pas les logs.

## Ce qui reste au serveur

- Le **corps de requête ne pose ni fichier ni traçabilité** : `insertDocumentRenewalRequestSchema`
  omet `receiptFileName`, `receiptFilePath`, `receiptUploadedAt`, `receiptUploadedBy`. Seule la date
  de validité est saisie ; le reste vient de `req.file` et `req.user.id`.
- Droits, statut accepté (`pending` / `in_progress`), date de validité ≥ aujourd'hui : règles métier
  susceptibles d'évoluer, donc au serveur.

## Mise en place

- Migration : `server/db/migrations/20261103_document_renewal_receipt.sql`.
- Jumelle : `DOCUMENT_RENEWAL_RECEIPT_SQL` dans `server/init-database.ts`, appelée juste après les
  `ADD COLUMN` existants de la table, hors du schéma CDC.
- Tests : `tests/unit/server/document-renewal-receipt-schema.test.ts` (jumelage, Zod),
  `tests/integration/document-renewal-receipt.test.ts` (catalogue, cas accepté/refusé, violation FK ou CHECK laissée NOT VALID et journalisée, remplacement de l'ancienne CHECK, second démarrage).

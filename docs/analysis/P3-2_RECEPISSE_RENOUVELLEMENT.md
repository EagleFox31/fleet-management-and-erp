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
`CHECK ((receipt_valid_until IS NULL) = (receipt_file_path IS NULL))`.
Une date sans fichier, ou un fichier sans date, ne débloque rien : la base le refuse quel que soit
l'appelant. Violation : SQLSTATE `23514`, `constraint = 'document_renewal_requests_receipt_complete'`.
Message attendu côté serveur (`AppError` 400) : « Le récépissé doit comporter un fichier et une date
de validité. »

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
  `tests/integration/document-renewal-receipt.test.ts` (catalogue, cas accepté/refusé, second démarrage).

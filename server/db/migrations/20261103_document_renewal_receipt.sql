-- P3-2 : récépissé provisoire d'une demande de renouvellement de papier. Un récépissé téléversé avec
-- une date de validité rend le véhicule éligible jusqu'à cette date incluse (docs/plans/p3-2-echeances.md §4).
-- Distinct de proof_file_name/path, preuve de clôture posée au passage à completed.
-- Rejoué à chaque démarrage par server/init-database.ts (applyMigrationSqlFiles) ; le même SQL est porté
-- par DOCUMENT_RENEWAL_RECEIPT_SQL (AGENTS.md §5), comparé par tests/unit/server/document-renewal-receipt-schema.test.ts.
-- Additif et rétroactif : colonnes nullable, sans défaut, demandes existantes à NULL, aucune donnée modifiée.
-- Contrainte : date de validité et fichier vont ensemble (l'un sans l'autre ne débloque rien).
-- Idempotent : ADD COLUMN IF NOT EXISTS, contrainte posée seulement si absente, sous verrou consultatif.
-- Retour arrière, dans cet ordre (sinon le démarrage suivant recrée les colonnes) :
--   1. retirer DOCUMENT_RENEWAL_RECEIPT_SQL et son appel de server/init-database.ts, ce fichier et les
--      colonnes receipt* de shared/schema.ts ;
--   2. déployer, puis ALTER TABLE document_renewal_requests DROP CONSTRAINT IF EXISTS document_renewal_requests_receipt_complete;
--      ALTER TABLE document_renewal_requests DROP COLUMN IF EXISTS receipt_valid_until, DROP COLUMN IF EXISTS receipt_file_name,
--      DROP COLUMN IF EXISTS receipt_file_path, DROP COLUMN IF EXISTS receipt_uploaded_at, DROP COLUMN IF EXISTS receipt_uploaded_by;
--      (perd les récépissés saisis ; les fichiers sous uploads/ restent).
SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));

ALTER TABLE document_renewal_requests ADD COLUMN IF NOT EXISTS receipt_valid_until date;
ALTER TABLE document_renewal_requests ADD COLUMN IF NOT EXISTS receipt_file_name text;
ALTER TABLE document_renewal_requests ADD COLUMN IF NOT EXISTS receipt_file_path text;
ALTER TABLE document_renewal_requests ADD COLUMN IF NOT EXISTS receipt_uploaded_at timestamp;
ALTER TABLE document_renewal_requests ADD COLUMN IF NOT EXISTS receipt_uploaded_by integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'document_renewal_requests'::regclass
      AND conname = 'document_renewal_requests_receipt_uploaded_by_users_id_fk'
  ) THEN
    ALTER TABLE document_renewal_requests ADD CONSTRAINT document_renewal_requests_receipt_uploaded_by_users_id_fk
      FOREIGN KEY (receipt_uploaded_by) REFERENCES users(id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'document_renewal_requests'::regclass
      AND conname = 'document_renewal_requests_receipt_complete'
  ) THEN
    ALTER TABLE document_renewal_requests ADD CONSTRAINT document_renewal_requests_receipt_complete
      CHECK ((receipt_valid_until IS NULL) = (receipt_file_path IS NULL));
  END IF;
EXCEPTION WHEN check_violation THEN
  RAISE WARNING 'document_renewal_requests_receipt_complete non posée : récépissés sans date ou sans fichier dans document_renewal_requests';
END $$;

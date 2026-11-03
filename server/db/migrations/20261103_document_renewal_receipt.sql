-- P3-2 : récépissé provisoire d'une demande de renouvellement de papier. Un récépissé téléversé avec
-- une date de validité rend le véhicule éligible jusqu'à cette date incluse (docs/plans/p3-2-echeances.md §4).
-- Distinct de proof_file_name/path, preuve de clôture posée au passage à completed.
-- Rejoué à chaque démarrage par server/init-database.ts (applyMigrationSqlFiles) ; le même SQL est porté
-- par DOCUMENT_RENEWAL_RECEIPT_SQL (AGENTS.md §5), comparé par tests/unit/server/document-renewal-receipt-schema.test.ts.
-- Additif et rétroactif : colonnes nullable, sans défaut, demandes existantes à NULL, aucune donnée modifiée.
-- Contrainte : date de validité, fichier (chemin et nom) et date de dépôt vont ensemble, tous NULL ou tous
-- renseignés. receipt_uploaded_by en est exclu : NULL admis (auteur non identifié) ; la FK, sans ON DELETE
-- comme completed_by, empêche de toute façon de supprimer un utilisateur qui a déposé un récépissé.
-- Idempotent, sous verrou consultatif et lock_timeout 5 s : ADD COLUMN IF NOT EXISTS ; un verrou de table
-- indisponible laisse le démarrage continuer (WARNING) au lieu de bloquer la table. FK et CHECK dans deux
-- blocs distincts (l'échec de l'une n'annule pas l'autre), posées NOT VALID si absentes puis validées
-- dans un sous-bloc : une ligne non conforme laisse la contrainte NOT VALID (écritures suivantes contrôlées),
-- jamais un démarrage bloqué. Une CHECK de même nom à l'ancienne définition (date et chemin seulement) est
-- remplacée. Tout écart est relu et journalisé au démarrage (reportDocumentRenewalReceiptGaps,
-- init-database.ts) : le RAISE WARNING n'atteint pas les logs.
-- Retour arrière, dans cet ordre (sinon le démarrage suivant recrée les colonnes) :
--   1. retirer DOCUMENT_RENEWAL_RECEIPT_SQL et son appel de server/init-database.ts, ce fichier et les
--      colonnes receipt* de shared/schema.ts ;
--   2. déployer, puis ALTER TABLE document_renewal_requests DROP CONSTRAINT IF EXISTS document_renewal_requests_receipt_complete;
--      ALTER TABLE document_renewal_requests DROP COLUMN IF EXISTS receipt_valid_until, DROP COLUMN IF EXISTS receipt_file_name,
--      DROP COLUMN IF EXISTS receipt_file_path, DROP COLUMN IF EXISTS receipt_uploaded_at, DROP COLUMN IF EXISTS receipt_uploaded_by;
--      (perd les récépissés saisis ; les fichiers sous uploads/ restent).
SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  ALTER TABLE document_renewal_requests ADD COLUMN IF NOT EXISTS receipt_valid_until date;
  ALTER TABLE document_renewal_requests ADD COLUMN IF NOT EXISTS receipt_file_name text;
  ALTER TABLE document_renewal_requests ADD COLUMN IF NOT EXISTS receipt_file_path text;
  ALTER TABLE document_renewal_requests ADD COLUMN IF NOT EXISTS receipt_uploaded_at timestamp;
  ALTER TABLE document_renewal_requests ADD COLUMN IF NOT EXISTS receipt_uploaded_by integer;
EXCEPTION WHEN lock_not_available THEN
  RAISE WARNING 'document_renewal_requests : colonnes receipt_* non ajoutées, verrou de table indisponible sous 5 s';
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'document_renewal_requests'::regclass
      AND conname = 'document_renewal_requests_receipt_uploaded_by_users_id_fk'
  ) THEN
    ALTER TABLE document_renewal_requests ADD CONSTRAINT document_renewal_requests_receipt_uploaded_by_users_id_fk
      FOREIGN KEY (receipt_uploaded_by) REFERENCES users(id) NOT VALID;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'document_renewal_requests'::regclass
      AND conname = 'document_renewal_requests_receipt_uploaded_by_users_id_fk' AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE document_renewal_requests VALIDATE CONSTRAINT document_renewal_requests_receipt_uploaded_by_users_id_fk;
    EXCEPTION WHEN foreign_key_violation THEN
      RAISE WARNING 'document_renewal_requests_receipt_uploaded_by_users_id_fk laissée NOT VALID : receipt_uploaded_by vers un utilisateur absent';
    END;
  END IF;
EXCEPTION WHEN lock_not_available OR undefined_column THEN
  RAISE WARNING 'document_renewal_requests_receipt_uploaded_by_users_id_fk non posée : verrou indisponible ou colonne receipt_uploaded_by absente';
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'document_renewal_requests'::regclass
      AND conname = 'document_renewal_requests_receipt_complete'
      AND pg_get_constraintdef(oid) NOT LIKE '%receipt_uploaded_at%'
  ) THEN
    ALTER TABLE document_renewal_requests DROP CONSTRAINT document_renewal_requests_receipt_complete;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'document_renewal_requests'::regclass
      AND conname = 'document_renewal_requests_receipt_complete'
  ) THEN
    ALTER TABLE document_renewal_requests ADD CONSTRAINT document_renewal_requests_receipt_complete
      CHECK (num_nulls(receipt_valid_until, receipt_file_path, receipt_file_name, receipt_uploaded_at) IN (0, 4)) NOT VALID;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'document_renewal_requests'::regclass
      AND conname = 'document_renewal_requests_receipt_complete' AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE document_renewal_requests VALIDATE CONSTRAINT document_renewal_requests_receipt_complete;
    EXCEPTION WHEN check_violation THEN
      RAISE WARNING 'document_renewal_requests_receipt_complete laissée NOT VALID : récépissés incomplets dans document_renewal_requests';
    END;
  END IF;
EXCEPTION WHEN lock_not_available OR undefined_column THEN
  RAISE WARNING 'document_renewal_requests_receipt_complete non posée : verrou indisponible ou colonnes receipt_* absentes';
END $$;

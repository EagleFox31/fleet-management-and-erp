-- vehicle_documents.type référence le référentiel dynamique vehicle_document_types(code) : un document ne
-- peut plus citer un code inexistant, quel que soit l'appelant (route, service, script), et un type utilisé
-- ne peut plus être supprimé par un DELETE direct. Pas d'ON DELETE ni d'ON UPDATE CASCADE (NO ACTION) :
-- un code est immuable, un type se désactive (active = false), il ne se supprime pas.
-- Rejoué à chaque démarrage par server/init-database.ts (applyMigrationSqlFiles) ; le même SQL est porté
-- par VEHICLE_DOCUMENTS_TYPE_FK_SQL (AGENTS.md §5), comparé par tests/unit/server/vehicle-documents-type-fk-schema.test.ts.
-- Aucune donnée modifiée. Idempotent, sous verrou consultatif et lock_timeout 5 s :
--   1. clé unique sur vehicle_document_types(code) si ni PK ni UNIQUE ne la couvre (la table la crée en PK) ;
--   2. FK posée NOT VALID si absente, jamais validée ici : les lignes historiques hors référentiel restent
--      lisibles, seules les écritures suivantes sont contrôlées. Le nombre de lignes hors référentiel est relu
--      et journalisé au démarrage (reportVehicleDocumentTypeGaps), sans aucune valeur.
-- Un verrou indisponible ou une table absente laisse le démarrage continuer (WARNING), réessayé au suivant.
-- Retour arrière : ALTER TABLE vehicle_documents DROP CONSTRAINT vehicle_documents_type_vehicle_document_types_code_fk;
-- puis retirer ce fichier et VEHICLE_DOCUMENTS_TYPE_FK_SQL (sinon le démarrage suivant la repose).
SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'vehicle_document_types'::regclass
      AND c.contype IN ('p', 'u')
      AND c.conkey = ARRAY[(SELECT a.attnum FROM pg_attribute a WHERE a.attrelid = 'vehicle_document_types'::regclass AND a.attname = 'code')]
  ) THEN
    ALTER TABLE vehicle_document_types ADD CONSTRAINT vehicle_document_types_code_key UNIQUE (code);
  END IF;
EXCEPTION WHEN lock_not_available OR undefined_table OR unique_violation THEN
  RAISE WARNING 'vehicle_document_types_code_key non posée : verrou indisponible, table absente ou codes en double';
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'vehicle_documents'::regclass
      AND conname = 'vehicle_documents_type_vehicle_document_types_code_fk'
  ) THEN
    ALTER TABLE vehicle_documents ADD CONSTRAINT vehicle_documents_type_vehicle_document_types_code_fk
      FOREIGN KEY (type) REFERENCES vehicle_document_types(code) NOT VALID;
  END IF;
EXCEPTION WHEN lock_not_available OR undefined_table OR invalid_foreign_key THEN
  RAISE WARNING 'vehicle_documents_type_vehicle_document_types_code_fk non posée : verrou indisponible, table absente ou code sans clé unique';
END $$;

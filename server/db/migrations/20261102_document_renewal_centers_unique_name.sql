-- DOC1 : unicité d'un centre de renouvellement sur son nom normalisé (casse, bords et espaces répétés
-- ignorés), tous types confondus. Complète la contrainte UNIQUE (name) qui laisse passer « Centre A »
-- et « centre a ». Rejoué à chaque démarrage par server/init-database.ts, qui porte le même bloc
-- (AGENTS.md §5).
-- Idempotent et prudent : l'index n'est créé que s'il n'existe aucun doublon de nom normalisé
-- (sinon le démarrage échouerait). En cas de doublon, rien n'est créé : le contrôle applicatif
-- (assertCenterNameFree) et la contrainte UNIQUE (name) restent le filet ; regrouper les doublons
-- à la main, puis redémarrer.
-- Additif : aucune donnée modifiée.
-- Retour arrière : DROP INDEX IF EXISTS uq_document_renewal_centers_name_normalized; retirer ce
-- fichier et le bloc de server/init-database.ts (sinon le démarrage suivant recrée l'index).
DO $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));
  IF NOT EXISTS (
    SELECT 1
    FROM document_renewal_centers
    GROUP BY regexp_replace(lower(btrim(name)), '\s+', ' ', 'g')
    HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_document_renewal_centers_name_normalized
      ON document_renewal_centers ((regexp_replace(lower(btrim(name)), '\s+', ' ', 'g')));
  END IF;
END $$;

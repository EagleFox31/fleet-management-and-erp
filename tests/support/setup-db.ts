/**
 * Doit s'exécuter AVANT tout import de `server/db.ts`.
 * Vitest setupFiles tournent avant les fichiers de test.
 *
 * On pointe DATABASE_URL vers DATABASE_URL_TEST (branche Neon de test ; le
 * garde-fou refuse l'endpoint de production). Les données de test sont préfixées TEST- et nettoyées
 * après chaque fichier.
 */
import { assertTestDatabaseNotProduction } from "../../e2e/helpers/production-guard";

const testUrl = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL;

if (!testUrl) {
  throw new Error(
    "DATABASE_URL ou DATABASE_URL_TEST est requis pour les tests d'intégration et de contrat. " +
      "Voir tests/README.md et .env.example.",
  );
}

assertTestDatabaseNotProduction(testUrl);

process.env.DATABASE_URL = testUrl;

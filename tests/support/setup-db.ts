/**
 * Doit s'exécuter AVANT tout import de `server/db.ts`.
 * Vitest setupFiles tournent avant les fichiers de test.
 *
 * On pointe DATABASE_URL vers DATABASE_URL_TEST (même Neon que le dev
 * dans ce projet). Les données de test sont préfixées TEST- et nettoyées
 * après chaque fichier.
 */
const testUrl = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL;

if (!testUrl) {
  throw new Error(
    "DATABASE_URL ou DATABASE_URL_TEST est requis pour les tests d'intégration et de contrat. " +
      "Voir tests/README.md et .env.example.",
  );
}

process.env.DATABASE_URL = testUrl;

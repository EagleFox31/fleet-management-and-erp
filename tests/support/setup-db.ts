/**
 * Doit s'exécuter AVANT tout import de `server/db.ts`.
 * Vitest setupFiles tournent avant les fichiers de test.
 *
 * On pointe DATABASE_URL vers DATABASE_URL_TEST après que `assertSafeTestDatabase`
 * a refusé : DATABASE_URL_TEST absent (aucun repli sur DATABASE_URL), DATABASE_URL
 * différent, hôte de production ou *.neon.tech non autorisé. Les données de test
 * sont préfixées TEST- et nettoyées après chaque fichier.
 */
import { assertSafeTestDatabase } from "../../e2e/helpers/production-guard";
import { pinListenerUrlsToTestDatabase } from "./listener-env";

process.env.DATABASE_URL = assertSafeTestDatabase();
// #298 : listenerPool (LISTEN, verrous consultatifs) lit ces deux variables avant DATABASE_URL.
// Héritées d'un .env, elles feraient écouter et verrouiller les tests sur une autre base.
pinListenerUrlsToTestDatabase(process.env);

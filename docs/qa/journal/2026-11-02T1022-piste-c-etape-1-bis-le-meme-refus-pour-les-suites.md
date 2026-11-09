## Piste C, étape 1 bis : le même refus pour les suites intégration et contrat

**Quoi**
- `assertTestDatabaseNotProduction` (dans `e2e/helpers/production-guard.ts`), appelée par `tests/support/setup-db.ts` avant la redirection de `DATABASE_URL` vers `DATABASE_URL_TEST` : les suites vitest d'intégration et de contrat refusent de démarrer quand l'URL effective vise la production. 4 cas unitaires ajoutés (refus sans URL dans le message, branche de test acceptée, variable de marqueurs, appel présent avant la redirection). `tests/README.md` corrigé : `DATABASE_URL_TEST` ne doit plus être « la même URL ».

**Comment**
- Réutilise la détection de l'étape 1 (hôte seulement, jamais le chemin ni les identifiants), message sans secret.

**Pourquoi**
- Le `.env` racine pointe `DATABASE_URL_TEST` sur la production : un `npm run test:contract` ordinaire y écrivait.

**Preuve**
- Unitaire 14/14. Contrat lancé avec `DATABASE_URL_TEST` sur l'endpoint de production (valeur factice, aucune connexion tentée) : échec immédiat au chargement du setup, message du garde-fou. Sans le garde-fou, le même lancement ouvre la connexion et initialise la base. Avec la branche de test : les contrats tournent.



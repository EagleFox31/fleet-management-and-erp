## 2026-11-06T13:33:00+01:00 — Test du plafond de connexion : garde de version du driver

- **Agent** : de (fleet-testeur) · **Branche** : `test/neon-version-guard` · **Commit** : voir `git log`
- **Statut** : fait (PR brouillon)
- **Quoi** : `tests/unit/server/db-pool-options.test.ts` atteignait son délai de 10 s sur un worktree relié par jonction au `node_modules` partagé, resté en neon 0.10.4. Sur cet ancien driver, la connexion reste en suspens : le test était correct, mais l'échec ne donnait pas la cause. Pas de réseau en jeu : l'hôte « db » n'est qu'un paramètre envoyé au serveur TCP local du test.
- **Comment** : une garde compare la version installée à la plage de `package.json` (lue, pas recopiée). Elle échoue tout de suite avec « node_modules obsolète : npm ci », dans un test dédié et dans le `beforeAll` du test du pair muet, qui est alors sauté.
- **Comment tester (QA)** :
  - 10/10 verts lancé seul (tests en 340 à 390 ms) ;
  - rouge en 0,85 s avec ce message sur un worktree temporaire relié au `node_modules` en 0.10.4 (avant : délai de 10 s) ;
  - unitaires 302/302, tsc 0, check:tests 0.
- **RAIDER** : A (version lue dans `package.json`, paquet résolu par Node) ; D (assertions du test inchangées) ; E (erreur actionnable). Ne s'applique pas : I, Retroactive (aucun état).
- **Reste / risques** : le `npm ci` du `node_modules` partagé reste à planifier (décision 0a, moment calme).


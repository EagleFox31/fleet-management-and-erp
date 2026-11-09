## VEH3 : e2e acquisition de véhicule, résultat d'exécution

- **Quoi** : `e2e/16-vehicle-acquisition-resume.spec.ts` rejoué en entier : 5 passed (6,2 min), un worker, `E2E_CHANNEL=msedge`, serveur sur le port 5057, base Neon de test (`tests-piste-c`), sous `db-lock`. `tsc` global : 0 erreur.
- **Preuve rouge/vert** : VEH3-UI-2 était rouge à la première exécution (brouillon `in_progress` recréé après `completed`), puis figé tel quel ; VEH3-UI-1 est un `test.fail` (passe tant que le bouton Abandonner n'existe pas, devient rouge dès qu'il est monté).
- **Piège** : un verrou `db-test.lock` périmé laissé par une exécution tuée bloque l'attente d'environ 17 min avant d'être repris ; la sortie reste vide pendant ce temps.


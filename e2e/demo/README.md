# Démos par profil

Parcours filmés (un par profil), exclus de `npm run test:e2e` : `playwright.config.ts` ignore `e2e/demo/` sauf si `E2E_DEMO=1`.

Le `.env` racine pointe la base de production (Neon) : ne jamais lancer ces commandes avec `--env-file=.env` seul. Forcer la base locale de test par un préfixe :

```bash
export DATABASE_URL=postgres://fleet:fleet@postgres:5432/fleet_test DATABASE_WS_PROXY=localhost:5433/v1
```

Les hôtes et ports ci-dessus sont ceux du compose de test du dépôt ; avec un compose personnel, adapter l'hôte (`localhost`, `127.0.0.1` ou `postgres`) et les ports, la base devant rester `fleet_test`.

1. Le seed (`assertLocalDatabase`, appelé aussi dans chaque spec) refuse toute URL dont l'hôte n'est pas local ou dont la base n'est pas `fleet_test`.
2. `node --import tsx e2e/demo/seed-demo.ts` (idempotent : comptes, rôles, mots de passe et propriétaires réconciliés, état des scénarios remis à zéro ; à rejouer entre deux passages).
3. `E2E_DEMO=1 E2E_RECORD=1 node node_modules/@playwright/test/cli.js test e2e/demo/<spec> --reporter=list`

Vidéos : `test-results/recordings/<test>/video.webm`.

Résidu connu : le justificatif téléversé par la démo du secrétariat reste dans `uploads/` (hors base).

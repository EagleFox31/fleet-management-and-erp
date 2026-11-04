# Démos par profil

Parcours filmés (un par profil), exclus de `npm run test:e2e` : `playwright.config.ts` ignore `e2e/demo/` sauf si `E2E_DEMO=1`.

1. Base locale uniquement (le seed refuse toute base hors `fleet_test` en localhost).
2. `node --env-file=.env --import tsx e2e/demo/seed-demo.ts` (idempotent, à rejouer entre deux passages).
3. `E2E_DEMO=1 E2E_RECORD=1 node --env-file=.env node_modules/@playwright/test/cli.js test e2e/demo/<spec> --reporter=list`

Vidéos : `test-results/recordings/<test>/video.webm`.

## VEH3 : e2e acquisition de véhicule

- **Quoi** : `e2e/16-vehicle-acquisition-resume.spec.ts`, 5 tests : reprise de l'étape en cours depuis le bandeau « Workflows en cours » puis après rechargement (état venu du serveur) ; documents obligatoires refusés tant qu'il en manque, puis téléversés et vérifiés en base ; fin `completed` (véhicule créé) ; fin `abandoned` (brouillon retiré du bandeau et de la reprise). Résultat sur la base de test tests-piste-c : **5 passed (6,1 min)**, Edge (`E2E_CHANNEL=msedge`).
- **Défauts produit figés** (non corrigés ici) :
  - VEH3-UI-1 : aucun écran ne propose d'abandonner un brouillon. Le bouton n'existe que dans le mode complet de `WorkflowReminders`, or le seul montage est compact (`client/src/pages/vehicles/index.tsx:119`) ; le wizard ne fait jamais appel à `abandonWorkflow` (`client/src/pages/workflows/vehicle-acquisition.tsx:102`). Test en `test.fail`.
  - VEH3-UI-2 : après l'activation, l'enregistrement différé de 500 ms (`client/src/hooks/use-workflow-persistence.ts:171`) part après `completeWorkflow()` ; le PATCH tombe en 404 et le repli POST recrée un brouillon `in_progress` de même sessionId : l'acquisition terminée réapparaît dans « Workflows en cours ». Comportement actuel asserté, avec la consigne de bascule une fois corrigé.
- **Comment** : chaque test crée son propre compte et ses données préfixées `E2E-VEH3` ; nettoyage par sacs d'identifiants, aucun nettoyage global (base partagée).
- **Pourquoi** : le contrat ne voit pas VEH3-UI-2 (il n'envoie pas l'enregistrement tardif du navigateur) ; seul le parcours écran le révèle.
- **Piège** : le port 5000 du poste est pris par Docker Desktop. Lancer le serveur sur un autre port (`PORT=5055`), puis `E2E_BASE_URL=http://127.0.0.1:5055 node --env-file=.env node_modules/@playwright/test/cli.js test ...` (le `--env-file` est requis : la spec importe `server/db`).


## Piste F, relecture : exécution e2e non obtenue (correction de l'entrée précédente)

**Quoi**
- Les modifications de `e2e/15` n'ont pas pu être rejouées : le port 5000 était occupé par le serveur d'un autre run (réutilisation interdite par le garde-fou). Un serveur lancé à part sur le port 5001 (branche de test, sous `db-lock`) a affiché une page blanche, donc aucune socket temps réel : les 3 tests échouent avant la première assertion modifiée (`observe`, attente `auth_success`).

**Pourquoi**
- Cause non élucidée (serveur de développement lancé hors `npm run dev`). Le correctif de la spec reste donc **non prouvé** ; `tsc` global est à 0 erreur. À rejouer : `E2E_CHANNEL=msedge` sur la branche Neon de test, port 5000 libre, sous `db-lock`.


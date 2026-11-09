## Piste F, relecture : témoin du chef et refetch borné par la trame

**Quoi**
- Gabarit non rempli `:"+L+"` remplacé par `:96` (`technician-work-orders.routes.ts`).
- `e2e/15` : le témoin WO7 vérifie maintenant la trame `work_order_updated` de l'OT chez le chef ; les étapes création, démarrage, fin et suppression attendent la trame de CETTE transition (statut et identifiant dans la trame), puis n'acceptent qu'un refetch postérieur à son arrivée (marge 250 ms).

**Comment**
- `observe` renvoie aussi `frameLog` (trames horodatées) ; `frameArrival` renvoie l'instant d'arrivée.

**Pourquoi**
- Un refetch tardif d'une étape précédente pouvait satisfaire l'attente de la suivante ; le témoin ne vérifiait aucune trame.

**Preuve**
- `tsc` global : 0 erreur. Exécution e2e : voir l'entrée suivante.


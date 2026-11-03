# Journal — échéance du plan préventif à la clôture de l'OT (lot P3-1)

## 2026-11-03 10:39 — La clôture d'un OT préventif fait avancer l'échéance de son plan

**Quoi.** Un plan calendaire restait à l'échéance traitée après la clôture de son OT ; le balayage l'écartait ensuite (OT clos postérieur à l'échéance) et ne générait plus jamais d'OT. Le défaut était figé par un `it.fails` dans `preventive-maintenance-lifecycle`.

**Comment.**
- `advanceScheduleAfterCompletion` part de l'échéance traitée par l'OT (`due_date`, sinon `start_date`), et ajoute la fréquence du plan.
- L'UPDATE est conditionné à `scheduled_date < prochaine` : une seconde clôture n'écrit rien.
- Les plans kilométriques sont exclus.
- La méthode est appelée depuis `storage.updateWorkOrder` et depuis le service technicien, par `onWorkOrderCompleted` : un échec est journalisé et n'annule pas la clôture.
- Le calcul des dates passe en UTC (D4), borné au dernier jour du mois : 31/01 + 1 mois = 28/02, pas 03/03. Les fréquences `daily` et `weekly` sont prises en charge.
- Couche 3 : sur les événements d'OT, le client invalide les requêtes du plan et des échéances. Toutes les clés qui commencent par `/api/maintenance-schedules` sont touchées (fiche véhicule, immatriculation, score de santé). Le plan n'a aucun événement WebSocket propre.

**Pourquoi.** Planning fixe : un OT clos en retard ne fait pas dériver le plan. C'est un choix produit ; le planning glissant reste possible plus tard. Réserves de relecture de aa (R1 à R3) intégrées.

**Preuves.**
- Intégration `preventive-maintenance-lifecycle` : 23/23. Couvre la clôture en retard, la double clôture, le plan kilométrique, le plan hebdomadaire, le balayage et 4 fins de mois.
- Mutations : appel retiré → 4 rouges ; garde `<` retirée → 1 rouge ; base = date du jour → 3 rouges ; ancien `setMonth` → 4 rouges.
- TS : 0 erreur.

## Rattrapage des plans bloqués avant P3-1 (#142)

**Quoi.**
- Les plans calendaires dont le dernier OT préventif a été clos avant P3-1 sont restés à l'échéance traitée.
- Le script `backfill:preventive-schedules` les avance d'une période :
  - aperçu par défaut ;
  - écriture avec `--apply --yes`.

**Comment.**
- `planScheduleCatchUp` part des plans actifs, calendaires et datés.
  - Pour chacun, il prend le dernier OT préventif. Il ne retient le plan que si cet OT est `completed` et si la date du plan n'a pas dépassé l'échéance traitée.
  - Un OT sans `due_date` ni `start_date` est écarté. Sans échéance connue, la base retomberait sur la date du plan et chaque apply la repousserait d'une période.
- `applyScheduleCatchUp` rejoue `advanceScheduleAfterCompletion` : même règle et même UPDATE conditionnel que la clôture.
- Le script affiche la base visée, hôte masqué, puis un tableau lisible : immatriculation, plan, ancienne date → nouvelle.

**Pourquoi.**
- `.env` pointe sur la base réelle : l'écriture exige une confirmation explicite, et l'apply n'a lieu que sur go de l'utilisateur, après lecture de l'aperçu.
- Un plan très en retard n'avance que d'une période. Le balayage génère aussitôt l'OT suivant, ce qui rend le retard visible au lieu de le masquer.

**Preuves.**
- Intégration `preventive-maintenance-lifecycle` : 27/27. Cas couverts :
  - aperçu sans écriture ;
  - apply, puis second apply sans écriture ;
  - plan kilométrique exclu, plan à OT ouvert exclu ;
  - plan déjà avancé, plan désactivé ;
  - OT sans date.
- Mutations :
  - filtre `isActive` retiré → 1 rouge ;
  - filtre OT sans date retiré → 1 rouge ;
  - filtre « dernier OT clos » retiré → 2 rouges.
- TS : 0 erreur.

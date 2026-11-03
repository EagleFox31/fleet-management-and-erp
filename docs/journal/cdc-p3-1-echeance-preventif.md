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

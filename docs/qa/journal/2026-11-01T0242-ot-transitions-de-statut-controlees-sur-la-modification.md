## 5592621 - OT : transitions de statut contrôlées sur la modification générique (WO2)

**Quoi**
- `PATCH /api/work-orders/:id` refuse un OT terminé qu'on voudrait remettre en cours, en attente ou
  en attente de pièces (409, le retour passe par le contrôle qualité) et un OT annulé qu'on voudrait
  rouvrir (409). Rien n'est écrit, pas même les autres champs du corps.
- Le technicien garde ses gestes (démarrer, terminer, reprendre après pièce) ; annuler ou remettre en
  attente lui est refusé (403). Garder le même statut reste permis (modale d'édition).
- La modale d'édition ne propose plus que les statuts atteignables pour le rôle connecté, et affiche
  le message serveur lisible (`userMessageOf`) au lieu de `error.message`.

**Comment**
- Règle unique `shared/constants/work-order-transitions.ts` (`checkWorkOrderTransition`), utilisée par
  la route et par la modale ; elle réutilise `canTechnicianTransition`.
- Contrôle placé après la validation des colonnes, avant toute écriture, levé en `AppError`.

**Pourquoi**
- La route acceptait n'importe quel passage : un technicien pouvait annuler un OT, et un OT terminé
  pouvait revenir en cours sans contrôle qualité ni motif.

**Preuve**
- Contrat `work-order-status-transitions` 5/5 (3 rouges avant le correctif). Voisins
  `work-order-quality-check`, `work-order-booking-guard`, `api-role-guard-and-validation`,
  `technician-work-order-status` : 43/43.
- Unitaire 807/807 ; `npm run check` 0 erreur ; e2e `03-work-orders` et `06-realtime-work-orders` verts.


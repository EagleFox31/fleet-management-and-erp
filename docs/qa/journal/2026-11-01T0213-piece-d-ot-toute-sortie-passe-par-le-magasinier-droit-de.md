## 136f966 - Pièce d'OT : toute sortie passe par le magasinier ; droit de sortie du chef d'atelier révocable

**Quoi**
- `POST /api/work-orders/:id/parts` (et `/awaiting-parts` avec une pièce) ne sort plus rien du stock.
  La quantité en rayon devient une demande `received`, « à sortir » dans la file du magasinier, sans
  approbation ni commande. Le manquant devient une demande `pending` et l'OT passe en attente de pièces.
- Le rayon déjà promis à une demande `received` / `delivered` est réservé : un second OT ne le compte
  plus comme disponible.
- Le chef d'atelier garde la sortie dérogatoire motivée (magasin fermé). L'administrateur la lui retire
  ou la lui rend : `PATCH /api/users/:id/stock-issue-permission`, interrupteur dans la liste des
  utilisateurs. Retirée, la sortie est refusée (403) et le stock reste intact.

**Comment**
- `server/services/work-order-part-request.ts` : pièce verrouillée (FOR UPDATE), demande ouverte
  réutilisée, réservation calculée en SQL, deux demandes créées dans la transaction.
- Colonne `users.can_issue_stock` (défaut `true`) : `shared/schema.ts`, `server/init-database.ts`,
  migration `20261031_users_can_issue_stock.sql`. Contrôle dans `partRequirementsService` (branche
  dérogation), route admin dans `server/api/user-stock-permission.routes.ts`.
- Temps réel : une trame `part_requirement_created` par demande créée (la trame `part_used_added`
  ne part plus de cette route, rien n'y sort).
- `tests/support/cleanup.ts` : le nettoyage des véhicules TEST orphelins supprime d'abord leurs OT et
  dépendants, et les prix carburant d'utilisateurs TEST orphelins (clés étrangères qui faisaient
  échouer le nettoyage global).

**Pourquoi**
- Décision métier : le technicien ne se sert pas au magasin, même en rayon ; le magasinier sort la
  pièce. Stock juste et traçable. Le chef d'atelier garde un recours la nuit, sous contrôle de l'admin.

**Preuve**
- Contrat `stock-issue-permission` 4/4 (nouveau, rouge avant), `work-order-parts` réécrit,
  `technician-work-order-status` : 17/17 ; `error-contract-and-issue-idempotence` +
  `part-requirements-chain` 15/15.
- Intégration `work-order-part-request` 8/8, dont concurrence 5 OT sur un stock de 3.
- Unitaire 803/803 ; `npm run check` 0 erreur ; e2e `10-work-order-part-request` vert.


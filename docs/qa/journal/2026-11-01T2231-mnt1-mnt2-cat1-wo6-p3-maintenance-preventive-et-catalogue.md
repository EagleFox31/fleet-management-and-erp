## MNT1, MNT2, CAT1, WO6, P3 - maintenance préventive et catalogue main-d'oeuvre

**Quoi**
- Contrat `maintenance-schedules` (MNT1) : droits (401, 403), corps invalides 400, véhicule inconnu 404, création active
  qui génère l'OT préventif lié, plan inactif sans OT, PATCH, désactivation et réactivation, DELETE, cloison client.
- Contrat `labor-catalog` (CAT1) : lecture sur session, écriture réservée au chef d'atelier, code en majuscules, auteur
  tracé, doublon refusé, deux créations simultanées (201 + 400), poste inactif masqué et refusé sur un OT.
- Intégration `preventive-maintenance-triggers` (MNT2) : échéance véhicule dans la fenêtre de 30 jours (J+30 oui,
  J+31 non), OT unique au rejeu et véhicule en maintenance, seuil kilométrique, plan inactif, plans à venir.
- Support `tests/support/contract-session.ts` : serveur in-process et un compte connecté par rôle.
- WO6 : déjà couvert par `time-tracking` (contrat 5, intégration 3), passé OK au plan sans nouveau test.

**Pourquoi**
- Le plan donnait ces lignes « À faire ». Les défauts sont figés en `it.fails` plutôt que corrigés.

**Preuve**
- Quatre `it.fails`, rejoués en `it`, rouges sur l'assertion visée :
  1. MNT1 : `DELETE /api/maintenance-schedules/:id` d'un plan avec OT répond 204, le plan existe encore
     (server/routes.ts:1811, server/storage.ts:1192 avale l'erreur de clé étrangère).
  2. MNT2 : l'échéance `scheduledDate` d'un plan actif ne déclenche aucun OT, seules les dates du véhicule le font
     (server/services/preventive-maintenance-service.ts:112).
  3. MNT2 : un second passage à 20000 km crée un second OT en attente pour le même plan (le premier est joué en
     mise en place et laisse un seul OT), la garde compare au titre du plan
     alors que l'OT s'intitule « Maintenance préventive: <titre> » (preventive-maintenance-service.ts:310, :359).
  4. CAT1 : `PATCH /api/labor-catalog/:id` répond 404, aucune route de modification ni de désactivation
     (server/api/work-order-items.routes.ts).
- Relecture : chaque `it.fails` ne contient plus que l'appel visé et l'assertion métier, la mise en place (véhicule,
  plan, entrée de catalogue) est dans un `beforeAll` qui contrôle le 201. Rouge rejoué sans `.fails`, erreurs exactes :
  `expected [ { id } ] to have a length of +0 but got 1` (MNT1), `expected [] to have a length of 1 but got +0`
  (échéance de plan), `expected [ ... ] to have a length of 1 but got 2` (deux OT), `expected 404 to be 200` (CAT1).
- Contrat 16/16 cas verts, intégration 11/11, unitaire 838/838, `tsc` 0 erreur.

**Limites**
- `calculateNextDueDate` lève pour les fréquences quotidienne et hebdomadaire acceptées par le POST : non figé.
- Bord de mois et fuseau du pointage non testés : WO6 repassé de « OK » à « Partiel » au plan.
- Alerte, clôture de l'OT préventif et recalcul de l'échéance par date non couverts (P3).

**Reste**
- Correctifs produit (fleet-api) puis passage des quatre `it.fails` en `it`.


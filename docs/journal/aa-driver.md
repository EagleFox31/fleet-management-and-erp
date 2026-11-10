# Journal aa-driver : moindre donnée côté serveur pour le chauffeur

## 2026-11-10 — Coordonnées client et solde de carte
- **Quoi** : `GET /api/missions/:id` ne donne plus au chauffeur contact, e-mail ni téléphone du client (id et nom restent) ; `GET /api/fuel-card/balance` ne rend aux rôles hors `TREASURY_FUEL_CARD_READ_ROLES` (chauffeur, technicien, magasinier, chef d'atelier) que les prix au litre et `priceSource`. Les deux `console.error` de `fuel-card.routes.ts` passent par `next(withLogContext(...))` vers le gestionnaire central (journal pino avec `requestId`, réponse générique avec référence).
- **Comment** : `server/lib/mission-client-contact-scope.ts` et `server/lib/fuel-balance-scope.ts` (liste blanche de champs, échec fermé). Liste des lecteurs réutilisée de `canReadFuelCardBalance` (check-list de lancement) : admin, secrétariat, comptable, direction, logistique. La matrice `MATRICE_ROLES_GAP.md` ne dit rien du solde de la carte ; les rôles viennent de `shared/constants/roles.ts`.
- **Pourquoi** : audit de la PR #661 ; aucun écran chauffeur ne lit ces champs (le tableau de bord chauffeur lit `averagePricePerLiter*` et `priceSource`).
- **Preuve** : contrat `driver-least-data` 15/15 sur la branche, 4 rouges contre main ; tsc 0 ; unitaires verts.
- **Hors périmètre** : seule la lecture détail renvoyait le contact client ; les listes ne renvoient que id et nom.

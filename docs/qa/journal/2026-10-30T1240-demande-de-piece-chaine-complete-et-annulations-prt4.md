## 69a218c - Demande de pièce : chaîne complète et annulations (PRT4)

**Quoi**
- Contrat `part-requirements-chain` : création par le technicien → approbation par le chef d'atelier →
  commande directe (refusée sans motif, acceptée avec) → entrée en stock par le magasinier (+2, mouvement
  `in` à son nom) → sortie du stock vers l'OT (−2, pièce rattachée à l'OT) → plus aucune transition.
- Annulation à chaque étape : en attente et approuvée (chef d'atelier ; magasinier refusé), commandée
  (demande d'annulation, décision de l'admin seul, ou retour à « approuvée »), entrée en stock, annulée
  et refusée (refusées, stock inchangé).
- Correctif : `PATCH /api/part-requirements/:id` passait une demande à « Sortie du stock » sans déduire
  la pièce ni la rattacher à l'OT. Le service refuse désormais `issued` sans effet de stock (400).

**Comment**
- `updatePartRequirement` : `issued` exige `onTransition` ; seule la route
  `POST /api/work-orders/:id/part-requirements/:id/issue` le fournit.
- Crescendo : intégration (`part-requirements-idempotence` : refus sans effet ; la course à deux sorties
  passe maintenant un effet neutre), puis contrat HTTP avec quatre rôles réels.

**Pourquoi**
- PRT4, priorité 2 du plan (traçabilité stock). Un statut « Sortie du stock » sans mouvement fausse le
  stock affiché et le coût de l'OT.

**Preuve**
- `npm run check` 0 erreur ; unitaire 467/467 ; intégration 59/59 ; contrat complet 124/124 (15 fichiers).
- Premier passage du nouveau contrat : 7/8, le rouge est le PATCH `issued` accepté (200, stock inchangé).
- Aucune donnée `TEST PRT4` restante en base.
- Hors périmètre, à trancher : le workflow autorise le technicien à annuler sa demande en attente, mais la
  route `PATCH` (`isInventoryManager`) le refuse et aucun écran technicien ne le propose.


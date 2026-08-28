# Évolution Future — Stock réservé pour OT

Date: 06/03/2026
Statut: Décision produit validée (implémentation reportée)

## Décision maintenant
- On **ne complexifie pas** le flux actuel.
- On garde le fonctionnement en place:
  - `quantity` = stock physique disponible.
  - Demande de pièce créée quand OT passe en `attente pièces`.
  - Sortie stock réelle uniquement quand la pièce est ajoutée définitivement à l'OT.

## Pourquoi on reporte
- Implémenter une réservation introduit une nouvelle couche métier (allocation, dé-réservation, arbitrage inter-OT).
- Le besoin est réel, mais pas bloquant pour continuer l'exploitation.
- Priorité immédiate: stabilité des flux OT, approvisionnement, réception, clôture.

## Règle d'exploitation temporaire (avec l'existant)
- Si besoin OT > stock:
  - créer la demande de pièce sur le **manque** prioritairement;
  - ne pas forcer des sorties stock négatives sauf cas exceptionnel.
- Le chef d'atelier arbitre la priorité entre OT en attente.
- Le magasinier confirme la disponibilité réelle avant affectation définitive.

## Limites connues (acceptées temporairement)
- Pas de blocage automatique de stock pour une OT.
- Risque de "concurrence" entre OT sur les mêmes pièces en faible stock.
- Pilotage manuel nécessaire entre atelier et magasin.

## Conception cible (phase future)
## 1) Modèle
- Ajouter `part_reservations`:
  - `id`
  - `part_id`
  - `work_order_id`
  - `quantity_reserved`
  - `status` (`active`, `released`, `consumed`)
  - `reason`
  - `created_by`
  - `released_by` (nullable)
  - `release_reason` (nullable)
  - `created_at`, `updated_at`

## 2) Logique stock
- `stock_on_hand` = stock physique
- `stock_reserved` = somme réservations actives
- `stock_available` = `stock_on_hand - stock_reserved`

## 3) Flux métier cible
- Cas besoin 7 / stock 5:
  - réserver 5 pour l'OT;
  - créer demande pour 2 (manque);
  - à réception, compléter puis consommer.
- Dé-réservation possible uniquement avec motif + validation chef/admin.

## 4) UI cible
- Sur OT:
  - bouton `Réserver stock disponible`;
  - badge `Réservé X / Besoin Y`;
  - action `Libérer réservation` (droits restreints).
- Sur pièce:
  - afficher `Stock`, `Réservé`, `Disponible`.

## 5) Traçabilité
- Journaliser chaque action:
  - réservation créée;
  - réservation partielle;
  - dé-réservation;
  - consommation depuis réservation.

## 6) Critères de validation future
- Une OT prioritaire ne perd pas sa part réservée sans action autorisée.
- `Disponible` ne peut pas devenir négatif.
- Réception pièce met à jour correctement OT en attente.
- Historique auditable par acteur et timestamp.

## Déclencheur d'implémentation
- Lancer cette évolution quand:
  - volume OT simultanées augmente;
  - conflits de pièces deviennent fréquents;
  - besoin d'arbitrage manuel devient coûteux.

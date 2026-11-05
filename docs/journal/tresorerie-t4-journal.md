# Journal de trésorerie (lot T4) : traites et chèques

**Quoi** : échéancier des traites et chèques (`payment_instruments`), à payer ou à encaisser. Il donne les jours avant échéance, une alerte (échéance passée, échéance proche) et des totaux. Un paiement écrit l'écriture correspondante au journal de trésorerie. Derrière le drapeau `finance`.

**Comment**
- Contrat partagé : `shared/contracts/payment-instruments.ts` (chemin, schémas Zod, libellés, types). `paymentInstrumentAlert` sert d'oracle de test au calcul SQL.
- Routes : `server/api/payment-instruments.routes.ts`, monté sous `/api/treasury/instruments`. Saisie : admin, secrétariat. Lecture : + direction (mêmes rôles que T1).
  - `GET /` : filtres `status`, `kind`, `direction` et seuil `alertDays` (7 jours par défaut, 365 au plus).
  - `GET /:id`.
  - `POST /` : réponse 201, ou 200 au rejeu.
  - `PATCH /:id` : en attente seulement.
  - `POST /:id/pay` : `{ accountId, paidAt }`.
  - `POST /:id/status` : `bounced` (rejetée) ou `cancelled` (annulée).
- Jours avant échéance et alerte : calculés en SQL à la date d'Africa/Douala. Totaux : `count`/`SUM ... FILTER` sur la même sélection filtrée.
- Paiement : une seule transaction, ligne verrouillée (`FOR UPDATE`).
  - Le compte doit être actif ; le paiement ne peut précéder l'émission.
  - L'écriture va au journal : sortie pour « à payer » (`reglement_fournisseur`), entrée pour « à encaisser » (`encaissement_client`). Contrepartie : le tireur ou le tiré. Clé de rejeu : `instrument:<id>`.
  - Un second paiement identique renvoie `replayed: true` ; un paiement différent renvoie 409. Des paiements concurrents produisent une seule écriture.
- Contraintes en base, nommées et réconciliées au démarrage (`TREASURY_RECONCILED_CONSTRAINTS`) :
  - 6 CHECK : nature, sens, statut, montant > 0, échéance ≥ émission, et « payée » ⇔ date + écriture ;
  - 2 UNIQUE : `request_key` et `treasury_entry_id`.
- Ménage des tests (`tests/support/cleanup.ts`) : les échéances sont supprimées avant les écritures, véhicules, fournisseurs, clients et utilisateurs qu'elles référencent.

**Pourquoi** : remplacer le suivi Excel des traites, où les échéances passées n'étaient vues qu'à la relance de la banque. Décision d'inclusion du 2026-11-05 (hors CDC inclus).

**Écart assumé (temps réel)** : aucun événement WebSocket pour l'instant. Il n'existe pas encore d'écran de trésorerie (T1 non plus). Les cliquets du catalogue (`realtime-catalog-wiring`, `realtime-invalidation-keys`) exigent un consommateur client pour chaque événement. L'événement `payment_instrument_changed` (invalidation des échéances et des comptes) arrivera avec l'écran, dans le même lot.

**Preuves** : `tests/contract/payment-instruments.contract.test.ts` (13 tests), `tests/unit/shared/payment-instruments-contract.test.ts` (8), `tests/integration/treasury-schema-reconcile.test.ts`, `tests/unit/server/treasury-schema-drift.test.ts`.

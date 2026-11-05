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

**Near miss (ordre de création)** : au merge du lot T2/T3, ses blocs `DO $` de réconciliation se sont retrouvés avant le `CREATE TABLE payment_instruments`. Sur une base neuve, la réconciliation aurait visé une table absente. Cause : deux lots ajoutaient au même tableau `TREASURY_SCHEMA_STATEMENTS` sans règle d’ordre. Prévention vérifiable : `tests/unit/server/treasury-schema-drift.test.ts` exige que tout `CREATE` précède le premier `DO $`. Leçon : dans un tableau d’instructions de bootstrap, une table nouvelle se place avec les créations, pas en fin de tableau.

**Relecture (réserves levées)** :
- violation de CHECK : le message dépend du nom de la contrainte (dates, montant), un message neutre sinon ;
- date de paiement postérieure à aujourd’hui (Douala) : 422 ;
- contrepartie au journal par `paymentInstrumentCounterparty` : le tireur pour une traite à payer et un chèque reçu, le second nom sinon ;
- une trace `moduleLogger("payment-instruments")` par paiement (`instrumentId`, `accountId`, `entryId`, `userId`, `requestId`) ;
- clôture rejouée avec d’autres observations : 409, l’original est conservé.

**Preuves** : `tests/contract/payment-instruments.contract.test.ts` (17 tests), `tests/unit/shared/payment-instruments-contract.test.ts` (12), `tests/integration/treasury-schema-reconcile.test.ts`, `tests/unit/server/treasury-schema-drift.test.ts`.

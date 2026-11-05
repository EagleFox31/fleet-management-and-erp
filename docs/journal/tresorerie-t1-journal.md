# Journal de trésorerie (lot T1)

**Quoi** : comptes (`treasury_accounts`) et écritures (`treasury_entries`), liste par compte et par mois avec solde courant, virement interne, totaux, export CSV. Derrière le drapeau `finance` (désactivé par défaut).

**Comment**
- Contrat partagé : `shared/contracts/treasury.ts` (routes, schémas Zod, types, `ledgerOf` de référence, `ledgerToCsv`).
- Routes : `server/api/treasury.routes.ts`. Saisie : admin, secrétariat. Lecture : + direction.
- Montants en chaînes à 2 décimales. Solde courant calculé en SQL (`SUM() OVER (ORDER BY entry_date, id)`) sur tout l'historique du compte, jamais stocké.
- Virement : 2 lignes dans une transaction, même `transfer_group`, catégorie `virement_interne`.
- Rejeu : colonne `request_key` unique. Même clé et même contenu : 200 sans doublon ; contenu différent : 409.
- Tables aussi créées dans `server/init-database.ts` (IF NOT EXISTS), colonnes d'audit omises des schémas d'insertion.

**Pourquoi** : remplacer le suivi Excel de caisse/banque ; décision d'inclusion du 2026-11-05.

**Hors périmètre** : liaisons règlement fournisseur (T3), carte carburant (T2), traites (T4). Soldes d'ouverture à fournir par le client à la date de bascule.

## Relecture (5 novembre 2026)

- **Quoi** :
  - ids du corps lus par `bodyIdSchema` : entier strict, borné au type `integer` ;
  - `totals.net` calculé en SQL ;
  - rejeu comparé sur tous les champs saisis (libellé, catégorie, pièce, notes, liens compris) ;
  - mois par défaut lu en Africa/Douala ;
  - montants normalisés par chaîne, sans flottant ;
  - ménage des comptes de test étendu aux FK `created_by` et `updated_by` de la trésorerie.
- **Comment** :
  - espaces de clés séparés. La clé client est préfixée `entry:K`, ou `transfer:K:out` et `transfer:K:in` pour un virement. Les lignes posées par une autre opération utilisent `fuel:` et `settlement:`.
  - une 23505 résiduelle répond 409.
- **Pourquoi** :
  - une écriture de clé « K:out » bloquait le virement de clé « K » et sortait en 500 ;
  - un id au-delà de 2 147 483 647 sortait en 500 côté base ;
  - en UTC, le 31 à 23 h 30 (heure de Douala : déjà le 1er) affichait le mois précédent.
- **Clé sur la ligne plutôt que dans `idempotency-store`** :
  - la ligne et sa clé sont écrites dans la même transaction, sous contrainte UNIQUE ;
  - la clé ne s'expire pas ;
  - une opération tierce (plein, règlement) peut poser sa clé dans sa propre transaction.

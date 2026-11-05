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

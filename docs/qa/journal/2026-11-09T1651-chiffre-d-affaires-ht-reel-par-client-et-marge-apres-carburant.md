## Facturation : chiffre d'affaires HT réel par client et marge après carburant

**Quoi** : nouvelle route `GET /api/billing/revenue/by-client?from=AAAA-MM-JJ&to=AAAA-MM-JJ`
(service `server/services/client-revenue-service.ts`). Elle lit le CA HT sur les factures
clients émises (toutes sauf `cancelled`), par client, avec le nombre de factures, le nombre de
montants négatifs, le carburant réel connu des missions facturées et la marge après carburant.
Lecteurs : `CLIENT_BILLING_STATS_ROLES` (admin, secrétaire, logistique, direction).

**Comment** :
- Test rouge d'abord : branche jetable `c7-red-revenue` (472c5dbc), tests + service bouchon,
  sans route. Attendu : intégration 8/9 en échec (seul « période vide » passe), contrat en 404.
- Une seule requête SQL : client lu sur la facture, sinon sur la mission ; carburant compté
  **une fois par mission** (acompte + solde ne le doublent pas) ; marge `null` dès qu'une
  facture n'a pas de mission ou qu'une mission n'a pas de coût carburant réel.
- Montants en chaîne décimale exacte (`numeric(18,2)::text`), totaux sommés en BigInt.
- Période par défaut : le mois en cours à Douala ; 366 jours au plus ; 400 lisible sinon.
  Validation manuelle (`isIsoCalendarDate`), pas de schéma Zod.

**Pourquoi** : le bandeau des opérations affichait un « CA » qui était en fait le carburant
estimé (corrigé par ailleurs). Le vrai CA vient des factures. Hypothèses écrites dans le
service : monnaie unique FCFA (pas de colonne devise), pas de statut brouillon, pas de table
d'avoirs (un montant négatif est sommé avec son signe et compté).

**Preuve** :
- `npx tsc --noEmit -p .` : 0 erreur ; `npm run -s check:tests` : 0.
- `tests/integration/client-revenue-service.test.ts` (9 cas) et
  `tests/contract/billing-revenue-by-client.contract.test.ts` (rôles T1 200/403/401, sans fuite
  de nom de client ; période T3 cinq 400 lisibles ; 366 jours acceptés) : en CI.

# O3 lot 1 : grille tarifaire (table, contrat, API)

## Quoi
Table `tariff_grid` (client facultatif, trajet, type de marchandise, unité ton/conteneur/voyage, prix en XAF, période),
contrat partagé `shared/contracts/tariff-grid.ts`, API `/api/tariff-grid` (liste, création, modification,
désactivation) et `GET /api/tariff-grid/suggest` en lecture seule. Drapeau `pricing`, rôles admin et direction.

## Comment
- Schéma au modèle #122 : trois CHECK nommés (unité, prix >= 0, période), posés NOT VALID puis validés avec WARNING,
  listés dans `CDC_RECONCILED_CONSTRAINTS`; SQL jumeau migration / `TARIFF_GRID_SQL` comparé par test.
- Unicité : index sur `CASE WHEN client_id IS NULL THEN 0 ELSE client_id END` (les NULL sont distincts en PostgreSQL,
  un tarif générique en double passerait sinon). Écrit sans virgule ni mélange colonne/expression pour rester relisible
  par `drizzle-kit push` (garde `schema-index-introspection`).
- Chevauchement de périodes pour la même clé (client, trajet, marchandise) : refusé en 409 par le service, sous
  verrou consultatif de transaction. Décision : refuser plutôt que laisser deux prix valides le même jour.
- `pickTariff` (pur, testé) : tarif du client avant le générique, type de marchandise exact avant tarif sans type,
  puis période la plus récente. Aucune suggestion hors période ni inactif : `null`, jamais un prix inventé.
- Suppression = désactivation (historique des prix conservé).

## Pourquoi
Le prix suggéré ne doit jamais s'appliquer seul à une facture : l'écran (lot 2) proposera, l'utilisateur décide.

## Réserves de relecture (corrigées)
- Rôles séparés : lecture admin, direction, secrétariat, logistique (taux clients en lecture seule) ; écriture admin et direction.
- `SET LOCAL lock_timeout = '5s'` en tête du SQL (création et réconciliation).
- Prix XAF entier : `numeric(15,0)` et `z.number().int()`.
- Chevauchement : seuls les tarifs actifs comptent ; l'index unique devient partiel (`WHERE active`), un tarif désactivé libère sa période. Réactiver un tarif qui chevauche un actif : 409.
- Date par défaut de la suggestion : jour calendaire de Douala (`Africa/Douala`), plus UTC.

## Near miss : mauvaise table modifiée (corrigé)
- Contexte : passage du prix en entier (scale 0). Le remplacement par motif est tombé sur `parts.unit_price` (ligne ~420) au lieu de `tariffGrid.unit_price` (~1664) : deux colonnes portent le même texte.
- Cause racine : édition par motif sans ancrer la table ; la garde n'existait que côté SQL jumeau, pas côté Drizzle des pièces.
- Détection : test DIR3 exports-inventory-content (125.5 reçu 126). Risque évité : `drizzle push` aurait arrondi tous les prix des pièces.
- Résolution : `parts.unit_price` rétabli à scale 2, `tariffGrid.unit_price` à scale 0.
- Prévention : assertion dans `tariff-grid-schema.test.ts` (parts scale 2, tariff_grid scale 0). Leçon : toute édition de schéma se relit par `git diff` table par table.

# O3 dette : pagination de la grille tarifaire et nom du client

## Quoi
- `GET /api/tariff-grid` renvoie `{ rows, total, limit, offset }` ; `limit` 1-200 (défaut 50), `offset` >= 0, hors bornes en 400.
- Création, modification et désactivation renvoient `clientName` (null pour un tarif générique).
- Écran : pager précédent/suivant, libellé « 51-100 sur 130 », retour à la dernière page non vide si la page courante se vide.

## Comment
- Service : lignes et `count(*)` en parallèle sur le même filtre, ordre stable ; `clientNameOf` partagé par les trois écritures.
- Contrat partagé : `tariffListQuerySchema` / `tariffListResponseSchema`, constantes de taille de page.

## Pourquoi
- Sans plafond, la liste grossit avec les clients ; le total permet de paginer sans deviner.
- La réponse d'écriture alimentait la ligne du tableau sans nom de client : le cache affichait un vide jusqu'au rechargement.

## Preuves
Contrat : pages disjointes et stables, page au-delà du total vide, défaut 50, 400 hors bornes, `clientName` sur POST/PUT/DELETE. Unitaires : `pageRangeLabel`, schémas de requête et de réponse.

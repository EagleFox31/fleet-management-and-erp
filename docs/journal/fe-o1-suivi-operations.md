# O1 — Suivi des opérations clients

## Quoi
Écran « Suivi des opérations » (`/operations/tracking`) : une ligne par mission, colonnes de la feuille Maersk
(conteneur, BL, secteur, chargement, départ, déchargement, retour, nature, commentaire), durée du voyage, facture liée,
récapitulatif en 5 statuts (voyage, facturation, attente de paiement, payée, annulée). Filtres client et mois.

## Comment
- Table `mission_operations` (1-1 avec `missions`, `mission_id` unique), créée de façon idempotente dans `init-database.ts`.
- `GET /api/mission-operations` (admin, logistique, secrétaire, direction) et `PUT /api/mission-operations/:missionId`
  (admin, logistique), derrière le drapeau `operations-tracking` (désactivé par défaut, 404 sinon).
- Écriture : `INSERT ... ON CONFLICT (mission_id) DO UPDATE`, rejouable ; `created_by`/`updated_by` posés par le serveur.
- Statut de récapitulatif dérivé (`recapStatusOf`) du statut de mission et de la dernière facture client non annulée ;
  aucun statut n'est stocké, donc rien à resynchroniser.
- Durée du voyage : base configurable, défaut déchargement − départ (réponse client Q6).

## Pourquoi
Le client suit ses opérations dans un tableur ; le déclenchement voyage → facturation reste manuel (Q4).
Dériver le statut évite une seconde source de vérité à côté de la facturation.

## Preuves
Unitaire (`mission-operations-contract.test.ts`), contrat (403 par rôle, 404 drapeau, idempotence, récapitulatif suit la
facture). Mutations vues rouges : retrait de `requireFeature`, élargissement des rôles d'écriture.

## Compléments de relecture
- Ménage des tests : FK `created_by`/`updated_by` vers `users` supprimées par compte dans `tests/support/cleanup.ts`.
- Pas d'événement WebSocket volontairement : c'est une saisie de suivi, pas une transition métier (règle des 3 couches non applicable) ; la liste se resynchronise par invalidation de requête.
- Dates lues en texte UTC (`to_char`) : colonnes `timestamp` sans fuseau, pas de décalage d'un jour si le serveur n'est pas en UTC.
- Remorque inconnue : 400 (et non 500 par violation de FK).
- Dette notée : `<select>` natifs à passer au Select du design system ; pagination de la liste.

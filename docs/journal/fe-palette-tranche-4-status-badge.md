# Palette, tranche 4 : status-badge (seul)

## Quoi
`status-badge.tsx` est le badge de statut multi-domaines (factures, commandes, documents, AGENTS.md §1). Seules trois familles ont un jeton de même sens et migrent : vert (payée, clôturée, terminée) -> success, rouge (annulée, annulée, rejetée) -> destructive, ambre (contestée) -> warning. Cliquet : 54 -> 33.

## Comment et pourquoi seulement ces trois
Le composant distingue des statuts par la couleur : jaune (en attente, brouillon), bleu (approuvée, confirmée), violet (commandée, envoyée), ciel (reçue, livrée), turquoise (émise, traitée), orange (partielle). Les ramener à success, warning et destructive effacerait ces distinctions. Ils restent en palette, comme exception documentée (décision 0a : pas de jeton info/catégoriel tant qu'il n'y a pas de demande produit).

## Frontière multi-domaines
Aucun libellé ni vocabulaire stock touché : `issued` reste « Emise » (sens facture), les écrans de demande de pièce passent par `getPartRequirementStatusLabel`. Seules les couleurs des trois familles changent.

## À noter
Les libellés de ce composant sont écrits sans accents (« Approuvee », « Payee »). Hors périmètre ici, à traiter dans une tranche libellés.

## Preuves
- Rendu côte à côte des badges payée, annulée, contestée avec les anciennes puis les nouvelles classes : sens conservé, vert un peu plus sobre. Les écrans de démo n'affichent que « Confirmée » (bleu, inchangé), d'où le rendu isolé. Mode sombre non supporté : pas de capture sombre.
- Contraste vérifié par `token-pairs-contrast`.

## 2026-11-10 18:05 - Avoirs clients (lot V1, PR5)

**Quoi.** Un avoir (`AV-AAAAMMJJ-NNN`) corrige une facture émise sans la modifier : il baisse le solde, est refusé au-delà du solde ou sur une facture annulée, et ne peut ni être modifié ni supprimé. Admin et comptable l'émettent ; les rôles de facturation le consultent et téléchargent son PDF ; un client n'y a pas accès.

**Comment.** `POST /api/billing/invoices/:id/credit-notes` (clé de rejeu obligatoire), `GET` de la liste, `GET /api/billing/credit-notes/:id/pdf`. Trigger en base pour l'immutabilité et pour la cohérence statut / solde des factures.

**Pourquoi.** Une facture émise est une pièce comptable ; l'avoir remplace la retouche.

**Comment c'est vérifié.** Intégration (immutabilité, cumul, course de deux avoirs, rejeu, cohérence statut / solde), contrat (rôles, 409, 400, PDF, avoir refusé sur facture déposée, retenues sur base nette, paiement partiel puis avoir puis solde), unitaires (parité migration et init, calculs, contrat).

**Question pour le client.** Les remboursements ne sont pas gérés en v1 : un avoir est plafonné au solde de la facture. Faut-il rembourser un client qui a déjà payé (avoir supérieur au solde) ? Si oui, quel circuit (trésorerie, décaissement, accord du comptable) ?

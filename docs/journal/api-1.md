# Journal — API 1 (`api-1`)

Worktree : `../fm-api-1`. Modèle d'entrée et règles : `README.md`.
Entrées ajoutées en bas, dans l'ordre chronologique, une par commit.

## 2026-10-31T19:00:00+01:00 — T-40 — Routes des lectures agregees

- **Agent** : api-1 · **Branche** : `lot/api/T-40-routes` · **Commit** : voir `git log` de la branche
- **Statut** : fait
- **Quoi** : `GET /api/vehicles/:id/cost-summary`, `/api/tires/movements`, `/api/billing/pending-invoices`.
- **Comment** : trois routeurs branches sur `aggregateReadsService`, derriere leur drapeau SHOULD puis un `authorize` par ressource (cout : admin, direction, atelier, logistique ; pneus : + magasin et technicien ; factures : admin, direction, secretariat, logistique) ; 404 si vehicule inconnu ; zod sur params et requete.
- **Pourquoi** : P-14, P-15, P-21 ; le client n'accede a aucune de ces lectures.
- **Comment tester (QA)** : activer les drapeaux, ouvrir chaque ecran avec un compte autorise puis un client (403).
- **Preuve** : contrat `aggregate-reads` 4 verts ; `tsc` global 0 erreur.
- **Reste** : `/tires/movements` doit etre monte avant tout `/tires/:id` de `routes.ts` (ordre de montage a verifier par sol).

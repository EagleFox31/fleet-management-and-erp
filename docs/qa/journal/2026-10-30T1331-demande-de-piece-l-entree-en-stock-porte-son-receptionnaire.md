## c06fa45 - Demande de pièce : l'entrée en stock porte son réceptionnaire (PRT6)

**Quoi**
- Nouvelle colonne `part_requirements.received_by` : l'utilisateur qui enregistre l'entrée en stock,
  jamais le demandeur. Posée sur `received` et `partially_received`, par le PATCH de la demande comme par
  la réception d'une commande fournisseur (`updateOrderStatus`, `partial` puis `delivered`).
- Champ tenu par le serveur : omis de `insertPartRequirementSchema`, retiré du corps du PATCH.
- Les demandes reçues avant ce commit restent à `NULL` : le réceptionnaire d'origine n'a pas été conservé.

**Comment**
- `shared/schema.ts` + `ALTER TABLE … IF NOT EXISTS` dans `server/init-database.ts` + migration
  `server/db/migrations/20261030_part_requirements_received_by.sql` (AGENTS.md §5).
- Les sélections explicites de colonnes (`part-requirements-service.ts`, `storage.ts`) renvoient le champ.
- Crescendo : intégration (`part-requirement-received-by` : commande fournisseur partielle par le
  magasinier, complète par l'admin), contrat (`part-requirements-chain` : entrée en stock par le
  magasinier avec un corps qui prétend le technicien ; PATCH hors réception qui tente d'écrire le champ).

**Pourquoi**
- PRT6, dette connue (AGENTS.md §9, `MATRICE_ROLES_GAP.md`) : le mouvement de stock était attribué au
  réceptionnaire depuis le 29 octobre, la demande ne disait toujours pas qui avait réceptionné.

**Preuve**
- Premier passage : 3 rouges (2 contrat, 1 intégration), `receivedBy` absent.
- `npm run check` 0 erreur ; unitaire 474/474 ; intégration 67/67 (13 fichiers) ; contrat 138 verts sur
  les 15 fichiers existants. Les 7 rouges du même run sont ceux du prochain chantier (pneus, TIR1–TIR4),
  dont le test est écrit et pas encore commité.


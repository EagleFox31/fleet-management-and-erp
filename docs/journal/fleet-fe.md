# Journal fleet-fe

## 2026-11-05 : carte des droits par profil mise à jour (docs/recette/profils-droits.html)

**Quoi.** La page autonome `docs/recette/profils-droits.html` reflète les gardes de route et la cloison client de la branche principale au commit 68aab06 (environ 160 fusions depuis la version du 3 novembre). Nouveautés : modules découpés comme demandé (véhicules, documents, missions, carburant, maintenance et OT, magasin pièces et demandes, pneus, achats, facturation client, rapports et exports, administration), profil Utilisateur ajouté, section « Profil Client » lisible seule (ancre `#client`), section « Écarts entre menu, écran et droits », section « À venir » rafraîchie (#214, #233 et la suppression tracée d'un plein sont fusionnés).

**Comment.** Lecture des middlewares `server/middleware/auth.ts`, des montages de `server/api/index.ts` et des routeurs, de `shared/constants/roles.ts`, de la matrice `shared/contracts/exports.ts`, des menus `client/src/components/layout/sidebar.tsx`, des routes `client/src/App.tsx` et des écrans `lot-screens.ts` / `cdc-screens.ts`. Les tableaux de données de la page (profils, actions, statuts) sont réécrits ; le moteur de rendu (cartes SVG, sélecteur de profil) est inchangé.

**Pourquoi.** Plusieurs gardes ont été resserrées (fournisseurs, commandes, factures fournisseur, export Word, prix d'achat du véhicule, données personnelles des chauffeurs, cloison client). L'ancienne page n'était plus fidèle.

**Comment tester.** Ouvrir le fichier dans un navigateur : choisir chaque profil, vérifier le décompte et les cartes ; ouvrir `#client` sur un téléphone (390 px, aucun défilement horizontal) ; basculer en mode sombre du système. Aucune ressource externe hors Google Fonts, aucun emoji.

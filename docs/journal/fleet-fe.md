# Journal fleet-fe

## 2026-11-05 : carte des droits par profil mise à jour (docs/recette/profils-droits.html)

**Quoi.** La page autonome `docs/recette/profils-droits.html` reflète les gardes de route et la cloison client de la branche principale au commit 68aab06 (environ 160 fusions depuis la version du 3 novembre). Nouveautés : modules découpés comme demandé (véhicules, documents, missions, carburant, maintenance et OT, magasin pièces et demandes, pneus, achats, facturation client, rapports et exports, administration), profil Utilisateur ajouté, section « Profil Client » lisible seule (ancre `#client`), section « Écarts entre menu, écran et droits », section « À venir » rafraîchie (#214, #233 et la suppression tracée d'un plein sont fusionnés).

**Comment.** Lecture des middlewares `server/middleware/auth.ts`, des montages de `server/api/index.ts` et des routeurs, de `shared/constants/roles.ts`, de la matrice `shared/contracts/exports.ts`, des menus `client/src/components/layout/sidebar.tsx`, des routes `client/src/App.tsx` et des écrans `lot-screens.ts` / `cdc-screens.ts`. Les tableaux de données de la page (profils, actions, statuts) sont réécrits ; le moteur de rendu (cartes SVG, sélecteur de profil) est inchangé.

**Pourquoi.** Plusieurs gardes ont été resserrées (fournisseurs, commandes, factures fournisseur, export Word, prix d'achat du véhicule, données personnelles des chauffeurs, cloison client). L'ancienne page n'était plus fidèle.

**Comment tester.** Ouvrir le fichier dans un navigateur : choisir chaque profil, vérifier le décompte et les cartes ; ouvrir `#client` sur un téléphone (390 px, aucun défilement horizontal) ; basculer en mode sombre du système. Aucune ressource externe hors Google Fonts, aucun emoji.

## 2026-11-05 — Écran Retenues à la source (lecture seule)

**Quoi.** Écran `/finance/withholdings` : filtres période et client, totaux, récapitulatif par client, détail par facture. Entrée de menu et route pour les rôles de lecture des créances, derrière le drapeau `finance`. La clé `/api/finance/withholdings` est un satellite du groupe `clientMoney` (dépôt de facture, taux de retenue).

**Comment.** Composant `client/src/components/finance/withholdings-summary.tsx`, déclaré dans `lot-screens.ts` et `lot-screen-components.ts`. Contrat `shared/contracts/finance-withholdings.ts` via `useContractQuery`. Texte d'aide : la période porte sur la date de dépôt chez le client.

**Pourquoi.** Déclaration fiscale et rapprochement des attestations de retenue.

**Comment tester.** Ouvrir l'écran avec un compte admin, direction, secrétariat ou logistique (drapeau finance actif) : mois en cours par défaut, aucune action. Autre rôle : pas de menu, route introuvable. Tests : `tests/unit/client/withholdings-summary.test.ts`.

## 2026-11-05 — Corbeille des pièces posées alignée sur le serveur

**Quoi.** Sur la fiche OT, la corbeille des pièces posées n'apparaît que pour admin, magasin et chef d'atelier, et pas sur un OT terminé ou annulé. Commentaire de `canIssueFromStock` corrigé (la garde serveur `isStockIssuer` inclut le chef d'atelier, exclu ici car il passe par la sortie exceptionnelle).

**Comment.** `PART_USED_REMOVE_ROLES` et `canRoleRemovePartUsed` dans `shared/constants/roles.ts` (aucune liste partagée n'existait). Clic via `useSingleFlightMutate`, id en variables. Après succès : invalidation des pièces de l'OT, du détail, de la liste et des satellites stock ; l'événement `part_used_removed` était déjà écouté.

**Pourquoi.** Le technicien recevait un 403 et l'OT annulé un 409 après affichage du bouton.

**Comment tester.** Compte technicien : pas de corbeille. Admin, magasin ou chef d'atelier sur OT en cours : corbeille présente ; OT annulé ou terminé : absente. Test : `tests/unit/client/part-used-remove-roles.test.ts`.

## 2026-11-10 — Landing : nombre de rôles dérivé

- Quoi : les 6 nombres de rôles en dur de `client/src/pages/landing.tsx` (7, 9, 9, 9, 11, 11) deviennent `ROLE_COUNT = userProfiles.length` (11).
- Comment : constante définie sous le tableau `userProfiles`, utilisée dans les 6 libellés. Test `tests/unit/client/landing-role-count.test.ts` : ids de `userProfiles` = `ALL_APP_ROLES` sans `user` (sans doublon), aucun `\d+ rôles|Profils` en dur, constante dérivée.
- Pourquoi : les chiffres avaient divergé de la liste réellement affichée.
- Tester : `node node_modules/vitest/vitest.mjs run tests/unit/client/landing-role-count.test.ts`.

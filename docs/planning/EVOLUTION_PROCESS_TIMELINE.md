# Évolution future — Timeline de process multi-profils

Date : 20 août 2026  
Statut : **Backlog UX** (indépendant des lots réception / QC)  
Inspiration visuelle : `OTTimeline.tsx` + `TechDiagnosticBanner.tsx` d’[atelier2026](https://github.com/EagleFox31/atelier2026)

Ce n’est **pas** un changement de machine à états. On reprend le **rendu** : une chaîne verticale où chaque étape dit **où on en est**, **qui doit agir**, **qui a déjà agi**.

---

## Décision maintenant

- On **s’inspire visuellement** du suivi OT d’atelier2026 pour tous les process FleetOS qui passent entre plusieurs rôles.
- On **n’importe pas** leurs 13 statuts garage, ni le rôle caissier, ni le devis client.
- On **ne code pas tout de suite** : d’abord un composant unique dans le design system, puis branchement écran par écran.
- Ce backlog peut partir **avant** `EVOLUTION_ATELIER_RECEPTION_QC.md` : les données responsables existent déjà (`STATUS_RESPONSIBLE`, historique, `createdBy` / `updatedBy`).

---

## Ce qu’atelier2026 fait bien (à copier)

Leur `OTTimeline` n’est pas un stepper de formulaire (cercles 1-2-3). C’est un **journal de relais** :

| Élément visuel | Rôle |
|---|---|
| Colonne verticale (fait / actuel / futur) | On voit toute la chaîne d’un coup, pas seulement le badge courant |
| Badge **Actuel** sur une seule étape | Réponse à « où en est-on ? » |
| Ligne **par Prénom Nom** sous l’étape faite | Qui a réellement bougé le process |
| Description métier sous le libellé | Ce qui se passe à cette étape, pas le code statut |
| Bannière « à toi de jouer » (`TechDiagnosticBanner`) | Le profil connecté voit **son** action, pas toutes les actions possibles |
| Branche visuelle (ex. QC refusé) | Exception sans casser la ligne principale (annulation, retour atelier) |

Le stepper horizontal existant chez nous (`client/src/components/workflow/stepper.tsx`) reste pour **créer** un objet (nouvelle mission, nouvel OT). Il ne sert pas à **suivre un relais entre profils**.

---

## Ce qu’on a aujourd’hui (le trou)

| Écran | Progression | Acteur attendu | Acteur réel |
|---|---|---|---|
| Demande de pièce (`inventory/requests`) | Badge statut | `STATUS_RESPONSIBLE` côté serveur, peu visible en UI | Partiel |
| Commande fournisseur (`procurement/orders/[id]`) | Stepper horizontal + grille « Responsabilités » à part | Oui, mais **décollée** de la progression | Non sur chaque étape |
| OT (`maintenance/work-orders/[id]`) | Badge + boutons Démarrer / Terminer | Non | Créateur seulement |
| Mission | Statuts + actions | Non dans une chaîne unique | Partiel |
| Facture fournisseur | Liste de dates (validée / approuvée / payée) | Non | Dates sans nom |
| Véhicule | Timeline historique | Non (c’est un journal, pas un pipeline) | Oui (`updatedBy`) |

Le chef d’atelier, le magasinier et la secrétaire doivent ouvrir **des pages différentes** pour savoir « c’est à qui ». L’objectif UX : **la même chaîne**, lue par tous, avec l’étape courante et le profil attendu.

---

## Cible visuelle FleetOS

Deux pièces, réutilisables, tokens du design system (vert primaire, pas d’emoji, icônes lucide) :

### 1. `ProcessTimeline` (colonne)

Pour chaque étape du pipeline **métier** (pas tous les statuts techniques) :

- Icône : check (fait) / point pulsant ou anneau (actuel) / cercle vide (futur)
- Titre = libellé de l’objet suivi (source unique `shared/constants/`)
- Sous-titre = action de l’étape
- **Profil attendu** (toujours) : Magasinier, Chef d’atelier, …
- **Personne réelle + date** (si l’étape est faite) : `par Awa N. · 20 août 2026 · 14:32`
- Badge `À faire` uniquement sur l’étape courante, et seulement si le rôle connecté est dans les acteurs attendus
- États exception : `Annulé`, `Retour`, `Annulation demandée` en branche sous l’étape concernée (même idée que le QC refusé d’atelier2026)

Desktop : colonne à droite du détail (comme la sidebar actions facture).  
Mobile : la colonne **au-dessus** des actions, pas un stepper 5 pastilles illisible.

### 2. `ProcessTurnBanner` (bandeau)

Visible seulement si l’utilisateur connecté **peut** faire la prochaine transition.

Texte type : « En attente du magasinier — sortir la pièce du stock ».  
Bouton unique = l’action de `TRANSITION_DESCRIPTIONS`, pas un menu de 4 statuts.

Si ce n’est pas son tour : bandeau neutre en lecture seule (« En attente du magasinier »), sans bouton mort.

---

## Où le poser (ordre)

Un composant, plusieurs pipelines. Ne pas recoder une timeline par page.

| Priorité | Process | Pipeline affiché (libellés objet) | Relais |
|---|---|---|---|
| **1** | Demande de pièce | En attente → Approuvée → Commandée → Entrée en stock → Sortie du stock | Tech/chef → chef/secrétaire → magasinier |
| **2** | Commande fournisseur | Fusionner le stepper actuel **et** le bloc Responsabilités | Magasin / secrétariat / admin selon type de commande |
| **3** | Ordre de travail | En attente → En cours → Attente pièces → Terminé | Chef / technicien / magasin (via demandes liées) |
| **4** | Mission | Brouillon → Planifiée → Affectée → En cours → Livrée → Terminée | Logistique → chauffeur → secrétariat |
| **5** | Facture fournisseur | Reçue → Validée → Approuvée → Réglée | Secrétaire / admin (droits par métrique déjà en place) |

L’OT (priorité 3) gagnera plus tard les étapes réception / QC du doc atelier ; la timeline s’allonge, le composant ne change pas.

---

## Règles d’implémentation (quand on lancera)

1. **Un seul composant** dans `client/src/components/design-system/` (ex. `process-timeline.tsx`), exporté via `index.ts`. Interdit de recopier le JSX dans chaque page.
2. Le pipeline (clés, libellés, profil attendu) vient des **constantes partagées** / du workflow serveur — pas d’une table locale dans le JSX. Pour les pièces : `STATUS_LABELS` + `STATUS_RESPONSIBLE` déjà dans `part-requirements-workflow.ts` (les remonter côté `shared/` si le client ne doit pas importer le serveur).
3. Le stepper horizontal `workflow/stepper.tsx` **reste** pour les wizards de création. Ne pas le « enrichir » jusqu’à le faire servir au suivi : deux jobs différents.
4. `StatusBadge` générique : ne pas y mettre le vocabulaire magasin (`issued` = « Émise » pour une facture). Les timelines process passent par les libellés métier.
5. Temps réel : si le statut change, la timeline se met à jour via les 3 couches (cache, WebSocket, invalidation détail). Pas de polling déguisé.
6. Accessibilité : l’étape courante a un `aria-current="step"`. Pas d’emoji.

---

## Hors scope

- Nouveaux statuts OT (réception, QC) — autre document.
- SMS / bannière colorée « style garage » hors tokens.
- Timeline véhicule : garder le journal historique (ce n’est pas un relais de rôles).

---

## Cas concret — OT, pièce reçue, magasin fermé

Situation actuelle (août 2026) :

- Le technicien **demande** la pièce et la **voit** dans l’OT (badge de statut).
- Seul le magasinier (ou admin) **sort** du stock : `isStockIssuer` + `received → issued`. Le bouton « Sortir du stock » est masqué au tech ; à la place un badge « Sortie par le magasin ».
- Si ça bloque le soir / week-end, la réponse produit n’est **pas** de rendre le bouton au tech : c’est une **soupape tracée** (geste exceptionnel audité), pas un contournement.

La timeline aide **ici** :

| Ça règle | Ça ne règle pas |
|---|---|
| Le tech comprend que l’étape courante est « Entrée en stock » / « Sortie du stock » et que l’acteur attendu est le **magasinier**, pas lui | Le magasin fermé le week-end (besoin d’une soupape RBAC + audit, décision terrain) |
| Plus de bouton mort ni de 403 : bandeau lecture « En attente du magasinier » vs bouton unique côté magasin | Le `if (technician && technicianId !== user.id)` devenu mort sur `POST …/issue` (le tech n’entre plus) — à commenter ou retirer, pas à habiller |
| Même chaîne lue depuis l’OT et depuis `/inventory/requests` | Le test de garde « `storage.updatePartRequirement` n’accepte pas `status` hors service » — dette tests, hors UX |

En résumé : la timeline rend le **relais visible**. Elle ne remplace ni la soupape week-end, ni le nettoyage de route, ni le test anti-porte dérobée.

---

## Déclencheur

Lancer la priorité 1 (demandes de pièce) quand on veut réduire les allers-retours « c’est à qui ? » entre atelier et magasin, **sans** attendre les lots réception / QC.

Premier écran : l’onglet pièces de l’OT (`work-orders/[id]`), là où le tech voit encore le statut mais plus le geste. Puis la liste `/inventory/requests`.

Critère de recette : deux sessions (chef d’atelier + magasinier) voient **la même étape courante** et **le même profil attendu** ; seul le magasinier a le bouton d’action sur « Sortie du stock ». Le technicien voit le bandeau lecture, jamais le bouton. Vérifier la trame WebSocket (`e2e/README.md`).

---

## Références

- atelier2026 : `components/workshop/OTTimeline.tsx`, `TechDiagnosticBanner.tsx`
- Design system actuel : steppers + timeline d’historique (`.claude/design-system.md`)
- Demandes de pièce : `server/services/part-requirements-workflow.ts` (`STATUS_RESPONSIBLE`, `TRANSITION_DESCRIPTIONS`)
- Commande : `client/src/pages/procurement/orders/[id].tsx` (stepper + bloc responsabilités à fusionner)
- Lots métier atelier : `docs/planning/EVOLUTION_ATELIER_RECEPTION_QC.md`

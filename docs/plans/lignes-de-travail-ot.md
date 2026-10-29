# Plan — Lignes de travail sur l'ordre de travail (lot 3)

**Statut** : à implémenter
**Date** : 2026-09-01
**Cadre** : `docs/planning/EVOLUTION_ATELIER_RECEPTION_QC.md`, lot 3 — exécuté en
premier conformément à la règle 2 de sa méthode d'exécution.

---

## Périmètre — lire avant tout

Ce lot enregistre **le temps passé** sur une intervention. Rien d'autre.

Il **ne valorise pas** ces heures en argent, il ne touche pas à
`workOrders.cost`, et il ne modifie aucun des calculs du tableau de bord
Direction.

> **Pourquoi.** Les techniciens sont salariés : leur paie tombe que le camion
> soit réparé ou non. Valoriser leurs heures et les remonter dans les charges du
> DG ferait baisser le résultat d'un montant qui n'est pas une dépense du mois —
> de la main-d'œuvre déjà payée, comptée une seconde fois sous un autre nom.
> Le système ne connaît d'ailleurs aucune notion de paie.
>
> Le coût qui compte aujourd'hui est celui des **pièces**, et il est déjà géré
> par le circuit magasin.

**Reporté explicitement, à ne pas anticiper :**

- taux horaire et valorisation des heures ;
- prime ou performance technicien — les heures collectées ici en seront la base
  le moment venu ;
- main-d'œuvre externe et sous-traitance : elles passent déjà par une facture
  fournisseur, donc elles sont déjà comptées. À traiter séparément, en veillant
  à ne pas les compter deux fois.

L'objectif immédiat est de **livrer l'application**. Ce lot doit rester petit.

---

## Pourquoi ce lot d'abord

Il n'ajoute **aucun état** au cycle de l'ordre de travail : `work_order_items`
est une table fille. Aucun risque sur les transitions, aucune reprise du cas de
non-régression P2b.

Et il comble le manque nommé dans le backlog : *« le champ `duration` / `cost` de
l'OT est trop pauvre »*. Un OT porte aujourd'hui une seule durée pour toute
l'intervention — impossible de dire qui a passé combien de temps sur quoi.

---

## Décision tranchée

**Les heures de ligne ne sont pas du pointage.**

`time_tracking` porte un **code de présence par jour** (`JT`, `M`, `Mi`, `C`,
`A`, `R`, `Re`) et aucune heure. C'est de la paie : présent, absent, congé. Elle
ne peut pas répondre à « combien de temps sur ce camion ».

Les deux tables coexistent sans lien. Ne pas tenter de les fusionner.

---

## Cible

### `labor_catalog` — postes de main-d'œuvre

Sert de **barème de comparaison** : 6 heures sur une vidange dont le standard
est 1 heure, c'est l'information utile.

| Colonne | Type | Note |
|---|---|---|
| `id` | serial | |
| `code` | text unique | ex. `VID-MOT`, `FREIN-AV` |
| `label` | text | libellé affiché |
| `standard_hours` | numeric(5,2) | temps barème, indicatif |
| `is_active` | boolean | défaut `true` |

Pas de colonne de tarif : voir le périmètre.

### `work_order_items` — lignes d'une intervention

| Colonne | Type | Note |
|---|---|---|
| `id` | serial | |
| `work_order_id` | integer NOT NULL | FK `work_orders`, `onDelete: cascade` |
| `labor_catalog_id` | integer NULL | FK ; `NULL` si travail hors catalogue |
| `custom_label` | text NULL | obligatoire si pas de poste catalogue |
| `technician_id` | integer NULL | FK `users` |
| `estimated_hours` | numeric(5,2) NULL | reprise du barème, modifiable |
| `actual_hours` | numeric(5,2) NULL | **la donnée qui manquait** |
| `status` | enum | `pending` / `in_progress` / `done` / `cancelled` |
| `started_at`, `completed_at` | timestamp NULL | |
| `notes` | text NULL | |
| `created_by`, `created_at`, `updated_at` | | audit, comme les autres tables |

**Une ligne sans `actual_hours` ne compte pas** dans les totaux. Elle n'est pas
comptée à zéro : on n'estime pas à la place d'une mesure. Même règle que le
kilométrage réel du PRK.

---

## Étapes

### Étape 1 — Schéma et base

- [x] `shared/schema.ts` : `laborCatalog`, `workOrderItems`, enum de statut de ligne
- [x] `server/init-database.ts` : `CREATE TABLE IF NOT EXISTS` pour les deux tables
- [x] Migration idempotente dans `server/db/migrations/`
- [x] Index sur `work_order_items(work_order_id)` et `(technician_id)`

> Le schéma et `init-database.ts` avancent **ensemble**. Une colonne déclarée
> dans Drizzle mais absente d'`init-database` plante sur une base vierge —
> première leçon de `LESSONS_LEARNED.md`.

### Étape 2 — Service

- [x] `server/services/work-order-items-service.ts`, **seul écrivain** des deux tables
- [x] Totaux d'un OT : heures estimées, heures réelles, écart au barème
- [x] Aucune route n'écrit `work_order_items` directement par `storage`
- [x] **Ne pas toucher à `workOrders.cost`**

> Trois portes dérobées de ce type ont été fermées en août 2026 : sortie de
> stock, statut véhicule, `status_history`. Ne pas en rouvrir une quatrième.

### Étape 3 — Tests unitaires, avant l'écran

- [x] Somme des heures réelles de plusieurs lignes
- [x] Ligne sans `actual_hours` : exclue du total, pas comptée à zéro
- [x] Écart au barème quand `standard_hours` existe, et quand il n'existe pas
- [x] Ligne hors catalogue : `custom_label` obligatoire

> Ces règles se testent sans base. Les figer avant l'interface évite que
> l'écran impose sa propre interprétation.

### Étape 4 — Routes

- [x] `GET /api/work-orders/:id/items`
- [x] `POST /api/work-orders/:id/items`
- [x] `PATCH /api/work-order-items/:id`
- [x] `DELETE /api/work-order-items/:id`
- [x] `GET /api/labor-catalog` (écriture réservée à `admin` / `workshop_manager`)
- [x] Garde de rôle au **montage** du routeur, pas route par route

### Étape 5 — Écran

- [x] Onglet **Travaux** sur la fiche d'OT, à côté de Pièces et Pneus
- [x] Ajout d'une ligne : poste catalogue ou libellé libre, technicien, heures
- [x] Total des heures réelles, et écart au barème quand il existe
- [x] État vide explicite : « Aucune ligne de travail enregistrée »
- [x] Brouillon de formulaire via `use-form-draft` (consigne projet)

### Étape 6 — Temps réel (règle des 3 couches)

- [x] Événement `work_order_item_changed` à la création / modification / suppression
- [x] Invalidation : détail OT, liste OT
- [x] Invalidation des **écrans satellites** : tableau chef d'atelier, dashboard technicien (via `/api/work-orders` et `/api/dashboard/technician-stats` ; aucun écran satellite n'affiche encore les heures des lignes)

> C'est la couche qu'on oublie, et celle qui produit l'écran figé.
> Pas d'invalidation du tableau Direction : ce lot ne touche à aucun montant.

---

## Hors périmètre

- Toute valorisation en argent — voir le périmètre en tête.
- `workOrders.cost` et ses 13 lecteurs : **inchangés**.
- Aucun nouvel état sur `work_orders` — c'est le lot QC qui les apportera.
- Pas de lien avec `time_tracking`.
- Pas de photos ni d'observations structurées — c'est le lot 4.

---

## Critères de fin

- [x] `npx tsc --noEmit` : 0 erreur **sur tout le projet**, sans filtrer la sortie
- [x] `npm test` : suite complète verte, avec les nouveaux tests de l'étape 3
- [x] Une intervention réelle saisie avec deux lignes et deux techniciens (test de contrat `tests/contract/work-order-items.contract.test.ts`, par l'API ; pas encore rejouée dans le navigateur)
- [x] Le tableau de bord Direction affiche **exactement les mêmes montants**
      qu'avant le lot — c'est la preuve que rien n'a fui vers les charges (prouvé indirectement : `work_orders.cost` inchangé dans le test de contrat, aucune invalidation Direction)

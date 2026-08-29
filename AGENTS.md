# AGENTS.md — Conventions de contribution

Guide destiné aux agents et aux développeurs qui modifient ce dépôt.
Il ne remplace pas `docs/`, il fixe les règles qui se perdent le plus souvent.

---

## 1. Libellés de statut

### Règle

**Un libellé de statut décrit l'objet métier suivi, pas l'action qui l'a produit.**

Pour les demandes de pièce, le badge décrit **la demande**. Les libellés sont donc
au féminin et au participe passé (`Approuvée`, `Commandée`, `Annulée`).

Les deux étapes qui déplacent physiquement du stock font exception et forment une
**paire symétrique en groupe nominal**, parce qu'elles sont lues par le magasin :

| Statut | Libellé | Sens |
|---|---|---|
| `received` | **Entrée en stock** | La pièce est arrivée au magasin |
| `issued` | **Sortie du stock** | La pièce a quitté le magasin vers l'atelier |

Chaîne complète :

```
En attente -> Approuvée -> Commandée -> Entrée en stock -> Sortie du stock
```

### Pourquoi ces libellés

- Ils reprennent le vocabulaire déjà employé pour l'action correspondante :
  `TRANSITION_DESCRIPTIONS['received_issued'] = 'Sortir la pièce du stock'`.
- `Terminé` (ancien libellé de `issued`) ne disait pas ce qui s'était passé, et
  contrevenait à la règle de `docs/analysis/LESSONS_LEARNED.md` : pas de libellé
  technique ou vague dans l'UI finale.
- `Affecté à l'OT` est **interdit** pour `issued` : c'est le sens de `fulfilled`
  (« Pièce installée, OT clôturé »). Confondre les deux détruit la distinction.
- `Sortie validée` est **interdit** : la transition `received -> issued` n'a pas
  d'étape d'approbation, le mot « validée » induirait un contrôle inexistant.

### Source unique

Tous les libellés de statut de demande de pièce vivent dans :

```
shared/constants/part-requirements.ts
```

Le serveur et les pages **importent** depuis ce fichier. Ne jamais redéclarer une
table de libellés en local : il en existait trois, elles avaient déjà divergé
(`fulfilled` valait « Installée » côté client et « Utilisée » côté serveur).

Consommateurs actuels :

- `server/services/part-requirements-workflow.ts` (`STATUS_LABELS`)
- `client/src/pages/inventory/requests.tsx`
- `client/src/pages/procurement/orders/new.tsx`
- `client/src/lib/part-requirement-status.ts`

Avant d'écrire un libellé de statut en dur dans du JSX, vérifier qu'il n'existe
pas déjà dans les constantes partagées.

### Frontière avec le StatusBadge générique

`client/src/components/design-system/status-badge.tsx` est **multi-domaines**
(factures, commandes, documents). Chez lui, `issued` signifie « Emise » au sens
d'une facture émise, ce qui est correct dans son contexte. Ne pas y propager le
vocabulaire stock. Les écrans de demandes de pièce doivent passer par
`getPartRequirementStatusLabel`, pas par ce composant générique.

---

## 2. Transitions métier : la règle des 3 couches

Détaillée dans `docs/analysis/LESSONS_LEARNED.md`. Toute transition métier doit
livrer les trois, sans exception :

1. **Instantané UI local** — mise à jour du cache après succès de la mutation.
2. **Temps réel inter-profils** — émission d'un événement WebSocket dédié.
3. **Resync ciblé** — invalidation des queries impactées : détail, liste **et**
   écrans satellites (dashboards, KPI, compteurs).

Oublier la couche 3 sur les écrans satellites est l'erreur la plus fréquente.

### Le `QueryClient` est un singleton

Toujours l'importer **par l'alias** :

```ts
import { queryClient } from "@/lib/queryClient";
```

Jamais par chemin relatif (`./lib/queryClient`, `../lib/queryClient`). Vite
résout les deux formes comme deux modules distincts : on obtient **deux
instances**, le provider en utilise une et la synchro temps réel écrit dans
l'autre. Toute la couche temps réel devient alors silencieusement inerte —
l'app ne se met plus à jour que par les `refetchInterval` de polling.

C'est un bug réel, corrigé le 18 août 2026 : `main.tsx` était le seul importeur
par chemin relatif. Symptôme à reconnaître : une latence d'affichage
**approximativement égale à un `refetchInterval`** (7 s sur les ordres de
travail). Détails dans `docs/analysis/LESSONS_LEARNED.md`.

La même vigilance vaut pour tout module portant un état partagé.

---

## 3. Tester le temps réel

Vérifier la **trame WebSocket**, pas seulement l'écran : plusieurs listes ont un
`refetchInterval` (7 s sur les ordres de travail), donc une assertion UI au-delà
de cet intervalle est satisfaite par le polling et ne prouve rien.

Un test temps réel doit jouer **deux comptes de rôles différents**. Voir
`e2e/README.md` (section « Piège à connaître ») et `e2e/06-realtime-work-orders.spec.ts`.

---

## 4. Interface

Le design system fait foi : `.claude/design-system.md`.

Deux règles qui reviennent le plus :

- **Aucun emoji dans l'UI**, jamais. Utiliser une icône `lucide-react`.
- **Attention au thème** : le fond de la landing est sombre et `fixed`. Une section
  sans fond propre est sur du sombre (`text-white` correct) ; une section en
  `bg-background/80` devient claire (`text-white` y est invisible). Utiliser les
  tokens (`text-foreground`, `text-muted-foreground`) sur fond clair.

Densité d'affichage : la racine passe à 90 % entre 1280 et 1599 px
(`client/src/index.css`). Les tailles écrites en px en dur (`text-[11px]`) ne
suivent pas cette réduction, c'est volontaire.

---

## 5. Traçabilité stock : `parts` et `tires`

Les fiches **pièces** (`parts`) et **pneus** (`tires`) portent les **quatre champs
d'audit obligatoires** :

| Colonne BDD | Type | Rôle |
|---|---|---|
| `created_by` | `integer` → `users.id` | Utilisateur ayant créé la fiche |
| `updated_by` | `integer` → `users.id` | Dernier utilisateur ayant modifié la fiche |
| `created_at` | `timestamp` | Horodatage de création |
| `updated_at` | `timestamp` | Horodatage de dernière modification |

### Règles serveur

1. **Création** (`POST /api/parts`, `POST /api/tires`) — renseigner `created_by`
   et `updated_by` avec `req.user.id` (les deux à la création), plus
   `created_at` / `updated_at`.
2. **Modification** (`PATCH`, ajustement stock, soft delete pneu) — mettre à jour
   `updated_by` + `updated_at`. Ne jamais laisser le client écrire ces champs
   dans le body : ils sont **omis** des schémas Zod d'insertion
   (`insertPartSchema`, `insertTireSchema`).
3. **Lecture** — les services peuvent enrichir la réponse avec `createdByName` /
   `updatedByName` (jointure `users`), sans colonnes supplémentaires en BDD.

### Schéma source

```
shared/schema.ts  →  tables parts, tires
server/services/parts-service.ts
server/services/tires-service-simplified.ts
```

Migration SQL de référence :
`server/db/migrations/20260818_parts_tires_audit_columns.sql`

**Règle schéma :** toute colonne ajoutée dans `shared/schema.ts` doit aussi être
créée de façon idempotente dans `server/init-database.ts` (`ALTER TABLE … IF NOT
EXISTS`). Un fichier dans `server/db/migrations/` seul ne suffit pas : il est
rejoué au démarrage, mais la duplication dans `init-database.ts` garantit la
cohérence avec le reste du bootstrap (comme `parts.created_by`). Ne pas compter
sur un `drizzle-kit push` manuel ni sur une exécution Neon ponctuelle.

### RBAC pneus (magasin vs atelier)

Aligné sur la feuille Excel **PNEUMATIQUE** (`docs/analysis/MATRICE_ROLES_GAP.md`) :

| Action | Rôles | Middleware |
|---|---|---|
| Créer / modifier fiche pneu en stock | `admin`, `warehouse` | `isTireCatalogManager` |
| Montage, rotation, démontage | `admin`, `workshop_manager` | `isWorkshopManager` |
| Inspections | + `technician` | `isTechnician` |

Ne pas utiliser `isWorkshopManager` pour le référentiel stock pneu : c’était une
erreur corrigée (magasinier bloqué en 403 malgré le menu `/inventory/tires`).

### Inventaire stock : réutiliser `PremiumDataTable`

Pièces et pneus sont le **même objet mental** (référence, quantité, prix,
fournisseur, emplacement). L'UI partage le même composant tableau :

| Référence | Composant |
|---|---|
| Pièces | `client/src/components/inventory/part-table.tsx` |
| Pneus | `client/src/components/inventory/tire-table.tsx` |

Règles alignées sur `part-table` :

- **`PremiumDataTable`** — pas de grille de cards pour le catalogue stock.
- **Ligne cliquable** = voir le détail ; pas de bouton « œil » redondant.
- **Actions visibles selon le rôle** — masquer la corbeille aux non-admin (ne pas
  afficher puis toast « accès refusé »).
- **Magasinier** : ajuster le stock + modifier ; **admin** : + supprimer.
- **Stock bas** : `rowClassName` bordure rouge + fond teinté (même pattern que pièces).

---

## 6. Brouillons de formulaire (localStorage)

Pour les formulaires longs ou multi-étapes, réutiliser le pattern du wizard pneu :

| Couche | Fichier | Rôle |
|---|---|---|
| Stockage | `client/src/lib/form-draft-storage.ts` | `createFormDraftStorage({ formId, version })` |
| Hook | `client/src/hooks/use-form-draft.ts` | Restauration, auto-save debounced, purge |
| UI | `client/src/components/form-draft/form-draft-indicator.tsx` | Badge + bouton « Effacer brouillon » |

### Ajouter un brouillon à un écran

1. Créer un module `client/src/lib/<forme>-draft.ts` avec le storage typé,
   les `defaultValues` et un `isEmpty()` si besoin.
2. Brancher `useFormDraft({ form, storage, userId, isEmpty })` dans la page.
3. Appeler `clearDraft()` dans le `onSuccess` de la mutation POST/PATCH.
4. Afficher `FormDraftBadge` + `FormDraftDiscardButton`.

Pour un **wizard multi-étapes**, passer aussi `getMeta` / `applyMeta` (ex. `{ step }`)
et appeler `persistDraft(values, meta)` à chaque changement d'étape.

Clé localStorage : `fleetos-<formId>-v<version>-<userId>` — incrémenter `version`
si la forme des données change (sinon le brouillon est ignoré).

Références : `client/src/lib/tire-wizard-draft.ts`, `client/src/lib/supplier-new-draft.ts`.

**Ne pas confondre** avec `use-workflow-persistence.ts` : celui-ci persiste côté
serveur (`/api/workflows/vehicle-acquisition`) pour l'acquisition véhicule.

---

## 7. Imports TypeScript — pas de doublon

Quand on **regroupe, déplace ou fusionne** des `import` en tête de fichier :

1. **Retirer l'ancienne ligne** avant d'ajouter le même symbole ailleurs.
2. **Relire le bloc d'imports** (≈ 45 premières lignes) ou lancer `ReadLints` /
   `npm run check` sur le fichier touché.

Symptôme Vite typique : `Identifier 'X' has already been declared`.

Exemple réel (août 2026) : `canRoleEvaluateSupplierCategory` importé deux fois dans
`client/src/pages/procurement/suppliers/[id].tsx` après fusion de blocs d'imports
sans suppression de l'original.

### Source unique des rôles

Le type `AppRole` et la liste `ALL_APP_ROLES` vivent dans `shared/constants/roles.ts`
et se **dérivent du schéma** (`users.role.enumValues`). Ne pas redéclarer une liste
de rôles locale : ajouter un rôle dans `shared/schema.ts` suffit, sauf libellés UI
(`getRoleLabel`, formulaire admin).

---

## 8. Vérifications avant de rendre la main

```bash
npm run check              # TypeScript
npm test                   # Vitest unitaires (pas de DB)
npm run test:integration   # Vitest services + DATABASE_URL_TEST
npm run test:contract      # Vitest HTTP in-process + DATABASE_URL_TEST
npm run test:e2e           # Playwright (voir e2e/README.md)
```

Arborescence et règles : `tests/README.md`. Ne pas colocaliser de `*.test.ts` dans `client/`, `server/` ou `shared/`.

Notes :

- Lancer **`npm run check` sur tout le projet** — ne pas filtrer la sortie sur ses
  seuls fichiers pour conclure « c'est bon ». Le décompte qui vaut : zéro `error TS`
  global.
- `npx playwright` ne fonctionne pas ici : les shims de `node_modules/.bin` font
  0 octet (dépendances installées sous Linux puis copiées). Utiliser
  `node node_modules/@playwright/test/cli.js test`.
- Les e2e écrivent sur la base réelle pointée par `DATABASE_URL`. Ne pas les
  lancer contre la production.

---

## 9. Dette connue à ne pas aggraver

- `server/routes.ts` (~5 700 lignes) contient des routes dupliquées. Ne rien y
  ajouter : créer un routeur dans `server/api/` et le monter dans `server/api/index.ts`.
- `server/_archive/` et les variantes `vehicle-activation-service-*.ts` /
  `vehicle-deletion-service-*.ts` sont du code mort. Ne pas s'en inspirer.
- Traçabilité stock ouverte : `server/services/part-requirements-service.ts`
  attribue l'entrée en stock à `requirement.requestedBy` (le demandeur) au lieu
  du magasinier qui réceptionne. Correction attendue : champ `receivedBy`.
  Voir `docs/analysis/MATRICE_ROLES_GAP.md`.

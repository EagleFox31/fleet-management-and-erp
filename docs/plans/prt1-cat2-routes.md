# Plan — routes manquantes PRT1 (variantes/spécifications de pièce) et CAT2 (pièces d'une panne)

Cadrage du 2026-11-02, à la demande de la session tests. Plan seulement, aucun code livré.

## Constat préalable (CAT2 en partie déjà fait)

La partie « validatedBy forgeable / id inconnu en 200 » de CAT2 est **déjà corrigée** : le PATCH de
`server/api/fault-catalog.routes.ts:20-57` retire `validatedBy` du corps, le pose depuis `req.user.id` au passage
à `validated`, le remet à null au retour en `draft`, et renvoie 404. Monté avant routes.ts (`server/api/index.ts:96`).
`tests/contract/fault-catalog-lifecycle.contract.test.ts` ne contient plus aucun `it.fails` (l.114-134 en `it`).
La ligne 194 de `docs/qa/PLAN_COUVERTURE_MODULES.md` est donc périmée.

Ce qui manque pour les deux points : les tables existent dans le schéma, mais aucune route ni méthode de service ne
les expose. Rien à créer côté modèle, sauf la garantie d'existence des tables dans `init-database.ts` et deux défauts
de FK.

## 1. PRT1 : variantes et spécifications de pièce

**Modèle (réutilisé)** — `shared/schema.ts`
- `part_specifications` (617-624) : `part_id` FK `parts` ON DELETE CASCADE. Pas d'index unique : décider (part_id, nom) unique ou non.
- `part_variants` (627-635) : `part_id` en cascade, `variant_code` UNIQUE global. `part_requirements.variant_id` (l.568) référence `part_variants` sans onDelete.
- Zod existants : `insertPartSpecificationSchema` (642), `insertPartVariantSchema` (647).

**Migration**
- Ni `server/init-database.ts` ni `server/db/migrations/` ne mentionnent ces tables, ni `fault_catalog*` : elles n'existent que par `drizzle-kit push`, interdit de supposer (AGENTS.md §5).
- Ajouter `server/db/migrations/2026110x_parts_catalog_children.sql` + miroir `init-database.ts` (mécanique `LOT_RECETTE_SCHEMA_STATEMENTS` l.104, verrou consultatif, test de dérive comme `tests/unit/server/lot-recette-schema-drift.test.ts`).
- Idempotent : `CREATE TABLE IF NOT EXISTS` pour `part_specifications`, `part_variants`, `fault_catalog_parts` ; `CREATE INDEX IF NOT EXISTS idx_part_specifications_part_id`, `idx_part_variants_part_id` ; si unicité retenue : `CREATE UNIQUE INDEX IF NOT EXISTS ux_part_specifications_part_name ON part_specifications(part_id, lower(specification_name))`.

**Zod partagé** (`shared/schema.ts`, après les schémas existants)
- `insertPartSpecificationSchema` : `partId` omis (vient de `:id`). Textes `.trim().min(1)`.
- `updatePartSpecificationSchema` : insertion en `.partial()`, sans `partId`.
- `insertPartVariantSchema` : `partId` omis ; `additionalPrice` numérique ≥ 0 coercé en string (même règle que `unitPrice`, cf. #76).
- `updatePartVariantSchema` : `.partial()`.
- Pas de colonnes d'audit (§5 ne vise que `parts` et `tires`).

**Service** : nouveau `server/services/part-catalog-children-service.ts` (ou méthodes dans `parts-service.ts`).
- `listSpecifications(partId)`, `createSpecification`, `updateSpecification(partId, specId)`, `deleteSpecification`, idem variantes.
- Pièce inexistante → `AppError(404)`. Toujours filtrer sur le couple (partId, childId) : enfant d'une autre pièce → 404.
- Doublon de code (`isUniqueViolation`, `server/lib/pg-errors`) → 409.
- Suppression d'une variante référencée par `part_requirements.variant_id` : FK 23503 → 409 « variante utilisée par une demande » (option : `isAvailable=false`).

**Routes** : dans `server/api/parts-catalog.routes.ts` (monté avant routes.ts, `index.ts:94`). Aucun doublon dans routes.ts ; `/api/parts/:id(\\d+)` (routes.ts:2677) ne capture pas ces chemins.

| Méthode | Chemin | Garde | Codes |
|---|---|---|---|
| GET | `/parts/:id([0-9]+)/specifications` | `isStaff` | 200, 401, 404 |
| POST | `/parts/:id([0-9]+)/specifications` | `authenticate, isPartsCatalogManager` | 201, 400, 403, 404, 409 (si index unique) |
| PATCH | `/parts/:id([0-9]+)/specifications/:specId([0-9]+)` | idem | 200, 400, 403, 404 |
| DELETE | `/parts/:id([0-9]+)/specifications/:specId([0-9]+)` | idem | 204, 403, 404 (ou 204 rejouable, aligner sur DELETE pièce) |
| GET | `/parts/:id([0-9]+)/variants` | `isStaff` | 200, 404 |
| POST | `/parts/:id([0-9]+)/variants` | `authenticate, isPartsCatalogManager` | 201, 400, 403, 404, 409 |
| PATCH | `/parts/:id([0-9]+)/variants/:variantId([0-9]+)` | idem | 200, 400, 403, 404, 409 |
| DELETE | `/parts/:id([0-9]+)/variants/:variantId([0-9]+)` | idem | 204, 403, 404, 409 (référencée) |

- RBAC : écriture `admin` + `warehouse` (`isPartsCatalogManager`, `server/middleware/auth.ts:188`) ; lecture `isStaff` (l.209), le technicien et l'atelier choisissent une variante dans une demande.
- **Client existant cassé** : `client/src/pages/inventory/parts-database.tsx:60-96` appelle `GET/POST /api/parts/specifications` et `/api/parts/variants` à plat avec `partId` dans le corps (routes inexistantes). Porter le client sur les chemins imbriqués (`selectedPartId` connu l.148, l.154) ; sinon alias à plat (`?partId=`, `partId` dans le corps). Vérifier la signature d'`apiRequest`. Invalider la query de la pièce après mutation (§2) ; WebSocket non indispensable pour un référentiel, à justifier en une ligne dans la PR.

**Tests de contrat** : étendre `tests/contract/parts-catalog-crud.contract.test.ts`, retirer la phrase l.15-16. Cas :
201 par `warehouse` et `admin` ; 403 `technician`, `workshopManager`, `secretary` ; 200 lecture `technician` ; 401 sans session ;
pièce inconnue 404 (GET, POST) ; enfant d'une autre pièce 404 ; `variantCode` dupliqué 409 sans fuite (`noLeak`) ;
`additionalPrice` non numérique/négatif 400 avec champ nommé ; `partId` du corps ignoré ; suppression pièce → cascade ;
variante référencée par une demande → DELETE 409. Nettoyage : cascade suffit pour `ids.partIds` ; ajouter les tables à `tests/support/cleanup` si on crée des demandes.

## 2. CAT2 : pièces associées à une panne

**Modèle** : `fault_catalog_parts` (`shared/schema.ts:751-758`) existe, deux défauts à corriger dans la même migration :
- FK sans `onDelete` : `DELETE /api/fault-catalog/:id` (routes.ts:4704, `storage.deleteFaultCatalog` storage.ts:2388) → **500** dès qu'une pièce est liée ; `partsService.deletePart` (`parts-service.ts:224-237`) → 500 si la pièce est liée. Décision : `fault_catalog_id` et `part_id` en ON DELETE CASCADE (ou RESTRICT + 409 explicite dans `deletePart`). SQL idempotent : `ALTER TABLE ... DROP CONSTRAINT IF EXISTS <nom>` puis `ADD CONSTRAINT ... ON DELETE CASCADE` ; **vérifier le nom réel dans `pg_constraint`** (local et Neon). Refléter dans `shared/schema.ts` (`{ onDelete: "cascade" }`).
- Couple non unique : `CREATE UNIQUE INDEX IF NOT EXISTS ux_fault_catalog_parts_fault_part ON fault_catalog_parts(fault_catalog_id, part_id)` ; **dédoublonner avant** (garder `min(id)`) sinon échec au démarrage ; exposer l'index côté Drizzle.
- `quantity` : `default(1)`, nullable ; Zod entier ≥ 1. `isOptional` : boolean, défaut false.

**Zod** (`shared/schema.ts:760`)
- `insertFaultCatalogPartSchema` : `faultCatalogId` omis ; `partId` entier positif ; `quantity` entier ≥ 1 (défaut 1) ; `isOptional` booléen optionnel.
- `updateFaultCatalogPartSchema` : `{ quantity?, isOptional? }` ; `partId` non modifiable (supprimer puis recréer).
- Facultatif : `FAULT_CATALOG_STATUSES = ["draft","validated","archived"]` dans `shared/constants/fault-catalog.ts` avec libellés (Brouillon / Validée / Archivée), consommé par le schéma et `client/src/pages/maintenance/fault-catalog.tsx` (vérifier d'abord l'absence d'une table locale côté client).
- Durcir le POST de création (routes.ts:4668, retire bien `createdBy` et `validatedBy`) : ajouter `validatedBy: true` aux omissions d'`insertFaultCatalogSchema` (l.744) ; routes.ts:4672 doit continuer à passer `createdBy` hors `parse` ; `npm run check` doit rester vert.

**Routes** : dans `server/api/fault-catalog.routes.ts`. Aucun doublon dans routes.ts sous `/api/fault-catalog/:id/parts`.

| Méthode | Chemin | Garde | Codes |
|---|---|---|---|
| GET | `/fault-catalog/:id([0-9]+)/parts` | `isStaff` (même lecture que routes.ts:4658) | 200 (jointure `parts.name`, `reference`), 401, 404 |
| POST | `/fault-catalog/:id([0-9]+)/parts` | `isWorkshopManager` | 201, 400, 403, 404 (panne), 400/404 (`partId` inconnu, 23503 explicite), 409 (déjà liée), 409 (archivée) |
| PATCH | `/fault-catalog/:id([0-9]+)/parts/:linkId([0-9]+)` | `isWorkshopManager` | 200, 400, 403, 404, 409 (archivée) |
| DELETE | `/fault-catalog/:id([0-9]+)/parts/:linkId([0-9]+)` | `isWorkshopManager` | 204, 403, 404, 409 (archivée) |

- RBAC : écriture `admin` + `workshop_manager` (`isWorkshopManager`, auth.ts:175) ; lecture personnel. Magasinier et technicien en lecture seule (403 écriture déjà prouvé pour la fiche, test l.93-100).
- Règle métier : panne `archived` figée → 409 sur écriture de ses pièces ; `validated` reste modifiable. Règle dans le service, pas dans la route.
- Option recommandée : déménager aussi GET/POST/DELETE fiche (routes.ts:4658, 4668, 4704) dans `fault-catalog.routes.ts`, désactiver les doublons de routes.ts et mettre à jour la liste gelée `tests/unit/server/routes-hygiene.test.ts` dans le même commit. DELETE fiche : 404 sur id inconnu ou 204 rejouable (test l.154 tolère < 500).
- Service : `server/services/fault-catalog-service.ts` (nouveau), pas `storage.ts`. `listParts`, `addPart`, `updatePart`, `removePart`, contrôles de couple (panne, lien).

**Tests de contrat** : étendre `tests/contract/fault-catalog-lifecycle.contract.test.ts`, réécrire l'en-tête l.14-15. Cas :
201 par `workshopManager` ; 200 lecture `technician` et `warehouse` ; 403 écriture `technician`, `warehouse` ; 404 panne inconnue et lien d'une autre panne ;
`partId` inconnu 4xx sans fuite ; même pièce deux fois 409 ; `quantity: 0` ou `"deux"` 400 avec champ nommé ; écriture sur archivée 409 ;
**suppression admin d'une panne avec pièces : 204 et liens supprimés** (régression du 500 actuel) ; suppression d'une pièce liée : plus de 500.
`afterAll` (l.47) : supprimer `fault_catalog_parts` avant les fiches, ou cascade. Pièces via `createTestPart` (`tests/support/factories`).

## Ordre de livraison (une PR par étape)

1. **Migration** : SQL, miroir `init-database.ts`, test de dérive. Trois tables idempotentes, index, dédoublonnage puis index unique `fault_catalog_parts`, FK en cascade. Vérifier sur Postgres local (`test:db:schema`), rejouer deux fois le démarrage : seconde passe sans écriture.
2. **Zod partagé** : omissions et schémas de mise à jour, `npm run check` global.
3. **CAT2 pièces associées** : service, routes, contrat. Ligne 194 du plan QA → OK (validatedBy et 404 déjà couverts).
4. **PRT1** : service, routes, contrat, portage de `parts-database.tsx`. Ligne 225 du plan QA.
5. Facultatif : déménager le reste de `/api/fault-catalog` hors de routes.ts + `routes-hygiene.test.ts`.

## Risques et vérifications

- Données existantes : doublons dans `fault_catalog_parts` → dédoublonner dans la même transaction avant l'index ; nom de contrainte FK généré par drizzle à vérifier en base ; Neon/prod peuvent ne pas avoir ces tables si `db:push` n'y a jamais tourné → `CREATE TABLE IF NOT EXISTS`.
- `variant_code` unique global, pas par pièce : garder ce contrat (changer = rupture, ADR).
- Doublons Express : aucun pour les nouveaux chemins. `GET /api/parts/:id/usage-history` en double dans routes.ts (3099, 3146), hors périmètre.
- `auditWrites(AUDIT_CONFIG)` (`index.ts:90`) : vérifier si `server/lib/audit-config.ts` demande une entrée pour ces chemins d'écriture.
- Pas de `console.*` dans le neuf ; `deletePart` en contient (l.225, l.239) : migrer vers `moduleLogger` si on touche la fonction, sans supprimer (§10).
- DoD : `npm run check` zéro erreur global, `npm test` (dérive SQL), `npm run test:contract` sur Docker local, si possible e2e de l'écran `parts-database` après portage.

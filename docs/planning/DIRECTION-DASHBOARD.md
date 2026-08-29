# Chantier — Profil Direction (`management`)

> Dashboard exécutif pour le DG : **CA facturé** et **résultat après charges** séparés, lecture seule, sans impact sur les autres profils.

Dernière mise à jour : août 2026

---

## Objectif

Un profil **`management`** (libellé UI : **Direction**) avec un écran unique, simple :

| Pilier | Question DG |
|---|---|
| Flotte | Combien de camions sont opérationnels ? |
| Entrées | CA facturé, encaissé, impayés |
| Sorties | Carburant, maintenance, achats fournisseurs |
| Résultat | Marge brute (HT) après charges directes |
| Rentabilité | Top clients, top destinations / lignes |

**Hors périmètre MVP** : saisie, admin utilisateurs, stock, OT, drill-down opérationnel.

---

## Architecture (dossier dédié)

```
client/src/pages/management/          # Pages Direction uniquement
client/src/components/management/     # Composants Direction uniquement
server/services/management-dashboard-service.ts
server/api/management.routes.ts       # GET /api/management/dashboard
shared/constants/management-dashboard.ts
```

Réutilisation design system : `HeaderCard`, `KpiGrid`, `KpiTile`, `CardShell`, `StatusMetricStrip`, `PremiumTabsNav`, `ClientRevenueChart` (inspiration).

---

## Suivi

### Phase 0 — Cadrage & doc

- [x] Rédiger ce document de chantier
- [x] Benchmark concurrence / attentes DG (voir conversation août 2026)

### Phase 1 — Backend agrégateur

- [x] Ajouter le rôle `management` dans `shared/schema.ts`
- [x] Constantes partagées période + types réponse (`shared/constants/management-dashboard.ts`)
- [x] Service `management-dashboard-service.ts` (CA HT/TTC, charges, marge, flotte, tops)
- [x] Route `GET /api/management/dashboard?period=month` (lecture seule, rôles `management` + `admin`)
- [x] Middleware `isManagementOrAdmin`
- [x] Monter le routeur dans `server/api/index.ts`

### Phase 2 — Frontend Direction (isolé)

- [x] Page `client/src/pages/management/dashboard.tsx`
- [x] Composants `components/management/` (flux argent, tops, sélecteur période)
- [x] Branchement `App.tsx` : `SmartDashboardRoute` case `management`
- [x] Menu sidebar minimal (2 entrées : dashboard + rapports)
- [x] Libellés rôle (`contextual-help/roles.ts`, `topnav`, admin users)

### Phase 3 — Compte & QA

- [x] Documenter création compte DG dans `docs/qa/COMPTES_ENVIRONNEMENT.md`
- [x] Test manuel : login Direction → dashboard sans menu admin *(validé post-correctifs)*
- [x] Test régression : technicien / magasinier inchangés *(validé — zéro tsc, 87 tests)*
- [x] Tests unitaires période management (`tests/unit/shared/management-dashboard.test.ts`)

### Phase 4 — V2 (non MVP)

- [x] Rentabilité par type de marchandise (`missions.cargo`)
- [x] Comparaison période N vs N-1 (flèches tendance)
- [x] Export PDF « rapport Direction » mensuel
- [x] Page `/management/reports` dédiée

---

## Règles de non-régression

1. **Ne pas modifier** les dashboards admin, secrétaire, logistique, etc.
2. Toute logique Direction vit dans `pages/management/` et `components/management/`.
3. Les autres profils ne voient pas le menu Direction.
4. L’API `/api/management/*` est protégée ; les APIs existantes restent inchangées.

---

## Formules MVP

**Règle de cohérence** : le résultat brut est calculé **tout en HT**. Mélanger CA HT
et charges TTC fausse la marge (~19,25 % du volume d'achats fournisseurs compté
à tort comme charge).

| Métrique | Source | Base |
|---|---|---|
| CA facturé (affichage TTC) | `client_invoices.amount_ttc` | TTC |
| CA pour marge | `client_invoices.amount_ht` | **HT** |
| Encaissé | TTC − `balance` | TTC |
| Impayés | Σ `balance` | TTC |
| Charge carburant | Σ `fuel_records.debit_amount` ou `cost` | HT* |
| Charge maintenance | Σ `work_orders.cost` (OT terminés) | HT |
| Charge fournisseurs | Σ `supplier_invoices.amount_ht` | **HT** |
| Résultat brut | CA HT − (carburant + maintenance + fournisseurs) | **HT** |
| Flotte | `vehicleStatusService.getFleetStatistics()` | — |

\* Carburant : pas de double comptage avec les pièces OT — les pièces passent par
`work_orders.cost`, le carburant par `fuel_records` uniquement.

---

## Post-mortem (août 2026)

| # | Problème | Gravité | Correction |
|---|---|---|---|
| 01 | Marge DG : charges fournisseurs TTC soustraites d'un CA HT | Critique | `supplier_invoices.amount_ht` |
| 02 | Quatre listes de rôles divergentes | Élevée | `AppRole` + `ALL_APP_ROLES` dérivés du schéma (`shared/constants/roles.ts`) |
| 03 | `ClientDashboard` appelé sans import dans `App.tsx` | Élevée | Import ajouté |
| 04 | Perte affichée en vert (`featured` neutralise `valueClassName`) | Moyenne | `featuredTone="danger"` sur la tuile Résultat brut |
| 05 | Soupçons carburant / pièces | Info | Vérifiés, commentaires seulement |

**Leçons** : lancer `npm run check` sur **tout** le projet (pas de filtre sur ses
fichiers) ; relire les formules des docs cochées « fait » ; dériver, ne pas recopier.

---

## Compte test (à créer via Admin > Utilisateurs)

| Rôle | Login suggéré | Mot de passe |
|---|---|---|
| Direction (`management`) | `dg` | *(défini à la création)* |

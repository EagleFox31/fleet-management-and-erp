# Matrice Rôles — Version Décision Rapide

## Conclusion test (direct)
- **Flux pièces atelier**: le **magasinier** est le pilote opérationnel (commande/réception/sortie stock).
- **Chef d’atelier + technicien**: expriment et valident le besoin technique.
- **Secrétaire**: contrôle administratif et fournisseurs (selon cas).
- **Logisticien**: centré missions/transport, pas acteur principal des pièces atelier.
- **Admin**: backup/supervision, pas opérateur métier par défaut.

## Lecture simple (image métier)
- **Atelier**: décide le besoin.
- **Magasin**: ouvre et ferme le robinet des pièces.
- **Administration**: valide et trace.
- **Logistique**: fait rouler les missions.

## Matrice courte — Fait vs Cible

| Sujet | Aujourd’hui (fait) | Cible métier | Correction |
|---|---|---|---|
| Création demande pièce | Admin + Chef atelier + Technicien + Magasinier | OK | Ne rien changer |
| Validation demande | Admin + Chef atelier + Secrétaire (avec règle spéciale) | OK | Garder, clarifier UI |
| Commande fournisseur (pièces atelier) | Admin + Magasinier + Secrétaire + Logisticien | Magasinier + Secrétaire (+ Admin backup) | Retirer Logisticien du flux standard pièces |
| Réception fournisseur (pièces atelier) | Trop large selon écrans/routes | Magasinier (primaire), Secrétaire/Admin (backup) | Restreindre par type de commande |
| Traçabilité entrée stock | `createdBy = demandeur` | `createdBy = demandeur` + `receivedBy = réceptionnaire réel` | Ajouter un champ dédié `receivedBy` (priorité haute) |
| QA doc | Mélange flux pièces et flux achats/logistique | 2 flux séparés | Réécrire scénario QA |

## Pneus — feuille Excel PNEUMATIQUE vs STOCK

Source : `EXEMPLAIRE SUIVI MAINTENANCE.xlsm`, feuille **PNEUMATIQUE** (voir
`docs/reports/CORRESPONDANCE_LOT1_EXISTANT_EXCEL_29_09_2025.md`).

La feuille mélange **deux métiers** dans un même journal :

| Colonnes Excel | Sens métier | Rôle cible |
|---|---|---|
| `Date_entree`, `Fournisseur`, `N_fac_bl`, `Qte_entree` | Réception stock magasin | **Magasinier** |
| `Date_sortie`, `Immatriculation`, `Position`, `Km_compteur` | Montage / suivi flotte | **Atelier** (chef + technicien) |

Ce n’est **pas** la feuille **STOCK** (pièces), mais la logique d’**entrée**
reproduit celle du magasin ; la **sortie** relève de l’atelier.

### Matrice pneus — Fait vs Cible

| Sujet | Aujourd’hui (code) | Cible métier (Excel) | Middleware |
|---|---|---|---|
| Fiche pneu en stock (CRUD référentiel) | `admin`, `warehouse` | Magasinier (+ admin backup) | `isTireCatalogManager` |
| Consultation inventaire pneus | Tous profils authentifiés (GET) | Lecture large | `authenticate` |
| Montage / démontage véhicule | `admin`, `workshop_manager` | Atelier | `isWorkshopManager` |
| Rotations | `admin`, `workshop_manager` | Atelier | `isWorkshopManager` |
| Inspections | `admin`, `workshop_manager`, `technician` | Atelier | `isTechnician` |
| Suppression fiche pneu | `admin` seul | Admin backup | `isAdmin` |

**Règle mémo pneus :** le magasinier **entre** le pneu au stock ; l’atelier **le
sort** vers un véhicule. Ne pas confondre avec le flux demandes de pièces.

### Dette restante (hors RBAC)

- Colonnes Excel non modélisées : `N_fac_bl`, km parcouru calculé, journal
  entrée/sortie unifié comme dans PNEUMATIQUE.
- `tires.supplier` en texte libre (pas de `supplierId` comme `parts`).
- KPI dashboard admin : pneus exclus des KPI « pièces en stock » (volontaire).

## Règle mémo (à retenir)
- **“Le magasinier a les clés du magasin.”**
- **“Le chef d’atelier valide le technique.”**
- **“La secrétaire verrouille l’administratif.”**
- **“Le logisticien conduit les missions.”**
- **“L’admin débloque, il ne fait pas tout.”**

## Plan de correction (ordre)
1. **Fix traçabilité stock**: garder `createdBy = demandeur` + ajouter `receivedBy`.
2. **RBAC pneus**: séparer catalogue stock (`isTireCatalogManager`) et flotte (`isWorkshopManager`) — **fait côté routes**.
3. **RBAC conditionnel PO**: distinguer `commande pièces atelier` vs `commande non pièces`.
4. **UI commandes/demandes**: masquer actions hors périmètre rôle + message métier simple.
5. **MAJ QA**: séparer explicitement les 2 parcours (atelier pièces / autres achats).

## Traçabilité `...By` (prévision simple)
- `createdBy` : **garder le demandeur** (ta consigne).
- `updatedBy` : **à ajouter** sur les demandes de pièces pour savoir qui a fait la dernière action.
- `approvedBy` : utile pour tracer qui valide/rejette la demande.
- `orderedBy` : utile pour tracer qui passe la commande fournisseur.
- `receivedBy` : utile pour tracer qui confirme la réception.
- `issuedBy` : utile pour tracer qui sort la pièce du stock.
- Commandes fournisseur: on peut garder la timeline `[TRACE_PO]` actuelle, ou ajouter des colonnes dédiées (`sentBy`, `confirmedBy`, `closedBy`) si tu veux un reporting SQL direct.

## Sources utilisées
- Code: `server/middleware/auth.ts`, `server/services/part-requirements-workflow.ts`, `server/routes.ts`, `server/api/purchase-orders.routes.ts`, `client/src/pages/inventory/requests.tsx`.
- Documents: CDC signé + analyses Excel maintenance/fournisseurs + user stories.

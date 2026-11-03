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
| Traçabilité entrée stock | `requestedBy = demandeur` + `receivedBy = réceptionnaire réel` (30/10/2026) | `createdBy = demandeur` + `receivedBy = réceptionnaire réel` | **Fait** (PRT6) |
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

## Véhicules — capacité des réservoirs (FUEL3, 2 novembre 2026)

| Sujet | Aujourd’hui (code) | Cible métier | Middleware |
|---|---|---|---|
| Modifier la fiche véhicule (`PATCH /api/vehicles/:id`) | `admin`, `workshop_manager` | OK | `isVehiclePatcher` |
| Saisir la capacité des réservoirs (`tankCapacityL`) | `admin`, `workshop_manager`, `logistics` | La logistique gère le carburant | `isVehiclePatcher` + `vehiclePatchRefusal` |

La logistique passe la garde mais ne peut envoyer que `tankCapacityL` : toute autre clé
renvoie 403 (`server/lib/vehicle-patch-guard.ts`). Rôles : `VEHICLE_PATCH_ROLES`
(`shared/constants/roles.ts`). Le changement émet `vehicle_tank_capacity_changed`
(rôles carburant), qui rafraîchit les anomalies et le compteur « sans capacité ».

## Règle mémo (à retenir)
- **“Le magasinier a les clés du magasin.”**
- **“Le chef d’atelier valide le technique.”**
- **“La secrétaire verrouille l’administratif.”**
- **“Le logisticien conduit les missions.”**
- **“L’admin débloque, il ne fait pas tout.”**

## Plan de correction (ordre)
1. **Fix traçabilité stock**: garder `createdBy = demandeur` + ajouter `receivedBy` — **fait** (PRT6, 30/10/2026).
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

## Écart horizontal connu : technicien et OT d'un autre technicien (3 novembre 2026)
- `GET /api/work-orders/:id` (`server/routes.ts` ~1851) refuse un technicien sur l'OT assigné à un autre technicien (403).
- `assertWorkOrderReadable` (`server/lib/work-order-scope.ts`) n'applique que la cloison client : les sous-ressources `GET /api/work-orders/:id/parts`, `/items`, `/pending-part-requirements` et `/tire-rotations` restent lisibles par tout technicien, quel que soit l'OT.
- Aucune règle changée : décision métier à prendre (aligner les sous-ressources sur le détail, ou assumer que l'atelier partage la lecture). Le garde `tests/unit/server/routes-hygiene.test.ts` exige seulement une cloison client ou une garde de rôle sur ces lectures.

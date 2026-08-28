# Matrice Rôles — Fait vs Préconisé vs Correction

## 1) Périmètre et sources

### Sources "fait" (implémentation actuelle)
- `server/middleware/auth.ts`
- `server/services/part-requirements-workflow.ts`
- `server/routes.ts` (`/api/part-requirements`)
- `server/api/purchase-orders.routes.ts`
- `client/src/pages/inventory/requests.tsx`
- `client/src/pages/procurement/orders/[id].tsx`
- `QA-DASHBOARD-ADMIN.md`

### Sources "préconisé" (documents métier)
- `attached_assets/Cahier des Charges ETS YARORO_signed_1755005115892.pdf`
- `attached_assets/Analyse du fichier « EXEMPLAIRE SUIVI MAINTENANCE.xlsm »_1759164771752.docx`
- `attached_assets/USER STORIES Suivi de maintenance_1759164771755.docx`
- `attached_assets/USER STORIES tire feuille excel_1759164771745.docx`
- `attached_assets/Gestion des Fournisseur1_1759164771753.docx`
- `attached_assets/Analyse Complète des Fichiers Logistiques_1759164771750.docx`

## 2) Matrice synthèse

| Étape métier | Fait (code actuel) | Préconisé (documents) | Écart | Correction proposée |
|---|---|---|---|---|
| 1. Créer une demande de pièce | `admin/workshop_manager/technician/warehouse` (`isPartRequester`) | Magasinier + atelier (technicien/chef atelier) cohérent avec l'existant Excel | Écart faible | Garder tel quel |
| 2. Valider/Rejeter une demande | Workflow: `admin/workshop_manager/secretary`; règle spéciale: si demandeur = chef d'atelier, validation uniquement secrétaire | Séparation des tâches et validation administrative/encadrement; compatible avec la règle spéciale | Écart faible | Garder la règle spéciale; clarifier le libellé UI "qui valide quoi" |
| 3. Passer une demande approuvée en commande | Flux standard via Achats; override urgence possible (motif obligatoire). UI: "Passer par Achats" + "Urgence" | Très aligné avec besoin de contrôle (pas de commande directe par défaut) | Écart faible | Garder. Ajouter badge "Override urgence" dans historique |
| 4. Qui peut créer/modifier une commande fournisseur (PO) | API PO autorise `admin/warehouse/secretary/logistics` sur toute la commande | Docs maintenance orientent plutôt pièces atelier vers **magasinier** (opérationnel) + support administratif (secrétaire). Logisticien est plutôt opérations transport | Écart moyen | Introduire **scope commande**: `type=parts` vs `type=non_parts`. Pour `parts`: write par `warehouse/secretary/admin`; `logistics` lecture seule (ou action limitée) |
| 5. Qui peut envoyer la commande au fournisseur | API: `admin/warehouse/secretary/logistics` | Pour pièces atelier: magasinier + secrétaire en priorité; admin en backup | Écart moyen | Règle conditionnelle par type. `parts`: `warehouse/secretary/admin`. `non_parts`: `secretary/logistics/admin` |
| 6. Qui peut confirmer la réception | API PO: mêmes rôles write; Demande pièce: réception faite côté magasin | Documents maintenance: réception magasin = rôle magasinier; mais besoin réel peut inclure backup administratif | Écart moyen | `parts`: réception primaire `warehouse`; secours `secretary/admin` (option `logistics` si tu confirmes ce use case) |
| 7. Entrée de stock après réception | Fait automatiquement sur demande reçue; `partsStockMovements.createdBy = requestedBy` | Métier: le réceptionnaire doit être tracé (magasinier/acteur réel), pas le demandeur | Écart fort (traçabilité) | Corriger `createdBy` avec l'utilisateur qui confirme la réception |
| 8. Sortie stock pour OT | Workflow autorise `received -> issued` par `admin/warehouse` | Cohérent avec rôle magasin | Écart faible | Garder |
| 9. Factures fournisseurs | PO/Invoices accessibles large selon pages; docs fournisseurs mettent l'assistante (secrétaire) au centre, direction en supervision | Rôles parfois trop larges selon modules | Écart moyen | Clarifier RBAC factures: `secretary/admin` write, autres lecture selon besoin |
| 10. Cohérence doc interne de test (QA) | `QA-DASHBOARD-ADMIN` inclut logisticien très tôt dans flux achats pièces | Documents Excel maintenance donnent surtout magasinier + atelier pour la chaîne pièces | Écart documentaire | Mettre à jour QA pour distinguer `flux pièces atelier` et `flux achats non pièces` |

## 3) Détail des constats (preuves)

### A. Implémentation actuelle
- Demandes pièces:
  - `isPartRequester = ['admin','workshop_manager','technician','warehouse']`.
  - `isInventoryManager = ['admin','workshop_manager','warehouse','secretary']`.
  - Références: `server/middleware/auth.ts:157-158`, `server/routes.ts:4637-4654`.
- Workflow demandes:
  - Validation pending: `admin/workshop_manager/secretary`.
  - `approved -> ordered`: `admin/warehouse`.
  - `ordered -> received`: `admin/warehouse`.
  - Règle spéciale: demande créée par chef d'atelier => validation/rejet par secrétaire.
  - Référence: `server/services/part-requirements-workflow.ts:85-116`, `server/services/part-requirements-workflow.ts:296-307`.
- UI demandes:
  - Approbation pour approvers; commande/réception côté warehouse/admin.
  - Référence: `client/src/pages/inventory/requests.tsx:137-187`, `client/src/pages/inventory/requests.tsx:888-955`.
- PO:
  - Write/status transitions autorisés à `admin/warehouse/secretary/logistics`.
  - Références: `server/api/purchase-orders.routes.ts:31-33`, `server/api/purchase-orders.routes.ts:265-269`, `client/src/pages/procurement/orders/[id].tsx:278-280`.
- Traçabilité réception stock:
  - Mouvement d'entrée stock utilise `createdBy: requirement.requestedBy` (demandeur), pas l'acteur de réception.
  - Référence: `server/services/part-requirements-service.ts:345-354`.

### B. Préconisations documentaires (CDC + analyses Excel)
- CDC: gestion par profils (technicien saisie périmètre, chef atelier vue globale maintenance, admin paramètres globaux).
- Analyse maintenance: magasinier responsable stock + alerte CDE + déclenchement approvisionnement + entrée stock à réception.
- User stories maintenance: magasinier saisit entrées/sorties et suit seuils.
- User stories transport: logisticien orienté missions/transport; secrétaire orientée carburant/administratif; directeur/management valide gros dossiers.
- Analyse fournisseurs: assistante de direction au centre de la saisie fournisseurs/factures.

## 4) Cible RBAC recommandée (pragmatique)

### A. Commandes liées aux pièces atelier (`type=parts`)
- Créer demande: `technician`, `workshop_manager`, `warehouse`, `admin`.
- Valider demande:
  - par défaut: `workshop_manager` ou `secretary` ou `admin`.
  - si demandeur = `workshop_manager`: `secretary` (ou `admin` backup).
- Convertir en PO / envoyer fournisseur: `warehouse`, `secretary`, `admin`.
- Réceptionner: `warehouse` (primaire), `secretary/admin` (backup).
- Clôturer PO: `warehouse`, `secretary`, `admin`.

### B. Commandes non liées pièces atelier (`type=non_parts`)
- Créer/Envoyer/Suivre: `secretary`, `logistics`, `admin`.
- Réception/Clôture: selon métier concerné (logistique/administratif), avec traçabilité d'acteur.

## 5) Plan de correction technique

1. **Ajouter un scope métier sur PO** (`orderScope`: `parts` | `non_parts`) déduit des lignes (requirement/part présents).
2. **Appliquer des permissions conditionnelles** sur `PATCH /api/purchase-orders/:id/status` selon `orderScope`.
3. **Ajuster l'UI PO**:
   - Afficher "consultation" si rôle non autorisé pour l'étape en cours.
   - Afficher un schéma différent `parts` vs `non_parts`.
4. **Corriger la traçabilité stock réception**:
   - enregistrer `createdBy = currentUserId` lors de la réception, pas `requestedBy`.
5. **Harmoniser la doc QA**:
   - séparer explicitement les 2 flux (atelier pièces vs achats non pièces).

## 6) Décision métier à valider avant dev

- Confirme si, pour `type=parts`, tu veux inclure `logistics` en backup sur **réception**.
- Confirme si `admin` reste backup universel (recommandé pour déblocage).
- Confirme si `secretary` peut aussi faire la réception pièces ou seulement validation administrative.


# Rapport de Retours QA — Parcours P2 : Maintenance inter-profils & Transitions Mobile/Web

> **Projet :** FleetMaster / Yaro FleetOS  
> **Campagne :** Recette QA multi-profils (Dashboard Administrateur, Atelier Technicien Mobile & Modules Métier)  
> **Périmètre analysé :** Parcours P2 (Maintenance inter-profils, cycle des Ordres de Travail, statuts véhicules, synchronisation temps réel & responsive mobile) & Transition P4 (Affectation ressources missions)  
> **Date de test :** 31 août 2026  
> **Testeur :** Équipe QA  
> **Statut global P2 :** ⚠️ **Validé avec réserves (Anomalies fonctionnelles, synchronisation & Responsive mobile)**

---

## 1. Synthèse Exécutive des Anomalies Relevées

| ID | Fichier Capture de Référence | Type | Sévérité | Périmètre | Résumé de l'anomalie |
|---|---|---|---|---|---|
| **ANO-P2-01** | [`P2-01_disponibilite_vehicule_apres_ot.png`](file:///c:/Users/IBRAH/Documents/Projets/Tests%20AQ%20Yaro/P2-01_disponibilite_vehicule_apres_ot.png) | **Bug Métier / Cycle de vie** | 🔴 **Majeure** | Web / Missions | Véhicule maintenu avec le libellé « en maintenance » dans la sélection mission malgré la clôture de tous les OT. |
| **ANO-P2-02** | [`P2-02_modale_edition_ot_overflow_web.png`](file:///c:/Users/IBRAH/Documents/Projets/Tests%20AQ%20Yaro/P2-02_modale_edition_ot_overflow_web.png) | **Bug UI / Layout** | 🟠 **Moyenne** | Web / Atelier | Modale d'édition d'OT trop longue, champs coupés en bas (overflow), absence de scroll et boutons d'action masqués. |
| **ANO-P2-03** | [`P2-03_anglicisme_pickup_formulaire_mission.png`](file:///c:/Users/IBRAH/Documents/Projets/Tests%20AQ%20Yaro/P2-03_anglicisme_pickup_formulaire_mission.png) | **I18n / Vocabulaire** | 🟡 **Mineure** | Web / Missions | Anglicisme incohérent « Pickup » au lieu de « Enlèvement / Chargement » face à « Livraison ». |
| **ANO-P2-04** | [`P2-04_modernisation_champs_date_heure.png`](file:///c:/Users/IBRAH/Documents/Projets/Tests%20AQ%20Yaro/P2-04_modernisation_champs_date_heure.png) | **UX / Design System** | 🔵 **Amélioration** | Web / Formulaires | Contrôles HTML natifs (date/time) basiques et peu intégrés au design moderne de l'application. |
| **ANO-P2-05** | [`P2-05_statut_ot_non_synchronise_mobile.jpeg`](file:///c:/Users/IBRAH/Documents/Projets/Tests%20AQ%20Yaro/P2-05_statut_ot_non_synchronise_mobile.jpeg) | **Bug Synchro / Temps réel** | 🔴 **Majeure** | Mobile / Technicien | Statut OT démarré non répercuté sur mobile (`En cours = 0`), compteurs et cartes non actualisés sans rechargement lourd. |
| **ANO-P2-06** | [`P2-06_responsive_liste_ot_mobile_overflow.jpeg`](file:///c:/Users/IBRAH/Documents/Projets/Tests%20AQ%20Yaro/P2-06_responsive_liste_ot_mobile_overflow.jpeg)<br>[`P2-06b_responsive_onglets_mobile.jpeg`](file:///c:/Users/IBRAH/Documents/Projets/Tests%20AQ%20Yaro/P2-06b_responsive_onglets_mobile.jpeg) | **Bug Responsive Mobile** | 🟠 **Moyenne** | Mobile / Technicien | Perte de responsive sur la liste des OT (débordement horizontal des onglets et boutons d'action rognés à droite). |
| **ANO-P2-07** | [`P2-07_responsive_modale_demarrer_ot_mobile.jpeg`](file:///c:/Users/IBRAH/Documents/Projets/Tests%20AQ%20Yaro/P2-07_responsive_modale_demarrer_ot_mobile.jpeg)<br>[`P2-08_responsive_modale_dezoom_mobile.jpeg`](file:///c:/Users/IBRAH/Documents/Projets/Tests%20AQ%20Yaro/P2-08_responsive_modale_dezoom_mobile.jpeg) | **Bug Responsive / Viewport** | 🟠 **Moyenne** | Mobile / Technicien | Formulaire modal « Commencer l'intervention » rogné à droite ; nécessite un dézoom manuel (pinch-out) qui crée des marges excessives. |

---

## 2. Analyse Détaillée des Retours & Références Captures

---

### 🔴 ANO-P2-01 : Persistance du statut « En maintenance » après clôture de tous les OT

- **Capture de référence :** [`P2-01_disponibilite_vehicule_apres_ot.png`](file:///c:/Users/IBRAH/Documents/Projets/Tests%20AQ%20Yaro/P2-01_disponibilite_vehicule_apres_ot.png)
- **Écran :** `/operations/missions/new` (Étape 2 : *Affectation Ressources*)
- **Profil connecté :** Logisticien (`issouf`) ou Secrétaire (`dana`)

#### Constat
Dans le sélecteur déroulant **Véhicule Disponible**, le véhicule `LT-P1-001 (Volvo FH16)` apparaît toujours grisé/désactivé avec le motif suivant :
> `LT-P1-001 - Volvo FH16 (40T) — véhicule à l'atelier (en maintenance) ; visite technique expirée depuis 133 jours`

Alors que tous les ordres de travail (OT #1 et OT #2 dans le scénario P2/P2b) ont été clôturés et passés au statut **Terminé** (`completed`) par le technicien `ali`.

#### Cause racine & Recommandations
1. **Défaut de synchronisation backend (`vehicles.status`) :** Le trigger ou la méthode `releaseVehicleFromMaintenance` ne met pas à jour `vehicles.status = 'available'` (ou `'operational'`) lors du passage de l'OT à `completed`.
2. **Gestion multi-OT :** Vérifier que la requête de clôture contrôle correctement l'absence d'autres OT en cours :
   ```sql
   UPDATE vehicles 
   SET status = 'available' 
   WHERE id = $vehicleId 
     AND NOT EXISTS (
       SELECT 1 FROM work_orders 
       WHERE vehicle_id = $vehicleId 
         AND status IN ('pending', 'in_progress', 'draft')
         AND id != $currentWorkOrderId
     );
   ```
3. **Dissociation des alertes :** Séparer clairement l'indisponibilité pour cause d'atelier de l'indisponibilité pour conformité administrative (visite technique expirée).

---

### 🟠 ANO-P2-02 : Modale d'édition OT — Dépassement d'écran, boutons masqués et transparence

- **Capture de référence :** [`P2-02_modale_edition_ot_overflow_web.png`](file:///c:/Users/IBRAH/Documents/Projets/Tests%20AQ%20Yaro/P2-02_modale_edition_ot_overflow_web.png)
- **Écran :** `/maintenance/work-orders/55` (Édition d'ordre de travail)
- **Profil connecté :** Chef d'atelier (`terry`)

#### Constat
1. **Overflow vertical :** La modale est trop longue ; le champ texte « Diagnostic » est tronqué au bas de l'écran et les boutons d'action (**Enregistrer les modifications**, **Annuler**) sont inaccessibles sans défilement spécial.
2. **Absence de scroll interne :** Manque d'un conteneur `max-h-[85vh]` avec `overflow-y: auto`.
3. **Arrière-plan transparent superposé :** Les boutons de la page de fond (*Commencer*, *Imprimer*, *Modifier*, *Supprimer*, *Coût total*) restent visibles au travers de la boîte.

#### Recommandations
- Ajouter un conteneur flex vertical avec zone centrale scrollable (`overflow-y: auto`) et un footer sticky en bas contenant les boutons de soumission.
- Renforcer l'opacité du backdrop (`bg-black/60`).

---

### 🔴 ANO-P2-05 : Non-synchronisation des statuts en cours sur mobile

- **Capture de référence :** [`P2-05_statut_ot_non_synchronise_mobile.jpeg`](file:///c:/Users/IBRAH/Documents/Projets/Tests%20AQ%20Yaro/P2-05_statut_ot_non_synchronise_mobile.jpeg)
- **Écran :** `/technician` (Vue mobile Technicien - Mes Ordres de Travail)
- **Profil connecté :** Technicien (`ali`)

#### Constat
Après avoir cliqué sur **Commencer l'intervention** (depuis le mobile ou depuis l'interface web), le statut de l'intervention ne se met pas à jour sur l'application mobile :
- Le compteur **En cours** reste à `0` (devrait être à `1`).
- Le compteur **En attente** reste à `3`.
- L'OT reste affiché dans la liste avec le badge orange `EN ATTENTE` au lieu de basculer dans l'onglet `En cours`.

#### Cause racine & Recommandations
- **Absence d'invalidation du cache de données (React Query / SWR) :** Après la mutation `startWorkOrder`, le hook de requête `useTechnicianWorkOrders` ne déclenche pas `queryClient.invalidateQueries(['technician-work-orders'])`.
- **Événements WebSocket / SSE :** S'assurer que l'événement `work_order_updated` ou `work_order_started` met à jour l'état local du technicien en temps réel sans nécessiter de rafraîchissement complet de la page navigateur.

---

### 🟠 ANO-P2-06 : Perte du responsive sur la liste des OT mobile

- **Captures de référence :** 
  - [`P2-06_responsive_liste_ot_mobile_overflow.jpeg`](file:///c:/Users/IBRAH/Documents/Projets/Tests%20AQ%20Yaro/P2-06_responsive_liste_ot_mobile_overflow.jpeg) (Débordement droit de la liste et bouton Commencer coupé)
  - [`P2-06b_responsive_onglets_mobile.jpeg`](file:///c:/Users/IBRAH/Documents/Projets/Tests%20AQ%20Yaro/P2-06b_responsive_onglets_mobile.jpeg) (Onglet « Terminés » tronqué)
- **Écran :** `/technician` (Vue mobile Technicien)

#### Constat
Sur écran smartphone (largeur ~360px - 412px) :
- Les onglets de filtrage (`En attente (3)`, `En cours (0)`, `Terminés (2)`) dépassent la largeur de l'écran et sont tronqués à droite.
- Les cartes d'ordres de travail ont une largeur minimale rigide qui entraîne un débordement horizontal (`overflow-x`), coupant le bouton **Commencer** et les informations tarifaires/dates.

#### Recommandations
- Utiliser des conteneurs à largeur adaptative `w-full max-w-full` sans `min-w-[...]` rigide.
- Mettre en place un défilement horizontal fluide sur les onglets avec `overflow-x-auto scrollbar-none` ou un affichage compact adapté au mobile.

---

### 🟠 ANO-P2-07 : Modale « Commencer l'intervention » rognée & Problème de Viewport sur mobile

- **Captures de référence :** 
  - [`P2-07_responsive_modale_demarrer_ot_mobile.jpeg`](file:///c:/Users/IBRAH/Documents/Projets/Tests%20AQ%20Yaro/P2-07_responsive_modale_demarrer_ot_mobile.jpeg) (Formulaire coupé sur le bord droit)
  - [`P2-08_responsive_modale_dezoom_mobile.jpeg`](file:///c:/Users/IBRAH/Documents/Projets/Tests%20AQ%20Yaro/P2-08_responsive_modale_dezoom_mobile.jpeg) (Vue après dézoom manuel montrant l'échelle inadaptée)
- **Écran :** `/technician` (Modale de démarrage d'OT)

#### Constat
- À l'ouverture de la modale de démarrage d'intervention, la largeur du dialogue dépasse la largeur du viewport mobile. Les champs de sélection de pièces et le bouton **Ajouter** sont rognés sur le bord droit.
- Pour voir l'ensemble de la modale, l'utilisateur est contraint de dézoomer manuellement (pinch-out), ce qui révèle une mise en page non responsive centrée avec d'épaisses marges blanches vides.

#### Recommandations
- Configurer la balise meta viewport : `<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">`.
- Adapter la modale pour le mobile en mode **BottomSheet / Fullscreen Drawer** (`w-full h-full sm:h-auto sm:max-w-lg rounded-t-2xl sm:rounded-2xl`).
- Disposer la ligne « Pièces utilisées » en grille verticale responsive (`flex-col sm:flex-row`) pour éviter l'écrasement des inputs sur petits écrans.

---

### 🟡 ANO-P2-03 : Incohérence linguistique & Anglicismes (« Pickup »)

- **Capture de référence :** [`P2-03_anglicisme_pickup_formulaire_mission.png`](file:///c:/Users/IBRAH/Documents/Projets/Tests%20AQ%20Yaro/P2-03_anglicisme_pickup_formulaire_mission.png)
- **Écran :** `/operations/missions/new` (Étape 1 : *Trajet & Cargo*)

#### Constat
Le formulaire utilise le terme anglais « Pickup » (`Adresse Pickup *`, `Date Pickup`, `Heure Pickup`) en opposition à « Livraison » (`Adresse Livraison *`, `Date Livraison`).

#### Recommandations
- Remplacer par : **`Adresse d'enlèvement *`**, **`Date d'enlèvement`**, **`Heure d'enlèvement`** (ou « Point de chargement »).

---

### 🔵 ANO-P2-04 : Modernisation visuelle des champs Date / Heure

- **Capture de référence :** [`P2-04_modernisation_champs_date_heure.png`](file:///c:/Users/IBRAH/Documents/Projets/Tests%20AQ%20Yaro/P2-04_modernisation_champs_date_heure.png)
- **Écran :** `/operations/missions/new`

#### Constat & Recommandations
- Remplacer les champs natifs par des composants date/time picker personnalisés conformes au design system (icônes Lucide intégrées, masques de saisie élégants, formatage homogène `DD/MM/YYYY`).

---

## 3. Matrice de Priorisation & Plan d'Action

| Priorité | Réf | Module | Action Corrective Requise | Responsable |
|:---:|---|---|---|---|
| **P0 - Bloquant** | `ANO-P2-01` | Backend / Véhicules | Déclencher le passage à `status = available` à la clôture du dernier OT actif d'un véhicule. | Dev Backend |
| **P0 - Bloquant** | `ANO-P2-05` | Frontend / Cache | Invalider et rafraîchir les requêtes React Query lors du changement de statut d'un OT sur mobile. | Dev Frontend |
| **P1 - Urgent** | `ANO-P2-02` | Frontend / UI Web | Ajouter scroll interne et footer sticky sur la modale `/maintenance/work-orders/:id`. | Dev Frontend |
| **P1 - Urgent** | `ANO-P2-06`<br>`ANO-P2-07` | Frontend / Mobile UI | Corriger le responsive sur mobile (onglets, cartes, et transformer la modale en BottomSheet). | Dev Frontend / Mobile |
| **P2 - Qualité** | `ANO-P2-03` | I18n | Franciser « Pickup » en « Enlèvement / Chargement ». | Product / Dev |
| **P3 - Confort** | `ANO-P2-04` | UI-UX | Moderniser les sélecteurs de date et heure. | Dev UI |

---

## 4. Conclusion

Le parcours **P2** a permis de valider la logique métier de l'Atelier mais met en évidence des régressions ergonomiques et de synchronisation, particulièrement sur l'interface **Technicien Mobile** et la réintégration des véhicules dans le module **Opérations (Missions)**. La résolution des tickets P0/P1 est recommandée avant de clore définitivement la campagne QA.

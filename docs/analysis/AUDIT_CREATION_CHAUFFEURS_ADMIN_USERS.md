# Audit métier — Création des chauffeurs depuis `/admin/users`

Date: 11/03/2026
Portée: UX Admin, API utilisateurs/chauffeurs, workflow missions

## Statut au 11/03/2026

- `Phase A` implémentée: API CRUD chauffeur admin (`POST/PATCH/PATCH toggle/GET`).
- `Phase B` implémentée: bouton `Ajouter un chauffeur`, modal de création/édition et action d’activation dans `admin/users`.
- Temps réel câblé: invalidation WebSocket sur événements `driver_created|driver_updated|driver_toggled`.
- Restant à trancher/implémenter: `Phase C` (création optionnelle de compte utilisateur lié) et `Phase D` (tests automatisés API + QA renforcée).

## 1) Constat initial (avant implémentation)

### Ce qui existe
- Onglet `Chauffeurs` affiché dans la page admin utilisateurs.
- Liste chauffeurs alimentée via `GET /api/drivers`.
- Suivi CPC (statistiques, alertes, mise à jour date CPC).

### Ce qui manque
- Aucun bouton `Ajouter un chauffeur` dans l’onglet chauffeurs.
- Aucun endpoint CRUD chauffeur (`POST /api/drivers`, `PATCH /api/drivers/:id`, `DELETE /api/drivers/:id`) n’est exposé.
- Le formulaire `Créer un utilisateur` ne crée qu’un enregistrement `users` et ne crée pas la fiche métier `drivers`.

## 2) Preuves code (références)

- Onglet chauffeurs en lecture seule, pas de création:
  - [users.tsx](/mnt/e/FleetMaster2.0-main/FleetMaster2.0-main/client/src/pages/admin/users.tsx#L541)
  - [users.tsx](/mnt/e/FleetMaster2.0-main/FleetMaster2.0-main/client/src/pages/admin/users.tsx#L590)
  - [users.tsx](/mnt/e/FleetMaster2.0-main/FleetMaster2.0-main/client/src/pages/admin/users.tsx#L624)
- Formulaire utilisateur sans rôle chauffeur, création via `/api/users`:
  - [user-form.tsx](/mnt/e/FleetMaster2.0-main/FleetMaster2.0-main/client/src/components/users/user-form.tsx#L28)
  - [user-form.tsx](/mnt/e/FleetMaster2.0-main/FleetMaster2.0-main/client/src/components/users/user-form.tsx#L85)
- API drivers limitée au CPC (GET + update CPC uniquement):
  - [drivers.routes.ts](/mnt/e/FleetMaster2.0-main/FleetMaster2.0-main/server/api/drivers.routes.ts#L16)
  - [drivers.routes.ts](/mnt/e/FleetMaster2.0-main/FleetMaster2.0-main/server/api/drivers.routes.ts#L65)
- Création utilisateur existante ne touche pas `drivers`:
  - [routes.ts](/mnt/e/FleetMaster2.0-main/FleetMaster2.0-main/server/routes.ts#L472)
- Modèle `drivers` existe déjà (prêt pour CRUD), relation optionnelle `userId`:
  - [schema.ts](/mnt/e/FleetMaster2.0-main/FleetMaster2.0-main/shared/schema.ts#L752)
  - [schema.ts](/mnt/e/FleetMaster2.0-main/FleetMaster2.0-main/shared/schema.ts#L899)
- Le workflow mission consomme `/api/drivers` pour affectation:
  - [new.tsx](/mnt/e/FleetMaster2.0-main/FleetMaster2.0-main/client/src/pages/missions/new.tsx#L66)

## 3) Impact métier

### Blocages
- Impossibilité de peupler proprement le référentiel chauffeurs depuis l’UI admin.
- Affectation mission incomplète ou forcée via SQL manuel.
- Qualité de données faible sur permis/CNI/validités si pas de formulaire standardisé.

### Risques
- Dépendance aux scripts/SQL ad hoc en production.
- Écarts entre cahier de tests et comportement réel (ex: QA attend `POST /api/drivers`).
- Traçabilité RH incomplète (qui a créé, qui a désactivé).

## 4) Cible métier recommandée

## Principe
- Un **chauffeur** est une fiche métier (`drivers`) assignable en mission.
- Un chauffeur peut être:
  - **sans compte applicatif** (cas terrain le plus fréquent),
  - **avec compte** (optionnel) si besoin de connexion future.

## Parcours cible simple
1. Admin ouvre `Admin > Utilisateurs > Chauffeurs`.
2. Clique `Ajouter un chauffeur`.
3. Saisit identité + documents + statut actif.
4. Enregistre.
5. Le chauffeur apparaît immédiatement:
   - dans la liste chauffeurs,
   - dans les sélecteurs missions,
   - dans les KPI/alertes CPC.

## 5) Plan d’implémentation

## Phase A — API métier chauffeurs (priorité haute)
- Créer `server/api/drivers-management.routes.ts` (ne pas alourdir `routes.ts`).
- Endpoints:
  - `POST /api/drivers` (création),
  - `PATCH /api/drivers/:id` (édition),
  - `PATCH /api/drivers/:id/toggle` (activer/désactiver),
  - `GET /api/drivers/:id` (détail).
- Permissions:
  - création/édition/toggle: `admin` (option: `secretary` en édition documentaire).
  - lecture: profils opérationnels existants.
- Validation:
  - `firstName`, `lastName` obligatoires,
  - `employeeNumber` unique si fourni,
  - cohérence dates (expiry >= date du jour si imposée métier).

## Phase B — UI Admin Users (priorité haute)
- Dans l’onglet `Chauffeurs`, ajouter:
  - bouton `Ajouter un chauffeur`,
  - modal/form chauffeur,
  - actions `Modifier` + `Activer/Désactiver`.
- Champs minimum:
  - prénom, nom, matricule,
  - n° permis + validité,
  - n° CNI + validité,
  - date CPC (optionnelle au départ),
  - statut actif.
- Rafraîchissement temps réel:
  - invalidation query `["/api/drivers"]`, `["/api/drivers/cpc-statistics"]`,
  - broadcast websocket `driver_created|driver_updated|driver_toggled`.

## Phase C — Option compte applicatif (priorité moyenne)
- Ajouter dans le formulaire un switch `Créer un compte de connexion`.
- Si activé:
  - créer user (`/api/users`) puis lier `drivers.userId`.
- Règle recommandée:
  - pas de rôle `driver` pour l’instant (non présent dans enum actuel),
  - utiliser un rôle existant seulement si un périmètre fonctionnel réel est défini.

## Phase D — Qualité et contrôle (priorité moyenne)
- Ajouter tests API:
  - création nominale,
  - doublon matricule,
  - droits insuffisants.
- Ajouter scénarios QA:
  - création chauffeur admin,
  - apparition immédiate dans création mission,
  - désactivation => non assignable.

## 6) Décisions métier à trancher avant dev

1. Qui peut créer un chauffeur en plus de l’admin: `secretary` oui/non.
2. Un chauffeur doit-il avoir un compte dès la création: oui/non (recommandé: non).
3. Désactivation chauffeur: doit-on bloquer s’il est assigné à une mission non terminée.
4. Champs obligatoires au go-live: permis et CNI obligatoires ou tolérés en incomplet.

## 7) Résultat attendu après implémentation

- Référentiel chauffeurs maintenable depuis l’UI.
- Affectation mission fluide sans SQL manuel.
- Cohérence métier RH/ops (documents, CPC, disponibilité).
- Alignement entre QA CRUD et comportement réel.

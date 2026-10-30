# Journal — Frontend 1 (`fe-1`)

Worktree : `../fm-fe-1`. Modèle d'entrée et règles : `README.md`.
Entrées ajoutées en bas, dans l'ordre chronologique, une par commit.

## 2026-10-30T13:56:05+01:00 — T-09 — Squelette client : drapeaux, routes et menu du lot

- **Agent** : fe-1 · **Branche** : `lot/fe/T-09-squelette-client` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : `useFeature(key)`, `FeatureGate`, routes et entrées de menu de tous les écrans du lot vers des pages vides ; entrées finance (Trésorerie) et Distribution masquées par drapeau.
- **Comment** : table déclarative `client/src/config/lot-screens.ts` (route, rôles, drapeau, menu) ; `components/lot-routes.tsx` génère les routes (posées avant les routes à `:id` dans `App.tsx`) ; `sidebar.tsx` injecte les entrées par rôle et filtre par drapeau. Un écran livré s'enregistre dans `config/lot-screen-components.ts` (une ligne), sans retoucher App/sidebar. Défauts de `FEATURE_FLAGS` tant que `GET /api/feature-flags` n'a pas répondu. Reuse : Build (60 lignes, pas de dépendance). Les entrées QHSE, GPS et tarifs n'existent pas dans le menu actuel : rien à masquer, les clés restent prêtes.
- **Pourquoi** : plan 06 T-09, ADR §6 ; débloque fe-2, sol (T-51, T-53) et pe (T-36).
- **Comment tester (QA)** :
  - Prérequis : compte admin ; serveur sans surcharge de drapeaux.
  - Étapes : 1. Menu Administration : Comptes verrouillés, Journal d'audit, Types de document, Sauvegardes, Périmètre. 2. Chaque entrée affiche la page vide. 3. Aller sur /fuel/vouchers : page introuvable (drapeau coupé). 4. Compte technicien sur /admin/backups : page introuvable.
  - Attendu : aucune page blanche.
  - Preuve automatisée : `node node_modules/vitest/vitest.mjs run tests/unit/client/use-feature.test.ts` → 6 passed ; tsc global zéro erreur.
- **RAIDER** : R/A table et drapeaux découverts ; I rendu sans état ; D aucune route existante modifiée ; scoped : client seul.
- **Reste / risques** : rôles des écrans SHOULD à ajuster par leur tâche (champ `roles` de la table).

## 2026-10-30T13:57:44+01:00 — T-50 — Câblage temps réel des événements du lot

- **Agent** : fe-1 · **Branche** : `lot/fe/T-50-temps-reel` (sur T-09) · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : les 7 événements de `REALTIME_EVENTS` invalident leurs clés ; `work_order_updated` réinterroge aussi `/api/kpi`, `part_requirement_updated` le stock et les demandes magasin.
- **Comment** : `useRealTimeSync.ts` : un `case` par événement qui appelle `invalidateCatalogEvent(nom)`, lecture de `invalidates` du catalogue (une seule source) ; satellites ajoutés pour `vehicle_document_type_changed` (véhicules, documents) et `backup_failed` (alertes). Adapt de la structure existante.
- **Pourquoi** : AGENTS §2 couche 2 et 3, plan 06 T-50.
- **Comment tester (QA)** :
  - Preuve automatisée : `node node_modules/vitest/vitest.mjs run tests/unit/client/realtime-catalog-wiring.test.ts` → 12 passed ; tsc global zéro erreur.
  - Preuve de trame WebSocket : T-55 (deux comptes).
- **RAIDER** : D cases existants inchangés ; I invalidations sans effet de bord ; scoped client.
- **Reste / risques** : la clé `/api/vehicle-documents` est une hypothèse de satellite, à confirmer au branchement T-32b.

## 2026-10-30T14:03:00+01:00 — T-31a — Écrans admin sécurité (comptes verrouillés, journal d'audit, message de verrouillage)

- **Agent** : fe-1 · **Branche** : `lot/fe/T-31a-admin-securite` (sur T-50 et mocks T-09b) · **Commit** : voir `git log`
- **Statut** : fait (partie a, contre les mocks msw ; la partie b attend les routes réelles)
- **Quoi** : page Comptes verrouillés (liste, déverrouillage confirmé), page Journal d'audit (filtres utilisateur, objet, période, pagination), message « Compte verrouillé jusqu'à HH:MM » à la connexion.
- **Comment** : pages enregistrées dans `config/lot-screen-components.ts` ; réponses validées par les schémas de `shared/contracts/auth-lockout` et `audit-logs` ; déverrouillage par `useSingleFlightMutate`, id passé par les variables, ligne retirée du cache, puis invalidation de `/api/users` et `/api/audit-logs` ; erreurs par `userMessageOf`. `useAuth` expose `loginLockMessage` (le 429 y était avalé). Reuse : Adapt de `PremiumDataTable`, `AlertModal`, `Pagination`.
- **Pourquoi** : plan 06 T-31a, contrat P-03 et P-04.
- **Comment tester (QA)** :
  - Prérequis : compte admin ; mocks actifs ou routes réelles.
  - Étapes : 1. Administration, Comptes verrouillés : déverrouiller une ligne, elle disparaît. 2. Journal d'audit : filtrer par objet puis par période inversée (message d'erreur, aucune requête). 3. Se tromper 5 fois de mot de passe : le message indique l'heure de fin.
  - Preuve automatisée : `tests/unit/client/lockout-message.test.ts` + `use-feature.test.ts` → 10 passed ; tsc global zéro erreur.
- **RAIDER** : R tables et contrats partagés ; I déverrouiller deux fois = no-op côté liste ; D login inchangé hors message ; scoped client.
- **Reste / risques** : branchement réel (T-31b) ; `userId` du filtre saisi en numéro faute de sélecteur d'utilisateurs.

## 2026-10-30T14:20:00+01:00 — T-32a — Référentiel des types de document et sélecteur avec échéance proposée

- **Agent** : fe-1 · **Branche** : `lot/fe/T-32a-types-document` (sur T-31a) · **Commit** : voir `git log`
- **Statut** : fait (partie a, contre les mocks msw ; la partie b attend les routes réelles)
- **Quoi** : page Types de document (liste, création, modification, désactivation) ; le sélecteur de type du téléversement lit le référentiel et propose l'échéance (aujourd'hui plus la durée de validité).
- **Comment** : `useVehicleDocumentTypes` (hook partagé, clé `/api/vehicle-document-types`) ; `lib/document-due-date.ts` (fin de mois ramenée) ; formulaire `react-hook-form` + `zodResolver` sur le schéma du contrat ; ligne mise à jour dans le cache puis invalidation des documents véhicule ; single-flight. La proposition ne remplace jamais une date saisie à la main. Repli sur la liste historique si le référentiel est vide ou indisponible. Reuse : Adapt.
- **Pourquoi** : plan 06 T-32a, contrat P-05.
- **Comment tester (QA)** :
  - Prérequis : compte admin ; mocks actifs ou routes réelles.
  - Étapes : 1. Administration, Types de document : créer `permis_transport` (12 mois), le désactiver. 2. Fiche véhicule, ajouter un document : choisir Assurance, l'échéance se remplit ; la modifier puis changer de type, elle reste ; le type désactivé a disparu de la liste.
  - Preuve automatisée : `tests/unit/client/document-due-date.test.ts` → 3 passed ; tsc global zéro erreur.
- **RAIDER** : R hook et fonction réutilisables ; I enregistrer deux fois = même ligne ; D comportement historique conservé en repli ; scoped client.
- **Reste / risques** : le serveur actuel de téléversement peut refuser un code absent de son énumération historique (à lever au branchement T-32b) ; la clé `/api/vehicle-documents` reste une hypothèse de satellite.

## 2026-10-30T14:40:00+01:00 — T-34 — Détail OT : export Word et message de double affectation

- **Agent** : fe-1 · **Branche** : `lot/fe/T-34-ot-export-conflits` (sur T-32a) · **Commit** : voir `git log`
- **Statut** : fait (partie a ; la partie b attend les routes réelles)
- **Quoi** : menu Exporter (OT, bon de sortie) en .docx sur le détail d'un OT ; au démarrage d'un OT, un 409 de double affectation liste les OT en conflit.
- **Comment** : `work-order-export-button.tsx` (GET en blob sur `workOrderExportPath`, téléchargement, erreur par `userMessageOf`) ; `booking-conflict-alert.tsx` + `lib/booking-conflict.ts` (lit `conflicts` du contrat, une ligne par chevauchement) ; page OT : une ligne d'import-état, la mutation de démarrage garde le dialogue ouvert sur 409, bouton visible pour admin, chef d'atelier et magasinier. Reuse : Adapt.
- **Pourquoi** : plan 06 T-34, contrats P-07 et P-08.
- **Comment tester (QA)** :
  - Prérequis : OT existant ; deux OT sur le même technicien aux dates qui se chevauchent.
  - Étapes : 1. Détail OT, Exporter, Bon de sortie : un .docx se télécharge. 2. Démarrer l'OT avec un technicien déjà occupé : le dialogue reste ouvert et indique « Technicien déjà affecté à l'OT #N du … au … ».
  - Preuve automatisée : `tests/unit/client/booking-conflict.test.ts` ; suite client 142 passed ; tsc global zéro erreur.
- **RAIDER** : D flux de démarrage inchangé hors 409 ; I export sans écriture ; scoped client.
- **Reste / risques** : rôles du bouton d'export à confirmer avec le garde serveur (le serveur reste maître, 403 affichée en clair) ; seul le démarrage affiche les conflits, l'assignation depuis la modification de l'OT sera couverte à T-34b si la route la porte.

## 2026-10-30T18:41:02+01:00 — T-31b/T-32b/T-33b (partiel) — Écrans sur l'API réelle (agent fe-3)

- **Agent** : fe-3 (reprise de fe-1) · **Branche** : `lot/fe/T-3xb-api-reelle` (sur T-54c, fusionnée avec `main`) · **Commit** : voir `git log`
- **Statut** : fait pour le journal d'audit, les types de document et les préférences de notification ; comptes verrouillés, 429 au login et sauvegardes restent sur mock (serveur non fusionné : PR #42, #39, #37/#28).
- **Quoi** : vérification sur l'API réelle (serveur de dev, port 5091, comptes admin et chef d'atelier) de `GET /api/audit-logs`, `/api/vehicle-document-types`, `/api/notifications/settings` ; correction des écarts écran/réponse : la colonne Type des documents d'un véhicule affichait le code (`jaugeage_fe3`) au lieu du libellé du référentiel (types désactivés compris) ; canal e-mail affiché grisé « non configuré » dans les préférences.
- **Comment** : les mocks ne s'activent que par `VITE_API_MOCKS=1` (absent ici) : aucun service worker msw, toutes les requêtes partent vers le serveur (journal réseau capturé). R-04 rejoué : type créé en UI (POST 201, doublon 409), proposition d'échéance 24 mois, document attaché, alerte « expire bientôt » à J+20 générée par `checkTypedDocumentExpiryAlerts` et visible côté admin et chef d'atelier. Les 9 types du seed correspondent à `VEHICLE_DOCUMENT_TYPE_SEED` (code, libellé, validité, alerte 30 j, ordre). Données de test (véhicule, document, type, alertes) supprimées ensuite.
- **Pourquoi** : plan 06 T-31b, T-32b, T-33b ; attraper la dérive que les types ne voient pas.
- **Comment tester (QA)** :
  - Prérequis : serveur de dev, compte admin et compte chef d'atelier.
  - Étapes : 1. Admin, Journal d'audit : lignes réelles, filtre Objet = user. 2. Types de document : 9 types seedés. 3. Mon profil (chef d'atelier) : désactiver « Documents de véhicule », puis profil admin : reste actif. 4. Fiche véhicule, onglet Documents : le type s'affiche en libellé.
  - Preuve : captures hors dépôt (`scratchpad/fe-3/`) ; tsc global zéro erreur ; `tests/unit` vert hors un test d'événements temps réel déjà rouge avant ce lot de modifications.
- **RAIDER** : D contrats inchangés, mocks conservés pour le non fusionné ; I données de test créées puis retirées ; A aucune donnée de recette touchée.
- **Reste / risques** : écart serveur R-14 : la préférence est enregistrée et indépendante par profil, mais `/api/alerts` n'appelle pas `shouldNotify` (alerte documents toujours visible après désactivation) ; pagination du journal non éprouvée à l'écran (8 lignes, page de 50).

## 2026-10-30T18:41:02+01:00 — Factures « À chiffrer » et garde de rôle des tuiles KPI

- **Agent** : fe-3 · **Branche** : `lot/fe/T-3xb-api-reelle` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : factures en attente : montant 0 affiché « À chiffrer » (atténué) ; `KpiTiles` rendu seulement pour admin et management, et monté sur les tableaux de bord admin et direction (il n'était monté que sur le tableau générique, jamais atteint pour un rôle connu).
- **Comment** : `isToQuote` pure ; `KPI_VIEWER_ROLES` / `canViewKpi` dans `shared/constants/roles.ts` (aligné sur `isManagementOrAdmin`), composant enveloppe avant les hooks de requête. Préférences de notification : section visible de tout connecté (vérifié avec le chef d'atelier).
- **Pourquoi** : consigne de recette (T-40 renvoie `amount = 0`) et revue PR #25.
- **Comment tester (QA)** : tableau de bord admin : trois tuiles ; chef d'atelier : aucune tuile, aucune requête `/api/kpi`.
- **Preuve** : `tests/unit/client/pending-invoices-kpi-roles.test.ts` ; captures `20-dashboard-admin.png` (12 requêtes `/api/kpi`), `20-dashboard-terry.png` (0 requête).
- **RAIDER** : R liste de rôles dans la source unique ; D contrat et serveur inchangés.
- **Reste / risques** : capture « À chiffrer » non faite sur l'API réelle (drapeau `pending-invoices` coupé, route T-40 non servie) ; couverte par test unitaire. Compte management non utilisé (mot de passe inconnu).

## 2026-10-30T18:49:27+01:00 — Test des événements temps réel du lot (faux positif)

- **Agent** : fe-3 · **Branche** : `lot/fe/T-3xb-api-reelle` · **Statut** : fait
- **Quoi** : `tests/unit/shared/lot-recette-contracts.test.ts`, test « noms en snake_case… » : la collision n'est plus « l'événement apparaît dans useRealTimeSync.ts » mais « nom hors `REUSED_REALTIME_EVENTS` et au plus un `case` dans useRealTimeSync.ts ».
- **Comment** : `existingEvents` devient un décompte par nom ; assertion `<= 1`. Contre-épreuve : un `case "incident_reported"` dupliqué rend le test rouge, retiré ensuite.
- **Pourquoi** : T-50 ajoute les `case` du lot dans ce fichier, le test les prenait pour des événements préexistants (rouge sur la pile, vert sur main).
- **Comment tester (QA)** : `node node_modules/vitest/vitest.mjs run tests/unit/shared/lot-recette-contracts.test.ts`.
- **Reste / risques** : aucun.

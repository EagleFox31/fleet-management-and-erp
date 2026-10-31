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

## 2026-10-30T21:47:55+01:00 — T-31b/T-33b — Comptes verrouillés, 429 au login et sauvegardes sur l'API réelle (agent fe-4)

- **Agent** : fe-4 · **Branche** : `lot/fe/T-3xc-securite-sauvegardes` (sur `lot/fe/T-3xb-api-reelle`, fusionnée avec `main` 1802222) · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** :
  - Connexion : le refus est lu dans la réponse réelle (`loginFailureOf`) : 429 de `loginLockoutGuard` -> « Compte verrouillé jusqu'à HH:MM. » ; 400 de `captchaGuard` (drapeau `captcha` actif) -> message de vérification, widget affiché même si le compteur local ne l'attendait pas, défi régénéré après un échec (preuve ALTCHA à usage unique). Connexion par PIN : même lecture (verrouillage affiché à la place de « PIN incorrect »).
  - Comptes verrouillés : rôle affiché en libellé, rafraîchissement 60 s, invalidation de la fiche utilisateur après déverrouillage.
  - Sauvegardes : écran enfin monté (`admin-backups` manquait dans `lot-screen-components.ts`, la route affichait la page vide) ; double déclenchement (202 dans les deux cas) annoncé « Sauvegarde déjà en cours… aucune nouvelle sauvegarde n'a été créée » ; bouton « Sauvegarde en cours » pendant l'exécution ; historique rafraîchi toutes les 5 s tant qu'une exécution tourne (le succès n'émet aucun événement) ; colonne Détail avec libellé du code d'échec, jamais le code brut ; état de chargement/erreur.
- **Comment** : fonctions pures `client/src/lib/lockout-message.ts` (`captchaRequiredOf`, `loginFailureOf`) et `client/src/lib/backup-run.ts` (issue du 202 comparée aux exécutions connues avant le clic, marge 30 s) ; envoi par `useSingleFlightMutate` avec les variables de la mutation. Aucun fichier serveur touché, handlers MSW conservés.
- **Pourquoi** : routes T-13 (#42), T-57 (#39), T-19b/T-20 (#28, #37) fusionnées dans `main` ; le contrat 202 du double déclenchement est gelé, c'est l'écran qui doit le dire.
- **Comment tester (QA)** :
  - Prérequis : serveur de dev sans `VITE_API_MOCKS`, un compte admin, un compte non admin jetable.
  - Étapes : 1. Six connexions avec un mauvais mot de passe sur le compte jetable : « Compte verrouillé jusqu'à HH:MM. », pas de widget captcha (drapeau coupé). 2. Admin, Comptes verrouillés : la ligne apparaît (rôle en clair), Déverrouiller : liste vide, le compte se reconnecte. 3. Non admin sur `/admin/backups` : pas de menu, pas de bouton, API 403. 4. Admin, Sauvegardes, Lancer maintenant : toast « Sauvegarde lancée », puis ligne « Échec — Outil d'export absent du serveur » en dev (pas de `pg_dump`) et bandeau d'alerte.
  - Preuve automatisée : `tests/unit/client/login-failure.test.ts`, `tests/unit/client/backup-run.test.ts` ; suite unitaire 54 fichiers / 672 tests verts ; tsc global zéro erreur. Captures hors dépôt (`scratchpad/fe-4/01` à `07`).
- **RAIDER** : R lecture du refus partagée mot de passe/PIN ; D contrats serveur et mocks inchangés ; I comptes et données de vérification créés puis supprimés (exécution #17, alertes, 2 comptes TEST) ; A aucune donnée de recette touchée.
- **Reste / risques** : « déjà en cours » non reproductible en dev (le dump échoue en 0,2 s, pas de `pg_dump`) : couvert par test unitaire ; une exécution lancée par un autre admin moins de 30 s avant le clic et absente du cache est annoncée « lancée ». La vue PIN n'a pas de widget captcha : drapeau actif, elle affiche le message sans moyen d'y répondre. 429 du PIN non joué au navigateur (aucun chauffeur à PIN jetable). Autres écrans du lot importés mais non mappés dans `lot-screen-components.ts` (incidents, mouvements pneus, factures en attente, pointage) : hors périmètre, signalés.

## 2026-10-30T23:20:18+01:00 — Écrans du lot montés : pannes, mouvements de pneus, pointage, factures en attente (agent fe-4)

- **Agent** : fe-4 · **Branche** : `lot/fe/T-3xc-securite-sauvegardes` (PR #50) · **Commit** : voir `git log`
- **Statut** : fait côté client ; données réelles en attente des routes serveur
- **Quoi** :
  - `lot-screen-components.ts` : entrées `incident-declare`, `incidents-list`, `tire-movements`, `time-tracking`, `pending-invoices` (importés mais absents de la table : page vide).
  - Listes pannes, mouvements de pneus, factures en attente, grille de pointage : une requête en échec affichait l'état vide (« Aucun… ») ; elle affiche maintenant `LoadingError` (message lisible + Réessayer). Pointage : bouton Enregistrer masqué tant que la grille n'est pas chargée.
  - Déclarer une panne : la liste des véhicules lisait `GET /api/vehicles` comme un tableau (réponse réelle `{ vehicles }`) et proposait toute la flotte au chauffeur ; le formulaire ne s'affichait jamais. Chauffeur : ses véhicules de mission (`GET /api/drivers/me`), mission active d'abord ; administrateur : la flotte.
  - Garde-fou `tests/unit/client/lot-screen-components.test.ts` : rouge si un composant importé n'a pas d'entrée, ou si une clé n'est pas un `id` de `lot-screens.ts` (contre-épreuve incluse).
- **Comment** : fonctions pures `client/src/lib/incident-vehicles.ts` ; envoi de la panne déjà en `useSingleFlightMutate` + `userMessageOf`. Aucun fichier serveur touché, handlers MSW conservés.
- **Pourquoi** : écrans livrés mais inaccessibles ; erreurs serveur déguisées en « aucune donnée » ; formulaire chauffeur inutilisable.
- **État serveur sur `main` (1802222)** : les quatre routeurs (`incidents`, `tires/movements`, `billing/pending-invoices`, `time-tracking`) sont encore des bouchons 501 ; PR #35/#29 (T-43), #36/#17 (T-40), #40/#26 (T-45) ouvertes. Les écrans restent sur mocks (`VITE_API_MOCKS=1`) pour les données ; sur l'API réelle ils affichent « Une erreur technique est survenue… Référence : … ».
- **Comment tester (QA)** :
  - Drapeaux `incidents`, `tire-movements`, `time-tracking` allumés (`FEATURE_FLAGS`), `pending-invoices` coupé.
  - Chef d'atelier `/incidents`, magasinier `/inventory/tires/movements`, logistique `/drivers/time-tracking` : menu présent, encadré « Erreur serveur » avec référence (501 du bouchon), pas d'état vide, pas de bouton Enregistrer.
  - Administrateur `/driver/incident` : formulaire, choix du véhicule, envoi -> toast « Déclaration impossible » + référence (501, aucune écriture).
  - Chauffeur sans fiche `drivers` : « Profil chauffeur introuvable » (404 lisible).
  - Technicien sur les cinq chemins : « Page non trouvée », aucun appel API métier.
  - Logistique `/operations/pending-invoices` drapeau coupé : pas de menu, page non trouvée, API 404. Drapeau allumé (non joué) : menu et encadré d'erreur 501 sur l'API réelle, données MSW en mode mock.
  - Preuve automatisée : `tests/unit/client/lot-screen-components.test.ts`, `tests/unit/client/incident-vehicles.test.ts` ; suite unitaire 56 fichiers / 680 tests ; tsc global zéro erreur. Captures hors dépôt (`scratchpad/fe-4/08` à `19`).
- **RAIDER** : R table pilotée par `lot-screens.ts`, garde-fou générique ; A source véhicules selon le rôle, réponse paginée ou tableau acceptée ; D contrats serveur et mocks inchangés ; I comptes TEST créés puis supprimés avec leurs alertes et lignes `user_onboarding`, aucune panne/pointage/mouvement écrit (routes 501) ; données de recette intactes.
- **Reste / risques** : données réelles dès fusion de T-43/T-40/T-45. Fil d'Ariane « Pneus > Détail » sur `/inventory/tires/movements` (segment lu comme un id). `LoadingError` affiche un emoji (composant partagé préexistant, non modifié). Rechargement complet lent du serveur de dev : le chien de garde d'auth (12 s) peut renvoyer au login, sans lien avec ces écrans.

## 2026-10-31T14:32:25+01:00 — T-3xd — Rôles des écrans du lot alignés sur leurs routes (agent fe-4)

- **Agent** : fe-4 · **Branche** : `lot/fe/T-3xd-roles-ecrans` (PR #51, depuis `main` f4e4616) · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** :
  - Pointage : lecture et saisie pour admin et logistique, lecture seule pour secrétariat et direction (écran ajouté, saisie masquée) ; fil d'Ariane « Flotte › Chauffeurs › Pointage » ; totaux : chauffeurs actifs sans saisie du mois listés à zéro (compte non supprimé, fiche `drivers` non désactivée).
  - Mouvements de pneus : écran = API (admin, direction, chef d'atelier, magasinier, technicien), retiré à la logistique et au secrétariat ; menu sous « Gestion de stock », groupe créé pour les rôles qui ne l'avaient pas.
  - Panne chauffeur : seuls les véhicules des affectations actives (`ACTIVE_ASSIGNMENT_STATUSES` partagé, `assignmentStatus` exposé par `/api/drivers/me`).
  - 403 : type d'erreur « permission » (« Accès refusé », bouclier), distinct de la session expirée.
  - Comptes verrouillés : fin de verrou lue par le store pg qui l'écrit (une heure de décalage hors UTC avec Drizzle).
  - Tableaux de bord : widget des factures fournisseurs en retard masqué hors approvisionnement ; tuiles KPI en erreur (dont 501) : « Indisponible », sans nouvel essai sur un 4xx ou un 501 ; « Aucune donnée » réservé à une réponse vide.
  - Écarts corrigés au passage : coût véhicule sans secrétariat, factures en attente avec direction, historique d'OT pour tout le personnel (`isStaff` = `STAFF_ROLES`).
- **Comment** : groupes de rôles nommés dans `shared/constants/roles.ts`, importés par l'écran et par le routeur ; `errorTypeOf` (`client/src/lib/error-type.ts`) ; `DbLockoutStore.listLocked` ; `kpiTileText` / `shouldRetryKpi` purs dans `kpi-tiles.tsx`.
- **Pourquoi** : les rôles étaient déclarés deux fois sans contrat (écran ouvert à un rôle que l'API refuse : 403 ; rôle admis sans écran : pas de menu) ; colonne `timestamp` sans fuseau lue par un autre pilote que celui qui l'écrit ; « Aucune donnée » affiché sur une erreur 501 était faux.
- **Comment tester (QA)** :
  - Logistique `/drivers/time-tracking` : sélecteurs et Enregistrer ; secrétariat et direction : grille sans sélecteurs ni bouton.
  - Technicien et direction `/inventory/tires/movements` : menu « Gestion de stock », liste ; logistique et secrétariat : pas de menu, page non trouvée.
  - Chauffeur avec une mission terminée et une active : un seul véhicule proposé.
  - Six mauvais mots de passe : heure du message de connexion = heure de la ligne « Comptes verrouillés ».
  - Admin, tableau de bord : les trois tuiles KPI (routes 501) affichent « Indisponible ».
  - Preuve automatisée : garde-fous `tests/unit/client/lot-screen-api-roles.test.ts` (rôles écran = route, identifiants résolus seulement par import réel) et `tests/unit/server/lockout-columns-read-path.test.ts` (colonnes de verrou lues par le seul store), tous deux contrôlés par mutation ; `tests/unit/client/kpi-tiles.test.ts` ; contrats `time-tracking`, `auth-lockout-timezone` (processus en UTC+1). Captures hors dépôt (`scratchpad/fe-4/36` à `47`).
- **RAIDER** : R groupes de rôles partagés ; A aucun fuseau supposé (test en `Africa/Douala`) ; I aucune migration, lectures pures ; D contrat d'API inchangé hors `assignmentStatus` optionnel ; failure memory : deux entrées dans `LESSONS_LEARNED.md` ; données de recette intactes, comptes TEST supprimés.
- **Reste / risques** : colonnes de verrou à passer en `timestamptz` (lot base de données) ; angles morts du garde-fou des rôles écrits en tête du test (`SCREEN_APIS` tenu à la main, `router.use`, contrôles dans les handlers) ; un chauffeur désactivé garde ses saisies déjà faites dans la grille du mois.

## 2026-10-31 : carburant, lecture seule du chef d'atelier et de la direction (PR #51)

- **Quoi** : bons et anomalies carburant consultables par `workshop_manager` et `management` (boutons Valider / Traiter masqués) ; écriture du prix du litre réservée à `admin` et `logistics` (le secrétariat n'y a plus accès) ; écrans carburant déclarés dans le garde-fou des rôles.
- **Comment** : `FUEL_WRITE_ROLES`, `FUEL_READ_ROLES`, `FUEL_PRICE_WRITE_ROLES` dans `shared/constants/roles.ts`, importés par les routeurs et les écrans ; `GET /api/fuel-vouchers` ajoutée ; `POST /api/fuel-prices` passe de `isFuelCardManager` (inchangé, encore utilisé ailleurs) à `authorize(FUEL_PRICE_WRITE_ROLES)`.
- **Pourquoi** : décision du 31 octobre 2026 ; l'écran ne doit pas proposer une action que l'API refuse.
- **Comment tester (QA)** : chef d'atelier et direction sur `/fuel/vouchers` et `/fuel/anomalies` : listes sans bouton d'action ; secrétariat sur `/fuel/prices` : lecture seule ; logistique et admin : saisie possible.
- **Preuve automatisée** : contrats `fuel-vouchers-prices`, `fuel-anomalies` (GET 200 chef d'atelier / direction, écritures 403, POST prix 403 secrétariat, 201 admin et logistique) ; garde-fou `lot-screen-api-roles`.
- **RAIDER** : R groupes de rôles partagés ; D contrats d'API étendus sans rupture ; données de recette intactes, comptes TEST supprimés par le nettoyage des tests.

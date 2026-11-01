# Journal de la campagne de couverture

Trace de chaque étape de la priorité 1 de `PLAN_COUVERTURE_MODULES.md` :
**ce qui a été fait, comment, et pourquoi**, avec la preuve associée.

- Les incidents (cause racine, prévention) vivent dans `docs/analysis/LESSONS_LEARNED.md` ;
  ce journal y renvoie au lieu de les recopier.
- Une entrée par commit, la plus récente en bas.
- Méthode constante : test rouge d'abord, correctif minimal, suites complètes
  (`npm run check`, `npm test`, `npm run test:contract`), puis docs et commit.

Codes de tests utilisés (voir le plan) : **T1** 401/403 par rôle, **T3** 400 lisible
sur corps invalide, **T4** champs tenus par le serveur ignorés, **T7** double
soumission sans doublon.

---

## 6237cb3 - Matrice RBAC et ratchet des schémas d'insertion

**Quoi**
- Test unitaire de chaque middleware de rôle (`isAdmin`, `isWorkshopManager`, …)
  contre chaque rôle de `ALL_APP_ROLES`.
- Ratchet sur les schémas d'insertion Zod : liste des champs tenus par le serveur
  (`createdBy`, `updatedBy`, `createdAt`, …) qui ne doivent pas être acceptés du client ;
  17 exceptions existantes gelées.

**Comment**
- Niveau unitaire (sans base), les rôles dérivés de `shared/constants/roles.ts`.
- Le ratchet échoue si une nouvelle exception apparaît ; il passe quand une
  exception disparaît, il faut alors la retirer de la liste.

**Pourquoi**
- Base de la pyramide : vérifier les règles d'accès sans base de données, en millisecondes.
- Ratchet plutôt que tout corriger d'un coup : on empêche d'aggraver la dette sans
  bloquer le travail en cours.

## a20b181 - Contrat d'erreur centralisé et logger structuré

**Quoi**
- Contrat `ApiErrorBody { message, code, requestId, errors? }` (`shared/errors.ts`).
- `AppError` (`server/lib/app-error.ts`) et gestionnaire central
  (`server/middleware/error-handler.ts`).
- Logger pino `moduleLogger` (`server/lib/logger.ts`) ; `clientLogger` et
  `userMessageOf` côté navigateur (`client/src/lib/api-error.ts`).

**Comment**
- Le gestionnaire central normalise toute réponse >= 400, y compris les anciens
  `res.status(400).json({ message })` des routes : pas de réécriture route par route.
- Une 5xx affiche un message générique + « Référence : <requestId> » ; le détail ne
  part qu'aux logs, retrouvable par ce `requestId`.

**Pourquoi**
- Des messages techniques (SQL, stack) arrivaient dans les toasts.
- Un utilisateur qui signale une erreur peut donner une référence exploitable.
- Incident : LESSONS_LEARNED « Erreurs techniques affichées, logs supprimés ».

## 179015d - Réception et sortie de pièce idempotentes (T7 stock)

**Quoi**
- Une double soumission de « Sortir la pièce du stock » ne décrémente plus deux fois.

**Comment**
- Compare-and-set sur le statut dans `updatePartRequirement` ; l'effet stock passe
  dans `onTransition(tx)`, dans la même transaction que le changement de statut.
- Garde `quantity >= n` dans l'`UPDATE` du stock.

**Pourquoi**
- Deux clics rapprochés ou un retry réseau produisaient deux mouvements de stock.
- Incident : LESSONS_LEARNED « Sortie de stock vers l'OT : double sortie possible ».

## ffb87e5 - 403 par rôle et 400 lisible sur les POST principaux (T1, T3)

**Quoi**
- Test de contrat `tests/contract/api-role-guard-and-validation.contract.test.ts` :
  7 POST (OT, véhicule, demande de pièce, commande, facture fournisseur, fournisseur,
  client). Rôle interdit -> 403 au contrat ; rôle autorisé + corps vide -> 400 lisible.
- Correctifs : Zod sur le POST demande de pièce ; `ZodError` -> `next()` dans clients.

**Comment**
- Sessions réelles par `POST /api/auth/login`, un utilisateur `TEST-` par rôle.
- `expectErrorContract` refuse tout motif technique (`stack`, `SQLSTATE`, `violates`, …).
- Corps vides : aucune écriture en base.

**Pourquoi**
- Deux routes renvoyaient 500 « Erreur serveur » sur un corps incomplet : l'utilisateur
  ne savait pas quel champ corriger.
- Incident : LESSONS_LEARNED « Corps invalide renvoyé en 500 ».

## e76918c - PATCH véhicule et OT, statut forcé à la création d'une demande (T3, T4)

**Quoi**
- `server/lib/column-validation.ts` : `prepareColumnUpdate(table, body)`.
- PATCH véhicule et OT branchés dessus ; POST demande de pièce force `pending`.
- Nettoyage des tests : purge des alertes avant les utilisateurs `TEST-`.

**Comment**
- Les routes historiques de `server/routes.ts` n'ont pas de schéma Zod : le contrôle
  est **dérivé des colonnes Drizzle** (entier, décimal, date, booléen, énumération,
  obligatoire). Aucune règle par route à maintenir.
- `""` devient `null` hors colonnes texte : c'est ce que le formulaire envoie pour
  un champ vidé.
- Tests de non-régression qui rejouent la charge utile réelle des écrans
  (formulaire véhicule, démarrer puis terminer un OT).

**Pourquoi**
- Bug réel trouvé par le test : une date laissée vide faisait échouer en silence
  **toute** la modification du véhicule (200 renvoyé, rien d'enregistré).
- Une demande de pièce pouvait naître déjà « Sortie du stock » si le client envoyait le statut.
- Incidents : LESSONS_LEARNED « Modification de véhicule perdue en silence »,
  « Nettoyage des tests bloqué par les alertes ».

## d4f928c - PATCH pièce, pneu, panne, pneu monté (T3, T4)

**Quoi**
- PATCH pièce : champs d'audit du corps ignorés, 400 par champ, 404 pièce inconnue,
  409 référence en double, plus de texte d'erreur brut.
- PATCH pneu : `ZodError` -> 400 ; panne du catalogue et pneu monté : `prepareColumnUpdate`.

**Comment**
- Tests de contrat écrits d'abord : 6 rouges (500 partout), puis verts.
- Les deux erreurs métier connues du service pièce (message texte) sont traduites
  en `AppError` avec le bon statut ; tout le reste devient 500 générique journalisé.

**Pourquoi**
- La route renvoyait `error.message` au client, y compris une erreur SQL (interdit, AGENTS.md §10).
- Le client pouvait réécrire `createdBy` / `createdAt` d'une fiche pièce (traçabilité stock, AGENTS.md §5).
- Incident : LESSONS_LEARNED « PATCH pièce : texte d'erreur exposé et champs d'audit modifiables ».

## 676de75 - Règlement fournisseur idempotent (T7 paiement)

**Quoi**
- Un règlement de facture fournisseur soumis deux fois n'est enregistré qu'une fois.
- Le reste à régler déduit les règlements saisis et pas encore rapprochés.
- Un second rapprochement bancaire du même règlement répond 200 au lieu de 500.
- Les erreurs de ces routes passent par le contrat d'erreur (400/404/409 lisibles,
  plus de `details: error.message`).

**Comment**
- Test d'intégration écrit d'abord (`tests/integration/supplier-settlement-idempotence.test.ts`,
  7 cas) : 6 rouges. Il appelle le service directement, avec `Promise.all` pour
  simuler deux clics simultanés.
- Service (`server/services/three-way-matching-service.ts`) :
  - saisie dans une transaction, verrou `FOR UPDATE` sur la facture : deux saisies
    simultanées passent l'une après l'autre ;
  - clé d'idempotence métier = référence de paiement : même référence et même
    montant -> règlement existant rendu (`replayed: true`) ; autre montant -> 409 ;
  - rapprochement en compare-and-set (`where status = 'recorded'`), même motif que
    la sortie de stock (179015d) ;
  - erreurs métier levées en `AppError` au lieu de `Error` texte.
- Route (`server/api/supplier-invoices.routes.ts`) : rejeu -> 200 sans diffusion
  WebSocket (rien n'a changé), justificatif du rejeu supprimé du disque ; `catch`
  -> `next(error)`, le gestionnaire central journalise ; `console.error` migré vers
  `moduleLogger("supplier-invoices")`.
- Test de contrat (`tests/contract/supplier-settlement-idempotence.contract.test.ts`) :
  vrai envoi multipart avec justificatif, session secrétaire. Rejoué sans le correctif
  (`git stash` des deux fichiers) : 2 rouges sur 3, donc le test détecte bien le bug.
- Le client (`client/src/pages/procurement/invoices/[id].tsx`) dédoublonne déjà la
  liste par `id` : un 200 de rejeu ne crée pas de doublon à l'écran, rien à changer.

**Pourquoi**
- Risque financier direct : une facture pouvait être payée deux fois au fournisseur.
- Le solde ne baisse qu'au rapprochement bancaire, qui arrive des jours plus tard :
  le contrôle de plafond doit compter les règlements en attente, sinon il ne protège rien.
- Rejeu en 200 plutôt qu'en 409 : la personne qui a double-cliqué a bien fait ce
  qu'elle voulait, elle ne doit pas voir une erreur.
- Incident : LESSONS_LEARNED « Règlement fournisseur : facture payable deux fois ».

**Preuve**
- `npm run check` 0 erreur ; `npm test` 386/386 ; `npm run test:contract` 46/46 ;
  `npm run test:integration` 30/30.
- Sur 5 passages de l'intégration, 2 ont échoué sur `management-dashboard-service`
  avec `ETIMEDOUT` à la connexion Neon (réseau), sans lien avec ce changement ;
  le fichier passe seul et sur les autres passages.
- 0 ligne `TEST-` orpheline, 0 justificatif `TEST-` sur disque.

**Reste**
- Même contrôle à faire sur l'encaissement client : fait au commit suivant.

## 9f9ca09 - Encaissement client idempotent (T7 paiement, T3)

**Quoi**
- Un paiement de facture client saisi deux fois n'est enregistré et déduit qu'une fois.
- Deux paiements simultanés sont tous deux déduits (plus de paiement perdu).
- Paiement au-delà du solde ou sur facture annulée : 409 lisible.
- Corps invalide (montant non numérique, négatif, mode inconnu) : 400 lisible, solde intact.

**Comment**
- Test d'intégration d'abord (`tests/integration/client-payment-idempotence.test.ts`) : 8 rouges.
  Le cas des deux paiements partiels simultanés est vert seul et rouge dans la suite
  sur l'ancien code : c'est une vraie course, sa détection dépend du timing.
- Service (`server/services/client-billing-service.ts`, `recordPayment`) : même motif que
  676de75 : transaction, `FOR UPDATE` sur la facture, clé d'idempotence = référence
  de paiement, plafond vérifié sous verrou, `AppError` 404/409. `console.log` migrés vers
  `moduleLogger("client-billing")`.
- Route (`server/api/billing.routes.ts`) : schéma Zod avec messages en français, mode de
  paiement dérivé de l'énumération de la colonne (`clientPayments.paymentMethod.enumValues`),
  erreurs -> `next(error)`, pas de diffusion WebSocket sur un rejeu.
- Écran (`client/src/pages/operations/invoices/[id].tsx`) : toast d'erreur via
  `userMessageOf` au lieu de `error.message` (AGENTS.md §10). Le cache dédoublonnait déjà
  le paiement par `id`, et le bouton est désactivé pendant l'envoi.
- Test de contrat (`tests/contract/client-payment-idempotence.contract.test.ts`, 7 cas)
  rejoué sans le correctif (`git stash`) : 5 rouges.

**Pourquoi**
- Le lost update fausse la comptabilité sans erreur visible : paiement présent dans
  l'historique, solde non baissé, relance du client à tort.
- Un `NaN` dans `balance` casse la facture et tous les agrégats qui la lisent (tableau de bord).
- Pour un paiement sans référence (espèces), seule la protection de plafond s'applique :
  deux paiements identiques sans référence restent deux paiements, car rien ne permet
  de distinguer un rejeu d'un second versement réel. Choix volontaire, plutôt qu'une
  fenêtre de temps heuristique qui fusionnerait de vrais paiements.
- Changement de comportement assumé : un trop-perçu est maintenant refusé (409) au lieu
  de rendre le solde négatif, comme côté fournisseur.
- Incident : LESSONS_LEARNED « Encaissement client : paiement perdu, trop-perçu et solde NaN ».

**Preuve**
- `npm run check` 0 erreur ; `npm test` 386/386 ; `npm run test:integration` 38/38 ;
  `npm run test:contract` 53/53 ; 0 ligne `TEST-` orpheline.
- Plus aucune route de paiement sans protection : `billing.routes.ts` (encaissement),
  `supplier-invoices.routes.ts` (règlement, rapprochement, legacy `/payment`). T7 passe à « Fait ».

## d0cf7e8 - Niveaux E et UI : double clic, refus lisibles, actions selon le rôle (T7, T1, T3)

**Quoi**
- Un double clic sur « Confirmer » n'enregistre plus qu'un paiement client et qu'un ajustement de stock.
- Deux ajustements de stock simultanés s'additionnent ; un retrait au-delà du stock est refusé (409)
  au lieu d'être ramené à 0 ; un ajustement invalide donne un 400 lisible au lieu d'un 500 SQL.
- Couverture e2e de la priorité 1 dans le navigateur : double soumission (T7), 403 forgé au contrat
  d'erreur (T1), toast métier sans détail technique (T3), boutons selon le rôle (T1 UI).

**Comment**
- Niveau E d'abord (`e2e/07-double-submit-integrity.spec.ts`, `e2e/08-role-actions-and-error-toast.spec.ts`) :
  données créées par les fabriques de `tests/support` (un utilisateur par rôle, préfixe `TEST-`),
  connexion par `page.request` (`loginWithSession`), vérité lue en base, nettoyage en `afterAll`.
  `E2E_CHANNEL` rend le navigateur configurable (Edge installé, Chromium de Playwright absent).
- Le `dblclick` réel a révélé deux doublons (paiement sans référence, ajustement de stock) malgré
  `disabled={isPending}`. Garde synchrone `singleFlight` (unitaire d'abord, 3 cas) et hook
  `useSingleFlightMutate`, branchés sur les deux boutons. Rouge sans la garde (`git stash` du client), vert avec.
- L'e2e d'ajustement a aussi montré deux mouvements « 10 -> 13 » pour +3 en stock : intégration
  (`tests/integration/parts-stock-adjustment.test.ts`, 5 appels simultanés : rouge 12 au lieu de 15),
  puis service sous transaction et `FOR UPDATE`, `AppError` 400/404/409, `console.log` migrés vers
  `moduleLogger("parts")`.
- Route `POST /api/parts/:id/update-stock` : schéma Zod en français, `next(error)`. Seule modification
  de `server/routes.ts` : durcir une route existante, aucune route ajoutée (AGENTS.md §9).
- Contrat (`tests/contract/parts-stock-adjustment.contract.test.ts`, 8 cas) rejoué sans les correctifs
  serveur : 6 rouges (500 au lieu de 400/404, 200 au lieu de 409).
- Toast de l'ajustement via `userMessageOf`.
- Le test T3 UI échouait une fois sur deux : le 409 était bien affiché, puis remplacé en moins d'une
  seconde par une alerte temps réel (`alert_created` -> toast), car `TOAST_LIMIT` valait 1. Unitaire
  sur le réducteur (`tests/unit/client/toast-limit.test.ts`, rouge puis vert), limite passée à 3.
  Le test cible `li[role="status"]` : Radix double chaque toast d'un `span role="status"` pour
  les lecteurs d'écran, ce qui donnait deux éléments à un sélecteur par rôle.

**Pourquoi**
- `isPending` ne change qu'au rendu suivant : la protection n'était qu'affichée. Le serveur ne peut pas
  dédoublonner un paiement sans référence (décision de 9f9ca09), donc la garde client est la seule barrière
  pour ce cas.
- Un historique de stock qui ne correspond pas au stock rend tout inventaire faux sans erreur visible.
- Un message d'erreur effacé avant d'être lu n'est pas lisible : c'est le cas que seul l'e2e pouvait montrer.
- Le niveau UI vérifie ce que voit l'utilisateur ; le niveau C ne prouve pas qu'un toast est lisible ni
  qu'un bouton interdit est masqué.
- Incidents : LESSONS_LEARNED « Double clic : deux paiements, deux ajustements de stock » et
  « Ajustement de stock : mise à jour perdue, retrait plafonné en silence », « Toast d'erreur effacé
  par une alerte temps réel ».

**Preuve**
- `npm run check` 0 erreur ; `npm test` 391/391 ; `npm run test:integration` 45/45 ;
  `npm run test:contract` 61/61.
- e2e 07 (4 cas) et 08 (3 cas) verts contre la base de dev, serveur local sur 5055 ; T3 UI rejoué
  3 fois de suite après le correctif du toast (3/3) ; 0 ligne `TEST-` orpheline.
- Un échec intermédiaire venait d'un test d'intégration lancé en parallèle (purge des `TEST-`) :
  voir LESSONS_LEARNED « Near miss : purge de test qui casse un e2e en cours ».

## b662936 - Routes secondaires : 400 lisible, double clic sur les boutons stock (T3, T4, T7)

**Quoi**
- PATCH document, planification de maintenance, utilisateur ; POST et PATCH plein carburant ; POST
  catalogue de pannes : corps invalide refusé en 400 par champ au lieu d'un 404, d'un 500 ou d'une
  valeur tronquée.
- La modification d'une planification depuis le formulaire est enfin enregistrée.
- `useSingleFlightMutate` sur les boutons restants qui écrivent de l'argent ou du stock.
- Valider ou refuser une demande de pièce vise la bonne demande.

**Comment**
- Niveau C d'abord (`tests/contract/secondary-routes-validation.contract.test.ts`, 15 cas). Il a révélé
  que toute édition de planification répondait 404 : `storage.getMaintenanceSchedule` était un bouchon.
- Planification : les deux `PATCH /api/maintenance-schedules/:id` fusionnés (la première, servie par
  Express, n'écrivait que `isActive`), `prepareColumnUpdate`, colonnes connues seulement.
- Documents : `prepareColumnUpdate` sur `name`, `description`, `expiryDate`, nom vide refusé.
- Utilisateur : `insertUserSchema.partial()` sur le corps sans mot de passe, 409 si nom ou e-mail
  déjà pris, mot de passe haché seulement s'il est saisi, logs migrés sans le corps.
- Carburant : schéma Zod commun (nombres de formulaire convertis puis validés), PATCH partiel avec
  repli sur l'enregistrement existant.
- Catalogue de pannes : `insertFaultCatalogSchema`, `createdBy` pris dans la session, `validatedBy` ignoré.
- Client : `useSingleFlightMutate` sur le règlement et le rapprochement fournisseur, la mise à jour
  d'une demande (réception), la sortie de stock depuis l'OT, le changement de statut d'une commande
  (la livraison entre du stock). Toasts par `userMessageOf`, emoji retiré du toast de demande.
- Demandes : l'id passe dans les variables de la mutation au lieu d'être lu dans `selectedRequest`.
- Garde-fous unitaires : `storage-stubs` (bouchons appelés, liste gelée de 2) et `routes-hygiene`
  (routes en double, liste gelée de 10 ; aucun `req.body` journalisé par `console.*`).

**Pourquoi**
- Un 404 sur une donnée qui existe fait croire à une suppression ; un `parseFloat("12abc")` enregistré
  à 12 fausse la consommation sans que personne ne le voie.
- Les champs tenus par le serveur (`createdAt`, `validatedBy`, `createdBy`) ne viennent pas du client (T4).
- Incidents : LESSONS_LEARNED « Planification : modifications perdues, puis 404 sur toute édition »,
  « Mot de passe en clair dans les journaux », « Erreurs de validation rendues en 404 ou en valeur
  tronquée », « Valider ou refuser une demande visait la demande précédente ».

**Preuve**
- `npm run check` 0 erreur ; `npm test` 395/395 ; `npm run test:integration` 45/45 ;
  `npm run test:contract` 76/76 ; 0 ligne `TEST-` orpheline.
- Contrat rejoué sans les correctifs serveur : 13 rouges, 2 verts (non-régressions déjà vraies). Le cas
  « POST quantité illisible » est exclu de ce rejeu : sans correctif il crée un plein que le nettoyage
  ne sait pas retirer.
- T4 PATCH demande de pièce (`requestedBy` ignoré) rouge sans son correctif (introduit en 179015d), vérification restée ouverte jusqu'ici.
- `routes-hygiene` rouge sur la version précédente de `server/routes.ts`, `storage-stubs` rouge sans
  l'implémentation de `getMaintenanceSchedule`.
- Pas d'e2e pour la fermeture périmée des demandes : voir la prévention dans LESSONS_LEARNED.

## 009684f - Anciens bouchons de stockage : suppression de document, OT par technicien et par client (T1, T7)

**Quoi**
- `DELETE /api/documents/:id` supprime enfin la ligne et le fichier. Avant, la route répondait 204 et
  l'écran « Document supprimé » alors que rien n'était supprimé.
- `GET /api/work-orders/technician/:id` renvoie les OT du technicien au lieu d'une liste toujours
  vide ; un technicien ne lit que les siens (403 sinon).
- `GET /api/work-orders` pour un client : les OT de ses véhicules au lieu d'une liste vide.
- Liste d'OT du technicien : le filtre de statut vaut aussi pour ses propres OT.
- Écran documents : corbeille réservée à l'admin et au chef d'atelier, garde double clic, toast lisible.

**Comment**
- Unitaire d'abord : `uploadedFileCandidates` (`server/lib/uploaded-file.ts`, 12 cas) ne renvoie que des
  chemins sous `uploads/`, pour les deux formes stockées (`uploads/...` de multer, `/uploads/...` ancien).
- Garde `storage-stubs` élargie aux bouchons qui renvoient un objet vide : elle a trouvé
  `getWorkOrdersByOwner` (`{ workOrders: [], total: 0 }`), appelé pour tout client et invisible jusqu'ici.
  Liste gelée désormais vide.
- Intégration (`tests/integration/storage-former-stubs.test.ts`, 8 cas, 8 rouges sans le correctif) :
  la ligne d'abord, le fichier ensuite ; un fichier encore référencé par un autre document est
  conservé ; un chemin hors de `uploads/` n'est jamais supprimé ; un fichier absent ne bloque pas.
- `getWorkOrdersForTechnician` : `OR` de Drizzle non parenthésé dans `and(...)`, d'où
  `A AND B OR C`. Parenthèses explicites.
- Contrat (`tests/contract/former-storage-stubs.contract.test.ts`, 9 cas) : 204 puis 404 au contrat,
  403 technicien et magasinier, 401 sans session, client limité à ses véhicules.
- Route DELETE : 404 si la ligne a disparu entre-temps, événement `vehicle_updated` avec `documentId`
  (le client invalide déjà listes, KPI et alertes documents sur ce cas), `console.error` migré.
- UI (`e2e/09-vehicle-document-delete.spec.ts`, 2 cas) : suppression par double clic sur la
  confirmation, une seule requête, document absent de l'écran, de la base et du disque ; secrétaire
  sans corbeille. Les boutons sont cherchés par préfixe « Supprimer » pour que le test vaille aussi
  contre l'ancien écran.

**Pourquoi**
- Un succès affiché sans effet est pire qu'une erreur : l'utilisateur croit le document retiré.
- Le fichier est supprimé après la ligne : si le disque échoue, il reste un fichier orphelin, pas un
  document qui pointe vers un fichier disparu.
- Incidents : LESSONS_LEARNED « Garde des bouchons aveugle aux objets vides » et
  « OR Drizzle non parenthésé dans and() ».

**Preuve**
- `npm run check` 0 erreur ; `npm test` 407/407 ; `npm run test:integration` 53/53 ;
  `npm run test:contract` 85/85 ; 0 ligne `TEST-` orpheline, aucun dossier de test sous `uploads/`.
- Contrat rejoué sans les correctifs serveur : 6 rouges, 3 verts (non-régressions déjà vraies).
- e2e 09 vert (2/2), serveur local sur 5055 ; rejoué avec l'ancien composant : 2 rouges (deux DELETE
  envoyés, corbeille visible pour la secrétaire).

## 4d878ea - Chemins disque des documents, saisie et modification d'un plein (T1, T3)

**Quoi**
- Téléversement d'un document de workflow : `sessionId` et `documentType` viennent de la requête et
  devenaient des segments de chemin. `..%2F..%2Fx` (décodé par Express) écrivait hors de
  `uploads/workflows`. Désormais 400 lisible, rien n'est écrit.
- Les deux téléchargements (`/api/documents/:id/download`, `/api/workflows/documents/:documentId`)
  ne servent qu'un fichier situé sous `uploads/` (404 sinon).
- `transferDocumentsToVehicle` : l'INSERT `vehicle_documents` était une chaîne interpolée (apostrophe
  = requête cassée ou SQL injecté) ; le nom d'origine servait de nom disque sans retirer les
  répertoires. Code sans appelant aujourd'hui, corrigé avant qu'il n'en ait.
- `POST /api/fuel-records` réservé aux profils qui ont un écran carburant (admin, chef d'atelier,
  technicien, secrétaire, logistique) ; `PATCH` à l'auteur du plein ou à l'admin, comme
  `canEditFuelRecord` côté client.

**Comment**
- Unitaire : `isSafePathSegment` (`server/lib/uploaded-file.ts`, 10 cas) ; matrice RBAC
  `isFuelRecordWriter` dans `auth-middleware.test.ts`.
- Intégration (`tests/integration/workflow-document-transfer.test.ts`, 5 cas) : nom avec apostrophe
  et SQL enregistré tel quel, nom avec `../` copié dans le dossier du véhicule, `factur_achat` rangé
  en `autre`, `AppError` 400 sur session ou type invalide.
- Contrat (`tests/contract/fuel-records-and-document-paths.contract.test.ts`, 14 cas) : 403 client et
  magasinier, 403 non-auteur, 400 `VALIDATION` sur les deux segments, 404 sur chemin stocké hors de
  `uploads/`, et les non-régressions (technicien, auteur, admin, téléversement normal, deux formes
  stockées servies).
- `secondary-routes-validation` : les pleins modifiés par le chef d'atelier lui sont attribués
  (changement de contrat voulu : un non-auteur reçoit maintenant 403).
- Ménage des deux nouveaux tests : disque d'abord, noms uniques. Le premier rejeu sans correctif
  avait laissé des fichiers à la racine du projet et dans `uploads/` : le ménage base échouait (pleins
  non suivis créés par client et magasinier) avant d'atteindre le disque.
- `console.*` de `workflow-document-service.ts` migrés vers `moduleLogger("workflow-documents")`.

**Pourquoi**
- Un paramètre d'URL est décodé avant d'arriver à la route : `%2F` devient `/`. Tout segment de chemin
  venu de la requête doit être validé, pas seulement concaténé.
- Règle carburant tirée des écrans (menu, `/technician/fuel`, `canEditFuelRecord`) :
  `PROFILS_ACCES.md` ne cite qu'admin et logistique pour « Consommations », mais vise la carte
  carburant. Écart à trancher dans la matrice.
- Incident : LESSONS_LEARNED « Paramètre de requête utilisé comme segment de chemin disque ».

**Preuve**
- `npm run check` 0 erreur ; `npm test` 431/431 ; `npm run test:integration` 58/58 ;
  `npm run test:contract` 99/99 ; 0 ligne `TEST-` orpheline, aucun fichier de test sous `uploads/`.
- Rejoué sans le correctif serveur : contrat 9 rouges, 5 verts (non-régressions) ; intégration 5/5
  rouges ; aucun fichier laissé hors des dossiers de test.
- Deux passages complets précédents avaient des rouges dans des fichiers non touchés (erreurs Neon
  dans `createTestUser`, 84 tests sautés au premier) ; rejoués seuls puis en suite complète : verts.
  Cause non établie.

## 24fb32f - Le technicien ne saisit plus de plein (T1)

**Quoi**
- `isFuelRecordWriter` : admin, chef d'atelier, secrétaire, logistique. Le technicien reçoit 403 sur
  `POST /api/fuel-records`.
- Page `/technician/fuel` supprimée, avec son entrée dans le menu latéral, la barre basse et le fil
  d'Ariane : elle n'affichait que « Mes pleins » et serait restée vide.
- Le chauffeur n'est pas concerné : il saisit par sa mission (`POST /api/missions/:id/fuel-records`,
  limité au chauffeur affecté).

**Comment**
- Matrice RBAC (`auth-middleware.test.ts`) puis contrat `fuel-records-and-document-paths` : technicien
  ajouté aux refus ; non-régressions portées par le logisticien.

**Pourquoi**
- Règle donnée par le commanditaire : un technicien n'a pas de plein à enregistrer.

**Preuve**
- `npm run check` 0 erreur ; matrice RBAC 173/173 ; contrat carburant + routes secondaires 30/30.

## 87c8678 - Documents de véhicule : cloison entre clients (T1)

**Quoi**
- Un client ne lit plus les documents des véhicules d'un autre client. Le personnel (tous rôles sauf
  `client`) les lit tous, pour un contrôle ou un travail.
- Objet isolé hors périmètre → 403 `FORBIDDEN` « Accès refusé : ce véhicule n'appartient pas à votre
  compte. » : `GET /api/vehicles/:id/documents`, `.../documents/:type`, `GET /api/documents/:id/download`,
  `GET /api/workflows/documents/:id`, et les écritures `PUT /api/vehicles/:id/mileage` et
  `.../maintenance-position`.
- Listes filtrées sur le propriétaire : `GET /api/vehicles/documents/all`, `expiring-docs`, `expired-docs`,
  `document-stats`, `all-with-status`, `GET /api/workflows/:sessionId/documents`.

**Comment**
- `isAnyUser` (`server/middleware/auth.ts`) charge `req.user` ; `authenticate` ne le faisait pas.
- Garde unique `server/lib/client-scope.ts` (`canAccessOwned`, `ownerScopeOf`), le personnel ne coûte
  aucune lecture. Services : `ownerId` optionnel (défaut `null` = pas de filtre, appelants inchangés).
- Workflow : filtre sur l'auteur du workflow, pas sur `sessionId` (non unique, testé).
- `console.*` des fonctions touchées migrés vers `moduleLogger` ; plus de `error.message` dans les 500
  de `vehicles.routes.ts`.
- Crescendo : unitaire du garde + matrice RBAC, puis contrat avec deux clients, un technicien et un admin.

**Pourquoi**
- Règle du commanditaire : documents visibles par tout le personnel, jamais d'un client à l'autre.
  Avant : une session suffisait, ids séquentiels.

**Preuve**
- `npm run check` 0 erreur ; unitaire 453/453 ; intégration 58/58 ; contrat complet 111/111 ;
  0 `TEST-` en base ni sur disque.
- Nouveau contrat `vehicle-documents-client-scope` : 11/11. Premier passage 10/11 : la fabrique de
  véhicules ignore `licensePlateExpiry`, date posée par une mise à jour dans le test.
- Sans correctif : 8 rouges sur 11 ; les 3 verts sont les accès autorisés (non-régression).

## 52487da - Kilométrage et position : saisie réservée au personnel

**Quoi**
- `PUT /api/vehicles/:id/mileage` et `.../maintenance-position` : un client est refusé (403), même sur
  son propre véhicule. Le personnel (tous rôles sauf `client`) saisit sur tout véhicule.
- Véhicule inexistant : 404 « Véhicule introuvable. » au lieu d'une 500 « Erreur serveur ».
- Kilométrage en baisse : 400 avec le message métier au lieu d'une 500.

**Comment**
- Nouveau garde `isStaff` (`server/middleware/auth.ts`), dérivé de `ALL_APP_ROLES` ; le contrôle de
  propriétaire devenu sans objet sur ces deux routes est retiré.
- `vehicle-documentation-service.ts` lève `AppError(404)` / `AppError(400)` ; les routes les passent
  déjà au gestionnaire central.
- Crescendo : matrice RBAC (`isStaff`), puis contrat `vehicle-documents-client-scope` (client sur son
  véhicule, baisse de kilométrage, véhicule absent).

**Pourquoi**
- Règle du commanditaire : un client ne saisit pas lui-même son kilométrage.
- Une 500 se lit « le serveur est en panne » ; l'utilisateur doit lire « ce véhicule n'existe pas ».

**Preuve**
- `npm run check` 0 erreur ; unitaire 467/467 (matrice RBAC 201/201) ; contrat
  `vehicle-documents-client-scope` 14/14.
- Sans correctif serveur : 3 rouges sur 14 (client sur son véhicule, baisse, véhicule absent).

## cf585de - Suppression d'un document de workflow : cloison entre clients

**Quoi**
- `DELETE /api/workflows/documents/:id` : un client ne supprime plus le document de la session d'un
  autre client (403). L'auteur de la session et le personnel suppriment.
- Document absent : 404 « Document non trouvé » au lieu d'une 500.

**Comment**
- Route passée de `authenticate` à `isAnyUser` + `canAccessOwned` sur l'auteur du workflow, comme la
  lecture `GET /api/workflows/documents/:id`.
- `WorkflowDocumentService.deleteWorkflowDocument` lève `AppError(404)` (suppression concurrente) ;
  `console.error` migré vers `moduleLogger`.
- Contrat : documents à usage unique avec leur propre fichier, pour ne pas casser les autres tests.

**Pourquoi**
- Trou de la cloison posée en 87c8678 : la lecture était fermée, la suppression restait ouverte à toute
  session (ids séquentiels).

**Preuve**
- `npm run check` 0 erreur ; unitaire 467/467 ; contrats `vehicle-documents-client-scope` 16/16 et
  `fuel-records-and-document-paths` 15/15 ; aucun résidu dans `uploads/`.
- Sans correctif : 2 rouges sur 16 (le client A supprimait le document du client B ; l'absent donnait 500).

## 69a218c - Demande de pièce : chaîne complète et annulations (PRT4)

**Quoi**
- Contrat `part-requirements-chain` : création par le technicien → approbation par le chef d'atelier →
  commande directe (refusée sans motif, acceptée avec) → entrée en stock par le magasinier (+2, mouvement
  `in` à son nom) → sortie du stock vers l'OT (−2, pièce rattachée à l'OT) → plus aucune transition.
- Annulation à chaque étape : en attente et approuvée (chef d'atelier ; magasinier refusé), commandée
  (demande d'annulation, décision de l'admin seul, ou retour à « approuvée »), entrée en stock, annulée
  et refusée (refusées, stock inchangé).
- Correctif : `PATCH /api/part-requirements/:id` passait une demande à « Sortie du stock » sans déduire
  la pièce ni la rattacher à l'OT. Le service refuse désormais `issued` sans effet de stock (400).

**Comment**
- `updatePartRequirement` : `issued` exige `onTransition` ; seule la route
  `POST /api/work-orders/:id/part-requirements/:id/issue` le fournit.
- Crescendo : intégration (`part-requirements-idempotence` : refus sans effet ; la course à deux sorties
  passe maintenant un effet neutre), puis contrat HTTP avec quatre rôles réels.

**Pourquoi**
- PRT4, priorité 2 du plan (traçabilité stock). Un statut « Sortie du stock » sans mouvement fausse le
  stock affiché et le coût de l'OT.

**Preuve**
- `npm run check` 0 erreur ; unitaire 467/467 ; intégration 59/59 ; contrat complet 124/124 (15 fichiers).
- Premier passage du nouveau contrat : 7/8, le rouge est le PATCH `issued` accepté (200, stock inchangé).
- Aucune donnée `TEST PRT4` restante en base.
- Hors périmètre, à trancher : le workflow autorise le technicien à annuler sa demande en attente, mais la
  route `PATCH` (`isInventoryManager`) le refuse et aucun écran technicien ne le propose.

## 376dc15 - OT : un seul bouton « Demander la pièce », le serveur décide au clic

**Quoi**
- Stock suffisant : la pièce sort directement vers l'OT, au prix du catalogue.
- Stock insuffisant : le disponible sort vers l'OT, une demande `pending` est créée pour le manquant, l'OT
  passe en `awaiting_parts`. Une demande déjà en cours sur la même pièce est réutilisée, pas doublée.
- Le stock ne devient jamais négatif : le passage en force réservé au magasinier et à l'admin disparaît.
- `POST /api/work-orders/:id/parts` quitte `server/routes.ts` pour `work-order-parts.routes.ts` ;
  `POST .../awaiting-parts` avec une pièce passe par le même service (une pièce en stock ne part plus en
  demande).
- Écran OT : un seul bouton, aperçu du partage avant l'envoi, double clic neutralisé. Le sélecteur ne
  proposait que les 10 premières références (`/api/parts` pagine à 10) : il charge le catalogue.

**Comment**
- Calcul pur dans `server/lib/part-request.ts` (`splitPartRequest`, `describePartRequest`).
- Service `requestPartForWorkOrder` : une transaction, verrou sur l'OT puis sur la pièce, sortie par
  `addPartToWorkOrder(..., { requireAvailable: true })`.
- Temps réel en trois couches : invalidations locales (OT, listes, attente de pièces, demandes, stock,
  magasin) ; trames `part_used_added`, `part_requirement_created`, `work_order_updated`,
  `work_order_awaiting_parts` ; resync des écrans satellites par `useRealTimeSync`.
- Crescendo : unitaire (partage et messages), intégration (dont cinq demandes simultanées sur un stock de
  3), contrat HTTP (statuts, rôles, trames diffusées), e2e à deux rôles (technicien qui demande, magasinier
  qui reçoit la trame).

**Pourquoi**
- Le technicien demande une pièce ; c'est au serveur, pas à lui, de savoir si elle est en stock et de
  mettre l'OT en attente. Deux boutons (« ajouter », « attente de pièces ») laissaient le choix à l'écran.

**Preuve**
- `npm run check` 0 erreur ; unitaire 474/474 ; intégration 66/66 (12 fichiers) ; contrat 129/129
  (15 fichiers) ; e2e `10-work-order-part-request` 1/1.
- Contrat rejoué sur l'ancien code : 4 rouges sur 6 (stock épuisé, stock partiel, quantité invalide,
  pièce en stock envoyée en demande) ; restent verts le refus du magasinier et l'OT marqué sans pièce.
- Hors périmètre, à trancher : `PATCH /api/technician/work-orders/:id/status` ajoute encore des pièces sans
  garde de stock et avale les erreurs ; une demande réutilisée n'augmente pas sa quantité.

## c06fa45 - Demande de pièce : l'entrée en stock porte son réceptionnaire (PRT6)

**Quoi**
- Nouvelle colonne `part_requirements.received_by` : l'utilisateur qui enregistre l'entrée en stock,
  jamais le demandeur. Posée sur `received` et `partially_received`, par le PATCH de la demande comme par
  la réception d'une commande fournisseur (`updateOrderStatus`, `partial` puis `delivered`).
- Champ tenu par le serveur : omis de `insertPartRequirementSchema`, retiré du corps du PATCH.
- Les demandes reçues avant ce commit restent à `NULL` : le réceptionnaire d'origine n'a pas été conservé.

**Comment**
- `shared/schema.ts` + `ALTER TABLE … IF NOT EXISTS` dans `server/init-database.ts` + migration
  `server/db/migrations/20261030_part_requirements_received_by.sql` (AGENTS.md §5).
- Les sélections explicites de colonnes (`part-requirements-service.ts`, `storage.ts`) renvoient le champ.
- Crescendo : intégration (`part-requirement-received-by` : commande fournisseur partielle par le
  magasinier, complète par l'admin), contrat (`part-requirements-chain` : entrée en stock par le
  magasinier avec un corps qui prétend le technicien ; PATCH hors réception qui tente d'écrire le champ).

**Pourquoi**
- PRT6, dette connue (AGENTS.md §9, `MATRICE_ROLES_GAP.md`) : le mouvement de stock était attribué au
  réceptionnaire depuis le 29 octobre, la demande ne disait toujours pas qui avait réceptionné.

**Preuve**
- Premier passage : 3 rouges (2 contrat, 1 intégration), `receivedBy` absent.
- `npm run check` 0 erreur ; unitaire 474/474 ; intégration 67/67 (13 fichiers) ; contrat 138 verts sur
  les 15 fichiers existants. Les 7 rouges du même run sont ceux du prochain chantier (pneus, TIR1–TIR4),
  dont le test est écrit et pas encore commité.

## 0d015a2 - Pneus : RBAC magasin / atelier et suppression douce (TIR1–TIR4)

**Quoi**
- Fiche pneu supprimée (douce) : invisible au détail (`GET /api/tires/:id` 404), non modifiable
  (`PATCH` 404), non resupprimable (`DELETE` 404). Fiche inexistante : 404 au lieu de 200 vide.
- `DELETE /api/tires/:id` : pneu monté → 409 avec un message lisible ; plus de `error.message` brut en 400.
- `PATCH /api/vehicle-tires/:id/remove` : montage inconnu ou déjà démonté → 404 (le service rendait
  toujours `true`).
- `POST /api/tire-rotations` : corps validé (400 `VALIDATION`) ; OT et rotation créés dans une même
  transaction, une rotation refusée ne laisse plus d'OT orphelin. Véhicule inconnu → 404.
- `POST /api/tire-inspections` : corps validé (400 `VALIDATION`, plus de 500) ; l'inspecteur reste
  l'auteur de la requête.

**Comment**
- `server/services/tires-service-simplified.ts` : filtre `deletedAt IS NULL` sur `getTire` / `updateTire`,
  `updateTire` ne masque plus les erreurs, `removeTireFromVehicle` filtre `status = 'active'` et lit le
  `returning`, `AppError` 404 / 409 dans `deleteTire`, `db.transaction` pour OT + rotation. Les `console.*`
  touchés passent par `moduleLogger("tires")`.
- `server/routes.ts` (correction en place, aucune route ajoutée) : `insertTireInspectionSchema` et
  `insertTireRotationSchema` (sans `workOrderId`, `performedBy`, `createdBy` ; coût accepté en nombre,
  comme l'envoie le formulaire) ; `AppError` et `ZodError` confiés au gestionnaire central.
- Contrat `tests/contract/tires-rbac.contract.test.ts` : quatre rôles réels (admin, magasinier, chef
  d'atelier, technicien), 15 cas.

**Pourquoi**
- Feuille PNEUMATIQUE (AGENTS.md §5) : le magasin tient la fiche, l'atelier monte, tourne et démonte,
  le technicien inspecte. Le RBAC tenait déjà ; les cas d'erreur, eux, répondaient 200, 400 brut ou 500.
- Une fiche supprimée qui reste modifiable ou consultable contredit la suppression douce (TIR2).

**Preuve**
- Premier passage sur l'ancien code : 7 rouges sur 15 (PATCH inexistant 200, DELETE 400 au lieu de
  404 / 409, détail d'une fiche supprimée 200, démontage inconnu 200, rotation et inspection invalides 500).
- `npm run check` 0 erreur ; unitaire 474/474 ; intégration 67/67 (13 fichiers) ; contrat 145/145 (16 fichiers).

## 3572b2e - Pneus : le démontage dit où va le pneu (TIR3)

**Quoi**
- Démonter un pneu exige une destination : **Remettre en stock** (la fiche regagne une unité,
  `updated_by` = qui démonte) ou **Mettre au rebut** avec un motif obligatoire (usé, endommagé,
  crevé non réparable ; stock inchangé). Avant, le démontage ne touchait jamais le stock.
- `PATCH /api/vehicle-tires/:id` (édition générique) refuse les champs de cycle de vie
  (`status`, `tireId`, `vehicleId`, dates et kilométrage de démontage) : 400 lisible. On pouvait
  passer un montage à `removed` sans effet stock.
- Écran « Pneus montés » : bouton « Démonter » (chef d'atelier, admin), dialogue avec destination,
  motif, kilométrage (au moins celui du montage) et observation ; badge de statut lisible.

**Comment**
- `shared/constants/tire-removal.ts` : destinations, motifs, libellés, `tireRemovalSchema` (Zod),
  `vehicleTireStatusAfterRemoval`. Le statut existant `vehicle_tires.status` porte la destination
  (`removed` = remis en stock, `worn` / `damaged` / `punctured` = rebut) : aucune colonne ajoutée.
- `removeTireFromVehicle` : démontage et retour en stock dans une même transaction ; fiche supprimée
  → 409 « choisissez la mise au rebut ». Trame `vehicle_tire_removed` avec `destination`.
- `server/routes.ts` : corrections en place des deux PATCH existants, aucune route ajoutée.
- Client : `vehicle-tire-remove-dialog.tsx`, `useSingleFlightMutate`, invalidation fiches,
  statistiques, stock bas et pneus du véhicule (AGENTS.md §2).

**Pourquoi**
- Les logiciels de flotte imposent ce choix au démontage : RTA Fleet (retour stock, rechapage, hors
  service, rebut avec code motif obligatoire), Eptura (retour inventaire ou mise au rebut), OxMaint
  (kilométrage et motif relevés au démontage). Un pneu démonté qui disparaît du stock fausse
  l'inventaire du magasin.
- Limites assumées : le stock reste agrégé par référence (un pneu usagé remis en stock se mélange au
  neuf) ; le rechapage n'est pas modélisé ; les démontages antérieurs ne sont pas rattrapés.

**Preuve**
- Contrat `tires-rbac` 18/18 ; sur l'ancien code serveur, 4 rouges (stock non incrémenté, destination
  non exigée, PATCH générique accepté).
- Unitaire `tests/unit/shared/tire-removal.test.ts` (schéma, correspondance avec l'énumération) ;
  unitaire 478/478 ; `npm run check` 0 erreur.
- e2e `11-tire-removal-to-stock` vert : double clic = 1 requête, trame reçue par le magasinier,
  stock 0 → 1 en base.
- `client-payment-idempotence` (intégration) instable sans lien : 8/8 puis 2 échecs sur le même code,
  8/8 sans les changements pneus.

## caed509 - Pneus : brouillon du wizard et tableau stock (TIR5, TIR6) ; nettoyage de test cloisonné

**Quoi**
- Brouillon de formulaire : l'auto-enregistrement pendant la saisie ne s'exécutait jamais. Le brouillon
  n'était écrit qu'au changement d'étape. Corrigé dans `useFormDraft`, ce qui vaut pour ses 14 formulaires.
- Wizard pneu : `useSingleFlightMutate` sur la création (AGENTS.md §10) et message d'erreur par
  `userMessageOf` au lieu de `error.message`.
- Nettoyage des tests : `cleanupOrphanTestRows` ne supprime plus que les lignes `TEST-` vieilles de plus
  de 2 h. Il effaçait, à la fin de chaque fichier, les utilisateurs et données des lancements concurrents.
- e2e `12-tire-wizard-draft-and-table` : TIR5 et TIR6.

**Comment**
- `persistDraft` dépendait de `getMeta` / `isEmpty`, souvent passés en fonctions inline, donc recréés à
  chaque rendu. L'effet `form.watch` se réabonnait à chaque frappe et son nettoyage annulait le minuteur
  en attente. Le watch appelle maintenant `persistDraft` par une ref et ne dépend plus que de
  `debounceMs`, `enabled` et `form`.
- `cleanupOrphanTestRows` : filtre `created_at < now() - 2 hours` ajouté au filtre de préfixe, sur
  chaque table balayée.

**Pourquoi**
- La base de test est partagée (`DATABASE_URL_TEST` = `DATABASE_URL`) par cette session, les e2e et les
  worktrees du lot. Le balayage global expliquait les 401 en série des suites contrat et les échecs
  intermittents de `client-payment-idempotence` (utilisateur ou lignes supprimés en plein test).

**Preuve**
- e2e 12 rouge sur l'ancien hook (brouillon jamais écrit pendant la saisie), vert après : 2/2.
- La garde double clic n'est pas prouvée par l'e2e : sans elle, le double clic n'envoyait déjà qu'une
  requête. Conservée par règle (§10).
- Unitaire 781/781 ; `npm run check` 0 erreur ; contrat 398/398 (37 fichiers, plus aucun 401) ;
  intégration 89/90 : seul échec `login-lockout-db-store`, table `login_attempts_by_username` absente
  (migration du lot T-12 non appliquée), sans lien.
- Constat hors périmètre : `getCurrentUser` (`client/src/lib/auth.ts`) abandonne `/api/auth/me` après
  8 s et renvoie alors vers la connexion. Un serveur lent passe pour une déconnexion.

## 163a20a - Session : un serveur lent ne déconnecte plus l'utilisateur

**Quoi**
- Au démarrage, seul un 401 de `/api/auth/me` vaut « pas de session ». Un délai dépassé, une coupure
  réseau ou une 5xx gardent l'utilisateur en attente : nouvelle tentative automatique et panneau
  « Le serveur met du temps à répondre » avec un bouton « Réessayer maintenant ».
- e2e `01-auth-login` : nouveau cas « serveur lent ». Unitaire `session-check`.

**Comment**
- `client/src/lib/session-check.ts` : `checkSession` renvoie `authenticated` / `anonymous` /
  `unreachable` (délai 10 s) ; `nextSessionRetryDelay` donne 1, 2, 4, 8 puis 10 s.
- `useAuth` : boucle de tentatives à la place du chien de garde de 12 s qui forçait `user = null`.
  `isLoading` reste vrai tant que le serveur ne répond pas, donc les routes protégées ne redirigent pas.
  Connexion et déconnexion interrompent la boucle. `mountedRef` est remis à vrai au montage (double
  montage du mode strict).
- L'e2e bloque le service worker PWA (`serviceWorkers: "block"`), sinon `page.route` ne voit pas les
  requêtes.

**Pourquoi**
- Le serveur de dev met jusqu'à ~35 s à servir une page. Le contrôle abandonnait à 8 s et renvoyait
  vers la connexion un utilisateur dont la session était valide (constat de caed509).

**Preuve**
- e2e `01-auth-login` 3/3. Le cas « serveur lent » échoue sur l'ancien `useAuth`.
- Unitaire 789/789 ; `npm run check` 0 erreur.
- Lancement e2e sur `E2E_BASE_URL=http://127.0.0.1:5055` : le port 5000 était occupé par une autre
  application, que Playwright réutilisait (`reuseExistingServer`).

## f81714f - OT technicien : plus de sortie de stock, plus de retour en arrière (WO2)

**Quoi**
- `PATCH /api/technician/work-orders/:id/status` n'accepte plus de pièces : 400 avec un message qui
  renvoie vers la demande au magasin. L'écran « Mes ordres de travail » remplace le bloc « Pièces
  utilisées » par un lien vers la fiche de l'OT.
- Transitions autorisées au technicien : en attente → en cours, en cours → en cours / terminé,
  en attente de pièces → en cours. Un OT terminé ou annulé est refusé (409).
- Statut inconnu : 400. Kilométrage inférieur à celui du véhicule : 400, rien n'est écrit.

**Comment**
- Route déplacée de `server/routes.ts` vers `server/api/technician-work-orders.routes.ts` (Zod,
  `AppError`, `moduleLogger`). Tout est vérifié avant la première écriture.
- Table des transitions : `shared/constants/technician-work-order-transitions.ts`.

**Pourquoi**
- Décision métier : le technicien ne se sert pas au magasin, il demande la pièce pendant la
  réparation et le magasinier la sort. L'ancienne route décrémentait le stock elle-même, avalait les
  erreurs (« Statut mis à jour » affiché alors que la pièce n'était pas enregistrée), insérait la
  ligne de pièce avant la sortie de stock hors transaction, acceptait n'importe quel statut
  (`n_importe_quoi` enregistré en base) et ignorait sans prévenir un kilométrage plus bas.

**Preuve**
- Contrat `technician-work-order-status` 7/7 ; 5 cas rouges sur l'ancienne route (200 au lieu de
  400/409). Avec `work-order-parts`, `work-order-quality-check`, `api-auth-guard` : 22/22.
- Unitaire 802/802 ; `npm run check` 0 erreur.

**Reste**
- `POST /api/work-orders/:id/parts` (« demander une pièce », `requestPartForWorkOrder`) sort encore
  directement du stock la quantité disponible quand le demandeur est technicien. Contraire à la même
  décision ; à traiter à part (change le circuit des demandes).

## 136f966 - Pièce d'OT : toute sortie passe par le magasinier ; droit de sortie du chef d'atelier révocable

**Quoi**
- `POST /api/work-orders/:id/parts` (et `/awaiting-parts` avec une pièce) ne sort plus rien du stock.
  La quantité en rayon devient une demande `received`, « à sortir » dans la file du magasinier, sans
  approbation ni commande. Le manquant devient une demande `pending` et l'OT passe en attente de pièces.
- Le rayon déjà promis à une demande `received` / `delivered` est réservé : un second OT ne le compte
  plus comme disponible.
- Le chef d'atelier garde la sortie dérogatoire motivée (magasin fermé). L'administrateur la lui retire
  ou la lui rend : `PATCH /api/users/:id/stock-issue-permission`, interrupteur dans la liste des
  utilisateurs. Retirée, la sortie est refusée (403) et le stock reste intact.

**Comment**
- `server/services/work-order-part-request.ts` : pièce verrouillée (FOR UPDATE), demande ouverte
  réutilisée, réservation calculée en SQL, deux demandes créées dans la transaction.
- Colonne `users.can_issue_stock` (défaut `true`) : `shared/schema.ts`, `server/init-database.ts`,
  migration `20261031_users_can_issue_stock.sql`. Contrôle dans `partRequirementsService` (branche
  dérogation), route admin dans `server/api/user-stock-permission.routes.ts`.
- Temps réel : une trame `part_requirement_created` par demande créée (la trame `part_used_added`
  ne part plus de cette route, rien n'y sort).
- `tests/support/cleanup.ts` : le nettoyage des véhicules TEST orphelins supprime d'abord leurs OT et
  dépendants, et les prix carburant d'utilisateurs TEST orphelins (clés étrangères qui faisaient
  échouer le nettoyage global).

**Pourquoi**
- Décision métier : le technicien ne se sert pas au magasin, même en rayon ; le magasinier sort la
  pièce. Stock juste et traçable. Le chef d'atelier garde un recours la nuit, sous contrôle de l'admin.

**Preuve**
- Contrat `stock-issue-permission` 4/4 (nouveau, rouge avant), `work-order-parts` réécrit,
  `technician-work-order-status` : 17/17 ; `error-contract-and-issue-idempotence` +
  `part-requirements-chain` 15/15.
- Intégration `work-order-part-request` 8/8, dont concurrence 5 OT sur un stock de 3.
- Unitaire 803/803 ; `npm run check` 0 erreur ; e2e `10-work-order-part-request` vert.

## 5592621 - OT : transitions de statut contrôlées sur la modification générique (WO2)

**Quoi**
- `PATCH /api/work-orders/:id` refuse un OT terminé qu'on voudrait remettre en cours, en attente ou
  en attente de pièces (409, le retour passe par le contrôle qualité) et un OT annulé qu'on voudrait
  rouvrir (409). Rien n'est écrit, pas même les autres champs du corps.
- Le technicien garde ses gestes (démarrer, terminer, reprendre après pièce) ; annuler ou remettre en
  attente lui est refusé (403). Garder le même statut reste permis (modale d'édition).
- La modale d'édition ne propose plus que les statuts atteignables pour le rôle connecté, et affiche
  le message serveur lisible (`userMessageOf`) au lieu de `error.message`.

**Comment**
- Règle unique `shared/constants/work-order-transitions.ts` (`checkWorkOrderTransition`), utilisée par
  la route et par la modale ; elle réutilise `canTechnicianTransition`.
- Contrôle placé après la validation des colonnes, avant toute écriture, levé en `AppError`.

**Pourquoi**
- La route acceptait n'importe quel passage : un technicien pouvait annuler un OT, et un OT terminé
  pouvait revenir en cours sans contrôle qualité ni motif.

**Preuve**
- Contrat `work-order-status-transitions` 5/5 (3 rouges avant le correctif). Voisins
  `work-order-quality-check`, `work-order-booking-guard`, `api-role-guard-and-validation`,
  `technician-work-order-status` : 43/43.
- Unitaire 807/807 ; `npm run check` 0 erreur ; e2e `03-work-orders` et `06-realtime-work-orders` verts.

## bcd695a - Commande fournisseur : remise bornée, quantités reçues contrôlées (T4)

**Quoi**
- `POST /api/purchase-orders` : remise hors de 0..100 refusée (400). Un total envoyé par le client
  reste ignoré, HT, remise, TVA et TTC sont recalculés.
- `PATCH /api/purchase-orders/:id/lines/:lineId` : quantités entières et positives ; quantité reçue
  plafonnée au commandé (400), jamais en baisse (409, la correction passe par un ajustement de
  stock) ; acceptées + refusées ≤ reçues (400) ; une ligne d'une autre commande est introuvable (404).
- Deux réceptions simultanées de la même ligne ne créditent le stock qu'une fois.
- Les deux routes renvoient leurs erreurs par le gestionnaire central (plus de `details: error.message`).

**Comment**
- Bornes Zod dans la route ; règles métier dans `procurementService.updateOrderLine` (`AppError`).
- Écriture de la ligne conditionnée à la quantité reçue lue (verrou optimiste) ; crédit de stock de
  `registerPartReception` en incrément SQL atomique, aussi utilisé par la livraison de commande.

**Pourquoi**
- Une remise de 150 % donnait un total négatif. Une quantité reçue de -100 puis de 5 créditait 105
  pièces, et la livraison suivante (« commandé - déjà reçu ») recréditait encore l'écart. La lecture
  puis réécriture du stock perdait une réception en cas d'appels simultanés.

**Preuve**
- Contrat `purchase-order-amounts` 8/8 (6 rouges avant le correctif). `error-contract-and-issue-idempotence`,
  `part-requirements-chain`, `api-role-guard-and-validation` verts (un dépassement de délai Neon sur un
  test d'OT, vert au rejeu).
- Unitaire 807/807 ; `npm run check` 0 erreur.

**Reste**
- Carburant : le coût saisi est celui du ticket, pas un montant serveur ; écart au prix de référence
  à traiter comme anomalie, pas en T4. Factures client et fournisseur à vérifier.

## 0c4941b - Facture client : montant borné, TVA et TTC recalculés au centime (T4)

**Quoi**
- `POST /api/billing/invoices/generate` : mission, montant (> 0, plafonné à 10^12 HT) et échéance
  (AAAA-MM-JJ) validés (400 lisible). TTC, solde, TVA, statut et auteur envoyés par le client sont ignorés.
- Mission inconnue 404 ; mission sans client 409 ; numéro de facture déjà pris 409.
- Écran mission : « Générer Facture » en single-flight, un double clic ne crée plus deux factures.

**Comment**
- Schéma Zod dans la route, erreurs par le gestionnaire central (`next(error)`), `AppError` dans
  `clientBillingService.generateInvoiceFromMission` ; HT et TVA arrondis au centime, TTC = HT + TVA.

**Pourquoi**
- Un montant de -5000 créait une facture négative ; une échéance ou un id invalide, une mission
  inconnue ou un numéro en double renvoyaient un 500 avec le message technique brut.

**Preuve**
- Contrat `client-invoice-generate` 11/11 (7 rouges avant le correctif) ; `client-payment-idempotence` 7/7.
- Unitaire 807/807 ; `npm run check` 0 erreur.

**Reste**
- Plusieurs factures par mission restent permises (onglet Factures de la mission) : pas de 409 par mission.
- Factures fournisseur à vérifier (T4).

## c3f3260 - Facture fournisseur : champs du workflow ignorés, solde initial = TTC (T4)

**Quoi**
- `POST /api/supplier-invoices` : statut, validation, approbation, paiement, solde et écarts envoyés
  par le client sont ignorés (facture toujours `received`, sans validateur ni payeur).
- Montants positifs, plafonnés à 10^12, TTC ≥ HT, arrondis au centime (400 lisible) ; numéro déjà
  saisi 409 ; erreurs par le gestionnaire central.
- Solde initial = TTC. Écran de saisie en single-flight.

**Comment**
- Schéma de route = `insertSupplierInvoiceSchema` moins les champs du workflow ; même exclusion et
  bornes dans `threeWayMatchingService.createSupplierInvoice` (couvre l'import Excel).

**Pourquoi**
- Une secrétaire pouvait créer une facture « payée » ou « approuvée par » un tiers. Un HT négatif
  donnait une facture négative ; un TTC trop faible réécrivait le HT. L'écran n'envoie pas de solde :
  la facture naissait à solde 0 et `/settlements` refusait tout règlement (« solde restant 0 »).

**Preuve**
- Contrat `supplier-invoice-create` 8/8 (8/8 rouges sur l'ancien code) ; `supplier-settlement-idempotence` vert.
- Unitaire 807/807 ; `npm run check` 0 erreur. Base : aucune facture non soldée à solde 0, pas de reprise.

**Reste**
- Import Excel : envoie `totalAmountHT` / `totalAmountTTC` alors que le schéma exige `amountHT` ;
  chaque ligne échoue probablement. À couvrir par un test rouge.

## 6b066f0 - Import Excel factures fournisseur : lignes du modèle acceptées, erreurs lisibles (T4)

**Quoi**
- `POST /api/supplier-invoices/import` : chaque ligne passe par la même saisie que `POST /`
  (champs du workflow ignorés, statut `received`, solde initial = TTC).
- Dates JJ/MM/AAAA strictes (31/02 refusé) ; `N° Commande` rattaché à la commande, refusé si
  inconnu ou d'un autre fournisseur (avant : ignoré sans rien dire).
- Message par ligne rédigé pour l'utilisateur ; erreur imprévue journalisée, ligne avec référence.
  Fichier refusé ou illisible : 400 au contrat commun. Un événement `supplier_invoice_created` par facture.

**Comment**
- `createSupplierInvoiceSchema` réutilisé, `ImportRowError` pour les refus de ligne, commandes lues
  en une requête (`inArray`), `AppError` + `next(error)` pour le fichier.

**Pourquoi**
- L'import envoyait `totalAmountHT` alors que le schéma exige `amountHT` : toute ligne du modèle
  échouait, avec le JSON Zod brut affiché à l'écran.

**Preuve**
- Contrat `supplier-invoice-import` 12/12 (rouge sur l'ancien code : ligne du modèle, montants
  numériques, dates) ; `supplier-invoice-create` et `supplier-settlement-idempotence` verts.
- Unitaire 807/807 ; `npm run check` 0 erreur.

**Reste**
- T3 : `PATCH /api/purchase-orders/:id/status` renvoie encore `details: error.message` en 500.

## b8dbbe1 - Commandes fournisseur : erreurs au contrat commun, transitions en source unique (T3)

**Quoi**
- `/api/purchase-orders` (liste, statistiques, regroupement, optimisation, retards, détail, statut) :
  plus de `details: error.message` ; erreurs au contrat commun `{ message, code, requestId }`.
- Identifiant illisible 400 ; commande inconnue 404 ; transition interdite et clôture sans facture
  payée 409 (avant 400), message en libellés d'écran (« Annulée », « Transmise fournisseur »).

**Comment**
- `AppError` dans `procurementService.updateOrderStatus`, `next(error)` dans les routes,
  `parseIdParam`. `shared/constants/purchase-order-statuses.ts` : statuts, libellés, transitions,
  repris par le service et `client/src/pages/procurement/orders/[id].tsx`. `console.error` migrés.

**Pourquoi**
- Le message technique (dont la transition en codes `cancelled -> sent`) partait dans la réponse ;
  un id non numérique finissait en 500.

**Preuve**
- Contrat `purchase-order-status-errors` 7/7 (4 rouges sur l'ancien code) ; `purchase-order-amounts` vert.
- Unitaire 812/812 (5 nouveaux sur la table de transitions) ; `npm run check` 0 erreur.

**Reste**
- Écran : passer de 400 à 409 est sans effet (il affiche `userMessageOf`). T3 sur `server/routes.ts`.

## 1dc6f93 - Documents de workflow : nom d'origine encodé dans Content-Disposition (sécurité)

**Quoi**
- `GET /api/workflows/documents/:id` sert le fichier avec un `Content-Disposition` sûr : nom ASCII
  inchangé, sinon repli ASCII + `filename*` UTF-8 qui restitue le nom exact.

**Comment**
- `server/lib/content-disposition.ts` (`contentDisposition(type, nom)`, RFC 6266 / 8187), même principe
  que le paquet `content-disposition` d'Express, sans dépendance ajoutée. Seul appelant à nom saisi :
  les autres en-têtes (exports, facture PDF, bon d'OT) portent un nom généré par le serveur.

**Pourquoi**
- `originalName` brut entre guillemets : caractère hors Latin-1 ou retour à la ligne → `setHeader`
  lève (500) ; un guillemet ouvrait un second paramètre `filename` (nom de téléchargement forgé).

**Preuve**
- Contrat `vehicle-documents-client-scope` 19/19 (2 rouges sur l'ancien code) ; unitaire
  `content-disposition` 8/8, total 820/820 ; `npm run check` 0 erreur.

**Reste**
- Sécurité : chemins stockés relus (`server/routes.ts` ~6090, rapports, preuves) ; `getRoleLabel`.

## d6b2afe - Justificatif de règlement fournisseur : servi seulement sous uploads/ (sécurité)

**Quoi**
- `GET /api/supplier-invoices/:id/settlements/:settlementId/proof` ne sert plus un fichier hors de
  `uploads/` ; 400/404 au contrat d'erreur commun, plus de `details: error.message` en 500.

**Comment**
- `uploadedFileCandidates` (`server/lib/uploaded-file.ts`) remplace `startsWith(<cwd>/uploads)` ;
  `next(error)` vers le gestionnaire central (qui journalise le `console.error` retiré).

**Pourquoi**
- `proofReference` est libre via `POST /:id/payment` (legacy) ; le préfixe acceptait un dossier
  voisin (`uploads-old/secret.txt` servi en 200).

**Preuve**
- Contrat `supplier-settlement-proof-path` 3/3 (2 rouges sur l'ancien code) ;
  `supplier-settlement-idempotence` vert ; unitaire 822/822 ; `npm run check` 0 erreur.

## 1fd9250 - Initialisation base : trigger créé en une instruction (fiabilité des suites)

**Quoi / Pourquoi**
- `DROP TRIGGER` puis `CREATE TRIGGER trg_sync_document_updated_by` : une initialisation concurrente
  échouait (« already exists »). Cas vécu : remplacer un fichier serveur pour jouer le rouge relance
  `tsx watch` (dev sur 5055) pendant le setup du contrat ; la suite s'arrête sans aucun test.

**Comment**
- `CREATE OR REPLACE TRIGGER` (PostgreSQL ≥ 14, Neon 17). Garde-fou `init-database-concurrency`
  (2 rouges sur l'ancien code) : aucun `CREATE TRIGGER` ni `DROP TRIGGER` nu dans l'init.

**Reste**
- Sécurité : `getRoleLabel` (5 rôles) ; T3 sur `server/routes.ts`.

## Lot 09f4a7c, a03d7a6, e246e1c, fe07afc - rôles, pneus, planification, documents de workflow

**Quoi**
- `09f4a7c` : libellés de rôle par `roleLabelOf` (`client/src/lib/contextual-help/roles.ts`) ; cinq
  tables locales retirées (liste utilisateurs, page techniciens, profil, barre du haut, admin).
- `a03d7a6` : `PATCH /api/vehicle-tires/:id/remove` refuse un kilométrage de démontage inférieur à
  celui du montage (400 lisible, pneu toujours monté, stock inchangé).
- `e246e1c` : `POST /api/maintenance-schedules` : véhicule inconnu 404, date illisible 400 nommé ;
  `POST /:id/generate-work-order` : id illisible 400. Les trois finissaient en 500.
- `fe07afc` : documents rattachés à l'activation d'un véhicule depuis le workflow : chemin borné à
  `uploads/` (`uploadedFileCandidates`) ; `createdAt` en chaîne retiré (l'insertion échouait toujours).

**Pourquoi**
- Un magasinier, un logisticien ou la direction s'affichait « Utilisateur » dans la liste.
- Un démontage à rebours fausse l'usure et le coût au km du pneu.
- `file_path` vient du corps : un fichier du serveur hors `uploads/` devenait un document du véhicule.

**Preuve**
- Rouge sur l'ancien code : 1 unitaire (garde-fou), 2 intégration, 4 contrat.
- Vert : `role-labels` 3/3, `workflow-document-paths` 2/2, `tires-rbac` + `secondary-routes-validation`
  38/38, unitaire 825/825, `npm run check` 0 erreur.

**Reste**
- Pneus : stock usagé mélangé au neuf. WO3, WO5, parcours P2/P3/P6, soft delete, DOC/FUEL/ALR/DIR.

## Lot c7f565e, d12fdee - lignes de travail d'OT (WO3), demandes de renouvellement (DOC2)

**Quoi**
- `c7f565e` : `POST /api/work-orders/:id/items`, `PATCH` et `DELETE /api/work-order-items/:id`
  refusent l'écriture sur un OT terminé ou annulé (409) ; technicien ou poste inexistant : 400 lisible.
  La fiche OT masque l'édition des lignes sur OT terminé (annulé : déjà masqué).
- `d12fdee` : `PATCH /api/document-renewals/requests/:id/status` suit le cycle
  `pending -> in_progress -> completed`, rejet depuis `pending` ou `in_progress` ; terminée ou rejetée
  définitive (409) ; écriture conditionnelle sur le statut lu ; date d'échéance `AAAA-MM-JJ` réelle,
  sinon 400. Source : `shared/constants/document-renewal-statuses.ts`, `shared/constants/calendar-date.ts`.

**Pourquoi**
- Un OT clos ne se reprend que par le contrôle qualité : ses heures ne doivent plus bouger après coup.
  Un id inconnu finissait en 500 (clé étrangère).
- Une demande terminée pouvait repasser « en attente » ou être rejetée après coup ; une date illisible
  partait en erreur SQL.

**Preuve**
- Rouge sur l'ancien code : 2 contrat (201 au lieu de 409, 200 au lieu de 409).
- Vert : `work-order-items` 2/2, `document-renewal-status` 1/1, unitaire 837/837, `npm run check` 0 erreur.

**Reste**
- Pneus : stock usagé séparé du neuf (plan validé : `tires.used_stock_quantity`, `vehicle_tires.stock_source`).
- FUEL3 (kilométrage décroissant, volume > réservoir) : nouvelle règle d'anomalie, pas de capacité de
  réservoir en base. WO5, parcours P2/P3/P6, soft delete, DOC1/DOC3, ALR, DIR.

## Lot b4f1cc9, 6696d11 - pneus : stock usagé séparé du neuf (TIR7), nettoyage des tests

**Quoi**
- `b4f1cc9` : `tires.used_stock_quantity` et `vehicle_tires.stock_source` (`new` | `used`), créés dans
  `init-database.ts` et `20261101_tires_used_stock.sql`. Démontage vers le stock : usagé +1, neuf
  inchangé. Montage : neuf par défaut, usagé sur choix explicite (`stockSource`), décrément atomique
  gardé ; source vide : 409 lisible. Création de fiche : usagé forcé à 0 ; PATCH usagé négatif : 400.
  Statistiques : valeur et stock bas sur le neuf seul, `usedQuantity` exposé. Écrans : tableau pneus,
  dialogues de montage et de démontage, tableau de bord magasin. Source : `shared/constants/tire-stock.ts`.
- `6696d11` : le nettoyage de test supprime les factures d'un fournisseur de test avant lui.

**Pourquoi**
- Un pneu qui a roulé revenait compté et valorisé comme neuf : stock, valeur d'inventaire et alertes
  de stock bas faussés.
- Une facture importée (numéro sans préfixe `TEST-`) bloquait la suppression de son fournisseur et
  faisait échouer le nettoyage global de toutes les suites de contrat.

**Preuve**
- Rouge sur l'ancien code : `tires-used-stock` 10/10, unitaire `tires-used-stock-schema` 2/2.
- Vert : `tires-used-stock`, `tires-rbac`, `supplier-invoice-import` 41/41 ; unitaire 839/839 ;
  `npm run check` 0 erreur ; `e2e/11` 1/1 (démontage → usagé, trame temps réel).

**Limites**
- Le stock existant reste compté neuf (aucun backfill : l'origine n'a pas été conservée).
- Pneu sérialisé et rechapage non modélisés.

**Reste**
- WO5, DOC1/DOC3 ; FUEL3 = nouvelle règle d'anomalie à cadrer.

## Lot 5ef2af6, 5437147, 0d5db1d - coût d'OT (WO5), rejet de règlement (SINV1), retard client (CINV2)

**Quoi**
- `5ef2af6` : formule unique `computeWorkOrderCost` (`shared/work-order-cost.ts`) pour l'écran de
  détail et le PDF de l'OT ; KPI de coût moyen par intervention : rotations de pneus ajoutées.
- `5437147` : `PATCH /api/supplier-invoices/:id/settlements/:settlementId/reject`, motif obligatoire,
  colonnes `rejected_by`, `rejected_at`, `rejection_reason` (init + `20261101_supplier_settlement_rejection.sql`),
  événement `supplier_invoice_settlement_rejected`, bouton « Rejeter » et dialogue de motif.
- `0d5db1d` : `markOverdueInvoices` dans le cycle de fond ; un paiement partiel garde le retard ;
  événement `client_invoices_overdue`. Échéance par défaut des factures de test : 2099.
- SINV2 : déjà couvert par T7, statut mis à jour sans nouveau test.

**Pourquoi**
- WO5 : une pièce sans prix donnait « NaN » à l'écran et 0 dans le PDF ; le KPI ignorait les pneus.
- SINV1 : `rejected` existait sans route ; une saisie erronée bloquait le vrai règlement en 409.
- CINV2 : rien ne posait `overdue`, le compteur « en retard » restait à 0.

**Preuve**
- Rouge sur l'ancien code : `supplier-settlement-reject` 6/6, `client-invoice-overdue` 2/2,
  `kpi-service` coût moyen 1/1, unitaires `work-order-cost` et schéma de rejet.
- Vert : intégration 22/22 (avec `client-payment-idempotence`, `supplier-settlement-idempotence`),
  contrat 12/12 (avec les deux suites de règlement existantes), unitaire 845/845, `tsc` 0 erreur.

**Limites**
- Retard calculé à la date de Douala, au plus tard au cycle suivant (5 min).
- Le rejet n'est pas annulable ; une nouvelle saisie remplace le règlement rejeté.
- Pas d'e2e : écran de rejet vérifié par `tsc` seulement.

**Reste**
- ALR1-3, DOC1/DOC3 ; FUEL3 = nouvelle règle d'anomalie à cadrer.

---

## 2026-11-01 : cas partiels PO1, PO2, PRT3, CINV1

**Quoi**
- Contrats : `purchase-order-lifecycle` (chaîne draft à delivered, rôles, étape sautée 409, rejeu de livraison sans doublon de facture, stock reçu partiel puis complet), `purchase-order-three-way` (écart 0, 2 %, 10 %, facture sans commande, technicien refusé), `client-invoice-payments` (statuts pending/partial/paid, centimes en série, paiement sur facture soldée 409, synthèse client).
- Intégration : `stock-alert-lifecycle` (sous le seuil, pile au seuil, réappro partielle ou complète, retrait).

**Pourquoi**
- Lignes du plan en « Partiel » : seuls des e2e ou des services isolés les couvraient, sans rôle refusé ni rejeu.

**Preuve**
- Vert : PO1 et CINV1 (run du 1er novembre), PO2 8/8, PRT3 5/5 ; unitaire 839/839 ; `npm run check` 0 erreur.
- Rouge au premier passage, retenu comme défauts produit (tests en `it.fails`, à retirer à la correction) : voir Défauts.

**Défauts rapportés (non corrigés, à fleet-api / fleet-db)**
1. `server/services/three-way-matching-service.ts:286-295` : à exactement 5 % l'écart est marqué (`>=`) mais la recommandation reste `manual_review` (`<=`). Test : `exactement 5 % d'écart`.
2. `POST /api/supplier-invoices` avec un `purchaseOrderId` inexistant : 500 au lieu d'un 4xx lisible (`server/api/supplier-invoices.routes.ts`, création). Test : `commande inconnue`.
3. `server/services/parts-service.ts` (~250-300, `updateStock`) ne recalcule pas `parts.reorder_alert` ; l'export d'inventaire (`excel-export-service.ts` ~83) garde « Alerte CDE » = NON après une sortie sous le seuil. Test : `export d'inventaire`.

**Limites**
- Ces tests couvrent un comportement existant : pas de « rouge avant correctif », sauf les trois défauts ci-dessus (rouges constatés, gardés en `it.fails`).
- `POST /auto-approve` volontairement non appelé (il agirait sur toutes les factures reçues de la base).

**Reste**
- FUEL2/3, VEH2, MNT1/2, DIR2/3.

## Lot 4c5792e, 244f720, b916003 - défauts trouvés par les cas partiels

**Quoi**
- `4c5792e` : rapprochement 3 voies, la recommandation suit la borne de `hasDiscrepancy` : 5 % pile = `escalate`.
- `244f720` : `createSupplierInvoice` vérifie la commande liée ; inconnue = 404 « Commande fournisseur introuvable. »
  (route de création et import Excel).
- `b916003` : export d'inventaire, « Alerte CDE » = quantité <= seuil (règle de `stock-alerts-service`) ;
  `updateStock` tient `parts.reorder_alert` à jour.
- Les trois `it.fails` de la PR #61 redeviennent des `it`.

**Pourquoi**
- Défauts rapportés par l'agent des cas partiels (entrée précédente), gardés en `it.fails` jusqu'au correctif.

**Preuve**
- Rouge : les trois `it.fails` passaient sur l'ancien code (défaut présent).
- Vert : contrat 20/20 (`purchase-order-three-way`, `purchase-order-lifecycle`, `client-invoice-payments`),
  intégration 19/19 (avec `parts-stock-adjustment`, `supplier-settlement-idempotence`), unitaire 845/845, `tsc` 0.

**Limites**
- `reorder_alert` reste périmé pour les autres chemins qui modifient `parts.quantity` (réception, sortie) ;
  plus aucun lecteur serveur ne s'y fie pour décider.

**Reste**
- ALR1-3, DOC1/DOC3 ; FUEL2/3, VEH2, MNT1/2, DIR2/3.

## Lot d9d09b1, a32b671 - alertes : boîte de l'utilisateur (ALR2), génération planifiée (ALR1, ALR3)

**Quoi**
- `d9d09b1` : `server/api/alerts.routes.ts` (lu, tout lu, suppression) filtré sur l'utilisateur de
  session ; `POST /api/alerts/read-all` ; événement `alerts_read` (scope user) ; bouton « Tout marquer
  lu » ; doublons morts retirés de `server/routes.ts` et de la liste gelée.
- `a32b671` : clé de rappel quotidien sur les générateurs planifiés, insertion `ON CONFLICT DO NOTHING`
  sur `uq_alerts_user_dedupe`, pas d'événement sans création.

**Pourquoi**
- ALR2 : n'importe quel compte pouvait marquer lue ou supprimer l'alerte d'un autre ; pas de « tout lu ».
- ALR1 : une alerte lue revenait toutes les 5 min ; deux passages simultanés la doublaient.

**Preuve**
- Rouge sur l'ancien code : `alerts-inbox` 5/6 (200 au lieu de 404 hors périmètre, route read-all
  absente, événement non déclaré), `alert-generation-dedupe` 2/5 (concurrence, alerte lue recréée).
- Vert : contrat 12/12 (avec `notification-settings`, `incidents`), intégration
  `alert-generation-dedupe` 6/6 (dont alerte antérieure à la clé non doublée), unitaire 846/846,
  `tsc` 0 erreur.

**Limites**
- Rappel quotidien : une alerte lue revient le lendemain si l'objet est toujours en défaut.
- ALR3 couvert en intégration (événement par destinataire, technicien exclu), pas en e2e.
- `document-expiry-alerts` dépasse 90 s, sur main comme sur la branche : le passage parcourt tous les
  documents réels de la base partagée. Préexistant, non traité ici.

**Reste**
- DOC1/DOC3 ; FUEL3 à cadrer ; FUEL2, VEH2, MNT1/2, DIR2/3.

## Correctif relecture PR #62 - alertes non lues accumulées d'un jour à l'autre

**Quoi**
- Une alerte non lue identique (type, titre, lien) bloque toujours la création, quelle que soit sa clé :
  le rappel quotidien ne repart qu'une fois l'alerte lue.
- Garde-fou `alerts-write-hygiene` (écritures sur `alerts` gelées) ; leçon dans `LESSONS_LEARNED.md`.

**Pourquoi**
- Relecture : avec la seule clé du jour, un OT en retard non lu pendant 20 jours donnait 20 alertes
  non lues par destinataire. Corrige la limite « rappel quotidien » de l'entrée précédente : seule une
  alerte **lue** revient le lendemain.

**Preuve**
- Intégration `alert-generation-dedupe` 8/8 (J+1 non lue : aucune création ; J+1 lue : rappel),
  unitaire 848/848, `tsc` 0 erreur. Garde-fou rouge sur main (4 appels par id seul).

## DOC3 et P4 - renouvellement rapide : alerte d'échéance levée

**Quoi**
- `POST /api/document-renewals/quick-renew` lève désormais les alertes `doc_expiry` (due et expired)
  du document renouvelé, pour tous les destinataires, via `alertInboxService.clearDocumentExpiryAlerts`.
- Le client invalide les queries d'alertes sur `document_renewal_quick_completed`.

**Pourquoi**
- Test DOC3 rouge sur main : après renouvellement, l'échéance était à jour mais l'alerte restait,
  le tableau de bord annonçait encore un document renouvelé.
- La suppression passe par le service d'alertes, seul autorisé par le garde-fou `alerts-write-hygiene`.

**Preuve**
- Contrat `document-quick-renew-alerts` 2/2 (DOC3, P4) et `document-renewal-status` 1/1,
  unitaire 848/848, `tsc` 0 erreur.

**Reste**
- DOC1 (différé) ; FUEL3 à cadrer.

## Relecture PR #64 - délimitation des préfixes, invalidation en double

**Quoi**
- Unitaire `document-expiry-rule` : les préfixes de levée du document 1 ne couvrent pas les clés des documents 10 et 12.
- `useRealTimeSync.ts` : bloc d'invalidation DOC3 retiré, le même `case` invalide déjà les quatre clés d'alertes.

**Pourquoi**
- Relecture : aucun test ne cassait si le `:` final du préfixe disparaissait (le contrat utilise des ids consécutifs).

**Preuve**
- Unitaire 10/10 sur le fichier, `tsc` 0 erreur.

## ADM1, ADM3 - comptes : écriture réservée à l'admin, suppression qui coupe l'accès

**Quoi**
- Contrat `users-admin-soft-delete` (9 cas) : 403 non-admin et 401 anonyme sur POST/PATCH/DELETE
  `/api/users`, auto-suppression refusée, 204 puis 404, ligne conservée, absent de `GET /api/users`.
- Correctif : la connexion refuse un compte `deletedAt` ; `authorize`, `isAdmin` et `GET /api/auth/me`
  aussi ; `DELETE /api/users/:id` et `PATCH /api/admin/users/:id/toggle` (désactivation) effacent les
  sessions du compte et ferment ses connexions temps réel (`server/lib/user-sessions.ts`).

**Pourquoi**
- Trois cas rouges sur main (écrits d'abord en `it.fails`) : un compte supprimé se reconnectait, et
  une session ouverte avant la suppression restait valide sur toutes les routes.

**Preuve**
- Contrat 16/16 (`users-admin-soft-delete`, `api-auth-sessions`, `auth-lockout-admin`), unitaire
  848/848, `tsc` 0 erreur.

## Piste B, lots B1 et B3 (partiel) - référentiels, statut véhicule, libellés de demande

**Quoi**
- CLI1, PRT1, SUP1, SUP2, CAT2 au contrat (`clients-crud`, `parts-catalog-crud`, `suppliers-crud-ratings`,
  `fault-catalog-lifecycle`), VEH4 en intégration (`vehicle-status-sync`), PRT5 en unitaire
  (`part-requirement-labels-hygiene`). Aide `tests/support/contract-actors.ts` (plusieurs comptes de rôles).

**Pourquoi**
- Plan `PLAN_COUVERTURE_MODULES.md` : ces cas étaient « à faire ». Les défauts trouvés sont figés en `it.fails`
  (le test devient rouge le jour du correctif, ce qui force à retirer `.fails`).

**Défauts figés (`it.fails`)**
- `POST /api/parts` : référence en doublon, 500 ; prix non numérique, 500 ; stock négatif accepté (201).
- `DELETE /api/parts/:id` : id inconnu ou second appel, 500 au lieu de 404.
- `POST /api/suppliers` : nom en doublon, 500 au lieu de 409.
- `POST /api/purchase-orders` : accepte un fournisseur désactivé.
- Le chef d'atelier est refusé sur tout `/api/suppliers` (montage `PROCUREMENT_ROLES`) : la règle de notation
  de `supplier-categories.ts` pour ce rôle est inatteignable.
- `PATCH /api/fault-catalog/:id` : id inconnu, 200 ; `validatedBy` forgeable par le corps et jamais renseigné par le serveur.
- Annulation du dernier OT ouvert : le véhicule reste en maintenance (`storage.ts`, mise à jour d'OT).

**Preuve**
- Contrat 74/74 (11 `it.fails`), intégration VEH4 8/8 (1 `it.fails`), unitaire 855/855, `tsc` 0 erreur.
- PRT5 rouge avec `issued: "Terminé"` ajouté à `requests.tsx` (restauré), vert sans.

**Limites**
- Variante, spécification, catégories de pièce et pièces associées d'un défaut : aucune route, non couvrables.
- VEH1, VEH3, MIS2 écrits mais jamais exécutés (consigne d'arrêt) : non livrés. MIS1, P2, ADM2, DRV2, WO1, WO7, T6, P5, P6 non commencés.

## Lot ADM5, ADM6, DRV1 - PIN chauffeur, journal d'activité des comptes, fiche chauffeur

**Quoi**
- `driver-pin-login` (ADM5, 7 cas) : bon PIN ouvre une session, mauvais PIN, compte supprimé, rôle
  autre que chauffeur, PIN absent et corps incomplet refusés sans cookie ; la liste PIN n'expose que
  `id` et `name`.
- `audit-sensitive-actions` (ADM6, 3 cas) : création, changement de rôle et suppression de compte
  écrivent une ligne `activity_logs` attribuée à l'admin, mot de passe masqué ; un 403 n'en écrit aucune.
- `drivers-crud-deactivation` (DRV1, 7 cas) : CRUD logistique, magasin refusé, désactivation réservée
  à l'admin ; un témoin (chauffeur actif affecté : 200) et trois `it.fails` (affectation, liste PIN,
  connexion PIN), mise en place en `beforeAll` pour qu'un échec de préparation ne passe pas pour le défaut.

**Pourquoi**
- Défauts constatés : un chauffeur désactivé reste affectable par `PATCH /api/missions/:id` (seul le CPC
  est vérifié, le refus n'arrive qu'au lancement) ; il reste sur l'écran PIN et s'y connecte, car
  `drivers-list` et `pin-login` lisent `users` seul. Correction à arbitrer, non faite ici.

**Preuve**
- Contrat 17/17 (dont les 3 `it.fails`) ; les cas rejoués en `it` échouent sur l'assertion finale
  (affectation 200 au lieu de 400, compte encore listé).

## VEH2 - véhicule supprimé : masqué, historique consultable, non assignable

**Quoi**
- Contrat `vehicle-soft-delete` (9 cas) : un véhicule supprimé (`deletedAt`) est masqué de la liste et de la
  recherche, ses OT et missions passés restent consultables ; `DELETE /api/vehicles/:id` refusé aux non-admin
  (403), id invalide 400, inconnu 404, véhicule sans historique supprimé et masqué.
- Témoin : un véhicule actif avec un chauffeur formé s'assigne à une mission (201).

**Pourquoi**
- Le plan donnait VEH2 « À faire ». La colonne `vehicles.deletedAt` existe et les listes la filtrent, mais
  aucune route ne la pose : la suppression est physique.

**Preuve**
- Trois défauts en `it.fails`, chacun rejoué en `it` pour vérifier le rouge (cf. PR) :
  1. `DELETE` d'un véhicule portant un OT : 500 (clé étrangère `work_orders_vehicle_id_vehicles_id_fk`),
     au lieu de 200 avec `deletedAt` posé (server/routes.ts:1222, vehicle-deletion-service-trigger.ts:43).
  2. `POST /api/work-orders` sur un véhicule supprimé : 201 (server/routes.ts:2130 ne contrôle que l'existence).
  3. `POST /api/missions` avec un véhicule supprimé : 201 (server/api/missions.routes.ts:1736 sans filtre `deletedAt`).
- Relecture : les `it.fails` ne contiennent plus que l'appel visé et l'assertion métier ; la mise en place
  (véhicule supprimé, OT historique) est dans un `beforeAll` : une erreur de préparation fait échouer le hook
  au lieu de rendre le cas vert. Rouge rejoué sans `.fails`, erreurs exactes : `expected 201 to be 400`
  (mission), `expected 201 to be greater than or equal to 400` (OT), `expected 500 to be 200` (DELETE).
  Contrat 9/9 verts.
- Garde-fou d'hygiène (`it-fails-hygiene`) : le DELETE de la route est joué dans le `beforeAll` (il
  faisait deux requêtes dans le `it.fails`), le cas assert son statut puis la lecture de l'OT. Rouge rejoué :
  `expected 500 to be 200`. Hygiène 7/7.
- `tsc` 0 erreur, unitaire 838/838, contrat 9/9 cas verts.

**Limites**
- `GET /api/vehicles/:id` renvoie encore un véhicule supprimé (`storage.getVehicle`, server/storage.ts:699) : non figé.

**Reste**
- Correctif produit (fleet-api / fleet-db) : suppression logique, puis passer les trois `it.fails` en `it`.

## Garde-fou d'hygiène : it.fails sans mise en place

**Quoi**
- `tests/unit/server/it-fails-hygiene.test.ts` (5 cas) : extrait les `it.fails` / `test.fail` de `tests/` et `e2e/`, signale ceux dont le corps crée des données ou fait plusieurs requêtes. Huit occurrences héritées de main sont gelées.

**Comment**
- Analyse de texte (commentaires retirés, chaînes respectées), sans base. Une fabrique dont le résultat est assertionné sur `.status` est l'appel visé et n'est pas signalée, pour éviter les faux positifs.

**Pourquoi**
- `it.fails` passe sur n'importe quel échec : cinq PR ont dû être recalées (#67, #68, #70, #71, #72).

**Preuve**
- `it.fails` fautif fabriqué : rouge ; propre : vert. Fichier fautif déposé sur disque : 1 failed, retiré : 5/5.

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

## 2026-11-01 - FUEL2, DIR2, DIR3 : statistiques carburant et export par période

**Quoi**
- `tests/contract/fuel-vehicle-stats.contract.test.ts` : `GET /api/fuel-card/vehicle/:id/stats` (totaux, prix au litre, station la plus fréquente, enregistrements sans débit ignorés, autres véhicules ignorés, zéros, 401/403/400).
- `tests/contract/fuel-export-period.contract.test.ts` : export XLSX carburant filtré par mois et par année, contenu des cellules relu avec `xlsx`, 403 client, 400 année absente ou mois 13.
- `tests/support/contract-session.ts` : ajout de `raw()` pour lire un fichier binaire.

**Pourquoi**
- Plan : FUEL2, DIR2, DIR3 étaient « à faire ».

**Défauts figés (`it.fails`)**
- Statistiques d'un véhicule inconnu : 500 avec message brut au lieu de 404 (`fuel-card-service.ts:457`, route `fuel-card.routes.ts`).
- Un plein saisi par `POST /api/fuel-records` n'apparaît pas dans l'export de son mois : l'export filtre sur `fuelRecords.year/month` (`excel-export-service.ts:125`), que seul l'import Excel renseigne.

**Preuve**
- Rejeu sans `.fails` : rouge sur `expected [] to have a length of 1` (export) et sur 500 attendu 404 (statistiques).
- Relecture : le plein de l'export (véhicule, POST et son 201) est créé dans un `beforeAll`, le `it.fails` ne garde que le téléchargement et l'assertion. La date est fixe (2026-06-15) : le mois filtré est celui de la date envoyée, sans dépendre du fuseau ni du jour. Rouge rejoué sans `.fails` : `expected [] to have a length of 1 but got +0`. Contrat 4/4 verts.

**Limites**
- Rapports inventaire et performance technicien, historique de consommation : non couverts. FUEL1 et DIR1 non repris.

**Reste**
- FUEL1, DIR1, puis lot A5.

## Piste B, lot B2 : VEH1, VEH3, MIS2 (contrat)

**Quoi**
- Trois fichiers de contrat exécutés pour la première fois : `vehicles-crud` (VEH1), `vehicle-acquisition-workflow` (VEH3), `mission-planning-conflict` (MIS2). Corrigés : délais de describe à 180 s, `notes` à la place d'une colonne `color` inexistante, `GET /api/vehicles/abc` attendu en 404 (valeur cherchée comme immatriculation).
- Défauts produit figés en `it.fails`, sans toucher au code produit :
  - statut initial consigné deux fois (`server/storage.ts:871` et `server/routes.ts:1090`) ;
  - `year` / `mileage` non numériques : 500 au lieu de 400 (`shared/schema.ts:154-155`) ;
  - `PATCH /api/vehicles/:id` : `createdBy` du corps réécrit l'auteur (`server/routes.ts:1195`) ;
  - `PATCH /api/vehicles/:id` : immatriculation déjà prise, 500 (`server/storage.ts:910`, `server/routes.ts:1204`) ;
  - `PATCH /api/workflows/vehicle-acquisition/:id` : `userId` du corps réaffecte le brouillon (`server/services/workflow-service.ts:88`) ;
  - lancement de mission refusé : motifs réduits à « Ce champ n'est pas valide. » (`server/api/missions.routes.ts:2366`).

**Pourquoi**
- Ces fichiers étaient écrits mais jamais exécutés : leur couverture n'était pas prouvée.

**Preuve**
- Rouge en `it` avant `it.fails` : 2 lignes d'historique au lieu d'1, `year`/`mileage` 500, `createdBy` et `userId` réécrits, immatriculation en double 500, motif absent. Vert ensuite : vehicles-crud 22/22, acquisition + mission 34/34 (run4). `tsc` 0 erreur, unitaire 845/845.

**Limites**
- Le 400 du lancement de mission ne prouve pas le conflit seul (la mission de test n'a pas de budget) : le conflit est prouvé par `launch-readiness`.
- Un e2e VEH3 (parcours écran) reste à faire.

**Reste**
- MIS1 et P2 (rejouer `e2e/05`), lots B3 et B4 non commencés.

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

## MNT1, MNT2, CAT1, WO6, P3 - maintenance préventive et catalogue main-d'oeuvre

**Quoi**
- Contrat `maintenance-schedules` (MNT1) : droits (401, 403), corps invalides 400, véhicule inconnu 404, création active
  qui génère l'OT préventif lié, plan inactif sans OT, PATCH, désactivation et réactivation, DELETE, cloison client.
- Contrat `labor-catalog` (CAT1) : lecture sur session, écriture réservée au chef d'atelier, code en majuscules, auteur
  tracé, doublon refusé, deux créations simultanées (201 + 400), poste inactif masqué et refusé sur un OT.
- Intégration `preventive-maintenance-triggers` (MNT2) : échéance véhicule dans la fenêtre de 30 jours (J+30 oui,
  J+31 non), OT unique au rejeu et véhicule en maintenance, seuil kilométrique, plan inactif, plans à venir.
- Support `tests/support/contract-session.ts` : serveur in-process et un compte connecté par rôle.
- WO6 : déjà couvert par `time-tracking` (contrat 5, intégration 3), passé OK au plan sans nouveau test.

**Pourquoi**
- Le plan donnait ces lignes « À faire ». Les défauts sont figés en `it.fails` plutôt que corrigés.

**Preuve**
- Quatre `it.fails`, rejoués en `it`, rouges sur l'assertion visée :
  1. MNT1 : `DELETE /api/maintenance-schedules/:id` d'un plan avec OT répond 204, le plan existe encore
     (server/routes.ts:1811, server/storage.ts:1192 avale l'erreur de clé étrangère).
  2. MNT2 : l'échéance `scheduledDate` d'un plan actif ne déclenche aucun OT, seules les dates du véhicule le font
     (server/services/preventive-maintenance-service.ts:112).
  3. MNT2 : un second passage à 20000 km crée un second OT en attente pour le même plan (le premier est joué en
     mise en place et laisse un seul OT), la garde compare au titre du plan
     alors que l'OT s'intitule « Maintenance préventive: <titre> » (preventive-maintenance-service.ts:310, :359).
  4. CAT1 : `PATCH /api/labor-catalog/:id` répond 404, aucune route de modification ni de désactivation
     (server/api/work-order-items.routes.ts).
- Relecture : chaque `it.fails` ne contient plus que l'appel visé et l'assertion métier, la mise en place (véhicule,
  plan, entrée de catalogue) est dans un `beforeAll` qui contrôle le 201. Rouge rejoué sans `.fails`, erreurs exactes :
  `expected [ { id } ] to have a length of +0 but got 1` (MNT1), `expected [] to have a length of 1 but got +0`
  (échéance de plan), `expected [ ... ] to have a length of 1 but got 2` (deux OT), `expected 404 to be 200` (CAT1).
- Contrat 16/16 cas verts, intégration 11/11, unitaire 838/838, `tsc` 0 erreur.

**Limites**
- `calculateNextDueDate` lève pour les fréquences quotidienne et hebdomadaire acceptées par le POST : non figé.
- Bord de mois et fuseau du pointage non testés : WO6 repassé de « OK » à « Partiel » au plan.
- Alerte, clôture de l'OT préventif et recalcul de l'échéance par date non couverts (P3).

**Reste**
- Correctifs produit (fleet-api) puis passage des quatre `it.fails` en `it`.

## 2026-11-01 - FUEL1 et DIR1 : carte carburant et KPI Direction

**Quoi**
- `tests/contract/fuel-card-routes.contract.test.ts` : recharge (401, 403 par rôle, 201 par rôle autorisé, solde + montant, prix déduit, 400 sur six corps invalides), consommation (201, solde - coût, 400 par champ manquant), historique filtré (type, véhicule, année/mois, liste vide), statistiques mensuelles, par client, anomalies, liste des pleins par véhicule, suppression (403, 400, 404, 204, second appel 404).
- `tests/contract/management-dashboard-kpis.contract.test.ts` : le tableau de bord Direction est lu avant et après une transition réelle par l'API (OT en cours puis terminé, OT annulé, véhicule opérationnel, maintenance, hors service, plein saisi puis supprimé, facture fournisseur) ; seules les différences sont vérifiées.

**Pourquoi**
- Plan : FUEL1 et DIR1 étaient « partiel ». Le solde de la carte est global : valeurs absolues impossibles sur base partagée.

**Défauts figés (`it.fails`, assertion métier seule, requêtes jouées dans `beforeAll` puis lignes supprimées)**
- `POST /api/fuel-card/recharge` avec une date illisible : 500 (année NaN), `server/api/fuel-card.routes.ts:56`.
- `POST /api/fuel-card/consumption` : quantité `"abc"` acceptée en 201 et débit NaN écrit ; quantité négative acceptée en 201 (`fuel-card.routes.ts`, `fuel-card-service.ts:217`). Un débit NaN rend `balance` null pour toute la carte et désactive le contrôle `cost > balance` (comparaison avec NaN toujours fausse) : constaté en premier run, base nettoyée ensuite.
- Véhicule inconnu : 500 au lieu de 404 (`fuel-card-service.ts:218`) ; solde insuffisant : 500 au lieu de 409 (`fuel-card-service.ts:226`, la route renvoie 500 pour toute erreur) et message brut renvoyé.
- `GET /api/fuel-records/vehicle/:id` ouvert à un client pour un véhicule qui n'est pas le sien (`server/routes.ts:3290`, `authenticate` seul).

**Preuve**
- Contrat 48/48 (fuel-card-routes + management-dashboard-kpis, 6 `it.fails`).
- Rejeu du bloc de défauts sans `.fails` : 6 rouges (`expected 500 to be 400`, `expected 201 to be 400` x2, `expected 500 to be 404`, `expected 500 to be 409`, `expected 200 to be 403`).

**Limites**
- T5 : `tests/integration/stock-audit-columns.test.ts` écrit mais jamais exécuté, non livré (retiré de la PR). T8, T1, T3, T4 non commencés.
- Double soumission d'une recharge : aucune règle d'idempotence définie, non testée.
- Facture fournisseur : seule la saisie est couverte, pas validation/approbation/paiement.

**Reste**
- T5 (fichier écrit à exécuter), T8, puis T1, T3, T4.

## 2026-11-01 - T5 : audit created_by / updated_by des pièces et pneus

**Quoi**
- `tests/integration/stock-audit-columns.test.ts` (9 tests) : création (created_by = updated_by = auteur), modification par un autre utilisateur (updated_by et updated_at changent, created_by et created_at non), ajustement de stock par un troisième (updated_by, mouvement d'entrée initial du créateur puis mouvement de l'ajustement), suppression logique d'un pneu, noms joints en lecture, pneu supprimé non modifiable.

**Pourquoi**
- AGENTS.md §5 : quatre champs d'audit obligatoires. Aucun test ne distinguait les auteurs.

**Preuve**
- Premier run : 1 rouge, erreur de mon attendu (le service écrit aussi un mouvement initial à la création : `[4200, 4202]`), attendu corrigé. Puis 9/9 deux fois de suite (idempotence). Pas de défaut produit trouvé, donc pas d'`it.fails` ni de rouge à prouver.

**Limites**
- Niveau service seulement : le contrat HTTP (corps client ignorant created_by) n'est pas couvert.

**Reste**
- T8 (pagination, filtres, recherche), T1, T3, T4.

## 2026-11-01 - FUEL1 : filet de ménage des sondes (réserves de relecture #74)

**Quoi** : `probe()` enregistre l'id avant la suppression ; `afterAll` balaie `fuel_records` daté de 2031.
**Pourquoi** : un débit NaN resté en base fausse le solde global de la carte pour tous les fichiers (voir LESSONS_LEARNED).
**Preuve** : fichier rejoué, 40/40 verts sur la base `tests-piste-a`.
**Reste** : T8.

## Piste B, lot B2 : reprise de relecture (PR #72)

**Quoi**
- Mise en place sortie de chaque `it.fails` : `beforeAll` (ou `describe` dédié avec un it témoin) dans `vehicles-crud`, `vehicle-acquisition-workflow` et `mission-planning-conflict`. Un `it.fails` ne contient plus que l'appel visé et l'assertion métier ; l'assertion redondante `status === "assigned"` du lancement est retirée.
- Corrections de titres : détail `/api/vehicles/abc` (404, cherché comme immatriculation, `server/routes.ts:1052-1060`), PATCH qui modifie `notes`, « lancement refusé, statut inchangé ». Un doublon d'immatriculation qui passerait en 201 est ajouté à `ids.vehicleIds` pour le ménage.
- Correction du décompte des défauts produit : VEH1 4 (5 `it.fails`), VEH3 **5** (et non 1), MIS2 1, soit 10 (la mention « six défauts » du journal du lot B2 est à lire ainsi). Les quatre défauts VEH3 non documentés le sont désormais (commentaire DEFAUT PRODUIT, cause, fichier:ligne) :
  - `POST` sans validation (`server/routes.ts:5654`) : corps vide et `currentStep: "abc"` donnent 500 (`server/services/workflow-service.ts:36-42`) ;
  - `PATCH` d'une session inconnue : 200 et corps `null` (`workflow-service.ts:100`, `routes.ts:5710-5711`) ;
  - `PATCH` : `status` du corps étalé dans le `set` (`workflow-service.ts:88`), comme `userId`.

**Pourquoi**
- Un `it.fails` qui crée sa donnée passe au vert si la création échoue : il ne prouve plus le défaut. Garde-fou de la PR #73 (`it-fails-hygiene`).

**Preuve**
- Rouge sans `.fails` (log `b2r-rouge.log`, copies temporaires supprimées) : 11 échecs, tous sur l'assertion métier : 2 lignes d'historique au lieu d'1 ; 500 au lieu de 400 (année, kilométrage, corps vide, étape) ; PATCH immatriculation prise 500 ; `createdBy` et `userId` réécrits (id différent) ; PATCH inconnu 200 au lieu de 404 ; statut `completed` au lieu de `in_progress` ; motif « Conflit planning » absent.
- Vert avec `.fails` : trois fichiers ensemble, 58/58 (`b2r-vert.log`). `tsc` (tsconfig temporaire incluant les trois tests) : 0 erreur. `it-fails-hygiene` : 7/7, liste gelée inchangée.

**Reste**
- Défauts produit à corriger par fleet-api / fleet-db. e2e VEH3 non fait.

## Piste B, lot B2 : correctifs de contre-relecture (PR #72)

**Quoi**
- `vehicles-crud` : le premier POST du doublon d'immatriculation est vérifié (201) avant le second ; les POST de création refusée, sans session et de corps invalide passent par un helper qui enregistre tout 201 inattendu dans `ids.vehicleIds`, pour le ménage.
- Références produit recalées dans les commentaires DEFAUT PRODUIT (elles corrigent l'entrée précédente) : `server/routes.ts:1090` devient 1092-1093, `:1195` devient 1193, `:1204` devient 1201.

**Preuve**
- `vehicles-crud` rejoué sous verrou et test d'hygiène `it-fails-hygiene` : résultats dans le compte rendu de la PR.

## Lot MIS1 + P2 - Mission, facture, paiement au navigateur

**Quoi**
- `e2e/13-mission-invoice-payment.spec.ts` : la logistique crée une mission (API), la facture depuis
  l'écran mission (HT 100 000, TTC 119 250), la secrétaire encaisse en deux fois ; facture soldée, bouton
  de paiement absent, bouton désactivé pour la logistique. Vérité lue en base ; mission, facture, comptes
  et client supprimés en fin de spec.

**Comment**
- Comptes créés par `createE2EUser`, serveur et runner sur `DATABASE_URL_TEST` (branche tests-piste-b),
  sous verrou, Edge (`E2E_CHANNEL=msedge`).

**Pourquoi**
- `05-mission-billing-payment` lisait la première facture trouvée et skippait sur base vide.

**Preuve**
- Spec 13 : 1/1 vert (2,5 min). Pas de défaut produit visé : pas de rouge avant, le test est une
  couverture de parcours.

**Limites**
- Mission posée à « livrée » en base : affectation, étapes et lancement non rejoués (documents du
  véhicule et CPC requis).

## Lot B3 - Temps réel OT entre chef d'atelier et technicien (WO1, WO7, T6)

**Quoi**
- `e2e/14-realtime-work-order-roles.spec.ts` : trois comptes créés par la spec (chef d'atelier, deux
  techniciens). Le chef crée un OT affecté au technicien : trame `work_order_created` reçue par le
  technicien et alerte d'affectation lisible par `/api/alerts`. Un autre technicien est refusé (403) ;
  le technicien affecté démarre l'OT : trame `work_order_updated` reçue par le chef, statut en base.
  OT, véhicule et comptes supprimés en fin de spec.

**Comment**
- Trames lues sur `/ws` de chaque session (`page.on("websocket")`) après `auth_success`, jamais l'écran :
  le polling de 7 s ne peut pas produire une trame.

**Pourquoi**
- La spec 06 dépend de comptes déjà en base et ne couvre que la création, dans un seul sens.

**Preuve**
- Vert 1/1 (2,9 min). Rouge : diffusion du démarrage renommée (`technician-work-orders.routes.ts`,
  `work_order_updated` -> `wo_changed`, code rétabli) : échec « trame work_order_updated non reçue par le
  chef d'atelier », 1 failed.

**Limites**
- ADM2 (changement de rôle), DRV2 (déclaration de panne du chauffeur) et l'invalidation des KPI à
  l'écran ne sont pas couverts : budget de tours épuisé. Aucun défaut produit constaté.


## T8 : pagination, filtres et recherche des listes principales

**Quoi**
- `tests/contract/lists-pagination-filters.contract.test.ts` (55 cas, 17 `it.fails`) : véhicules, ordres de travail, pièces, fournisseurs. Pages de 2 sans doublon ni trou avec total cohérent, tri explicite ascendant puis descendant, filtres statut / priorité / `isActive` / catégorie, véhicule supprimé exclu, liste vide, bornes (`limit` et `offset` non numériques, négatifs, démesurés), apostrophe littérale, injection classique, ordres de travail d'un client limités à ses véhicules.

**Comment**
- Lignes créées par le test et repérées par un jeton unique dans le champ cherché ; nettoyage par id en `afterAll` (`finally`), ordres de travail supprimés avant les véhicules. Les `it.fails` ne contiennent que l'appel visé et l'assertion métier, la mise en place est en `beforeAll`.
- Missions (`GET /api/missions`) et documents (liste par véhicule) n'ont ni pagination ni filtre côté serveur : rien à tester au contrat.

**Pourquoi**
- Défauts constatés, non corrigés ici :
  - `%` et `_` agissent comme jokers dans le `ILIKE` (véhicules `storage.ts:753`, ordres de travail `storage.ts:1333`, pièces `parts-service.ts:27`, fournisseurs `supplier-management-service.ts:36` et `:42`).
  - Véhicules : `offset` négatif ou `limit` démesuré font échouer le SQL, `getVehicles` avale l'erreur (`storage.ts:844`) et la route répond 200 `{ vehicles: [], total: 0 }` (`routes.ts:963`).
  - Pièces : `offset` négatif ou `limit` démesuré répondent 500 (`routes.ts:2604`, page non bornée) ; un octet nul dans la recherche répond 500, comme sur les fournisseurs.
  - Fournisseurs : `isActive=maybe` est lu comme `false` (`suppliers.routes.ts:173`).
  - `GET /api/vehicles` ne filtre pas sur `ownerScopeOf` : un client voit les véhicules des autres (`routes.ts:958`, AGENTS.md §11).
  - Observé sans test figé : véhicules, `limit` non numérique ou négatif renvoie tous les véhicules, sans plafond.

**Preuve**
- Contrat 55/55 (17 `it.fails`) ; les 17 rejoués en `it` : 17 rouges, 38 verts. Hygiène `it-fails-hygiene` 7/7, liste gelée inchangée. `tsc --noEmit` global : 0 erreur ; fichier de test vérifié par un tsconfig temporaire : 0 erreur.


## Piste C, étape 1 : garde-fou e2e contre la production

**Quoi**
- `e2e/helpers/production-guard.ts` et son appel en tête de `playwright.config.ts` : Playwright refuse de démarrer quand la base visée est la production (hôte contenant l'endpoint Neon de production, ou un marqueur de `E2E_PRODUCTION_DB_MARKERS`). Message actionnable, sans URL ni mot de passe.
- `tests/unit/e2e/production-guard.test.ts` (10 cas) : extraction de l'hôte, pooler ou non, marqueur cherché dans l'hôte seulement, liste étendue par variable, repli sur le `.env`, priorité de la variable d'environnement, message sans secret, appel présent dans la config.

**Comment**
- Fonction pure, entrées injectables (`env`, lecture du `.env`) : testable sans base ni Playwright. La liste par défaut n'est qu'un plancher, la variable l'étend (RAIDER Agnostic).

**Pourquoi**
- Le `.env` racine pointe `DATABASE_URL` et `DATABASE_URL_TEST` sur la production ; les specs 07, 08, 10 à 14 créent et suppriment des lignes. Un oubli suffisait pour écrire en production.

**Preuve**
- Unitaire 10/10. `DATABASE_URL=<endpoint de production> node node_modules/@playwright/test/cli.js test --list` : échec immédiat avec le message du garde-fou (sans le garde-fou, la liste des specs s'affiche). Avec une branche de test : la config se charge.


## Piste C, étape 1 bis : le même refus pour les suites intégration et contrat

**Quoi**
- `assertTestDatabaseNotProduction` (dans `e2e/helpers/production-guard.ts`), appelée par `tests/support/setup-db.ts` avant la redirection de `DATABASE_URL` vers `DATABASE_URL_TEST` : les suites vitest d'intégration et de contrat refusent de démarrer quand l'URL effective vise la production. 4 cas unitaires ajoutés (refus sans URL dans le message, branche de test acceptée, variable de marqueurs, appel présent avant la redirection). `tests/README.md` corrigé : `DATABASE_URL_TEST` ne doit plus être « la même URL ».

**Comment**
- Réutilise la détection de l'étape 1 (hôte seulement, jamais le chemin ni les identifiants), message sans secret.

**Pourquoi**
- Le `.env` racine pointe `DATABASE_URL_TEST` sur la production : un `npm run test:contract` ordinaire y écrivait.

**Preuve**
- Unitaire 14/14. Contrat lancé avec `DATABASE_URL_TEST` sur l'endpoint de production (valeur factice, aucune connexion tentée) : échec immédiat au chargement du setup, message du garde-fou. Sans le garde-fou, le même lancement ouvre la connexion et initialise la base. Avec la branche de test : les contrats tournent.


## Piste C, étape 1 ter : nettoyage global des missions d'un compte de test

**Quoi**
- `tests/support/cleanup.ts` supprime aussi les missions (et leurs factures client) créées par un compte de test orphelin avant de supprimer le compte.

**Pourquoi**
- Sur la branche de test, le hook global `afterAll` échouait (`missions_created_by_users_id_fk`) et marquait en échec la suite de chaque fichier de contrat, tests verts compris.

**Preuve**
- Avant : 3 suites en échec au hook, 10 tests verts. Après : plus d'échec de hook.

## Piste C, étape 2 : cloison client sur les lectures de véhicule, deux clients et le personnel

**Quoi**
- `tests/contract/vehicles-two-clients-isolation.contract.test.ts` (7 cas) : `GET /api/vehicles` (chacun ne voit que le sien, total 1, recherche de l'immatriculation d'autrui = 0, personnel voit tout), `GET /api/vehicles/all`, `GET /api/vehicles/:id` par id et par immatriculation (sien 200, autre client 403 sans fuite de l'immatriculation, personnel 200, sans session 401), véhicule sans propriétaire refusé aux clients, inconnu 404 (jamais 500).

**Comment**
- Trois comptes réels (admin, client A, client B), trois véhicules, `createApp` en mémoire ; nettoyage des lignes créées.

**Pourquoi**
- Le plan T8 notait que `GET /api/vehicles` ne filtrait pas sur le propriétaire ; #80 l'a corrigé. Il manquait un test à deux clients qui garde la cloison.

**Preuve**
- Vert 7/7 sur la branche de test. Rouge sur la version fautive : en neutralisant le refus du détail (`server/routes.ts:1076`, condition remplacée par `false`), 3 des 7 cas échouent (par id, sans propriétaire, par immatriculation). Aucun défaut produit constaté, donc aucun `it.fails`.


## Piste C, étape 3 : parcours P5 (pneu) et P6 (stock bas vers réapprovisionnement)

**Quoi**
- `tests/contract/p5-tire-lifecycle.contract.test.ts` : un pneu de bout en bout (entrée en stock par le magasinier, montage neuf, suppression refusée tant que monté, inspection par le technicien, rotation, démontage vers le stock, remontage explicite de l'usagé et refus du remontage implicite, rebut, suppression refusée au magasinier puis acceptée à l'admin, historique de 2 montages et 1 inspection conservé), stock vérifié en base à chaque étape.
- `tests/contract/p6-low-stock-to-restock.contract.test.ts` (3 cas) : sortie sous le seuil, alerte avec manque, commande du brouillon à confirmée (alerte inchangée), réception par le magasinier (+10, une entrée de stock à son nom), alerte levée, demande reçue, réception rejouée sans crédit ; réception refusée au technicien ; réception partielle qui laisse l'alerte.
- Plan : P5 et P6 passent à « Contrat OK ».

**Comment**
- Deux erreurs de mes hypothèses corrigées au premier passage : la position de pneu `rear_left` n'existe pas (le 400 attendu en 409 était un faux positif de validation) et rejouer `delivered` répond 200 sans créditer (comportement idempotent, vérifié par le stock).

**Pourquoi**
- Les maillons étaient testés isolément ; rien ne prouvait la chaîne ni la justesse du stock d'une étape à l'autre.

**Preuve**
- P5 vert 1/1, P6 vert 3/3, deux passages de suite (idempotence). Rouge sur la version fautive : P5 avec le crédit de l'usagé au démontage neutralisé (`tires-service-simplified.ts:512`, `+ 1` en `+ 0`) ; P6 avec le crédit de réception neutralisé (`procurement-service.ts:238`) : 2 des 3 cas échouent. Une première mutation sur `part-requirements-service.ts:430` laissait P6 vert : ce n'est pas le chemin de réception d'une commande, le test ne prétend pas le couvrir.

## Bilan après les correctifs #76 à #80

**Quoi**
- `PLAN_COUVERTURE_MODULES.md` : 16 lignes mises à jour. Passent OK : T8, VEH1, VEH2, VEH4, MNT1, MNT2, CAT1, PRT5, SUP1, SUP2, DRV1, FUEL1, FUEL2, MIS2 (déjà OK, mention du défaut retirée). Restent partiels avec défauts levés : PRT1 (variante et spécification sans route), DIR3 (exports hors carburant).
- `couverture-tests.html` versionnée : bilan 52 testés, 16 partiels, 3 non testés (ADM2, DRV2, P5), 2 à construire (DOC1, FUEL3), sur 73.

**Comment**
- Statuts déduits des `it.fails` retirés par commit (`git show <pr> -- tests`) : plus aucun `it.fails(` sous `tests/` ni `e2e/` sur `main` (67b1588), seul le garde-fou `it-fails-hygiene` cite le mot.
- PRT5 était couvert depuis #65 (`part-requirement-labels-hygiene`) sans que le plan soit mis à jour.

**Pourquoi**
- Le plan disait encore « Partiel, `it.fails` » pour des défauts corrigés : le bilan sous-estimait la couverture de 14 éléments.

**Preuve**
- Décompte du tableau `mods` de la page : `{ OK: 52, P: 16, F: 3, X: 2 }`. Preuves d'exécution des tests convertis : celles des PR #76 à #80 (unitaires 869/869, contrats rejoués, logs `scratchpad/logs/final80-*.log`).

## Piste C, relecture : garde-fou e2e sans contournement

**Quoi**
- `playwright.config.ts` : `reuseExistingServer: false`. Un serveur déjà lancé sur le port (donc potentiellement sur la production) n'est plus réutilisé.
- `e2e/helpers/production-guard.ts` : `hostOf` renvoyait `""` pour une URL sans `user@`, ce qui laissait passer la production. L'autorité entière est maintenant l'hôte.
- `e2e/README.md` : phrase sur le refus précisée (base visée par la session), limite `E2E_BASE_URL` détaillée.
- Fusion de `docs/couverture-apres-correctifs` (#81) : ligne T8 du plan reprise de #81, entrées de journal conservées toutes deux, ligne vide ajoutée avant l'étape 2.

**Comment**
- `tests/unit/e2e/production-guard.test.ts` : URL de production sans identifiants (hôte, marqueur, refus) et verrou sur `reuseExistingServer`.

**Pourquoi**
- Le garde-fou ne voit que la `DATABASE_URL` de la session : réutiliser un serveur existant le contournait. Une URL sans identifiants est valide pour `pg`.

**Preuve**
- Rouge sur le code d'avant (les deux fichiers sources restaurés) : 2 échecs sur 16. Vert après : 16/16.


## Piste D, étape 1 : cliquets T1, T3, T4 sur les routes d'écriture

**Quoi**
- `tests/unit/server/write-routes-ratchet.test.ts` (12 cas, sans base) : analyse statique de toutes les routes POST/PUT/PATCH/DELETE de `server/routes.ts` et `server/api/*.routes.ts` (138 routes après dédoublonnage, Express servant la première déclaration). Trois cliquets : T1 garde de rôle (23 routes gelées), T3 validation du corps (32 sur 88 qui lisent `req.body`), T4 protection des champs serveur (32).
- `tests/unit/server/support/write-routes-scan.ts` (détection, préfixe de montage par routeur, y compris les routeurs multiples de `work-order-items.routes.ts`) et `support/write-routes-frozen.ts` (les trois listes).
- Plan : T1, T3, T4 passent à « OK avec cliquet ».

**Comment**
- Même principe que `vehicle-routes-guard` et `routes-hygiene` : liste gelée, échec dans les deux sens (nouvelle route non conforme, ou entrée gelée devenue conforme). Le message nomme la route et dit quoi faire.
- Ne sont pas des gardes de rôle : `authenticate`, `isAnyUser`, `requireFeature`, `requireAuth`, `checkAuth`, téléversement. Garde au montage (`apiRouter.use("/x", isStaff, ...)`) comptée.
- Limite : texte seulement. Un handler passé par référence n'est pas lu pour T3/T4 ; un contrôle fait dans une fonction appelée n'est pas vu (la route reste gelée). Premier passage : le téléversement `upload.single` était pris pour une garde (regex corrompue), la route `post /api/workflows/:sessionId/documents` a été révélée par le test lui-même puis gelée.

**Pourquoi**
- T1, T3 et T4 n'ont pas de fin naturelle (« toute route ») : un cliquet fige l'existant et interdit la régression, au lieu d'un test par route.

**Preuve**
- Rouge : route factice `app.post("/api/zz-fake", authenticate, ... values(req.body))` ajoutée temporairement à `server/routes.ts` : 3 cas échouent (T1, T3, T4) en nommant `post /api/zz-fake`. Entrée gelée inexistante ajoutée : le cas T1 échoue (« la liste ne peut que rétrécir »). Retirés : 12/12 vert.
- `tsc` global : 0 erreur. `npm test` : 82 fichiers, 895 tests verts (avant : 81 fichiers, 883).
- À examiner par fleet-api (non corrigé ici) : `server/routes.ts:5178` `post /api/test-date-maintenance` (route de test accessible à tout compte connecté) ; `server/api/document-renewals.routes.ts:861` `post /quick-renew` sans garde de rôle.


## Piste D, étape 2 : WO6, bord de mois, d'année et fuseau des pointages

**Quoi**
- `tests/integration/time-tracking-month-boundary.test.ts` (10 cas) : 31 mars / 1er avril, 31 décembre / 1er janvier (l'année change avec le mois), 29 février bissextile, rejeu du dernier jour du mois sans doublon, et le jour saisi relu à l'identique sous TZ = Kiritimati (+14), Pago Pago (-11), Los Angeles, UTC. Année 2033, aucune autre suite n'y écrit. Nettoyage des lignes et du compte créés.
- 2 `it.fails` (défaut produit) : 30 février et 29 février 2033 ne sont pas refusés en 400.
- Plan : WO6 mis à jour.

**Comment**
- Branche Neon `tests-piste-c`, sous `db-lock`. `month` et `year` sont tirés de la chaîne reçue (`time-tracking-service.ts:28`), jamais d'un `Date` : le fuseau du processus est sans effet, le test le fige.

**Pourquoi**
- WO6 notait « bord de mois et fuseau non testés ».

**Preuve**
- 13/13 verts avec les 3 cas existants (premier essai : délai de 10 s des hooks dépassé sur la branche froide, relancé avec 60 s). Les 2 `it.fails` passent donc la date impossible lève une erreur qui n'est pas un 400. Pas de rouge sur la version fautive pour les cas de bord : il n'y a pas de défaut de bord, ce sont des garde-fous de comportement correct. Second passage (idempotence) non rejoué faute de tours : nettoyage en `afterAll`.
- Défaut : `shared/contracts/common.ts:12` (`isoDateSchema` ne vérifie que la forme) puis `server/services/time-tracking-service.ts:27` (`::date` en SQL) : erreur de base au lieu de 400. Correctif à fleet-api.

## Piste D, relecture : les cliquets jugent la route réellement servie

**Quoi**
- `write-routes-scan.ts` (`allWriteRoutes`) lisait `routes.ts` d'abord. Or `server/app.ts` monte `apiRouter` avant `registerRoutes` : Express sert la version de `server/api`. Les routeurs sont maintenant lus dans l'ordre de montage de `server/api/index.ts` (`mountOrder`), `routes.ts` en dernier.
- Un garde qui rend la main par `next()` sans répondre (`admin-users-guard.routes.ts`) ne masque plus la vraie route : il est écarté (`isPassThrough`) et ses middlewares (`isAdmin`) sont prêtés à la déclaration servie.
- Listes gelées : T1 perd `post /api/fuel-card/consumption` ; T3 et T4 perdent `post /api/workflows/vehicle-acquisition` et `patch /api/workflows/vehicle-acquisition/:sessionId`. Aucune entrée ajoutée : aucune route servie non gardée n'est apparue.
- Non fait : les clés issues de gabarits (`relative(alertPath(":id"))`) restent telles quelles ; les résoudre demande de lire les constantes de chemin, pas simple.

**Comment**
- `tests/unit/server/write-routes-ratchet.test.ts` : l'ordre `app.use("/api", apiRouter)` avant `registerRoutes`, la version servie de `fuel-card/consumption` vient de `api/fuel-card.routes.ts` et est gardée, ordre de montage, garde `next()` (détection et prêt de middlewares).

**Pourquoi**
- Les cliquets jugeaient la version morte de routes dupliquées : une route servie gardée figurait comme non gardée, et inversement une route non gardée pouvait échapper.

**Preuve**
- Rouge avec `routes.ts` remis en premier : 4 échecs (ordre, T1, T3, T4). Vert avec l'ordre corrigé : 15/15.

## Piste E : DIR2 et DIR3, rapports par période et contenu des exports

**Quoi**
- `tests/contract/reports-inventory-period.contract.test.ts` (5 cas + 3 `it.fails`) : fenêtre mai 2019, mouvements avant, aux deux bornes et 1 ms après ; sortie comptée en valeur absolue ; statistiques cohérentes avec les lignes ; fenêtre vide ; début après fin ; 401.
- `tests/contract/reports-technician-period.contract.test.ts` (5 cas + 3 `it.fails`) : fenêtre juin 2019, deux techniciens créés, OT aux bornes et hors fenêtre ; totaux, taux arrondi, totaux globaux, fenêtre vide (taux 0), fenêtre étroite.
- `tests/contract/exports-inventory-content.contract.test.ts` (4 cas) : cellules exactes de l'export inventaire (alerte OUI/NON, valeur = stock réel x prix, N/A) et ligne TOTAL.
- `tests/contract/exports-invoices-content.contract.test.ts` (6 cas) : factures fournisseurs (paiements = TTC - solde, IMPAYÉ/PAYÉ, date fr-FR) et clients (échéance, filtre par client sans fuite d'un autre client, nom inconnu, nom trop long en 400).
- Plan : DIR2 fait en C, DIR3 élargi.

**Comment**
- Branche Neon `tests-piste-c`, sous `db-lock`. Données au jeton `TEST-`, fenêtres de dates propres (2019) pour que les totaux ne dépendent pas des autres suites, nettoyage en `afterAll` (mouvements, OT, pièces, comptes). Les `it.fails` ne contiennent que l'appel visé.

**Pourquoi**
- DIR2 ne couvrait que le carburant ; DIR3 notait « contenu des autres exports non vérifié ».

**Preuve**
- Vert : 26/26 (4 fichiers). Rouge par mutation temporaire, puis restaurée : `<=` en `<` sur la borne haute du rapport inventaire (`server/routes.ts`), borne haute des OT décalée de 1 ms (`reports-service.ts`), valeur du stock calculée sur `quantity` au lieu de `realStock` et Paiements = solde (`excel-export-service.ts`) : les 4 fichiers passent au rouge. Après restauration, `git diff server` vide, vert de nouveau (second passage).
- Défauts (it.fails, correctif à fleet-api) : `server/routes.ts:2840` et `:2894` `authenticate` seul, client et chauffeur lisent stock, prix, charge des techniciens alors que l'écran les masque (`reports/index.tsx:524`) ; `server/routes.ts:2842` date invalide : 200 vide ; `:2896` : date invalide, pas de 400.
- Observation, sans test : l'export inventaire valorise au stock réel, le rapport inventaire à la quantité théorique : deux valeurs du stock pour une même pièce.

## Piste E, relecture : décompte du rapport inventaire

**Quoi**
- Entrée « Piste E » : `reports-inventory-period` compte 5 cas + 3 `it.fails`, pas 6 + 3.

**Comment**
- Décompte des `it(` et `it.fails(` du fichier (5 et 3) ; le total 26/26 sur les quatre fichiers est cohérent avec 8 + 8 + 6 + 4.

**Pourquoi**
- Un chiffre faux dans le journal affaiblit les autres.

**Preuve**
- `grep -c` sur le fichier de contrat : 5 `it(`, 3 `it.fails(`.


## Piste F : T6, WO1, WO7, écrans satellites des transitions d'OT

**Quoi**
- `e2e/15-realtime-work-order-satellites.spec.ts` : (1) chef d'atelier et technicien créés par la spec ; création, démarrage, fin (technicien), correction (chef), refus création/suppression au technicien (403), suppression (chef). Chaque étape : trame WebSocket chez l'autre rôle ET refetch de `/api/work-orders/statistics` (et de la liste) observé (requêtes horodatées de la page) chez le chef, en moins de 5 s. (2) WO7 : `test.fail` « le chef reçoit l'alerte Intervention démarrée » avec témoin.

**Comment**
- Le tableau de bord du chef n'a pas de polling (`refetchInterval: false`, staleTime 5 min) : un refetch ne peut venir que de l'invalidation. Serveur local port 5072 et Playwright sur la branche Neon `tests-piste-c` (URL en variable d'environnement), sous `db-lock`. Mise en place du `test.fail` en `beforeAll`, le corps ne contient que la lecture des alertes.

**Pourquoi**
- T6 notait « invalidation KPI non vérifiée », WO7 « pas d'alerte nominative vers le chef ».

**Preuve**
- Vert : 3/3 en deux passages consécutifs (rouge reconfirmé après passage des attentes de refetch en requêtes horodatées, un premier essai avait échoué sur une création lente de la base distante). Rouge : retrait temporaire de l'invalidation `/api/work-orders/statistics` dans `work_order_updated` (`useRealTimeSync.ts`) : échec à l'attente du refetch après le démarrage (spec ligne 132) ; mutation annulée, `git diff client` vide.
- Défaut (test.fail, correctif à fleet-api) : `server/api/technician-work-orders.routes.ts:96` diffuse `work_order_updated` mais n'appelle pas `alertService.notifyWorkOrderProgress` (seul `server/routes.ts:2321` le fait) : pas d'alerte pour le chef quand le technicien démarre depuis son écran.
- Non couvert : MIS1/P2 (affectation, étapes, lancement de mission au navigateur) faute de tours.

## Piste F, relecture : témoin du chef et refetch borné par la trame

**Quoi**
- Gabarit non rempli `:"+L+"` remplacé par `:96` (`technician-work-orders.routes.ts`).
- `e2e/15` : le témoin WO7 vérifie maintenant la trame `work_order_updated` de l'OT chez le chef ; les étapes création, démarrage, fin et suppression attendent la trame de CETTE transition (statut et identifiant dans la trame), puis n'acceptent qu'un refetch postérieur à son arrivée (marge 250 ms).

**Comment**
- `observe` renvoie aussi `frameLog` (trames horodatées) ; `frameArrival` renvoie l'instant d'arrivée.

**Pourquoi**
- Un refetch tardif d'une étape précédente pouvait satisfaire l'attente de la suivante ; le témoin ne vérifiait aucune trame.

**Preuve**
- `tsc` global : 0 erreur. Exécution e2e : voir l'entrée suivante.

## Piste F, relecture : exécution e2e non obtenue (correction de l'entrée précédente)

**Quoi**
- Les modifications de `e2e/15` n'ont pas pu être rejouées : le port 5000 était occupé par le serveur d'un autre run (réutilisation interdite par le garde-fou). Un serveur lancé à part sur le port 5001 (branche de test, sous `db-lock`) a affiché une page blanche, donc aucune socket temps réel : les 3 tests échouent avant la première assertion modifiée (`observe`, attente `auth_success`).

**Pourquoi**
- Cause non élucidée (serveur de développement lancé hors `npm run dev`). Le correctif de la spec reste donc **non prouvé** ; `tsc` global est à 0 erreur. À rejouer : `E2E_CHANNEL=msedge` sur la branche Neon de test, port 5000 libre, sous `db-lock`.

## Bilan après la pile #81 à #86

**Quoi**
- `PLAN_COUVERTURE_MODULES.md` : T6, WO1, WO6, WO7, DIR2 passent OK (lignes encore en « Partiel » ou en `it.fails` après #86).
- `couverture-tests.html` : 62 testés, 7 partiels, 2 non testés (ADM2, DRV2), 2 à construire (DOC1, FUEL3), sur 73 ; PR #82 à #86 ajoutées, « Ce qui reste » et « Points ouverts » réécrits.

**Comment**
- Plus aucun `it.fails(` ni `test.fail(` sous `tests/` et `e2e/` sur `main` (hors le test d'hygiène qui les décrit).

**Preuve**
- Décompte du tableau `mods` de la page : `{ OK: 62, P: 7, F: 2, X: 2 }`.

## Réserve #86 : workflowId non entier sur le téléversement de document d'acquisition

- **Quoi** : `POST /api/workflows/:sessionId/documents` renvoyait 500 quand `workflowId` n'était pas un entier positif (`parseInt("abc")` = NaN passé à la requête SQL). Il renvoie désormais 400 « Identifiant de workflow invalide. », pour le personnel comme pour le client, sans rien écrire.
- **Comment** : validation `Number.isSafeInteger(n) && n > 0` avant la vérification d'appartenance et l'écriture (`server/routes.ts`). Cas ajouté dans `tests/contract/role-guards-pistes-def.contract.test.ts` (`abc`, `1.5`, `-3`, `0`, admin et client) : rouge prouvé sur l'ancien code (500), 16/16 vert après.
- **Pourquoi** : règle AGENTS.md §10, une entrée invalide donne un 400 lisible, jamais une erreur SQL en 500.

## VEH3 : e2e acquisition de véhicule

- **Quoi** : `e2e/16-vehicle-acquisition-resume.spec.ts`, 5 tests : reprise de l'étape en cours depuis le bandeau « Workflows en cours » puis après rechargement (état venu du serveur) ; documents obligatoires refusés tant qu'il en manque, puis téléversés et vérifiés en base ; fin `completed` (véhicule créé) ; fin `abandoned` (brouillon retiré du bandeau et de la reprise). Résultat sur la base de test tests-piste-c : **5 passed (6,1 min)**, Edge (`E2E_CHANNEL=msedge`).
- **Défauts produit figés** (non corrigés ici) :
  - VEH3-UI-1 : aucun écran ne propose d'abandonner un brouillon. Le bouton n'existe que dans le mode complet de `WorkflowReminders`, or le seul montage est compact (`client/src/pages/vehicles/index.tsx:119`) ; le wizard ne fait jamais appel à `abandonWorkflow` (`client/src/pages/workflows/vehicle-acquisition.tsx:102`). Test en `test.fail`.
  - VEH3-UI-2 : après l'activation, l'enregistrement différé de 500 ms (`client/src/hooks/use-workflow-persistence.ts:171`) part après `completeWorkflow()` ; le PATCH tombe en 404 et le repli POST recrée un brouillon `in_progress` de même sessionId : l'acquisition terminée réapparaît dans « Workflows en cours ». Comportement actuel asserté, avec la consigne de bascule une fois corrigé.
- **Comment** : chaque test crée son propre compte et ses données préfixées `E2E-VEH3` ; nettoyage par sacs d'identifiants, aucun nettoyage global (base partagée).
- **Pourquoi** : le contrat ne voit pas VEH3-UI-2 (il n'envoie pas l'enregistrement tardif du navigateur) ; seul le parcours écran le révèle.
- **Piège** : le port 5000 du poste est pris par Docker Desktop. Lancer le serveur sur un autre port (`PORT=5055`), puis `E2E_BASE_URL=http://127.0.0.1:5055 node --env-file=.env node_modules/@playwright/test/cli.js test ...` (le `--env-file` est requis : la spec importe `server/db`).

## VEH3 : e2e acquisition de véhicule, résultat d'exécution

- **Quoi** : `e2e/16-vehicle-acquisition-resume.spec.ts` rejoué en entier : 5 passed (6,2 min), un worker, `E2E_CHANNEL=msedge`, serveur sur le port 5057, base Neon de test (`tests-piste-c`), sous `db-lock`. `tsc` global : 0 erreur.
- **Preuve rouge/vert** : VEH3-UI-2 était rouge à la première exécution (brouillon `in_progress` recréé après `completed`), puis figé tel quel ; VEH3-UI-1 est un `test.fail` (passe tant que le bouton Abandonner n'existe pas, devient rouge dès qu'il est monté).
- **Piège** : un verrou `db-test.lock` périmé laissé par une exécution tuée bloque l'attente d'environ 17 min avant d'être repris ; la sortie reste vide pendant ce temps.

## Réserves de relecture de #86 : cloison, doublon de rôles, export stock

- **Quoi** :
  - Le téléversement `POST /api/workflows/:sessionId/documents` n'écrit plus sa requête d'appartenance : il passe par `canAccessOwned` (`server/lib/client-scope.ts`), avec `WorkflowDocumentService.getWorkflowOwnerId(workflowId, sessionId)`. Le message 403 est inchangé.
  - `DOCUMENT_RENEWAL_WRITER_ROLES` (`shared/constants/roles.ts`) devient la source unique de `isDocumentRenewalWriter` et de `CREATE_ROLES` dans `document-renewals.routes.ts`.
  - Colonne `realStock` de l'export stock : déjà absente de `excel-export-service.ts` (une seule colonne « Stock », lue sur `quantity`) et de `export-service.ts`. Rien à retirer ; le contrat DIR3 fige ce comportement en posant `realStock: 6` sans qu'il apparaisse. Les autres usages de `realStock` (alertes de stock, facturation TVA, écran entrepôt) ne passent pas par l'export.
- **Comment** : `npm run check` 0 erreur ; `npm test` 84 fichiers, 917 tests verts ; contrats `document-renewal-status`, `vehicle-acquisition-workflow`, `workflow-vehicle-acquisition`, `vehicle-documents-client-scope`, `lot-exports-roles`, `exports-inventory-content` : 232 verts sur la base `tests-piste-c`, sous `db-lock`.
- **Pourquoi** : une seule règle de cloison et une seule liste de rôles, pour qu'une correction ne soit pas faite à un seul endroit.
- **Complément après relecture** : `role-guards-pistes-def.contract.test.ts` (seul contrat du `POST /api/workflows/:sessionId/documents`) rejoué : 17 verts. Cas ajouté : un client qui envoie son propre `workflowId` avec le `sessionId` d'un autre est refusé (403, rien écrit), ce qui protège la clause `sessionId` de `getWorkflowOwnerId`. Liste en dur restantes, hors mission : `VIEW_ROLES` (`document-renewals.routes.ts`) et `isWorkflowDocumentWriter` (`auth.ts`).

## MIS1 / P2 : e2e cycle de vie d'une mission (2026-11-02 13:40)

- **Quoi** : `e2e/17-mission-lifecycle.spec.ts`, 5 tests. (1) Une logistique crée la mission (API, statut « planned » comme l'écran), l'affecte (véhicule + chauffeur par « Modifier »), la lance (dialogue de budgets), la livre, la clôture (déclaration sans plein, FDR 0) et génère la facture (HT 250 000, TTC 298 125) ; un administrateur sur un second navigateur reçoit les trames `mission_status_changed` (in_progress, delivered) puis `mission_completed` et son écran suit sans rechargement (la page mission n'a pas de `refetchInterval`). (2) Lancement refusé, message lisible et mission inchangée : assurance expirée, CPC révoqué après l'affectation. (3) Après régularisation du document, le même lancement aboutit. (4) Défaut figé en `test.fail`. Contrat `tests/contract/mission-assignment-eligibility.contract.test.ts` : POST refuse un véhicule en maintenance (vert), PATCH l'accepte (`it.fails`).
- **Défauts produit figés** (non corrigés ici) :
  - MIS1-UI-1 : `extractApiError` (`client/src/pages/missions/[id].tsx` ~l.131-141) lit `payload.details`, or `PUT /api/missions/:id/status` renvoie les motifs dans `message` + `errors` : `launchBlockedDocumentTypes` reste vide, « Créer demande de renouvellement » n'apparaît jamais sur un lancement bloqué par un document. Reste à corriger côté front.
  - MIS1-API-1 : `PATCH /api/missions/:id` (`server/api/missions.routes.ts`, bloc d'affectation, ~l.1861 et suivantes) ne passe pas par `getMissionEligibility` : un véhicule en maintenance (ou assurance échue) est affecté, alors que `POST` le refuse. Le lancement le rattrape plus tard. A corriger côté API.
  - Observation : une mission créée par l'API sans statut reste en « Brouillon » et l'écran n'offre aucune action pour la planifier ; seul l'écran de création envoie « planned ».
- **Comment** : données préfixées `E2E-MIS1-`, purgées à l'ouverture et à la fermeture (factures, affectations, missions, chauffeurs, puis sacs d'identifiants) ; crédit de carte carburant de test pour franchir la garde de solde. Serveur sur le port 5056 (5000 et 5055 pris), `E2E_CHANNEL=msedge`, sous `db-lock`.
- **Pourquoi** : MIS1 n'était couvert qu'à moitié (la spec 13 posait « livrée » en base) ; le lancement et ses gardes sont le point où le métier refuse.
- **Piège** : des `ETIMEDOUT` vers Neon depuis le runner (réseau) font échouer un run au hasard ; rejouer.

## 2026-11-02 15:24 — ADM2 et DRV2 : e2e changement de rôle et espace chauffeur

- **Quoi** : `e2e/18-admin-role-change.spec.ts` (8 tests) et `e2e/19-driver-space.spec.ts` (9 tests), dont un témoin par bloc de défauts. Run complet sur la base de test `tests-piste-c`, sous `db-lock`, Edge, un worker, port 5056 : **17 passed (17,3 min)**.
- **Vert** :
  - ADM2 : un admin passe un magasinier en technicien au navigateur ; après reconnexion, « Mes interventions » apparaît, « Inventaire des pièces » disparaît, `GET /api/purchase-orders` répond 403 et `GET /api/technician/work-orders/:selfId` 200.
  - ADM2, session ouverte avant le changement : les gardes de `server/middleware/auth.ts` (l.79, 106, 152) relisent le rôle en base à chaque requête, la session suit le nouveau rôle sans reconnexion.
  - DRV2 : chaque chauffeur voit sa mission sur son tableau de bord, pas celle de l'autre (`/api/drivers/me`).
- **Défauts figés** (`test.fail`, non corrigés ici) :
  - ADM2-1 : sur `/admin/users`, « Modifier » n'affiche que « bientôt » (`client/src/pages/admin/users.tsx:327`) ; le seul formulaire d'édition est sur `/users`, sans entrée de menu.
  - ADM2-2 : sur `/users`, changer le rôle sans retaper le mot de passe est refusé par le formulaire (`client/src/components/users/user-form.tsx:48` et `:75`, `partial` ne fait pas tomber `min(6)` sur une chaîne vide).
  - ADM2-3 : `server/api/purchase-orders.routes.ts:101` réécrit `req.user.role` depuis la session : un magasinier passé logistique garde sur sa session ouverte les suggestions de regroupement (l.201) et la réception des livraisons (l.367).
  - DRV2-1 : la déclaration de panne envoie `POST /api/alerts` (`client/src/pages/driver/dashboard.tsx:241`), réservé à `isWorkshopManager` (`server/routes.ts:4286`) : 403 et toast « Impossible d'envoyer le signalement ».
  - DRV2-2 : aucune voie ne crée d'OT à la panne ; `POST /api/incidents` est derrière le drapeau `incidents` désactivé (`shared/feature-flags.ts:34`) et ne crée pas d'OT (`server/services/incident-service.ts:135-151`).
  - DRV2-3 : `GET /api/missions`, `GET /api/missions/:id` (`server/api/missions.routes.ts:589`, `:692`) et `GET /api/drivers/:id/missions` (`drivers-management.routes.ts:164`) ne filtrent pas pour le rôle `driver` : un chauffeur lit les missions des autres (AGENTS.md §11).
- **Comment** : comptes et données préfixés `E2E-ADM2-` / `E2E-DRV2-`, supprimés en fin de spec et à l'ouverture si un run a planté. Mise en place hors des `test.fail` (garde `it-fails-hygiene`). Chaque défaut a été rejoué en `test` simple pour vérifier qu'il échoue sur l'assertion visée et non sur la mise en place. Un `test.fail` passe aussi quand son hook échoue (vu ici sur des coupures Neon, WebSocket 1006) : chaque bloc de défauts a donc un test ordinaire témoin qui partage ses hooks. DRV2-2 reconnaît la trame à son `vehicleId` (format des payloads `work_order_created`), pas à l'immatriculation.
- **Pourquoi** : ADM2 et DRV2 étaient « À faire ». DRV2 reste partiel : il n'existe pas de vue « missions du jour » (le tableau de bord n'affiche que la mission active), et la panne → OT n'existe pas encore côté produit.
- **Hors périmètre** : la boîte « Signaler un problème » affiche des emojis (`client/src/pages/driver/dashboard.tsx:103-106`), contraire à AGENTS.md §4.

## 2026-11-02 21:40 — ADM2, DRV2, MIS1 : défauts front corrigés, marqueurs retournés

- **Quoi** : correctifs front ADM2-1 (« Modifier » ouvre le formulaire sur `/admin/users`), ADM2-2 (mot de passe vide accepté en édition), DRV2-1/2 (panne envoyée sur `POST /api/driver/breakdowns`, véhicule requis), MIS1-UI-1 (motifs de refus lus dans `errors[]`, demande de renouvellement proposée). Tous les `test.fail` / `it.fails` correspondants deviennent des tests ordinaires : e2e 17:433, 18 (ADM2-1/2/3), 19 (DRV2-1/2/3), contrat `mission-assignment-eligibility`.
- **Preuves** : `npm run check` 0, `npm test` 932/932 ; contrat 3/3 ; e2e 17 5/5 ; e2e 18+19 16/17, le 17e (premier test de la spec 18, délai de 180 s) passé isolé en 3,4 min, délai porté à 300 s. Base de test ep-plain-lake, port 5058, sous `db-lock`.
- **Comment** : la purge de la spec 19 supprime désormais les `incidents` créés par la panne avant les véhicules (`incidents_vehicle_id_fkey`).
- **Pourquoi** : clore les défauts figés par #96 et #101 ; le serveur avait été corrigé par #102.
- **Pièges** : deux runs Playwright dans le même worktree s'écrasent leurs traces (`test-results`) ; un seul run à la fois par worktree. Le témoin PATCH du contrat créait ses données dans le `it` : délai explicite de 60 s.

## 2026-11-02 21:51 — DRV2 : seuls une panne ou un accident ouvrent un OT

- **Quoi** : `POST /api/driver/breakdowns` accepte `type` (`breakdown`, `accident`, `delay`, `other`, défaut `breakdown`). Seuls une panne et un accident ouvrent un OT. Un retard ou un autre signalement reste un incident qui alerte le chef d'atelier et l'admin.
- **Comment** : `driverReportRequestSchema` et `driverReportOpensWorkOrder` (`shared/contracts/incidents.ts`) sont partagés par la route et par l'écran chauffeur. L'écran envoie le type choisi et explique pourquoi le bouton est désactivé quand la mission n'a pas de véhicule.
- **Pourquoi** : la relecture de #107 a relevé qu'un « Retard prévu » ouvrait un OT à l'atelier. L'utilisateur a choisi qu'un OT ne s'ouvre que pour une panne ou un accident.
- **Preuves** : contrat `adm2-drv2-mis1-server-defects` 21/21 sur le Postgres local (accident → OT ; delay/other → incident sans OT ; type inconnu → 400). `tsc` : 0 erreur. `tests/unit` : 1010/1010.

## 2026-11-02 22:47 — PRT1 et CAT2 : routes enfants du catalogue pièces et pannes

- **Quoi** : routes `/api/parts/:id/specifications|variants` (PRT1) et `/api/fault-catalog/:id/parts` (CAT2), qui n'existaient pas ; l'écran base de pièces appelait des URL inexistantes. Lignes PRT1 et CAT2 du plan mises à jour.
- **Comment** : migration `20261102_parts_catalog_children.sql` (tables idempotentes, clés étrangères en cascade, dédoublonnage de `fault_catalog_parts`, index uniques), schémas Zod partagés, services `part-catalog-children-service` et `fault-catalog-service`, tests de contrat étendus.
- **Pourquoi** : fermer les derniers « Partiel » de ces deux modules (variantes, spécifications, pièces associées).
- **Preuves** : contrats `parts-catalog-crud` et `fault-catalog-lifecycle` : 68 tests, sur le Postgres local ; test unitaire de dérive migration / constante.

## 2026-11-02 22:55 — DIR3 et P3 : exports d'exploitation en cellules exactes, cycle de vie du plan préventif

- **Quoi** : DIR3 passe à OK pour les exports XLSX et ZIP (missions clients, rapport mensuel, véhicules, OT, utilisateurs, export complet). P3 reste Partiel : alerte à l'échéance, clôture de l'OT → véhicule opérationnel et recalcul de l'échéance sont couverts, deux règles ne sont pas câblées dans le produit.
- **Comment** : `tests/contract/exports-operations-content.contract.test.ts` (22 tests, en-têtes et cellules exactes, filtre, 400, ZIP relu par `tests/support/zip-read.ts`) et `tests/integration/preventive-maintenance-lifecycle.test.ts` (14 tests : balayage d'alertes borné à un véhicule par `getVehicles` espionné, clôture d'un puis de deux OT, `completeMaintenanceAndScheduleNext` mensuel/trimestriel/annuel/kilométrique, seuil kilométrique). Défauts figés en `it.fails`, mise en place en `beforeAll` (garde `it-fails-hygiene`) : DIR3-1 rôles magasinier, secrétaire, logistique, direction exportés bruts ; DIR3-2 `awaiting_parts` brut ; DIR3-3 priorité `critical` brute ; P3-1 clôturer l'OT n'avance pas l'échéance du plan (rien n'appelle `completeMaintenanceAndScheduleNext`, donc le plan ne redéclenche plus) ; P3-2 un OT issu d'un plan échu n'immobilise pas le véhicule (seule `vehicles.nextMaintenanceDate` le fait, `preventive-maintenance-service.ts` `declencheur`).
- **Pourquoi** : DIR3 et P3 étaient « Partiel » ; l'export est ce que la direction lit, le plan préventif ne doit pas s'éteindre en silence.
- **Preuves** : rouge avant : mutation temporaire des libellés et colonnes des services d'export, 6 échecs sur 22 ; trimestre compté 2 mois et destinataires d'alerte réduits à l'admin, 2 échecs sur 14 ; mutations retirées. La remise en exploitation est faite par un déclencheur de base (`20261102_work_orders_release_vehicle.sql`) : désactiver l'appel de `storage.updateWorkOrder` ne fait pas rougir le test, qui prouve le comportement du système, pas la ligne TypeScript. Vert après : contrat 22/22 et intégration 14/14 sur le Postgres local ; `tsc` 0 erreur ; `npm test` sans échec une fois la garde `it-fails-hygiene` respectée.
- **Pièges** : `createTestVehicle` ignore `nextMaintenanceDate` (la poser par `db.update`) ; `getVehicles` renvoie `{ vehicles, total }` ; les dates sont formatées dans le fuseau du serveur, d'où des dates à midi UTC ; les rôles, statuts et priorités non traduits sont figés plutôt que corrigés.

## 2026-11-03 09:39 — #130 : l'identifiant de véhicule ne sort plus de uploads/ au dépôt de document

- **Quoi** : `POST /api/vehicles/:vehicleId/documents` refuse en 400 « ID de véhicule invalide » tout identifiant qui n'est pas fait de chiffres seuls. Avant, `1..%2F..%2F..%2F..%2Fx` passait `parseInt` (1) et multer créait le dossier `x` à la racine du dépôt.
- **Comment** : `isVehicleIdSegment` et `vehicleDocumentDirectory` dans `server/middleware/upload.ts`. La route valide avant multer ; la destination multer revalide et vérifie que le chemin résolu reste sous `uploads/documents` (défense en profondeur, aussi pour l'import gelé de `routes.ts`). Le chemin stocké garde sa forme relative. Les deux autres `diskStorage` (renouvellements, factures fournisseur) ont un dossier fixe : non concernés.
- **Pourquoi** : AGENTS.md §9, une valeur de requête ne devient un segment de chemin qu'après validation. Relevé par la relecture sécurité de #126.
- **Preuves** : rouge avant correctif, dossier `pwn130-*` créé hors de `uploads/` pour les 3 profondeurs, et 500 au lieu de 400. Vert après : contrats `vehicle-documents-upload-path` 4/4 et `vehicle-documents-upload` 16/16 sur le Postgres local ; unitaire `upload-vehicle-directory` 12/12 ; `tsc` 0 erreur ; `npm test` 1549/1549.
- **Pièges** : le passage rouge laisse les dossiers créés ; le test les nettoie en `afterAll`, y compris `vehicle-12abc`.

## 2026-11-03 09:43 — #130 : réserves de la relecture et de l'audit sécurité

- **Quoi** : l'identifiant de véhicule refuse aussi les zéros en tête et les valeurs hors int Postgres ; une erreur disque à la création du dossier devient une 500 générique avec référence ; le contrat vérifie le corps `ApiErrorBody` du 400 (commit 9802d6d, sans entrée à part, rattaché ici).
- **Comment** : `/^[1-9]\d{0,9}$/` borné à 2 147 483 647 ; `mkdirSync` dans un `try` qui passe une `AppError` à `cb`, relayée telle quelle par la route ; confinement factorisé en `isInsideDirectory` (`server/lib/uploaded-file.ts`), partagé avec `uploadedFileCandidates` ; garde-fou `multer-storage-hygiene` ; leçon dans `docs/analysis/LESSONS_LEARNED.md`.
- **Pourquoi** : réserves 1 à 4 de fleet-relecteur, mineurs M1 et M4 de fleet-securite. M2 (`err.message` multer et `looksTechnical` sans `EACCES`) et M3 (extension non confrontée au type MIME) sont antérieurs à la PR : suite à part.
- **Preuves** : garde-fou rouge sur l'ancien `upload.ts`, vert après ; contrats `vehicle-documents-upload-path` 7/7 et `vehicle-documents-upload` 16/16 sur le Postgres local ; unitaires `upload-vehicle-directory` et `multer-storage-hygiene` verts.


## 2026-11-03 — P3-2 lot 2b (A) : récépissé provisoire de renouvellement

- **Quoi** : dépôt du récépissé (`POST /api/document-renewals/requests/:id/receipt`) et prise en compte dans `getMissionEligibility` : papier échu éligible jusqu'à `receipt_valid_until` inclus, puis bloqué.
- **Comment** : `tests/contract/document-renewal-receipt.contract.test.ts` (8 cas : 201 et événement en rôles, 403 technicien/chauffeur/client, remplacement, 400 date passée/illisible/fichier absent/format, jour J, 404, 409 clôturée, chemin hors `uploads/`, CHECK 23514), `tests/contract/vehicle-renewal-receipt-eligibility.contract.test.ts` (6 cas, horloge injectée) et `tests/unit/shared/vehicle-eligibility-receipt.test.ts` (5 cas).
- **Pourquoi** : décision 3 du plan P3-2 ; une règle, une source (la date du récépissé entre dans `getMissionEligibility`).
- **Reste** : le branchement dans `missions.routes.ts` (autre session) ; sans lui, le récépissé n'est pas encore lu à l'affectation ni au lancement.

## 2026-11-03 09:58 — P3-2 : garde-fous du jour J, du miroir et du PATCH /api/documents/:id

- **Quoi** : trois garde-fous sur les échéances de documents véhicule. (1) Une règle, une source au jour J : éligibilité mission, `isDateExpired` de `vehicle-documentation-service.ts` et `classifyDocumentExpiry` doivent rendre le même verdict. (2) Hygiène : aucune écriture d'une colonne miroir de `vehicles` hors de `server/lib/vehicle-document-mirror.ts`, sauf liste gelée. (3) Contrat du PATCH `/api/documents/:id`.
- **Comment** : `tests/unit/server/document-expiry-day-j.test.ts` (13 tests, base simulée, horloge figée, frontière à minuit UTC) ; `tests/unit/server/vehicle-mirror-write-hygiene.test.ts` (scan de `server/`, hors `_archive` et variantes mortes ; gelés : 3 écritures directes dans `routes.ts`, 1 `.set(variable)` dans `storage.updateVehicle`) ; `tests/contract/documents-patch-mirror.contract.test.ts` (9 tests : miroir suivi, 401/403, 400, nom seul, type sans miroir, 404, double soumission). Défauts figés en `it.fails`, mise en place en `beforeAll`.
- **Pourquoi** : le jour J a trois implémentations, deux divergent de la règle décidée (échéance du jour = expiré) ; `routes.ts` est gelé et écrit le miroir en direct.
- **Défauts produit (non corrigés ici)** : D1 `isDateExpired` (`vehicle-documentation-service.ts:35`, `<` strict) : échéance du jour non expirée dans statistiques, statut et liste. D2 `classifyDocumentExpiry` (`document-expiry-rule.ts`, `days < 0`) : échéance du jour « due » (figé par `document-expiry-rule.test.ts`, arbitrage produit). D3 `routes.ts:1427-1440` : le PATCH écrit le miroir sans garde « ne recule pas » ; corriger un document ancien fait reculer `insuranceExpiry`.
- **Preuves** : rouge avant : `<` changé en `<=` dans `isDateExpired`, l'`it.fails` de D1 rougit (1 échec) ; ligne assurance du PATCH neutralisée, 2 échecs du contrat ; `GREATEST` dans le PATCH, l'`it.fails` de D3 rougit ; emplacement factice `server/lib/zz-fake-mirror-write.ts`, 2 échecs d'hygiène. Retour arrière vérifié, `git diff server/` vide.

## 2026-11-03 11:05 — P3-2 : réserves de relecture de #135

- **Quoi** : le scan d'hygiène du miroir voit désormais `.set({ ...p })`, `vehicles as v`, `.update(schema.vehicles)`, `UPDATE "public"."vehicles"` et `onConflictDoUpdate` ; les tests d'éligibilité ne dépendent plus du fuseau de la machine ; l'id du 404 est lu en base.
- **Comment** : `vehicle-mirror-write-hygiene.test.ts` (regex élargies, alias signalé, upsert scanné) ; `document-expiry-day-j.test.ts` fixe `TZ=Africa/Douala` le temps du fichier et passe des `Date` locales à l'éligibilité ; contrat : `max(vehicle_documents.id) + 1`.
- **Pourquoi** : réserves 1 à 3 de la relecture. Nouveau défaut D4 : le service compte en date UTC, l'éligibilité en date locale ; à 23:30Z (00:30 à Douala) une assurance échéant le lendemain bloque l'une et pas l'autre, même après correction de D1. Arbitrage produit sur la date de référence.
- **Preuves** : rouge avant : fichier sonde temporaire avec les 5 formes, chacune vue (4 écritures miroir, 1 générique, 1 alias), sonde supprimée, liste gelée inchangée (aucun site réel nouveau) ; D4 en `it.fails` rougit quand le service compte en date locale. Vert après : `tsc` 0 erreur, `npm test` 1599/1599, contrat 9/9 sur fleet_test_p32gf2 (supprimée par dropdb).

## 2026-11-03 12:30 — P3-2 lot 2b partie B : jour J expiré, date UTC, PATCH documents, téléversement

- **Quoi** : D1/D2 le jour J est expiré partout ; D4 date du jour UTC unique (`shared/constants/expiry-day.ts` sur `shared/lib/utc-day.ts`) pour éligibilité, statistiques, alertes et lancement de mission ; D3 `PATCH /api/documents/:id` déplacé dans `vehicle-documents.routes.ts`, miroir recalé sur la plus lointaine échéance des documents du type ; M2 erreurs de téléversement génériques (détail dans `cause` et le journal), `EACCES|ENOSPC|EPERM` dans `looksTechnical` ; M3 extension confrontée au MIME.
- **Comment** : les `it.fails` D1, D2, D3, D4 de #135 passent en `it` ; `document-expiry-day-j.test.ts` rejoue D4 sous Africa/Douala et UTC (23:30Z le 3 : non expiré partout, 00:00Z le 4 : expiré partout) ; liste gelée du scan d'hygiène du miroir vidée ; nouveaux tests `upload-extension-and-technical-errors` (unitaire) et `vehicle-documents-upload-errors` (contrat).
- **Pourquoi** : une règle, une source ; décisions produit D2 (jour J expiré) et D4 (UTC partout). Décalage accepté : de 00:00 à 01:00 à Douala, le jour J est encore la veille.
- **Preuves** : rouge avant (code de #135 restauré) : 7 échecs sur day-j et règle, 16 échecs unitaires et 4 contrats (M3 x2, M2 tronqué, D3). Vert après : `tsc` 0 erreur, `npm test` 1629/1629, contrats voisins 83/83 sur fleet_test_p32c (supprimée par dropdb).

## 2026-11-03 10:20 — FUEL3 constaté OK, PRT1 : accès, erreurs et suppression d'une pièce référencée

- **Quoi** : FUEL3 passe de « À faire » à OK : la couverture existait déjà sur main et recouvre point par point le cadrage (limites exactes, plein sans kilométrage, premier plein, hors ordre, contrat de la liste, capacité par rôle), aucun test ajouté. PRT1 reste Partiel avec 12 cas de plus (et 2 tests témoins) ; deux défauts produit sont figés.
- **Comment** : `tests/contract/parts-catalog-access-errors.contract.test.ts` : 401 anonyme sur POST, PATCH, DELETE et enfants, 403 client, technicien et magasinier, corps `ApiErrorBody` (code, message, rien de technique) sur 400/401/403/404/409, double création simultanée, pièce citée par le catalogue de pannes. Deux `it.fails` avec test témoin et mise en place dans `beforeAll` (garde-fou `it-fails-hygiene`).
- **Pourquoi** : les erreurs de la fiche pièce n'étaient vérifiées que par statut ; AGENTS.md §10 exige le contrat unique. Il n'existe pas de CRUD de catégorie : `parts.category` est un texte libre.
- **Défauts figés (non corrigés)** : (1) `PATCH /api/parts/:id` accepte `quantity: -3` (200) alors que la création refuse (400) ; (2) `DELETE /api/parts/:id` d'une pièce citée par `part_requirements` : `deletePart` ne contrôle que le catalogue de pannes, la FK échoue et la route (`server/routes.ts`, catch du DELETE) renvoie 500 avec `error.message` brut. Correctif à fleet-api.
- **Preuves** : contrats `fuel-anomaly-rules`, `parts-catalog-crud`, `parts-catalog-access-errors` 78/78 et intégration `fuel-anomaly-rules` 20/20 sur `fleet_test_cov` ; `npm test` 1585/1585 ; `tsc` 0 erreur. Les deux `it.fails` sont rouges sur le produit actuel (le premier observé en 200, vérifié par sonde) et passeront en échec dès le correctif, signal pour les retirer.

## 2026-11-03 10:40 — DRV2 et P2 : espace chauffeur, état de la facture sur la mission, rôles du paiement (niveau E)

- **Quoi** : DRV2 reste Partiel, avec un défaut produit de plus figé : DRV2-4, aucune vue « missions du jour » (le tableau de bord ne garde que `allMissions.find(assigned | in_progress)`, alors que `/api/drivers/me` renvoie les deux missions). Ajouts : périmètre de la déclaration de panne (véhicule d'un autre 403, corps invalide 400, atelier 403, aucun OT créé). P2 : l'onglet Factures de la mission suit en attente, partielle, payée par la trame `client_invoice_payment_recorded` reçue par la logistique ; paiement refusé en 403 à la logistique, au technicien et au chauffeur ; trop-perçu et facture soldée en 409 ; montant négatif, non numérique ou mode inconnu en 400.
- **Comment** : `e2e/19-driver-space.spec.ts` (chauffeur C à deux missions, chauffeur D, `test.fail` DRV2-4 avec témoin en `beforeEach`) et second describe de `e2e/13-mission-invoice-payment.spec.ts` (une mission et une facture par test, deux sessions de rôles différents). Aucun fichier serveur ni autre spec touché.
- **Pourquoi** : les niveaux U, I et C de ces règles existent déjà (`client-invoice-payments`, `adm2-drv2-mis1-server-defects`) ; il manquait la preuve au navigateur et sur la trame.
- **Preuves** : 19 e2e verts sur le Postgres local `fleet_test_cov` (serveur sur le port 5177, navigateur msedge). Rouge avant : garde de rôle du paiement élargie à la logistique, le test des rôles échoue (200 au lieu de 403), mutation retirée. DRV2-4 est rouge par construction (`test.fail`). `tsc` 0 erreur, `npm test` 1585/1585.
- **Pièges** : les paiements clients prennent `bank_transfer` (pas `virement`) ; le port 5000 était occupé par un autre projet ; un OT ouvert par un test précédent sur le même véhicule impose de comparer avant et après.

## 2026-11-03 11:34 — DRV2 et P2 : réserves de relecture de #139

- **Quoi** : spec 13, le passage à « Payée » est prouvé par une seconde trame `client_invoice_payment_recorded` pour la même facture (compte exact 1 puis 2), plus seulement à l'écran ; les 403 du paiement (logistique, technicien, chauffeur) et les trois 400 (montant négatif, non numérique, mode inconnu) vérifient le contrat `ApiErrorBody` (code = `codeForStatus`, message non vide, aucun détail technique, même filtre que PRT1).
- **Pourquoi** : réserves a et b de b7 ; une assertion d'écran au-delà du `refetchInterval` est satisfaite par le polling (AGENTS.md §3), un statut seul ne prouve pas le contrat d'erreur (§10).
- **Preuves** : e2e 13 et 19 sur `fleet_test_cov` (serveur port 5177, msedge) : 18/19 au premier passage, DRV2-1 vert au rejeu isolé (2/2), instable, sans lien avec le delta ; tsc 0.

## 2026-11-03 11:57 — Contrôle ApiErrorBody partagé entre contrats et e2e

- **Quoi** : `TECHNICAL` et le contrôle du corps d'erreur vivent dans `tests/support/api-error.ts` (`apiErrorProblems`). Le contrat PRT1 (`parts-catalog-access-errors`) et la spec 13 l'importent. Leurs deux copies du filtre et de la fonction sont retirées.
- **Comment** : la fonction ne dépend d'aucun framework. Elle renvoie la liste des écarts, et chaque appelant garde un `expect(...).toEqual([])` d'une ligne avec son propre `expect` (Vitest ou Playwright). Le code attendu par défaut est `codeForStatus`, un code explicite le remplace. Corps décodé ou texte brut ; un corps non JSON ou vide est signalé, il ne lève pas d'exception.
- **Pourquoi** : les deux copies étaient identiques ; une troisième aurait pu diverger, comme les tables de libellés de statut (AGENTS.md §1). Rien à faire côté `playwright.config.ts` : `trace: "retain-on-failure"` y est déjà, ce qui garde la trace d'un échec rare comme DRV2-1 (rouge non reproduit en 3 passages complets de la spec 19).
- **Preuves** : test unitaire `tests/unit/e2e/api-error-support.test.ts` (conforme, code par défaut ou explicite, statut, message vide, détail technique, corps non JSON ou absent) ; unit 1614/1614 ; tsc 0 ; contrat PRT1 14/14 sur le Postgres local `fleet_test`. Spec 13 non rejouée au navigateur : seul le corps de son assertion change, et le fichier compile.
- **Piège** : sur la base partagée `fleet_test`, `cleanupOrphanTestRows` (`tests/support/cleanup.ts:193`) échoue sur `status_history_updated_by_id_users_id_fk` quand une autre session a laissé un historique de statut lié à un utilisateur de test. Le fichier est alors marqué en échec alors que ses 14 cas passent. À corriger à part.

## 2026-11-03 12:10 — Cloison chauffeur sur les GET de /api/operations (DRV2-3, suite)

- **Quoi** : un chauffeur lisait toutes les missions et leurs coûts par `/api/operations/*`, ce qui contournait le `router.param` de missions.routes.ts. Listes (`/missions`, `/missions/upcoming`, `/missions/active`) filtrées sur ses affectations (`driverScopeOf`, `assignments.driver_id`, fiche liée par `drivers.user_id`) ; `/missions/:id/costs`, `/missions/by-client/:clientName`, `/stats/by-client` et `/stats/by-destination` refusés en 403 (`AppError`). Personnel inchangé ; le client reste fermé par `isStaff` au montage (`STAFF_ROLES` exclut `client`), rien changé pour lui.
- **Comment** : `refuseDriver` dans operations.routes.ts ; paramètre `driverScope` optionnel dans `operations-service` (sous-requête `missions.id IN assignments`). Règle de portée réutilisée depuis `server/lib/driver-scope.ts`, aucune duplication. Les coûts sont refusés même sur sa propre mission : ils embarquent un amortissement tiré du prix d'achat du véhicule et les agrégats couvrent toute la flotte.
- **Pourquoi** : AGENTS.md §11, défaut DRV2-3 resté ouvert sur ce routeur.
- **Preuves** : `tests/contract/operations-driver-scope.contract.test.ts`, 7 cas, une fiche chauffeur par compte. Rouge sur main (262b4a9) : 4 échecs / 3 verts (liste avec la mission de B, upcoming/active, costs en 200, agrégats en 200). Vert après : 7/7 sur fleet_test.

## 2026-11-03 12:23 — Cloison operations : réserves de relecture de #149

- **Quoi** : R1, un compte chauffeur sans fiche `drivers` reçoit des listes vides et un 403 sur les coûts et les agrégats (contrat). R3, le refus des coûts lit `OPERATIONS_COST_READ_ROLES` (`shared/constants/roles.ts`, même forme que `WORK_ORDER_COST_READ_ROLES`) au lieu d'un `"driver"` en dur. R2, traité plutôt que reporté : pour un chauffeur, la jointure `assignments` ne retient que ses propres affectations (`assignmentsJoin`), donc une mission réaffectée ne lui renvoie plus le nom ni le véhicule de l'autre chauffeur. `purchasePrice` est masqué dans le véhicule de ses lignes.
- **Décision (utilisateur, 3 novembre 2026)** : `/missions/:id/costs` reste refusé au chauffeur, même pour sa propre mission. L'amortissement est tiré du prix d'achat du véhicule, et les agrégats couvrent toute la flotte. D'où le masquage de `purchasePrice` dans les listes.
- **Preuves** : contrat `operations-driver-scope` 9/9 sur fleet_test ; mutation (service remis à la version précédente) : « mission réaffectée » rouge, 8/9. Erreurs contrôlées par `apiErrorProblems` (`tests/support/api-error.ts`, #146). tsc 0, unit 1633/1633.

## 2026-11-03 13:18 — Cloison client sur les sous-ressources d'un OT (IDOR)

- **Quoi** : `GET /api/work-orders/:id/parts`, `/:id/items` et `/:id/pending-part-requirements` n'exigeaient qu'une session. Un client énumérait les ids et lisait prix unitaires et heures des OT d'un autre client. Elles passent à `isAnyUser` puis à `assertWorkOrderReadable` : 404 si l'OT n'existe pas (avant la cloison), 403 si le véhicule n'est pas au client. Le personnel est inchangé ; un client lit toujours le coût de son propre OT (décision du commanditaire).
- **Comment** : helper `server/lib/work-order-scope.ts`, qui réutilise `storage.getWorkOrder`, `storage.getVehicle` et `canAccessOwned` (même lecture du propriétaire que `GET /api/work-orders/:id`). Les `catch` des trois handlers relaient une `AppError` au gestionnaire central. Seuls les GET sont touchés ; `server/routes.ts` : le handler existant, sans nouvelle route.
- **Pourquoi** : AGENTS.md §11. Un OT dont le véhicule n'a pas de propriétaire n'est lisible que par le personnel.
- **Preuves** : `tests/contract/work-order-detail-client-scope.contract.test.ts`, 15 cas (3 routes x 5). Rouge sur main : 9 échecs / 6 verts (les 6 verts sont personnel et propriétaire). Vert après : 15/15 sur fleet_test. Contrats voisins (work-order*, vehicle-documents-client-scope, part-requirements-chain, api-role-guard) 104/104. tsc 0, unit 1658/1658.

## 2026-11-03 12:55 — Portée temps réel fermée par défaut

- **Quoi** : une portée WebSocket absente, vide ou invalide n'envoie plus rien (avant : broadcast à tous, clients compris, cause commune de #53, #127 et #151). Le broadcast n'existe que si `type: "broadcast"` est écrit.
- **Comment** : `normalizeScope` et le choix des destinataires sortent de `server/index.ts` vers `server/lib/realtime-scope.ts` (module pur, index de connexions injecté). Les appels sans portée (20 points d'émission) (OT, demandes de pièce, réception) sont rendus explicitement broadcast ; l'inventaire des appels est dans la PR.
- **Pourquoi** : le défaut ouvert transformait toute portée calculée vide en fuite ; fermer à la source vaut mieux que corriger appelant par appelant.
- **Preuves** : `tests/unit/server/realtime-scope.test.ts` (23 cas), rouge sur la règle copiée de main (16 échecs), vert sur la nouvelle ; `tests/unit/server/broadcast-hygiene.test.ts` (3 cas), rouge démontré par l'ajout d'un `type: "broadcast"`. Liste gelée : 41 occurrences dans 25 fichiers.

## 2026-11-03 13:20 — DRV2-1 qualifié : localisateur de toast ambigu

- **Quoi** : DRV2-1 (spec 19) n'est plus instable. `getByText("Problème signalé", { exact: true })` ; le corps de la réponse figure dans le message d'échec (lu seulement en échec, borné à 5 s). Nouveau garde `tests/unit/e2e/toast-title-exact-hygiene.test.ts`.
- **Comment** : base locale dédiée `fleet_test_c7`, serveur sur le port 5177, msedge. Rejeux spec 19 ×5 puis 13 + 19 ×3 : 147 verts, rouge non reproduit. Reproduit ensuite 1 fois sur 3 avec trace : POST 201, toast affiché, `strict mode violation` (titre + `<span aria-live>` du Toast Radix).
- **Pourquoi** : `getByText` sans `exact` cherche une sous-chaîne ; l'annonce passagère « Notification Problème signalé… » la contient. Défaut du test, pas du produit.
- **Preuves** : garde rouge sur la spec d'origine (`e2e/19-driver-space.spec.ts:196`), vert après ; spec 19 ×5 après correctif (voir PR) ; tsc 0.
- **Piège** : `response.text()` sur une réponse servie via le service worker PWA ne rend jamais la main (test bloqué 180 s sur un 201).

## 2026-11-03 13:40 — PRT1 en e2e : catalogue de pièces et trame WebSocket absente

- **Quoi** : `e2e/21-parts-catalog.spec.ts`. Parcours navigateur du magasinier (création par le formulaire avec catégorie libre, recherche dans le tableau, modification catégorie et prix, `createdBy`/`updatedBy` relus en base, corbeille absente et DELETE 403), suppression par l'admin à l'écran avec cascade des variante et spécification. Cas temps réel figé en `test.fail` : un second profil (chef d'atelier) sur `/inventory/parts` ne reçoit aucune trame de pièce.
- **Comment** : comptes créés par `createE2EUser` (warehouse, workshop_manager, admin), références `TEST-prt1-*`, nettoyage par `cleanupCreated`. Variante et spécification par l'API dans la session du magasinier : `parts-database.tsx`, seul écran qui les porte, n'est montée par aucune route. Base locale `fleet_test_de_rid`, serveur port 5137, msedge.
- **Pourquoi** : le contrat couvre les routes ; restait ce que l'écran affirme et la règle des 3 couches. `POST/PATCH/DELETE /api/parts` (`server/routes.ts`, gelé) n'émettent aucun événement et `useRealTimeSync.ts` n'invalide `/api/parts` que sur `part_used_*` et `part_requirement_*`.
- **Preuves** : le cas temps réel, sans `test.fail`, échoue sur « aucune trame WebSocket de pièce reçue par le profil observateur » (`auth_success` reçu, création 201 et modification 200 vérifiées avant) : cause bien l'absence de trame, pas un sélecteur. Mise en place hors du `test.fail` (garde `it-fails-hygiene`) : un témoin vérifie socket, création 201 et modification 200. Trois passages consécutifs verts (3/3 tests chaque fois), tsc 0, unit verts. Une PR corrective émet `part_catalog_changed` : la première des deux à fusionner laisse le `test.fail` en place, la seconde le retire.

## 2026-11-03 13:35 — Tests : refuser de démarrer sur une base de production

- **Quoi** : intégration, contrat et unitaires refusent de démarrer si `DATABASE_URL` (ou `_LISTENER`, `_DIRECT`) diffère de `DATABASE_URL_TEST`, si celui-ci manque (plus de repli), ou si l'hôte est interdit (`TEST_DB_FORBIDDEN_HOSTS`, `*.neon.tech` sauf `ALLOW_NEON_TEST_DB=1`).
- **Comment** : fonctions pures ajoutées à `e2e/helpers/production-guard.ts` (pas de second module), branchées dans `setup-db.ts` et un nouveau `setup-unit.ts` ; `--env-file=.env` retiré de `test:integration` et `test:contract`. CI inchangée (elle ne définit que `DATABASE_URL_TEST`).
- **Pourquoi** : near miss, contrat lancé avec le `.env` de production (voir `LESSONS_LEARNED.md`, 2026-11-03).
- **Preuves** : `tests/unit/server/test-db-guard.test.ts`, rouge sur le code d'avant, vert après ; essai manuel : `DATABASE_URL=postgres://u:p@ep-x.neon.tech/db` fait échouer un contrat avant toute connexion ; contrat `vehicle-documents-client-scope` 19/19 sur la base locale.

## 2026-11-03 14:00 — Garde base de test : rupture documentée, périmètre prouvé

- **Quoi** : AGENTS.md §8 et tests/README.md : `DATABASE_URL_TEST` s'exporte, `unset DATABASE_URL` avant intégration ou contrat, message d'erreur attendu. Preuve que e2e, `backfill:*` et `benchmark:*` sont hors garde.
- **Pourquoi** : revue de #159 (rupture à documenter).

## 2026-11-03 14:05 — Cloison OT : logs migrés, commentaire du helper (suite de 51dfdef)

- **Quoi** : dans les catch des GET touchés, les `console.*` passent à `moduleLogger` sans rien supprimer. `GET /api/work-orders/:id/parts` : le `console.log` du contenu des lignes devient un `log.debug` (`workOrderId`, `count`, `requestId`, sans le contenu), et le `console.error` un `log.error({ err, requestId })`. `GET /:id/items` : `console.error` migré vers `log.error`. Le commentaire de `assertWorkOrderReadable` dit qu'il applique la cloison client seulement ; l'écart technicien (OT d'un autre technicien, bloqué par `GET /api/work-orders/:id`) est noté comme connu.
- **Pourquoi** : AGENTS.md §10, un log se migre, il ne se supprime pas. Le contenu des lignes (prix) n'a pas à finir dans les journaux.
- **Preuves** : tsc 0, unitaires 1687/1687 ; contrats `work-order*` et `vehicle-documents-client-scope` 67/67 sur 10 fichiers, lancés sans `.env` ni `DATABASE_URL` (seulement `DATABASE_URL_TEST` et `DATABASE_WS_PROXY`).

## 2026-11-03 15:10 — Lectures d'OT de flotte réservées au personnel (IDOR, suite)

- **Quoi** : `GET /api/work-orders/:workOrderId/tire-rotations` passe à `isAnyUser` + `assertWorkOrderReadable` (le client propriétaire garde l'accès). `GET /api/work-orders/awaiting-parts`, `/api/work-orders/statistics`, `/api/statistics/work-orders`, `/api/parts/:id/work-orders` et `/api/parts/:id/usage-history` passent à `isStaff`. `GET /api/exports/work-orders` : `isStaff` ajouté en doublure ; le routeur `/api/exports` est déjà gardé par `EXPORT_ROLE_MATRIX` (admin, management, secrétaire, chef d'atelier), il n'y avait pas de fuite.
- **Comment** : aucun écran client n'appelle ces routes (grep `client/src` : tableaux de bord et pages atelier, magasin, rapports, fiche pièce, tous du personnel), donc pas de filtre `ownerScopeOf`. Chauffeur et technicien sont dans `STAFF_ROLES` et gardent l'accès. `assertWorkOrderReadable` refuse un id hors 1..2147483647 par un 400 (`AppError`) : couvre aussi `/parts`, `/items` et `/pending-part-requirements` (avant : 500 générique). `console.*` des catch touchés migrés vers `moduleLogger` ; le `console.log` des statistiques devient un `log.info`.
- **Pourquoi** : AGENTS.md §11. Un client lisait 100 OT de flotte avec véhicules, les statistiques d'atelier, l'historique d'usage des pièces et les rotations de pneus de tout OT. Écart horizontal technicien noté dans `docs/analysis/MATRICE_ROLES_GAP.md`.
- **Preuves** : `tests/contract/work-order-reads-client-scope.contract.test.ts`, 15 cas (4 tire-rotations + 5 x 2 réservées au personnel + 1 export). Rouge sur main : 7 échecs / 8 verts ; vert après, 15/15. Garde d'hygiène `routes-hygiene` : rouge en remettant `authenticate` sur tire-rotations, vert après (une exception gelée : `GET /api/work-orders/:id`, cloison en ligne).

## 2026-11-03 13:50 — Garde-fou base de test : relecture de #159 (identifiants, unitaires, docs)

- **Quoi** : `e2e/helpers/production-guard.ts` lit l'hôte par `new URL` (jamais d'extraction manuelle) et affiche « hôte illisible » au moindre doute (`#`, `/` ou `?` non encodé dans le mot de passe) ; une URL illisible est refusée. La garde unitaire (`assertUnitDatabaseNotProduction`) refuse aussi `*.neon.tech` hors `ALLOW_NEON_TEST_DB=1` et vérifie `DATABASE_URL_LISTENER` / `_DIRECT` (le placeholder `127.0.0.1:1` passe). Le message de refus donne `unset` et `Remove-Item Env:… -ErrorAction SilentlyContinue`. `assertTestDatabaseNotProduction` supprimée (plus aucun appelant hors son test, vérifié dans `e2e/`, `scripts/`, `tests/`). Docs corrigées : `tests/README.md`, `README.md`, `.env.example`, `.claude/agents/fleet-db.md`, `docs/analysis/controles-donnees-lot.md`. CI : `touch .env` et son commentaire retirés des jobs intégration et contrat.
- **Comment** : l'assertion toujours vraie (`toContain("productionMarkers(")`) est remplacée par des tests de câblage sur `setup-db.ts`, `setup-integration.ts`, `setup-contract.ts` (import de `./setup-db` avant `server/`) et `setup-unit.ts`, plus « l'hôte de production par défaut reste refusé avec `ALLOW_NEON_TEST_DB=1` ».
- **Pourquoi** : la relecture a montré que le message pouvait citer un morceau de mot de passe, que les unitaires n'étaient gardés que par marqueur, et que plusieurs documents décrivaient encore le repli sur `DATABASE_URL`. `touch .env` ne servait plus : les deux jobs n'exécutent que `test:db:schema` (cross-env, drizzle-kit) et vitest, sans `--env-file`.
- **Preuves** : tsc 0 ; unitaires 1710 (1709 au passage complet, `conflict-markers` en dépassement de délai sous charge, 2/2 seul) ; 21 cas dans `test-db-guard.test.ts`, rouge démontré en retirant le contrôle `@` de `parsedHost` (le cas `u:12/ss@…` fuit alors `u:12`) ; contrat `work-order-detail-client-scope` 15/15 et intégration `fuel-card-service` 6/6 sur le Postgres local ; refus fail-fast rejoués (URL illisible, `*.neon.tech`, `DATABASE_URL_TEST` absente) sans identifiant dans la sortie.

## 2026-11-03 13:19 — apiErrorProblems vérifie le requestId

- **Quoi** : `apiErrorProblems` (`tests/support/api-error.ts`) exige maintenant un `requestId` non vide dans le corps d'erreur. Si l'appelant fournit l'en-tête `X-Request-Id` de la réponse, il doit être identique (`null` = en-tête absent, c'est un écart). Les trois contrats consommateurs (parts-catalog-access-errors, operations-driver-scope, mission-fuel-errors) et l'e2e 13 passent l'en-tête.
- **Comment** : cinquième paramètre optionnel `requestIdHeader`, signature existante inchangée. `contract-session.call` expose `headers` (ajout, même forme que `contract-actors`).
- **Pourquoi** : contrat `ApiErrorBody` (`shared/errors.ts`). Le requestId est la référence que l'utilisateur donne au support (AGENTS.md §10), et rien ne le gardait.
- **Preuves** : unitaire 6/6, rouge à 2/6 avec l'ancien contrôle. Mutation serveur (`normalizeErrorBody` sans requestId) : 17 tests de contrat rouges sur les 3 suites consommatrices, verts une fois le serveur rétabli. Contrats complets 1340/1340 sur fleet_test_de_rid. Unit 1660/1660, tsc 0. Aucune route sans requestId parmi celles qu'appellent ces suites.

## 2026-11-03 14:05 — PRT1 : test.fail du temps réel levé après #165

- **Quoi** : le cas deux profils de `e2e/21-parts-catalog.spec.ts` passe en `test` ordinaire ; la ligne PRT1 du plan note le défaut corrigé.
- **Comment** : #165 émet `part_catalog_changed` sur POST, PATCH, DELETE et update-stock ; la reconnaissance de trame de la spec l'acceptait déjà.
- **Pourquoi** : la PR qui fusionne en second lève le `test.fail` (Playwright signalerait sinon l'échec inverse).

## 2026-11-03 15:00 — Lot A3 : lectures GET ouvertes au client (carburant, stock, factures, KPI)

- **Quoi** : `GET /api/fuel-records` (liste et `?vehicleId=`), `/statistics`, `/consumption-history` et `/api/statistics/fleet` passent à `isAnyUser` et se limitent aux véhicules du client (`canAccessOwned`, `ownerScopeOf`) ; `parts-used`, `parts` (liste, statistiques, stock bas, mouvements, détail, historique de stock, stock réel), `invoices` (par famille, TVA mensuelle, pièces d'une facture), `statistics/fleet-kpi`, `fleet-history`, `scheduled-maintenance` passent à `isStaff`. `GET /api/work-orders/:id` et `/api/parts/:id/*` : id hors plage en 400.
- **Comment** : `tests/contract/client-read-scope.contract.test.ts` (deux clients A et B avec véhicule et pleins, un compte atelier, un chauffeur). Garde d'hygiène étendue aux GET portant une garde reconnue (`tests/support/route-guard-scan.ts` ; gardes locales ou nommées autrement non jugées, échec fermé au lot A4), liste gelée de 55 lectures restantes.
- **Pourquoi** : AGENTS.md §11 ; récidive après #157 et #163 (voir LESSONS_LEARNED, 2026-11-03).
- **Preuves** : contrat 40/40 ; rouge sur les handlers de main : 25 échecs, 15 verts ; unitaire de garde 15 cas dont un négatif par contournement.

## 2026-11-03 14:30 — WO5 : coût d'OT identique écran, PDF et KPI (niveau E)

- **Quoi** : `e2e/22-work-order-cost.spec.ts` (2 cas) pose un OT clos avec heures, pièce et pneu, ouvre l'onglet Rapport, lit le « Coût total » de l'en-tête et le « Total » du récapitulatif, déclenche « Imprimer » (téléchargement) et lit la ligne TOTAL du PDF, puis interroge `GET /api/kpi/maintenance-costs?groupBy=vehicle`. Cas 1 : taux daté 8 000, 3,75 h (ligne annulée exclue), coût saisi 9 999 ignoré, pièces 3 000, pneu 2 000 -> 35 000. Cas 2 : aucun taux en vigueur, coût saisi 700 + 100 + 40 -> 840. Montants écrits à la main. Intégration : un cas « sans taux » ajouté à `work-order-cost.test.ts` (service technicien = KPI = 840). `e2e/21-parts-catalog.spec.ts` : reconnaissance de trame réduite à `type === "part_catalog_changed"` et deux trames attendues pour la pièce (`created` puis `updated`, lues dans `payload.action`).
- **Comment** : le PDF jsPDF n'est pas compressé et `pdf-parse` n'est pas installé (non ajouté) : le test lit les opérandes `Tj` du flux et prend la chaîne qui suit « TOTAL ». Les formules ne divergent que par l'arrondi (KPI au FCFA par composante, écran au centime) : même règle de main-d'oeuvre via `laborCost`, aucun défaut produit constaté. Données TEST-, supprimées en fin de spec (OT, lignes, pièces, rotations, taux).
- **Pourquoi** : ligne WO5 du plan, un seul coût pour l'écran, le PDF et le KPI. Les unitaires et l'intégration prouvaient la formule, pas ce que le navigateur affiche ni ce que le PDF imprime.
- **Preuves** : rouge sur code fautif : PDF sans taux (`laborRate: null` ligne 892 de la page de l'OT, rétabli) -> `pdfTotal` 14 999 au lieu de 35 000. Vert : spec 22 trois passes (2/2), spec 21 (3/3), intégration `work-order-cost` + `kpi-service*` 15/15, tsc 0, unitaires 1730/1730.

## 2026-11-03 — Lot A4 : cloison client des lectures pneus et garde en échec fermé

- **Quoi** : contrat `client-read-scope-tires.contract.test.ts` (53 cas) : `/api/vehicle-tires` cloisonné par client (client sans véhicule -> vide), 12 routes pneus réservées au personnel (client 403, technicien et responsable 200), 17 chemins masqués par un montage (client 403), règlement fournisseur, `?vehicleId` hors plage en 400, client `B&A` en 403 sur le carburant. Scan `route-guard-scan.ts` réécrit, 25 tests d'hygiène.
- **Comment** : acteurs manager, technicien, chauffeur, magasinier, clients A, B et sans véhicule ; données `TEST*` (pneu, 2 pneus montés, 3 inspections, 2 rotations) supprimées en `afterAll`, balayage d'orphelins étendu. Scan par classification de la source des gardes, identifiant inconnu = permissif.
- **Pourquoi** : dernière famille de fuites de lecture côté client (récidive des lots A1 à A3) et garde qui acceptait un nom de garde sans en lire le rôle.
- **Preuves** : rouge sur `routes.ts` de main : 21 échecs sur 53 ; vert 53/53. Mutation : `routes-hygiene` 1 échec / 24 réussis. Liste gelée 52 -> 22, liste non analysable 1. tsc 0, unitaires 1773/1773, familles de contrat 54 fichiers / 869 tests.

## 2026-11-03 14:58 — P6 : stock bas -> réapprovisionnement au navigateur (niveau E)

- **Quoi** : `e2e/23-low-stock-restock.spec.ts` (7 cas, série) : pièce TEST- sous son seuil, alerte au magasinier et compteur du chef d'atelier ; commande brouillon -> envoyée -> confirmée par l'écran du magasinier, alerte et stock inchangés ; réception par l'écran (+10, entrée de stock à son nom, relus en base) avec la trame `purchase_order_status_updated(delivered)` vérifiée chez le chef d'atelier ; technicien sans bouton, API 403, stock inchangé ; après rechargement l'alerte est levée.
- **Comment** : parcours joué une fois dans un beforeAll, observations dans `seen`, un maillon par test. La levée de l'alerte sans rechargement est un défaut produit figé en `test.fail` (mise en place hors du corps, témoin présent : garde #159). Libellés lus dans `shared/constants/purchase-order-statuses.ts`. Données TEST- supprimées en fin de spec (0 reste).
- **Pourquoi** : le contrat prouvait l'API, pas ce que voit le second profil. Le client ignore la réception pour l'alerte : `useRealTimeSync.ts` n'invalide pas les requêtes d'alerte sur cette trame. Non corrigé ici, à rendre à fleet-fe.
- **Preuves** : trois passes 7/7 ; rouge si l'émission serveur est retirée (`purchase-orders.routes.ts`, rétabli) : test de réception en échec faute de trame ; avec les quatre invalidations ajoutées côté client (rétabli), le `test.fail` passe au vert donc échoue (« Expected to fail »). tsc 0, unitaires 1763/1763.

## 2026-11-03 14:59 — WO5 : réserves de relecture sur e2e/22

- **Quoi** : `e2e/22-work-order-cost.spec.ts` : sondage direct vers 35 000 et 840 (plus de `toBeGreaterThan(0)`), `GET /api/work-orders/:id/labor-rate` vérifié nul avant le cas sans taux, import `node:fs` en tête.
- **Comment** : `readThreeCosts` reçoit le total attendu. **Pourquoi** : réserves du relecteur de #171 (un sondage > 0 pouvait valider un montant partiel). **Preuves** : spec 22 rejouée 2/2, tsc 0.

## 2026-11-03 15:03 — P6 : couche 3 sur la réception de commande fournisseur (défaut corrigé)

- **Quoi** : `client/src/hooks/useRealTimeSync.ts`, cases `purchase_order_*` : invalidation de `/api/warehouse/reorder-alerts`, `/api/parts/low-on-stock`, `/api/part-requirements` et `/api/parts`. `e2e/23` : le `test.fail` de la levée d'alerte sans rechargement devient un test normal.
- **Comment** : correctif dans le case client existant ; les événements de commande ne sont pas au registre `REALTIME_EVENTS` (les y inscrire toucherait la portée serveur, fermée par défaut depuis #153). Autres événements de stock relus : `part_requirement_*` invalide déjà pièces, stock bas et alertes ; l'ajustement passe par `part_catalog_changed` et `WAREHOUSE_QUERY_KEYS`. Pas d'autre trou.
- **Pourquoi** : défaut trouvé par P6, l'alerte restait affichée chez le chef d'atelier jusqu'au rechargement.
- **Preuves** : spec 23 deux passes 7/7 (dont la levée sans rechargement) ; rouge démontré à la PR #175 (sans les invalidations, le test échoue). tsc 0, unitaires 1768/1768.

## 2026-11-03 15:28 — Flakes : requestId dans les contrôles de fuite, compteur pg_stat de FUEL3

- **Quoi** : `leakText` dans `tests/support/api-error.ts`, utilisé par 50 contrôles de fuite dans 34 fichiers (30 de contrat, 4 unitaires dont le cas forcé) et par `apiErrorProblems`. Garde-fou `tests/unit/leak-check-hygiene.test.ts`. Cas déterministe `X-Request-Id: qrSqlREDR7` dans `part-scans-routes.test.ts`. FUEL3 : `vehicleVersions` (`xmin` et `md5`) remplace `pg_stat_user_tables`.
- **Comment** : le texte contrôlé ne contient plus le `requestId`. FUEL3 mesure ses propres lignes et une sentinelle, que le test supprime à la fin.
- **Pourquoi** : deux échecs aléatoires signalés par 0a. Le garde-fou a trouvé 7 contrôles de plus que le premier relevé.
- **Preuves** : rouge par mutation sur les deux cas (ancien contrôle avec le requestId forcé ; `UPDATE vehicles SET brand = brand` au démarrage). tsc 0, unitaires 142/142 fichiers, contrats 127/127 fichiers, FUEL3 4/4.

## 2026-11-03 16:00 — Couche 3 : table des écrans satellites et garde-fou

- **Quoi** : `client/src/lib/realtime-satellites.ts`, avec 14 groupes d'écrans et une table événement -> groupes. `useRealTimeSync.ts` appelle `invalidateSatellites` avant le `switch`, et `part_used_*` rafraîchit en plus la fiche de l'OT. Nouveau test `tests/unit/client/realtime-satellites.test.ts` (11 cas).
- **Comment** : le garde-fou balaie les émetteurs du serveur (premier argument littéral de `broadcast*`, `emit*` ou `diffuser`, et `'eventType'` SQL) et les `queryKey` du client, constantes `_PATH` des contrats comprises. Listes gelées :
  - `UNCOVERED_SATELLITES` : `/api/invoices/monthly-stats`, appel sans route, et `/api/workflows/stats`, sans événement ;
  - `TABLE_WITHOUT_EMITTER` : 4 événements.
- **Pourquoi** : les 14 écarts de l'audit 0a du 3 novembre 2026. L'oubli d'un écran satellite était l'erreur la plus fréquente de la règle des 3 couches.
- **Preuves** :
  - rouge par mutation : retirer `parts_delivered` fait échouer le test de famille, et `warehouse_stock_movement_recorded` sans groupe stock fait échouer le test de groupe et celui de l'audit ;
  - vert : unitaires 142 fichiers, tsc 0 ;
  - e2e en local : 23 + 21 (10/10), 06 + 14 + 15 (4 verts, 1 skip préexistant de 06 : aucun véhicule en base).

## 2026-11-03 15:31 — Couche 3 : réserves de relecture sur #179

- **Quoi** : NOT_YET_IN_TABLE et UNCOVERED_SATELLITES sont figées par égalité stricte. Le groupe fuel couvre aussi `["/api/fuel-card/vehicle", id, …]` et le préfixe `/api/fuel-records/vehicle/` (fiche véhicule). La JSDoc de `invalidateCatalogEvent` est revenue au-dessus de sa fonction.
- **Pourquoi** : réserve du relecteur. Les deux listes pouvaient grandir sans que le test échoue, ce qui contredisait leur nature de liste gelée.
- **Preuves** : rouge si on ajoute une entrée à l'une ou l'autre liste (2 échecs). tsc 0, unitaires 142/142 fichiers.

## 2026-11-03 15:36 — Ménage des comptes de test : garde-fou des FK vers users

- **Quoi** : `tests/integration/cleanup-users-fk-coverage.test.ts` lit `pg_constraint` et y relève les FK vers `users` sans `ON DELETE` (59). Chacune doit être traitée de l'une de ces façons :
  - par compte, `inArray(<table>.<colonne>, testUsers)` dans `deleteOrphanTestRows` ;
  - par préfixe, `orphan(<table>.…)` ;
  - par la liste gelée `NOT_YET_HANDLED` (36), comparée en égalité stricte.
- **Pourquoi** : une FK oubliée fait échouer le hook global de tous les fichiers. C'est déjà arrivé avec alerts, missions, document_renewal_centers et status_history. Le traitement de status_history existait déjà sur main (`test-cleanup-status-history.test.ts`). Il restait le garde-fou.
- **Preuves** : rouge si la ligne `statusHistory.updatedById` du nettoyage d'orphelins est retirée (3 échecs, dont le test existant). Vert 5/5 sur Postgres local, tsc 0.

## 2026-11-03 16:47 — Scan des lectures GET : sept contournements fermés (#176)

- **Quoi** : `tests/support/route-guard-scan.ts` refuse désormais sept formes qui le trompaient. Chaque refus reste en échec fermé.
  - A : un alias d'import (`authenticate as isStaff`) vaut la garde d'origine.
  - B : une garde connue redéclarée localement (`const`, `function`) sans être reclassée devient permissive.
  - C : un `router.use(garde)` ne couvre que les routes déclarées après lui.
  - D : un répartiteur `sessionGuard` qui appelle `next()` en direct est permissif.
  - E : un marqueur de cloison placé dans une chaîne ou un gabarit ne compte pas.
  - F : une réponse 4xx ou 5xx dont le corps n'est pas un message littéral compte comme un envoi de donnée.
  - G : `ownerScopeOf` ou `canAccessOwned` dont le résultat est jeté ne compte pas.
- **Où** : fixtures dans `tests/unit/server/route-guard-scan-bypass.test.ts`, avec 11 contournements refusés et 8 formes saines acceptées.
- **Pourquoi** : la poc #176 montrait qu'une route ouverte au client pouvait passer le garde-fou sans aucune cloison.
- **Preuves** :
  - sur le code réel, les offenders sont identiques à `OPEN_GET_READS_FROZEN` (aucun ajout, aucun retrait) ;
  - avec le scanner de main, le test échoue sur 11 cas (les 10 contournements et l'alias sain) ;
  - tsc 0.

## 2026-11-03 16:59 — Ménage des restes de test : pleins d'un véhicule orphelin

- **Quoi** :
  - `deleteOrphanTestRows` supprime les pleins d'un véhicule orphelin avant le véhicule, quelles que soient leurs notes.
  - Test : `tests/integration/test-cleanup-orphan-fuel-records.test.ts`.
- **Pourquoi** : signalé par aa.
  - Sur la base de contrat partagée, `fuel_records_vehicle_id_vehicles_id_fk` bloquait la suppression d'un véhicule orphelin.
  - Chaque fichier de contrat ressortait donc en échec alors que ses tests passaient.
  - Le balayage par préfixe des notes ne voit pas un plein saisi sans préfixe.
- **Preuves** :
  - rouge sans la ligne : 1 échec ;
  - vert 6/6, avec la garde des FK vers users et le test status_history ;

## 2026-11-03 16:55 — Couche 3 : kilométrage et position d'atelier ciblés par véhicule

- **Quoi** :
  - Le groupe vehicleOperations ne rafraîchit plus toutes les fiches véhicule (préfixe `/api/vehicles/`). Il rafraîchit la fiche du véhicule touché, par `/api/vehicles/<id>` et par l'immatriculation, ainsi que les listes `/api/vehicles`, `/all` et `/all-with-status`.
  - Gabarits `byId` dans `realtime-satellites.ts`, remplis depuis la charge de l'événement.
  - Sans identifiant dans la charge, repli sur le préfixe large.
- **Pourquoi** : un relevé de kilométrage invalidait chaque fiche, chaque liste de documents et chaque liste de pneus ouvertes dans le cache de tous les profils.
- **Preuves** :
  - rouge contre main : 1 échec sur le ciblage ;
  - vert 16/16 ;

## 2026-11-03 17:08 — e2e : plein de mission sans réponse, un seul débit (FUEL-DBL)

- **Quoi** : `e2e/21-mission-fuel-double-debit.spec.ts`.
  - Le chauffeur valide un plein.
  - `page.route` laisse la requête atteindre le serveur, qui écrit le plein (`route.fetch`), puis jette la réponse (`route.abort`).
  - Le chauffeur ferme la fiche (Annuler), la rouvre et renvoie le même plein.
  - Attendu : même `requestKey` aux deux envois, rejeu en 2xx, un seul débit en base pour la mission.
- **Pourquoi** : niveau E de #181.
  - Les contrats prouvent le rejeu côté serveur.
  - Seul un navigateur prouve que la clé survit à une issue inconnue et à la fermeture de la fiche (sessionStorage, `discard` qui garde une clé incertaine).
- **Preuves** :
  - vert sur Postgres local, serveur sur un port dédié, Chrome (`E2E_CHANNEL=chrome`) ;
  - rouge quand `discard` libère aussi une clé incertaine : le renvoi part avec une nouvelle clé ;
  - vert de nouveau après retour arrière ;
  - tsc 0.

## 2026-11-03 17:11 — Garde : toute alerte créée émet alert_created

- **Quoi** : `tests/unit/server/alert-emission-hygiene.test.ts` et le scanner `tests/support/alert-emission-scan.ts` (API TypeScript).
  - Le scanner recense les écritures d'alerte sous server/ : `insert(alerts)`, `createAlert(…)` et `INSERT INTO alerts`.
  - Pour chacune, il exige dans la fonction englobante (ou le gestionnaire `METHODE /chemin`) `broadcastAlertCreated`, la chaîne `alert_created` ou un helper local qui émet.
- **Résultat sur main** : 15 écritures, dont 10 qui émettent.
  - Deux exceptions justifiées : la primitive `storage.createAlert` et la restauration de sauvegarde.
  - Trois défauts gelés en égalité stricte : `POST /api/alerts`, `POST /api/test-date-maintenance`, `storage.checkAndCreateStockAlerts` (stock bas).
- **Pourquoi** : section « Émetteurs non traités » de l'audit temps réel ; la réception de pièces est corrigée par #180 (b7). Cette garde complète `alerts-write-hygiene`, qui couvre UPDATE et DELETE.
- **Preuves** :
  - rouge quand l'émission de `procurement-service` est retirée : 1 échec ;
  - unitaires 1862/1862 ;

## 2026-11-03 17:17 — Couche 3 : work_order_item_changed rafraîchit les KPI de coût

- **Quoi** : `work_order_item_changed` rejoint `EVENT_SATELLITES` avec les groupes `workOrderCost` et `workOrderLists`. Une famille « coût OT » (`^work_order_item`) est suivie par la garde, qui exige `workOrderCost`.
- **Pourquoi** : les heures réelles d'une tâche sont valorisées dans `loadCostRows` (`kpi-service`), qui alimente `/api/kpi/maintenance-costs` et `avg-cost-per-intervention`. Le case client n'invalidait que l'OT et les listes.
- **Preuves** :
  - rouge sur main : 2 échecs ;
  - unitaires 1855/1855 ;
  - tsc 0.

## 2026-11-03 17:16 — Carte d'impact : e2e/ et scripts/ déclenchent la porte unit

- **Quoi** : `.github/appfactory-impact.json`, les surfaces `e2e` et `scripts` gagnent `unit`.
- **Pourquoi** : main rouge après #194. La garde `toast-title-exact-hygiene` lit e2e/, et la CI d'une PR limitée à e2e/ ne la lançait pas. Leçon dans `docs/analysis/LESSONS_LEARNED.md`.
- **Preuves** : unitaires 1854/1854 avec la spec corrigée.

## 2026-11-03 17:40 — Garde : routes de routes.ts masquées par server/api/

- **Quoi** : `scanShadowedRoutes` (`tests/support/route-guard-scan.ts`) compare méthode et chemin complet, paramètres anonymisés, entre les routeurs montés dans `server/api/index.ts` et les `app.*` de `server/routes.ts`. `routes-hygiene` fige la liste en égalité stricte : 15 doublons.
- **Pourquoi** : `apiRouter` est monté avant `registerRoutes`, donc la déclaration de `routes.ts` dort avec ses gardes. Cas réel : `POST /api/fuel-card/consumption` acceptait un prix client sous `authenticate` (supprimé par #201).
- **Preuves** :
  - rouge si une entrée est retirée de la liste ;
  - unitaires 1886/1886 ;
  - tsc 0.
## 2026-11-03 17:33 — Couche 2 : l'alerte de stock bas est diffusée (alert_created)

- **Quoi** : `storage.checkAndCreateStockAlerts` émet `alert_created` après le commit de l'alerte.
  - Hors transaction, la trame part tout de suite.
  - Dans une transaction, elle passe par `StockWriteOptions.afterCommit`. La route de sortie joue les effets une fois la transition validée.
- **Pourquoi** : l'alerte de stock bas était écrite sans trame, donc la cloche du magasin ne bougeait qu'au rafraîchissement suivant. Dans une transaction, l'alerte était aussi écrite hors de celle-ci et survivait à son annulation. Elle suit désormais l'exécuteur du mouvement.
- **Aussi** : retrait de l'appel mort `/api/invoices/monthly-stats` (`useBilling`, `api-calls`, `billingService`), qu'aucune route ne servait. Les deux listes gelées se réduisent d'autant.
- **Preuves** :
  - intégration `stock-alert-broadcast` : 4 cas, 3 rouges contre main ;
  - contrat `stock-issue-alert-broadcast` : rouge contre main ;
  - contrats de la sortie : 19/19 ;
  - unitaires : 1868/1868 ;
  - tsc : 0.

- Suite de relecture (#202) : l'alerte de stock bas ne s'écrit plus dans la transaction du mouvement mais après son commit, par `alertService.notifyLowStock`. Un échec de l'alerte (insert refusé) n'annulait pas seulement l'alerte : Postgres annulait toute la sortie. Destinataires : tous les admins et magasiniers (décision du 3 novembre 2026), une alerte et une trame nominatives chacun, anti-doublon par destinataire. Preuves : intégration 5/5 (4 rouges sur l'état précédent, dont l'échec d'insert forcé par déclencheur), contrat 1/1 rouge sur l'état précédent (magasinier tiers servi, technicien et client exclus).

- CI coupée sur les PR brouillons (décision du 3 novembre 2026). **Quoi** : `ci.yml` et `build-android-apk.yml` ne lancent rien sur un brouillon, et un run complet part au passage en ready (`ready_for_review`). **Comment** : `types` explicites, condition `draft` sur le job d'entrée, push sur `main` inchangé. **Pourquoi** : chaque poussée d'un brouillon payait la suite complète. La preuve se fait sur une PR de test (un brouillon, puis ready).

- Routes mortes de `routes.ts` supprimées (liste `SHADOWED_LEGACY_ROUTES_FROZEN` vidée). **Quoi** : 13 déclarations masquées par `server/api` (auth ×2, fuel-card ×7, suppliers/top, fault-catalog PATCH, workflows POST et PATCH), et le code qu'elles seules appelaient : `vehicle-auto-creation.ts`, `storage.updateFaultCatalog`, imports `isFuelCardManager`, `faultCatalog`, `vehicleAcquisitionWorkflows`. `PATCH /api/admin/users/:id/toggle` est conservée (garde chaînée). **Comment** : une famille, un contrat existant qui distingue la route servie de la morte (chauffeur désactivé, client en 403, valideur forcé et 404, statut ignoré et aucun véhicule créé par WFL1). **Pourquoi** : une route masquée dort avec ses gardes ; elle revient si l'ordre de montage change. Constat annexe : `GET /api/suppliers/summary` est capté par `/:id` (400), consigné par un contrat `it.fails`, correctif dans une autre PR.

## 2026-11-03 18:52 — DOC1 : sélecteur de centre sans centre inactif, cas manquants du contrat

- **Quoi** : test unitaire `tests/unit/client/renewal-center-selector.test.ts` (3 cas) et deux cas ajoutés au contrat existant `document-renewal-centers.contract.test.ts` (#99, #118). Ligne DOC1 du plan passée à « Fait ».
  - Aucun filtre n'existe côté écran : les deux sélecteurs affichent la réponse de `GET /api/document-renewals/centers`, l'API retire les inactifs. Le test garde donc l'appel (jamais `includeInactive`) ; le filtre `is_active` de la route est couvert par le contrat, pas par une regex sur le source.
  - Contrat : `PATCH /active` avec `isActive` non booléen ou absent (400), id non numérique (404), reste inactif après une seconde désactivation ; filtre par type (centre d'un autre type absent, centre sans type présent) ; chauffeur et client en 403 sur la lecture.
- **Pourquoi** : DOC1 était couvert côté API seulement ; rien ne gardait le côté écran.
- **Preuves** : unitaire rouge si `document-renew.tsx` ajoute `includeInactive=1` (2 cas sur 3 en échec), vert après retour.

- DRV2 passé à « Fait » : le défaut DRV2-4 est corrigé. **Quoi** : le tableau de bord chauffeur ne montrait que la première mission `assigned` ou `in_progress`. Toutes les missions à faire sont maintenant affichées : `in_progress` d'abord, puis par enlèvement croissant (`/api/drivers/me` trie à l'envers, l'ordre est refait côté client). Les suivantes sont listées sous la mission active, dans un bloc « Ensuite ». Il n'y a pas de filtre par jour (`splitDriverMissions`, `client/src/lib/driver-missions.ts`). Le `test.fail` DRV2-4 de `e2e/19-driver-space` est devenu un test ordinaire. **Comment** : un helper pur avec son test unitaire (`tests/unit/client/driver-missions.test.ts`), et l'écran qui le consomme. **Pourquoi** : panne vers OT, trame WebSocket à deux profils et cloison étaient déjà couverts. DRV2-4 était le seul écart restant. **Preuves** : e2e `19-driver-space` 15/15 en local (le DRV2-4 était rouge sur main, d'où son `test.fail`) ; unitaires 1946/1946 ; tsc 0.

## 2026-11-04 14:14 — #286 : fusion de #278 et de main, échec dépendant de l'ordre (#293)

- **Quoi** : fusion de `fix/login-identifier-digest` (#278) et de `main` dans `fix/change-password-attempts`. Commentaire de `keyOf` placé au-dessus de son champ dans `LockoutGuardOptions`.
  - Filtre de reprise : les préfixes sans nom saisi (`pin:`, `cpw:`, empreinte) de #286 sont combinés avec la clause M-3 de #278 (nom numérique rangé dans `entity_id`).
- **Comment** : conflits résolus bloc par bloc, sans `checkout --ours` (near miss consigné dans LESSONS). LESSONS fusionné en union, sans entrée en double.
- **Pourquoi** : chaque PR de la pile ne doit montrer que son sujet face à `main`.
- **Diagnostic #293** (« R8 : pin-login, compte inconnu et PIN faux ») :
  - le test passe seul et n'échoue que dans la suite complète des contrats, selon l'ordre d'exécution ;
  - cause : plusieurs fichiers de contrat utilisent le même identifiant chauffeur inexistant, donc le même compteur d'échecs `pin:999999999` sur la base de test partagée. Selon l'ordre, ce compteur est déjà au seuil ;
  - piste : un identifiant inexistant propre à chaque fichier, ou le nettoyage de ce compteur (`storedLockoutKey`) avant chaque cas.

## 2026-11-04 14:39 — Lot atomique : réservation de la tentative avant la vérification du secret, limite par IP

- **Quoi** : la garde par compte (`pwd:`, `pin:`, `cpw:`) réserve la tentative avant le handler, sous un verrou consultatif par clé. Elle refuse en 503 si le compteur est en panne. Un plafond d'échecs par IP est ajouté devant `/api/auth/login` et `/api/auth/pin-login`.
- **Comment** :
  - garde par compte : 401 → échec confirmé ; 2xx → remise à zéro ; 400 ou 5xx → tentative rendue ;
  - limite IP : seuls un 2xx ou un 400 rendent leur jeton, une 5xx reste comptée (filet anti-abus, décision de 0a).
- **Pourquoi** : lire, laisser passer, puis écrire après le bcrypt laissait une rafale simultanée vérifier plus de secrets que le seuil (voir LESSONS, « Compteur anti-force brute lu puis écrit en deux temps »).
- **Audit sécurité** : GO sous réserve.
  - R1 (garde ouverte sur panne) et m6 (connexion cassée rendue au pool) sont corrigés dans ce lot.
  - R2 (validation du corps de `/auth/login` avant la garde, dans `server/api/index.ts`), m3 (agrégation IPv6 par /64), m4 (seuil derrière un NAT) et m5 (taille de la section critique) sont remontés à l'orchestrateur.
- **Preuves** :
  - contrat `login-lockout-concurrency` : rafales sur les trois espaces et sur la limite IP ;
  - intégration `login-lockout-db-store` : 20 réservations parallèles, exactement MAX admises, un seul audit ;
  - unitaires `auth-ip-limit` : 9/9.

## 2026-11-05T00:24:24+01:00 — Démos e2e par profil (technicien, secrétariat, client)

- **Agent** : b7 (fleet-testeur) · **Branche** : `feat/e2e-demo-profils` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : trois parcours filmés, un par profil, hors suite e2e par défaut : technicien (demande de pièce puis clôture de l'OT), secrétariat (renouvellement d'une assurance avec justificatif), client (ses véhicules, preuve de cloison 403).
- **Comment** : `e2e/demo/` (seed idempotent gardé sur fleet_test en local, helpers, 3 specs, README) ; `playwright.config.ts` ignore `e2e/demo/` sauf `E2E_DEMO=1`. Build : comptes et données par upsert sur clés naturelles (recette-seed non réutilisé, garde d'environnement incompatible).
- **Pourquoi** : démonstration par profil ; ne remplace aucun test.
- **Comment tester (QA)** : seed puis `E2E_DEMO=1 E2E_RECORD=1 node --env-file=.env node_modules/@playwright/test/cli.js test e2e/demo/<spec> --reporter=list` sur base locale ; attendu : 1 passed, 2 passages consécutifs.
- **RAIDER** : I (seed rejouable), D (suite par défaut inchangée), E (refus hors base locale) ; ne s'applique pas : code produit.
- **Reste / risques** : dialogue de renouvellement rapide de `vehicle-documents.tsx` inatteignable (code mort, le bouton mène à la page de renouvellement).

## 2026-11-05T00:33:32+01:00 — Démos e2e : réserves de relecture de #324

- **Agent** : b7 (fleet-testeur) · **Branche** : `feat/e2e-demo-profils` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : garde de base durcie (URL analysée : hôte local et chemin exactement `/fleet_test`), appelée dans chaque spec ; seed qui réconcilie rôle, mot de passe et propriétaire ; demandes de renouvellement de la démo purgées ; README sans `--env-file=.env` seul. Correction de l'entrée précédente : le seed est rejouable sans doublon en base, mais le justificatif téléversé reste dans `uploads/`.
- **Comment tester (QA)** : `DATABASE_URL` vers une autre base : le seed et les specs échouent ; sinon 3 specs vertes.
- **RAIDER** : I et E (garde stricte, réconciliation) ; ne s'applique pas : code produit.
- **Reste / risques** : fichier de justificatif dans `uploads/`.

## 2026-11-05T00:45:31+01:00 — Démo logistique (lot 2, profil 1)

- **Agent** : b7 (fleet-testeur) · **Branche** : `feat/e2e-demo-profils-2` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : parcours logistique filmé : création de la mission (assistant en 4 étapes), lancement avec budgets, livraison, clôture, facture client.
- **Comment** : `e2e/demo/04-logistique.spec.ts` ; seed enrichi (client donneur d'ordre, véhicule aux 3 papiers valides, chauffeur avec date CPC récente, crédit de carte). Le statut CPC affiché est recalculé depuis la date de formation : le seed fournit la date, pas seulement le libellé.
- **Pourquoi** : démonstration par profil.
- **Comment tester (QA)** : seed puis `E2E_DEMO=1 E2E_RECORD=1` sur la spec, base locale fleet_test ; attendu 1 passed, 2 passages.
- **RAIDER** : I (missions de démo purgées à chaque seed), E (garde de base) ; ne s'applique pas : code produit.
- **Reste / risques** : une mission créée avec véhicule et chauffeur reste « planned » (non « assigned ») : à confirmer côté produit.

## 2026-11-05T01:01:55+01:00 — Démo chef d'atelier (lot 2, profil 2)

- **Agent** : b7 (fleet-testeur) · **Branche** : `feat/e2e-demo-profils-2` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : création d'un OT par l'assistant, assignation à un technicien depuis la liste, démarrage et clôture depuis le détail.
- **Comment** : `e2e/demo/05-chef-atelier.spec.ts` ; seed : véhicule DEMO-CHEF-001, OT de démo purgés à chaque lancement ; mot de passe de terry aligné sur le défaut e2e (workshop123, exigé par le préflight des comptes).
- **Comment tester (QA)** : seed puis `E2E_DEMO=1 E2E_RECORD=1` sur la spec, base locale ; attendu 1 passed, 2 passages.
- **RAIDER** : I (purge), E (garde de base) ; ne s'applique pas : code produit.
- **Reste / risques** : l'assignation ne démarre pas l'OT (il reste « En attente » et seul « Voir OT » reste dans la liste) ; démarrage par le détail uniquement.

## 2026-11-05T01:26:11+01:00 — Démo magasinier (lot 3)

- **Agent** : b7 (fleet-testeur) · **Branche** : `feat/e2e-demo-profils-3` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : réception d'une commande fournisseur confirmée (code de livraison), entrée en stock, puis sortie de la pièce depuis l'onglet Pièces de l'OT en attente.
- **Comment** : `e2e/demo/06-magasinier.spec.ts` ; seed : fournisseur, commande DEMO-BC-001, OT en attente de pièces et sa demande liée ; purge des factures fournisseur générées par la réception. Ouverture de la commande par le bouton œil de la ligne (le numéro n'est pas un lien).
- **Comment tester (QA)** : seed puis `E2E_DEMO=1 E2E_RECORD=1` sur la spec, base locale fleet_test ; attendu 1 passed, 2 passages (verts, 16 à 17 s).
- **RAIDER** : I (purge et recréation à chaque seed), E (garde de base) ; ne s'applique pas : code produit.
- **Reste / risques** : le magasinier n'a pas de lien vers les ordres de travail : accès par la carte « en attente de pièces » de Demandes de pièces, repli par URL directe si elle est absente.

## 2026-11-05T01:41:28+01:00 — Démo magasinier : ouverture par le lien du numéro (suite de #332)

- **Agent** : b7 (fleet-testeur) · **Branche** : `feat/e2e-demo-profils-3` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : la spec 06 ouvre la commande par le lien du numéro (ligne cliquable depuis #332) ; toast asserté en exact (garde toast-title-exact-hygiene) ; README : parcours du magasinier.
- **Comment tester (QA)** : seed puis spec, 2 passages verts (16,8 s et 17,1 s) ; `npm run check` 0 erreur ; unitaires 202 fichiers / 2335 tests verts.
- **RAIDER** : D (garde d'hygiène des e2e respectée) ; ne s'applique pas : code produit.
- **Reste / risques** : spec 07 direction en cours de mise au point (tableau de bord et rapports via onglets).

## 2026-11-05T01:45:20+01:00 — Démo direction (lot 3)

- **Agent** : b7 (fleet-testeur) · **Branche** : `feat/e2e-demo-profils-3` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : connexion direction, tuiles du tableau de bord, corridors CEMAC, rapports (board pack par le menu, puis onglets trésorerie et audit flotte/TCO).
- **Comment** : `e2e/demo/07-direction.spec.ts` ; seed : compte direction1. Les rapports affichent 0 FCFA faute de données de période : la démo montre la navigation, pas des chiffres.
- **Comment tester (QA)** : seed puis spec, 2 passages verts (21,5 s et 21,1 s).
- **RAIDER** : E (garde de base) ; ne s'applique pas : code produit.
- **Reste / risques** : rapports vides (aucune facture de la période) ; un seed de facturation donnerait une démo plus parlante.

## 2026-11-05T02:10:00+01:00 — Démos : specs autonomes et assertions dures (réserves de relecture de #331)

- **Agent** : b7 (fleet-testeur) · **Branche** : `feat/e2e-demo-profils-3` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : chaque spec de démo (01 à 07) rejoue `seedDemo()` en `beforeAll` et devient autonome ; la spec magasinier exige la carte de l'OT en attente de pièces (plus de repli par URL) ; la spec direction cible le bouton « Rapports Direction » par son rôle.
- **Comment** : `e2e/demo/01..07-*.spec.ts` ; le seed est idempotent, donc le rejeu est sans effet de bord.
- **Comment tester (QA)** : `E2E_DEMO=1` sur `e2e/demo`, 2 passages de 7 specs verts avec rejeu du seed entre les deux (3,7 min chacun) ; `npm run check` à 0 erreur ; unitaires 202 fichiers / 2335 tests verts.
- **RAIDER** : I (specs rejouables seules) ; D (assertions dures) ; ne s'applique pas : code produit.
- **Reste / risques** : facture de période pour les rapports de direction et paiement de facture dans la PR suivante.

## 2026-11-05T02:40:00+01:00 — Démo paiement de facture et factures de période (lot 4)

- **Agent** : b7 (fleet-testeur) · **Branche** : `feat/e2e-demo-profils-4` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : démo « paiement de facture » (secrétaire : acompte puis solde) ; deux factures de période au seed, qui alimentent les rapports de direction (715 500 FCFA encaissés, 1 192 500 FCFA de créances), avec assertion dure dans la spec direction.
- **Comment** : `seedClientInvoices` purge `DEMO-FAC-%` (paiements en cascade) puis recrée ; `e2e/demo/08-paiement-facture.spec.ts` ; `07-direction.spec.ts`.
- **Comment tester (QA)** : seed puis specs 07 et 08, 2 passages verts chacune avec rejeu du seed.
- **RAIDER** : I (purge et recréation, sans doublon) ; ne s'applique pas : code produit.
- **Reste / risques** : audit flotte et TCO à 0 (aucune mission terminée au seed).

## 2026-11-05T03:10:00+01:00 — Démo administrateur (lot 4)

- **Agent** : b7 (fleet-testeur) · **Branche** : `feat/e2e-demo-profils-4` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : l'administrateur ouvre Administration, Utilisateurs, modifie le compte « recrue1 » (magasinier) et lui donne le rôle de technicien.
- **Comment** : `e2e/demo/09-admin.spec.ts` ; seed : comptes admin1 et recrue1 (le rôle de départ est rétabli à chaque seed par `ensureUser`).
- **Comment tester (QA)** : seed puis spec, 2 passages verts (36,5 s et 42,5 s).
- **RAIDER** : I (rôle rétabli au rejeu) ; ne s'applique pas : code produit.
- **Reste / risques** : aucun.

## 2026-11-05T03:40:00+01:00 — Mission terminée au seed : audit flotte et TCO non nul (lot 4)

- **Agent** : b7 (fleet-testeur) · **Branche** : `feat/e2e-demo-profils-4` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : le rapport « Audit Flotte & TCO » était à 0 faute de donnée : le seed crée une mission terminée de la période, affectée à un camion et facturée.
- **Comment** : `seedFleetAudit` (mission DEMO-TCO-001, affectation terminée, facture DEMO-FAC-003 payée), purgée puis recréée à chaque seed ; assertions « 1 camion » et encaissé 1 668 900 FCFA dans `07-direction.spec.ts`.
- **Comment tester (QA)** : specs 07, 04 et 08 vertes après le seed (04 non perturbée par la nouvelle mission).
- **RAIDER** : I (purge et recréation) ; ne s'applique pas : code produit.
- **Reste / risques** : aucun.

## 2026-11-05T04:10:00+01:00 — Démo e2e chauffeur : mission du jour et départ (lot 4)

- **Agent** : b7 (fleet-testeur) · **Branche** : `feat/e2e-demo-profils-4` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : dixième profil de démo, le chauffeur voit sa mission du jour sur son tableau de bord et confirme le départ (statut en cours en base).
- **Comment** : `seedDriverDay` (compte chauffeur1 relié à une fiche chauffeur, véhicule aux papiers valides, mission affectée avec budgets carburant, FDR et imprévus) ; helper `ensureValidPapers` extrait du seed logistique ; spec `10-chauffeur.spec.ts`. Le départ est refusé sans budgets renseignés (constaté au premier essai, 400), le seed les pose.
- **Comment tester (QA)** : `E2E_DEMO=1 ... test e2e/demo/10-chauffeur.spec.ts`, 2 passages verts avec rejeu du seed (13 s de vidéo) ; 04 reste verte.
- **RAIDER** : I (mission purgée puis recréée) ; ne s'applique pas : code produit.
- **Reste / risques** : aucun.

## 2026-11-05T05:00:00+01:00 — Démos 01 et 05 : geste Commencer du technicien, mineurs du seed (lot 4)

- **Agent** : b7 (fleet-testeur) · **Branche** : `feat/e2e-demo-profils-4` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : le démarrage d'une intervention est fait par le technicien (bouton « Commencer »), plus par le chef d'atelier ; deux mineurs de relecture du seed levés.
- **Comment** : 01 : l'OT du seed est `pending`, le technicien l'ouvre dans « En attente » et le démarre. 05 : le chef crée et assigne à un technicien de démo dédié (`demotech2`, l'assignation du technicien principal étant refusée par un conflit de créneau avec son OT en attente), déconnexion par le menu, le technicien démarre, le chef clôture. `loginThroughForm` reclique si le premier clic après démarrage du serveur n'a pas déclenché l'appel de connexion ; `ensureUser` réconcilie aussi le nom ; échéances de papiers écrites seulement si la date diffère ; mouvements d'entrée des réceptions précédentes purgés (11 avant et après deux seeds consécutifs).
- **Comment tester (QA)** : specs 01 et 05 vertes sur 2 passages avec rejeu du seed (05 : 41 s de vidéo), 06 verte sur 2 passages ; `npm run check` 0 erreur, unitaires 202 fichiers / 2335 tests.
- **RAIDER** : I (écritures seulement si l'état diffère, purge des mouvements) ; ne s'applique pas : code produit.
- **Reste / risques** : l'assignation d'un OT à un technicien déjà affecté en attente répond 409 (conflit de créneau, comportement produit).

## 2026-11-05T03:30:00+01:00 — Démos : réserves de relecture de #344 (nom logi1, ciblage 01, montants 07, dates locales)

- **Agent** : b7 (fleet-testeur) · **Branche** : `feat/e2e-demo-profils-4` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : quatre réserves de relecture levées sur le seed et les specs de démo.
- **Comment** : seed : `logi1` redevient « Jean Tchoumi » (plus de doublon de nom avec `demotech2`) ; `isoDayFromNow` et les dates « aujourd'hui / échéance » passent en jour calendaire local au lieu d'UTC. 01 : le bouton Commencer est celui de la carte qui porte le titre de l'OT de démo. 07 : montants exacts remplacés par des assertions non nulles, la base de test étant partagée.
- **Comment tester (QA)** : `npm run check` 0 erreur ; unitaires 210 fichiers / 2432 tests ; rejeu e2e/demo 01 à 10, 2 passages (résultats dans le rapport de PR).
- **RAIDER** : I (seed rejouable) ; D (assertions indépendantes des autres données) ; ne s'applique pas : code produit.
- **Reste / risques** : aucun.

## 2026-11-05T04:10:00+01:00 — Démo 09 : recherche du compte dans la liste paginée

- **Agent** : b7 (fleet-testeur) · **Branche** : `feat/e2e-demo-profils-4` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : la démo admin échouait une fois sur quatre passages (ligne `recrue1` introuvable en 30 s).
- **Comment** : la liste `/admin/users` est paginée par 10 sur une base partagée ; la spec saisit désormais le nom du compte dans le champ de recherche avant de viser la ligne. Cause probable (non reproduite à l'identique, artefacts écrasés par le passage suivant) : le compte sorti de la première page.
- **Comment tester (QA)** : 09 verte sur 2 passages avec rejeu du seed (20,6 s et 16,5 s) ; passage complet 01 à 10 : 10/10 au passage 2.
- **RAIDER** : D (indépendance vis-à-vis du volume de comptes) ; ne s'applique pas : code produit.
- **Reste / risques** : le diagnostic reste une hypothèse ; si le défaut revient, regarder le délai de la requête `/api/admin/users`.

## 2026-11-05T04:40:00+01:00 — Démo 07 : montant limité à la carte « Encaissé »

- **Agent** : b7 (fleet-testeur) · **Branche** : `feat/e2e-demo-profils-4` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : l'assertion Trésorerie pouvait passer grâce au seul « Poste Carburant ».
- **Comment** : le montant FCFA non nul est cherché uniquement dans la carte « Encaissé (factures clients réglées) ».
- **Comment tester (QA)** : 07 verte sur 2 passages avec rejeu du seed (28,6 s et 39,0 s) ; `npm run check` 0 erreur.
- **RAIDER** : D (assertion qui cible la bonne donnée) ; ne s'applique pas : code produit.
- **Reste / risques** : aucun.

## 2026-11-05T15:40:00+01:00 — Contrat : liste complète des motifs de refus de lancement

- **Agent** : fleet-testeur · **Branche** : `fix/e2e-acquisition-mission` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : garde-fou sur `body.motifs` du refus de lancement de mission (#354 / #466).
- **Comment** : `tests/contract/mission-launch-driver-message.contract.test.ts` : véhicule à assurance échue, sans budget ; le motif assurance est tu par le message borné et doit rester dans `motifs`. Entrée de leçon dans `LESSONS_LEARNED.md`.
- **Comment tester (QA)** : contrat sur Postgres local : 3 passed ; rouge (1 failed, `motifs` absent) avec `details` commenté dans `missions.routes.ts`.
- **RAIDER** : D (contrat client figé) ; ne s'applique pas : code produit inchangé.
- **Reste / risques** : aucun.

## 2026-11-06T12:55:00+01:00 — 503 intermittent sur la garde de connexion : plafond de connexion des pools

- **Agent** : de (fleet-testeur) · **Branche** : `fix/contract-login-503` · **Commit** : voir `git log`
- **Statut** : fait (PR brouillon)
- **Quoi** : `work-order-items.contract.test.ts` échouait par intermittence en 503 sur le login après environ 30 s.
- **Comment** :
  - Cause côté environnement : le relais de ports de Docker Desktop accepte la socket puis la coupe à 30 s (`read ECONNRESET`) sous rafale.
  - Cause côté produit : aucun plafond de connexion, et neon 0.10.4 plantait (TypeError non rattrapée) dès qu'on en posait un.
  - Correctif : `DATABASE_CONNECT_TIMEOUT_MS` (défaut 10 000 ms, 0 = sans plafond, valeur invalide = démarrage refusé), appliqué à `pool` et `listenerPool` ; neon passe en 1.2.0. La garde reste fermée sur panne (503).
- **Comment tester (QA)** :
  - `tests/unit/server/db-pool-options.test.ts` : serveur TCP muet, rejet au plafond sans fuite. Rouge en 0.10.4 (TypeError), vert en 1.2.0.
  - `tests/integration/session-store-neon-pool.test.ts` : aller-retour de session à travers le Pool neon, store de production et création de table.
  - Campagnes sur Postgres local : unitaires 301/301, intégration 73/73 et 1/1, contrats 254/254, work-order-items 10/10 en boucle (13 à 18 s, aucun 503).
- **RAIDER** : R/A (plafond configurable par variable d'environnement, sans hypothèse d'hébergeur) ; D (comportement de la garde inchangé, contrats verts) ; Failure memory (`LESSONS_LEARNED.md`, `tests/README.md`).
- **Reste / risques** : le plafond borne aussi l'attente d'une place dans le pool (max 10 par défaut, inchangé) : sous saturation de plus de 10 s, la requête répond par un 5xx générique avec sa référence. Prod sur GO de l'utilisatrice.

## 2026-11-06T13:12:00+01:00 — Pools Postgres : erreur d'une connexion au repos journalisée, sans arrêt du processus

- **Agent** : de (fleet-testeur) · **Branche** : `fix/db-pool-error-listener` · **Commit** : voir `git log`
- **Statut** : fait (PR brouillon)
- **Quoi** : `server/db.ts` n'écoutait pas `error` sur `pool` ni `listenerPool`. Une connexion inactive qui casse (redémarrage de la base, coupure réseau) levait l'erreur et arrêtait le serveur. Relevé par la revue de sécurité de #582.
- **Comment** : `server/lib/db-pool-errors.ts` (`logPoolErrors`) journalise par `moduleLogger("db")` avec `{ err, pool }`. pg-pool a déjà retiré la connexion fautive, la suivante est neuve.
- **Comment tester (QA)** : `tests/unit/server/db-pool-errors.test.ts` :
  - témoin : sans écouteur, l'émission lève ;
  - l'écouteur journalise sans lever ;
  - le vrai `server/db` porte un écouteur sur chaque pool. Ce test est rouge sans le branchement dans `db.ts`.
  - Campagnes : unitaires 302/302, tsc 0, check:tests 0. Intégration 71/74 : les 3 échecs (timeouts de connexion sous rafale) se reproduisent à l'identique sur main pur, ils viennent du relais Docker et non de ce lot.
- **RAIDER** : R (un seul module pour les deux pools) ; D (aucun changement de comportement hors panne) ; E (log structuré, pas de `console.*`). Ne s'applique pas : I, Retroactive (pas d'état).
- **Reste / risques** : aucun ; une connexion en cours de requête renvoie toujours son erreur à l'appelant (inchangé).

## 2026-11-06T13:33:00+01:00 — Test du plafond de connexion : garde de version du driver

- **Agent** : de (fleet-testeur) · **Branche** : `test/neon-version-guard` · **Commit** : voir `git log`
- **Statut** : fait (PR brouillon)
- **Quoi** : `tests/unit/server/db-pool-options.test.ts` atteignait son délai de 10 s sur un worktree relié par jonction au `node_modules` partagé, resté en neon 0.10.4. Sur cet ancien driver, la connexion reste en suspens : le test était correct, mais l'échec ne donnait pas la cause. Pas de réseau en jeu : l'hôte « db » n'est qu'un paramètre envoyé au serveur TCP local du test.
- **Comment** : une garde compare la version installée à la plage de `package.json` (lue, pas recopiée). Elle échoue tout de suite avec « node_modules obsolète : npm ci », dans un test dédié et dans le `beforeAll` du test du pair muet, qui est alors sauté.
- **Comment tester (QA)** :
  - 10/10 verts lancé seul (tests en 340 à 390 ms) ;
  - rouge en 0,85 s avec ce message sur un worktree temporaire relié au `node_modules` en 0.10.4 (avant : délai de 10 s) ;
  - unitaires 302/302, tsc 0, check:tests 0.
- **RAIDER** : A (version lue dans `package.json`, paquet résolu par Node) ; D (assertions du test inchangées) ; E (erreur actionnable). Ne s'applique pas : I, Retroactive (aucun état).
- **Reste / risques** : le `npm ci` du `node_modules` partagé reste à planifier (décision 0a, moment calme).

## 2026-11-06T14:01:00+01:00 — Rapports de direction : onglets alignés sur les drapeaux

- **Agent** : de (fleet-testeur) · **Branche** : `fix/reports-tabs-flags` · **Commit** : voir `git log`
- **Statut** : fait (PR brouillon)
- **Quoi** : `/management/reports` affichait « Trésorerie & Recouvrement » (drapeau `finance`) et « Distribution & Envois » (`report-schedules`) même avec ces drapeaux éteints, alors que la barre latérale les masquait (constat d'aa).
- **Comment** :
  - `client/src/lib/management-report-tabs.ts` filtre les onglets avec `FEATURE_GATED_HREFS`, la table que lit la barre latérale, et les valeurs de `useFeatureFlags` (hook existant) ;
  - la page ne rend que les onglets visibles et leurs `TabsContent` ;
  - une URL directe vers un onglet masqué retombe sur « Board Pack ».
- **Comment tester (QA)** : `tests/unit/client/management-report-tabs.test.ts` vérifie trois cas :
  - drapeaux éteints, les deux onglets sont absents ; drapeaux allumés, les 5 sont présents ; avec les défauts du catalogue, les deux sont masqués ;
  - une URL directe drapeau éteint retombe sur l'onglet par défaut ;
  - l'onglet affiché fait toujours partie des onglets visibles.
  - Campagnes : unitaires 303/303, tsc 0, check:tests 0.
- **RAIDER** : R (même table de drapeaux que la barre latérale, pas de liste locale) ; D (onglets sans drapeau inchangés) ; E (logique pure testée hors React). Ne s'applique pas : I, Retroactive (pas d'état).
- **Reste / risques** : le drapeau client est cosmétique ; la garde réelle reste `requireFeature` côté serveur. Pas de contrôle visuel dans ce lot.

## 2026-11-06T14:10:00+01:00 — Rapports de direction : sous-titre aligné sur le drapeau report-schedules

- **Agent** : de (fleet-testeur) · **Branche** : `fix/reports-subtitle-flag` · **Commit** : voir `git log`
- **Statut** : fait (PR brouillon)
- **Quoi** : le sous-titre de `/management/reports` annonçait la « distribution automatisée » même drapeau `report-schedules` éteint, alors que l'onglet d'envoi est masqué depuis #588.
- **Comment** : `reportsPageSubtitle(flags)` dans `client/src/lib/management-report-tabs.ts` réutilise `isReportTabEnabled` sur l'onglet d'envoi.
- **Comment tester (QA)** : un cas ajouté à `tests/unit/client/management-report-tabs.test.ts` : avec le drapeau éteint (et avec les défauts du catalogue), aucune mention de la distribution ; avec le drapeau allumé, le texte d'origine. Campagnes : unitaires 303/303, tsc 0, check:tests 0.
- **RAIDER** : R (même garde que les onglets) ; D (texte inchangé drapeau allumé). Ne s'applique pas : A, I, Retroactive.
- **Reste / risques** : aucun.

## 2026-11-07T16:19:50+01:00 — Pneus : statistiques en erreur au lieu de faux zéros, état d'erreur de la page

- **Agent** : de (fleet-testeur) · **Branche** : `fix/tire-stats-error-state` · **Commit** : voir `git log`
- **Statut** : fait (PR brouillon)
- **Quoi** : sur `/inventory/tires` (compte magasinier), `getTireStatisticsAdvanced` avalait toute erreur de base et renvoyait 200 avec des zéros. Après 10 s d'attente d'une place dans le pool, la page affichait « 0 pneu, valeur 0 » sans message. La page n'avait pas non plus d'état d'erreur.
- **Comment** : le service journalise par `moduleLogger` et relance `AppError(500, …, { cause })`. Le catch de la route existante (`routes.ts:3498-3505`, non modifié) répond lui-même 500 : l'utilisateur voit le message générique et la référence, pas le message de l'AppError. La requête des statistiques passe par la queryFn par défaut, qui produit une ApiError avec ce message et la référence. `tiresPageState` (`client/src/lib/tires-page-state.ts`) choisit entre chargement, erreur et prêt :
  - seule une requête **sans données** est en erreur : une relance qui échoue (temps réel, pool saturé) garde la liste et ses dialogues ouverts ;
  - si la liste est en échec, toute la page affiche `LoadingError` (`userMessageOf` et « Réessayer ») ;
  - si seules les statistiques sont en échec, un encart remplace les tuiles et la liste reste visible ;
  - « Réessayer » est désactivé pendant un nouvel essai (`isRetrying`, prop optionnelle de `LoadingError` et `AnimatedError`).
- **Comment tester (QA)** :
  - `tests/unit/server/tire-statistics-advanced-error.test.ts` : rouge avant le correctif, deux échecs (« expected { Object (totalTires, …) } to be an instance of AppError »), vert après ;
  - `tests/unit/client/tires-page-state.test.ts` : après la relecture, 6 échecs sur 7 avant le correctif, dont « liste en cache et relance en échec » (la page passait en erreur) ; 7 sur 7 verts après ;
  - Playwright local, compte warehouse : page normale, puis statistiques forcées en 500, où l'encart d'erreur affiche la référence et le bouton « Réessayer ».
  - Campagnes : tsc 0, check:tests 0, unitaires 305/305 fichiers (3178 tests). prefix-middleware-guardrail est instable sous charge (un échec à la première campagne, vert seul et à la seconde).
- **RAIDER** : R (`LoadingError` et queryFn existants) ; D (réponse inchangée en cas de succès) ; E (pas de détail technique dans le message, log migré, non supprimé). Ne s'applique pas : A, I, Retroactive.
- **Reste / risques** : d'autres méthodes du même service renvoient du vide en cas d'erreur (`getTires`, `getAllVehicleTires`, `getVehicleTires`, `getTireInspections`, `getTireRotations`, `getTireStatistics`, `getLowStockTires`, `getTireAlerts`). Elles sont signalées pour un lot séparé. Les 5 requêtes parallèles de statistics-advanced pèsent sur le pool : un regroupement en une seule requête SQL est prévu après la fusion.

## 2026-11-07T16:43:49+01:00 — Pneus : les lectures lèvent une erreur au lieu de renvoyer du vide, garde d'hygiène

- **Agent** : de (fleet-testeur) · **Branche** : `fix/tire-reads-swallowed-errors` · **Commit** : voir `git log`
- **Statut** : fait (PR brouillon)
- **Quoi** : suite de #591. Huit lectures pneus attrapaient l'erreur de base et renvoyaient `[]`, `{ tires: [], total: 0 }` ou des zéros :
  - dans `tires-service-simplified` : `getTires`, `getAllVehicleTires`, `getVehicleTires`, `getTireInspections`, `getTireRotations`, `getTireStatistics`, `getLowStockTires` ;
  - dans `storage` : `getTireRotationsForWorkOrder`.

  La route répondait 200 et l'écran affichait « aucun pneu ». Le bouchon `getTireAlerts` (`return []`, sans appelant) est retiré.
- **Comment** :
  - chaque lecture journalise par `moduleLogger` et relance `AppError(500, …, { cause })`. Les `console.*` de ces méthodes sont migrés, aucun n'est supprimé ;
  - consommateurs vérifiés : toutes les routes appelantes ont un catch qui répond 500 (`next(error)` pour les rotations d'un OT) ;
  - écrans : un repli `= []` ou `?? 0` changeait le 500 en faux vide. Le tableau de bord magasin, /inventory/tires (montés, inspections, rotations) et le dialogue de montage passent par `queryView` : « Indisponible » et « Réessayer » en échec sans données, cache conservé, montage bloqué tant que les positions occupées sont inconnues. Les autres écrans pneus relèvent d'un lot séparé ;
  - nouvelle garde AST `tests/unit/server/swallowed-read-catch-hygiene.test.ts`, sur le modèle de `swallowed-write-catch-hygiene`. Elle vise un catch sans `throw` qui renvoie `[]`, `{}`, `0` ou un objet de vides. Les 48 cas existants hors pneus sont gelés (cliquet) et aucune entrée pneus n'est admise.
- **Comment tester (QA)** :
  - `tests/unit/server/tire-reads-error.test.ts` : rouge avant le correctif (les 7 du service en un passage, puis le cas `storage`) ; 8 sur 8 verts après ;
  - garde rejouée sur le code d'avant : rouge sur exactement les 8 lectures pneus ; verte après ;
  - `tests/unit/client/tire-reads-error-states.test.ts` : branchement des trois écrans rouge avant, vert après ; Playwright sur /warehouse/dashboard avec low-stock forcé en 500 ;
  - contrats pneus sur Postgres local (8 fichiers, 165 tests) : verts ;
  - campagnes : tsc 0, check:tests 0, unitaires 307/307 fichiers.
- **RAIDER** :
  - R : `AppError` et `moduleLogger` existants, garde calquée sur celle des écritures ;
  - D : réponse inchangée en cas de succès, contrats verts ;
  - E : aucun détail technique dans les messages ;
  - failure memory : leçon du 2026-11-07 dans `LESSONS_LEARNED.md`.

  Ne s'appliquent pas : A, I, Retroactive.
- **Reste / risques** : 48 cas gelés hors pneus, dont 29 dans `storage.ts`. Certains écrans affichent encore une liste vide sur un 500 (comportement déjà présent avant ce lot) ; seule /inventory/tires a un état d'erreur.

## 2026-11-07T17:57:52+01:00 — Pneus : un seul pneu actif par position, garanti en base

- **Statut** : fait (PR brouillon)
- **Quoi** : le contrôle « position libre » de `installTireOnVehicle` (SELECT avant INSERT) laissait passer deux montages simultanés sur la même position. Index unique partiel `uq_vehicle_tires_active_position` sur `vehicle_tires (vehicle_id, position) WHERE status = 'active'`. Dans la même PR, deux mineurs de #592 : le sélecteur de véhicules du dialogue de montage (fetch maison, `= []`) et le Select des pneus montés du formulaire d'inspection (vide en cas d'erreur).
- **Comment** :
  - index posé par `init-database.ts` et sa migration jumelle, sous verrou consultatif, seulement sans doublon ; sinon WARNING, aucune correction, couples (véhicule, position) journalisés par `reportVehicleTireActivePositionGaps` ;
  - 23505 de l'index → 409 « position occupée » à l'installation et à la modification ; `updateVehicleTire` relance (409/500) au lieu de renvoyer `undefined` ; une ligne ajoutée dans le catch existant de `PATCH /api/vehicle-tires/:id` (`server/routes.ts`) pour transmettre l'`AppError`, aucune route ajoutée ;
  - écrans : `queryView` + `InlineQueryError` ; le sélecteur de véhicules passe par la queryFn par défaut.
- **Comment tester (QA)** :
  - contrat concurrence : rouge sans l'index (`[201, 201]`), vert avec (`[201, 409]`, stock 5 → 4) ;
  - intégration (4 tests) : doublons existants, doublon réglé, second démarrage sans écriture ;
  - unitaires : schéma/SQL (4) et conflit 23505 (6), rouges avant ; garde de branchement des écrans pneus étendue (2 cas, rouges sur les écrans d'avant) ;
  - campagnes : tsc 0, check:tests 0, unitaires 310 fichiers / 3218 tests, contrats pneus 8 fichiers / 102 tests sur Postgres local.
- **RAIDER** :
  - R : modèle de réconciliation de `uq_drivers_user_id`, `queryView` et `InlineQueryError` existants ;
  - I : second démarrage sans écriture, prouvé ;
  - D : succès inchangés, 409 déjà renvoyé par le contrôle ; contrats verts ;
  - Retroactive : aucune donnée modifiée, doublons signalés, pas corrigés ;
  - failure memory : leçon du 2026-11-07 dans `LESSONS_LEARNED.md`.

  Ne s'applique pas : A (pas de dépendance d'environnement nouvelle).
- **Reste / risques** : en prod, si des doublons existent, l'index reste absent jusqu'au démontage par l'atelier (WARNING au démarrage). Revue sécurité prévue (stock).

## 2026-11-09T11:51:18+01:00 — Argent et stock : une lecture en échec n'est plus un vide (8 lectures, écrans consommateurs)

- **Statut** : fait (PR brouillon)
- **Quoi** : 8 lectures renvoyaient `[]` ou `0` sur une erreur de base : `getParts`, `getAllStockMovements`, `getPartStockHistory`, `getPartsUsedForWorkOrder`, `getAllPartsUsed`, `getMaintenanceCost` (`storage.ts`), `getPartRequirements`, `getRequirementsByPartId` (`part-requirements-service.ts`). Une panne s'affichait comme « aucun mouvement », « 0 demande » ou un coût d'OT sous-évalué.
- **Comment** :
  - serveur : `storageLog.error({ err, … })` puis `AppError(500, message lisible, { cause })` ; les routes renvoient la 5xx normalisée avec sa référence ; `console.log` de ces fonctions migrés en `debug` ;
  - écrans : `queryView` / `listQueryView` + `InlineQueryError` ou « Indisponible » sur mouvements, demandes, accueil stock, tableau de bord magasin, activité récente, techniciens, nouvelle commande, dialogue de demandes d'une pièce, fiche OT ;
  - fiche OT : `workOrderDisplayCost` rend le coût pièces et le total inconnus si les pièces ne sont pas lues ; l'impression est refusée tant qu'elles ne le sont pas ; l'aperçu de demande ne promet plus « une demande sera créée » si la vérification a échoué ;
  - nouvelle commande : le préremplissage par URL n'est consommé qu'une fois les demandes lues ;
  - rapport PDF des coûts de maintenance : pièces d'OT ou ordres de travail illisibles → rapport refusé au lieu d'un total à 0 ou à l'estimation ; pièces lues une seule fois par OT.
- **Comment tester (QA)** :
  - `tests/unit/server/money-stock-reads-error.test.ts` : 8 lectures, rouges 8/8 sans le correctif serveur, vertes après ;
  - `tests/unit/client/money-stock-reads-error-states.test.ts` : 14 cas, rouges 14/14 sur les écrans d'avant ; `work-order-tires-cost.test.ts` : 3 cas pièces ;
  - cliquet `swallowed-read-catch-hygiene` : 48 → 40 ;
  - campagnes : tsc 0, check:tests 0, unitaires 318 fichiers / 3298 tests, contrats pièces/stock/demandes 19 fichiers / 227 tests sur Postgres local.
- **RAIDER** :
  - R : `queryView`, `listQueryView`, `InlineQueryError`, `formatKnownCost` existants ;
  - D : réponses de succès inchangées ; contrats verts ;
  - failure memory : leçon du 2026-11-07 (#591) appliquée, pas de nouvel incident.

  Ne s'appliquent pas : A, I, Retroactive (aucune donnée ni schéma touchés).
- **Reste / risques** : `warehouse.reorderAlerts` (`useWarehouse.ts`) expose une erreur que 5 tableaux de bord ignorent (`|| 0`) ; `/api/part-requirements/active-by-part` garde un `= {}` par défaut (lecture hors de ce lot). Revue sécurité requise (argent/stock).

## 2026-11-09T14:29:18+01:00 — Argent et stock, suite : rapport complet, valeur du stock, alertes de réappro, historique

- **Statut** : fait (PR brouillon)
- **Quoi** :
  - rapport PDF des coûts de maintenance : `GET /api/work-orders` était appelé sans `limit` (50 par défaut), le rapport ne comptait que les 50 premiers OT. `fetchAllWorkOrders` lit par pages de 500 jusqu'au total ; échec, forme invalide, liste incomplète ou plus de 20 pages → rapport refusé avec un message clair ;
  - même rapport : véhicules ou utilisateurs illisibles → refus ; lecture de `/api/parts/used` retirée (elle ne nourrissait aucun calcul) ;
  - `useWarehouse` : plus d'alertes de réappro calculées sur le stock bas seul quand les demandes de pièce sont illisibles ; `inventoryValue` et `reorderAlerts` exposent `view` / `failed` ;
  - tableaux de bord admin, accueil, chef d'atelier, magasin, panneau d'alertes : « Indisponible » et encart au lieu de 0, « Aucune alerte » ou « Tout est à jour » ;
  - catalogue pièces (statut des demandes), fiche pièce (historique de stock), fiche OT (demandes en attente, compte de l'onglet Pièces) : encart au lieu d'un vide.
- **Comment tester (QA)** :
  - `tests/unit/client/fetch-all-work-orders.test.ts` : 8 cas sur fetch simulé (120 OT sur 3 pages, échec en page 2, page vide avant le total, forme invalide, borne de 20 pages) ;
  - `tests/unit/client/money-stock-reads-error-states.test.ts` : 33 cas, chaque ajout rouge sur le code d'avant puis vert ;
  - campagnes : tsc 0, check:tests 0, unitaires 319 fichiers / 3325 tests. Aucun fichier serveur modifié.
- **RAIDER** :
  - R : `queryView`, `listQueryView`, `InlineQueryError`, `UNAVAILABLE` existants ; `fetchAllWorkOrders` réutilisable par les autres rapports ;
  - D : réponses API inchangées ; pour moins de 500 OT, le rapport fait un seul appel comme avant ;
  - dérogation : le `console.log` des pièces utilisées part avec le fetch inutile qu'il décrivait (accord de l'orchestrateur, écrit dans la PR).

  Ne s'appliquent pas : A, I, Retroactive (aucune donnée ni schéma touchés).
- **Reste / risques** : solde de carte carburant (`|| 0`) sur les tableaux de bord admin et accueil ; `/api/alerts` du panneau d'alertes sans état d'erreur ; véhicules du rapport lus avec `limit=1000`. Revue sécurité requise (argent/stock).

## 2026-11-09T15:04:00+01:00 — Rapport des coûts : OT répétés ou sautés entre deux pages (réserve de relecture #599)

- **Statut** : fait (PR brouillon #599)
- **Quoi** :
  - `getWorkOrders` et `getWorkOrdersForTechnician` triaient par `createdAt` seul. À date de création égale (import en masse), un OT pouvait revenir sur deux pages et un autre être sauté, sans que le compte change. Départage par `id` décroissant ;
  - `fetchAllWorkOrders` dédoublonne par id, refuse si le nombre d'OT distincts ≠ total ou si le total change d'une page à l'autre, et formate le total en fr-FR ;
  - `useWarehouse` : l'échec de l'agrégat `/api/warehouse/reorder-alerts` (403 selon le rôle) n'affiche plus « Indisponible » pendant le chargement des deux sources.
- **Comment tester (QA)** :
  - `tests/integration/work-orders-pagination-tiebreak.test.ts` : 6 OT de même date lus page par page. Rouge avant : `[755, 755, 755, 755, 755, 760]` ; vert après ;
  - `tests/unit/client/fetch-all-work-orders.test.ts` : +3 cas (doublon entre pages, total qui change, format fr-FR), rouges puis verts ;
  - campagnes : tsc 0, check:tests 0, unitaires 319 fichiers / 3329 tests, contrats OT 20 fichiers / 255 tests sur Postgres local.
- **RAIDER** : D : contrat de `GET /api/work-orders` inchangé, l'ordre à date égale était indéterminé ; aucune donnée touchée.
- **Reste / risques** : `getWorkOrdersByOwner` et les autres listes paginées ne sont pas revues.

## 2026-11-09T15:26:00+01:00 — Rendu serveur des tuiles de stock en échec (inventaire, magasin, atelier)

- **Statut** : fait (PR brouillon)
- **Quoi** :
  - `tests/unit/client/money-stock-render-error-states.test.ts` : rendu `react-dom/server` des trois écrans avec `/api/parts/statistics` en erreur dans le cache (`queryCache.build(...).setState`) ; la tuile doit lire « Indisponible », jamais 0. Un témoin par écran avec données saines. Complète les regex de `money-stock-reads-error-states.test.ts`, qui lisent le source sans prouver l'affichage ;
  - `warehouse/dashboard.tsx` : le sous-texte de « Valeur stock total » teste `statsFailed` et non `statistics.error` (une relance échouée avec données en cache masquait la valeur moyenne par pièce) ; couvert par un cas de rendu.
- **Comment tester (QA)** : `npx vitest run tests/unit/client/money-stock-render-error-states.test.ts` (7 tests). Rouge avec chaque garde forcé à `false` (inventaire l.216, magasin l.162, atelier l.80) et avec `statistics.error` rétabli en l.214 ; vert sinon.
- **RAIDER** : D : aucun contrat touché ; aucune dépendance ajoutée, `vitest.config.ts` inchangé.
- **Reste / risques** : l'onglet « Alertes » du magasin (répartition) n'est pas rendu par défaut, donc non couvert ; tuile « Stock bas / épuisé » de l'atelier (onglet Inventaire) idem, la garde `stockStatsFailed` est prouvée via « Alertes stock magasin ».

## 2026-11-09T14:31:03+01:00 — Alertes, demandes de pièces, catalogue de pannes, maintenance : une lecture en échec n'est plus un vide (6 lectures)
- **Quoi** : `getPartRequirements`, `getFaultCatalogs`, `getMaintenanceCompliance`, `getScheduledMaintenanceCount`, `getAlertsByUserId`, `getUnreadAlertsByUserId` levaient `[]`, `0` ou `{0,0,0}` en cas d'erreur de base ; elles lèvent désormais une `AppError` 500 journalisée (`storageLog`, `{ err }`).
- **Comment** : les deux appelants situés dans une mutation (`missions.routes.ts` demande de renouvellement, `routes.ts` déclenchement de maintenance par date) lisent les alertes non lues en meilleur effort (catch local, `log.warn` avec `requestId`, anti-doublon ignoré) : la mutation reste en 2xx. Écrans : badge et panneau des alertes (topnav), catalogue de pannes, tuile « Maintenances planifiées », tuile et compteur de conformité (tableau de bord atelier), encart des OT en attente de pièces affichent « Indisponible » ou un encart d'erreur, jamais 0.
- **Pourquoi** : même défaut que #597 et l'incident du 7 novembre (zéros pendant une saturation du pool).
- **Comment tester (QA)** : `tests/unit/server/alerts-maintenance-reads-error.test.ts` (6 lectures, rouge 6/6 sur main) ; `tests/contract/mission-renewal-alert-read-failure.contract.test.ts` (POST 201 quand la lecture lève ; rouge 500 sans le catch) ; `tests/unit/client/alerts-maintenance-reads-error-states.test.ts` ; cliquet `swallowed-read-catch-hygiene` 40 → 34 ; tsc 0.
- **RAIDER** : R : `InlineQueryError`, `AppError`, `storageLog` existants ; D : réponses de succès inchangées ; failure memory : leçon du 2026-11-07 appliquée. Ne s'appliquent pas : A, I, Retroactive (aucune donnée ni schéma touchés).
- **Reste** : ~34 cas gelés ; `getUsersByRole` (notification de renouvellement) à traiter avec son appelant en meilleur effort.

## 2026-11-09T15:19:00+01:00 — Rapports PDF : véhicules lus en entier, carburant sans repli à 0, logs migrés

- **Statut** : fait (PR brouillon)
- **Quoi** :
  - `fetch-all-pages.ts` : lecture paginée générique extraite de `fetchAllWorkOrders` (dédoublonnage par id, refus si total qui change, page vide avant le total, élément sans id, borne de 20 pages). `fetchAllWorkOrders` délègue, mêmes exports et messages ;
  - `fetchAllVehicles` (pages de 1000) remplace les trois `fetch('/api/vehicles?limit=1000')` des rapports d'utilisation, de coûts et de carburant : au-delà de 1000 véhicules, les suivants étaient omis sans le dire ;
  - `fetchFuelRecords` : une lecture de `/api/fuel-records` en échec refuse le rapport (`ReportRefusedError`) au lieu de produire un rapport de carburant à 0 ; les `catch` des rapports d'utilisation et de carburant transmettent ce refus ;
  - `pdf-export.ts` : les 18 `console.*` migrés vers `clientLogger` (13 appels ; regroupements listés dans la PR).
- **Comment tester (QA)** :
  - `tests/unit/client/fetch-all-pages.test.ts` (10 cas : 2 500 véhicules en 3 pages, échec en page 2, doublon, total qui change, page vide, borne 20 001, carburant en échec ou non-liste, chemin avec paramètres, élément sans id) ;
  - `tests/unit/client/money-stock-reads-error-states.test.ts` : branchement de pdf-export (aucun `console.`, 3 `fetchAllVehicles`, 2 `fetchFuelRecords`, refus transmis), rouges avant, verts après ;
  - `fetch-all-work-orders.test.ts` : 11 tests inchangés, verts ;
  - campagnes : tsc 0, check:tests 0, unitaires 322 fichiers / 3361 tests. Aucun code serveur touché.
- **RAIDER** : R : lecture paginée unique pour OT et véhicules ; D : contrats d'API inchangés, messages des OT inchangés.
- **Reste / risques** : `/api/users` du rapport des coûts lu en un appel (non paginé côté serveur) ; `getWorkOrdersByOwner` non revu.

## 2026-11-09T16:04:00+01:00 — Ordres de travail : export PDF et alertes d'échéance lus en entier (cliquet 7 → 5)

- **Statut** : fait (PR brouillon)
- **Quoi** :
  - `maintenance/work-orders.tsx` : la requête `/api/work-orders` des 300 derniers OT (relue toutes les 7 s) ne servait qu'à l'export PDF. Elle est supprimée : l'export lit toutes les pages au clic (`fetchAllWorkOrders`). « Export réussi » n'est annoncé qu'après une lecture complète ; une liste vide ne produit pas de PDF (« Aucun ordre de travail à exporter ») ; un refus s'affiche par `userMessageOf` et se journalise par `clientLogger.error(…, reportErrorContext(error))`. Double clic bloqué par une ref ;
  - `maintenance/date-based-alerts.tsx` : « cette alerte a déjà son OT » se déduisait des 300 derniers OT. Un OT plus ancien était ignoré, l'alerte redevenait « à faire » et la génération en masse pouvait créer un doublon. Lecture complète (`["/api/work-orders", "all"]`, même préfixe pour les invalidations). Tant qu'elle n'a pas réussi, les boutons de création sont désactivés et un `InlineQueryError` propose « Réessayer » ;
  - `capped-list-reads-hygiene` : 2 fichiers retirés de la liste gelée (7 → 5 cas).
- **Comment tester (QA)** :
  - `tests/unit/client/work-orders-full-reads.test.ts` : 4 cas de branchement sur l'export (rouges avant) ; rendu `react-dom/server` des alertes avec la lecture des OT en erreur : boutons « Créer OT atelier » et « Générer les OT atelier » désactivés, encart d'erreur présent (rouge sur l'ancien code : bouton actif) ; témoin sain ; OT existant reconnu ;
  - campagnes : unitaires 327 fichiers / 3395 tests ; tsc 0 ; check:tests 0. Aucun code serveur touché.
- **RAIDER** : D : contrat d'API inchangé ; les deux écrans ne concluent plus sur une liste partielle.
- **Reste / risques** : 5 lectures plafonnées gelées (inventaire, interventions — 1000 demandés, 500 rendus —, pièces de l'OT, dialogue de montage ×2). La liste de véhicules des alertes (`["/api/vehicles"]`, sans `limit`) ne rend que 10 véhicules (`VEHICLE_LIST_DEFAULT_LIMIT = 10`) : alertes calculées sur 10 véhicules seulement, hors du cliquet (pas de `limit` en dur) ; signalé, lot à part.

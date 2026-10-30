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

## (ce commit) - Documents de véhicule : cloison entre clients (T1)

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

# Journal b7 — chantier erreurs et logs

Modèle et règles : `docs/journal/README.md`.

## 2026-11-03T14:35:07+01:00 — Réserves de #172 — 500 locaux et garde-fou

- **Agent** : b7 · **Branche** : `fix/error-log-500-reserves`
- **Statut** : fait
- **Quoi** : les 5 réponses 500 restantes (client créé, mis à jour, archivé ou restauré « mais introuvable » ; renouvellement rapide non finalisé) passent par le gestionnaire central. Elles tracent une ligne avec `requestId` et renvoient le corps commun `{ message, code, requestId }`.
- **Comment** :
  - `server/api/clients.routes.ts` : `throw new AppError(500, …)` dans le try. Le catch relaie l'AppError telle quelle. Aucune garde de rôle touchée (lot 3 de aa).
  - `server/api/document-renewals.routes.ts:1198` : `return next(new AppError(500, …))` et non `throw`. Le catch supprimerait le justificatif alors que le document le référence déjà, puisqu'il a été mis à jour avant.
  - 10 ternaires `x instanceof AppError ? x : …` retirés parce que la ligne précédente relaie déjà l'AppError. Ceux qui restent sont utiles : leur catch n'a pas cette garde.
  - Garde-fou : `tests/unit/server/error-500-relay-hygiene.test.ts`. Adopt du modèle de `routes-hygiene.test.ts`.
- **Pourquoi** : réserves du relecteur sur #172 (AGENTS.md §10 : une erreur, une trace, jamais de détail technique dans la réponse).
- **Comment tester (QA)** :
  - Prérequis : aucun.
  - Étapes : lancer le test unitaire ci-dessous.
  - Attendu : 20 tests passés. Sans le correctif, 5 tests échouent.
  - Preuve automatisée : `npx vitest run tests/unit/server/error-500-relay-hygiene.test.ts` → `20 passed`.
- **RAIDER** :
  - couvert : D (statuts HTTP inchangés, contrats verts), E (§10) et Failure memory (garde-fou exécutable) ;
  - ne s'applique pas : A, I et R (rétroactif), car rien ne change en base ou à distance.
- **Reste / risques** : les sites « log puis 500 » de `missions.routes.ts` attendent la fin du travail de c7.

## 2026-11-03T14:41:20+01:00 — Correction de l'entrée précédente — renouvellement rapide

- **Agent** : b7 · **Branche** : `fix/error-log-500-reserves`
- **Statut** : fait
- **Quoi** : dans l'entrée précédente, la justification donnée pour `document-renewals.routes.ts:1198` est **fausse**. `vehicleDocuments` ne stocke que l'échéance (`expiryDate`). Quand `finalizedRequest` est vide, aucune demande ne référence `proofFilePath`, et le justificatif restait orphelin.
- **Comment** : `return next(…)` devient `throw new AppError(500, …)`. Le catch supprime alors le justificatif puis relaie l'AppError.
- **Pourquoi** : réserve du relecteur sur #173.
- **Comment tester (QA)** : `npx vitest run tests/unit/server/error-500-relay-hygiene.test.ts` → `20 passed`. Contrats `document-renewals` verts.
- **Reste / risques** : suivi de sécurité sur les fichiers téléversés de ce handler, dans un lot à part :
  - les 404 et 400 en 1032, 1037-1047, 1092 et 1098 laissent le fichier orphelin ;
  - 1092 et 1098 arrivent après la mise à jour de l'échéance, hors transaction ;
  - un échec de `createAlert` supprime un justificatif déjà référencé par la demande.

## 2026-11-03T14:54:56+01:00 — Renouvellement rapide : cycle de vie du justificatif

- **Agent** : b7 · **Branche** : `fix/quick-renewal-proof-lifecycle`
- **Statut** : fait (audit fleet-securite en cours)
- **Quoi** : sur `POST /api/document-renewals/quick-renew`, un justificatif téléversé n'est conservé que s'il est référencé par la demande enregistrée. Un refus après lecture du document ne fait plus avancer l'échéance. Un échec de notification ne renvoie plus 500 et ne supprime plus le justificatif.
- **Comment** :
  - `server/api/document-renewals.routes.ts` : drapeau `proofRecorded` et suppression dans `finally` tant qu'il est faux. Tous les refus et échecs passent par ce point, 401 et 403 inclus.
  - Le contrôle de la demande ciblée (404, 400) passe avant toute écriture.
  - Une seule transaction couvre l'échéance, le miroir véhicule, la levée des alertes et la demande.
  - Les alertes sont envoyées au mieux, comme la diffusion WebSocket.
  - `syncVehicleDocumentMirror` et `clearDocumentExpiryAlerts` reçoivent un `executor` optionnel (`DbExecutor`, par défaut `db`), sans changement pour les autres appelants.
- **Pourquoi** : réserves de relecture sur #173 :
  - les 404 et 400 en 1032, 1037-1047, 1092 et 1098 laissaient le fichier orphelin ;
  - 1092 et 1098 arrivaient après la mise à jour de l'échéance ;
  - un échec de `createAlert` supprimait un justificatif déjà référencé.
- **Comment tester (QA)** :
  - Prérequis : un compte secrétaire, un véhicule avec un document assurance.
  - Étapes :
    1. Renouveler avec un `requestId` inexistant.
    2. Vérifier `uploads/document-renewals/proofs`.
  - Attendu :
    - réponse 404 ;
    - aucun nouveau fichier ;
    - échéance du document inchangée.
  - Preuve automatisée : `tests/contract/document-quick-renew-proof-lifecycle.contract.test.ts` → `5 passed`. Sans le correctif : 5 échecs.
- **RAIDER** :
  - couvert :
    - D : contrats existants verts (169) ;
    - I : tout ou rien, plus d'état partiel ;
    - E ;
    - failure memory : contrat par cas.
  - ne s'applique pas : A.
- **Reste / risques** :
  - le centre agréé est créé par `resolveRenewalCenter` avant les contrôles du document, donc il persiste même en cas de refus (comportement existant, à trancher) ;
  - `details: uploadError.message` à la ligne 920 renvoie le message de multer.

## 2026-11-03T15:00:56+01:00 — Renouvellement rapide : réserves de l'audit fleet-securite

- **Agent** : b7 · **Branche** : `fix/quick-renewal-proof-lifecycle`
- **Statut** : fait. Verdict de l'audit : OK sous réserve, aucun bloquant.
- **Quoi** :
  - M1 : contrat d'échec en transaction (500, fichier supprimé, échéance, miroir et demande inchangés).
  - M2 : le refus de multer donne un message lisible (taille, format), sans `details`.
  - M3 : un `requestId` qui vise une demande close est refusé en 409, et la preuve d'origine est conservée.
  - M4 : l'UPDATE de la demande porte la condition de statut ouvert, et 409 si 0 ligne (deux onglets).
- **Comment** :
  - `server/api/document-renewals.routes.ts`.
  - Contrat `document-quick-renew-proof-lifecycle` : 8 cas.
  - Garde-fou `error-500-relay-hygiene` : il interdit aussi `details: x.message`.
- **Comment tester (QA)** :
  - Contrat → `8 passed`. Sans le correctif, M2 et M3 échouent (M1 passait déjà, ce qui prouve le tout ou rien).
  - Garde-fou : 1 échec sur la version précédente, 20/20 ensuite.
- **Reste / risques** :
  - M4 n'a pas de test de concurrence (condition SQL seule) ;
  - M5 : une coupure après COMMIT non acquitté supprime un fichier référencé (cas théorique accepté) ;
  - le centre créé avant les contrôles reste un point produit, à trancher par 0a.

## 2026-11-03T15:16:28+01:00 — Réception de pièces : alert_created vers l'atelier

- **Agent** : b7 · **Branche** : `fix/procurement-alert-created`
- **Statut** : fait, PR brouillon.
- **Quoi** :
  - Les alertes de livraison (`parts_delivered`) et de réception partielle (`part_received`) étaient écrites sans trame `alert_created` : la cloche et le toast du chef d'atelier et du technicien ne bougeaient pas. Signalé par de (audit temps réel de 0a).
  - En plus : le renouvellement de document émettait une charge imbriquée (`{ alert }`), alors que le client lit une charge à plat. Le toast affichait donc « Nouvelle alerte », sans message ni lien.
- **Comment** :
  - Émetteur partagé `server/lib/alert-broadcast.ts`, avec une charge à plat comme `alert-service`.
  - `procurement-service` émet la trame après l'écriture de chaque alerte. Le renouvellement passe par le même émetteur.
  - missions.routes.ts n'est pas touché (verrou c7).
- **Pourquoi** : règle des 3 couches (AGENTS.md §2), couche 2.
- **Comment tester (QA)** : contrat `procurement-alert-realtime`, 3 cas. Les trames sont reçues par deux rôles (chef d'atelier, technicien) et le magasinier n'en reçoit aucune. Sans le correctif, 3 échecs sur 3.
- **Reste** : migrer `missions.routes.ts:139` sur l'émetteur partagé après la PR de c7.

## 2026-11-03T15:24:48+01:00 — Suivis de #178 et de #180

- **Quoi** :
  - quick-renew résout le centre agréé après les contrôles, sans centre orphelin en cas de refus ;
  - le toast de document-renew passe par userMessageOf ;
  - broadcastAlertCreated ne lève plus, avec un échec journalisé par alerte ;
  - un console.log de procurement-service est migré ;
  - deux entrées LESSONS_LEARNED.
- **Comment** :
  - test de contrat quick-renew : les cas 404 et 409 vérifient l'absence de centre (rouge 2 sans le correctif) ;
  - test de contrat procurement-alert-realtime : portée user sur toute trame, et un cas « envoi raté » (rouge 1 sur 4 sans le try/catch).
- **Pourquoi** : réserves du relecteur sur #178 et #180, transmises par 0a.

## 2026-11-03T16:38:35+01:00 — Balayage des toasts error.message (§10)

- **Quoi** : 62 sites dans 42 fichiers client affichaient `error.message` brut (dont `instanceof Error ? error.message` et les gabarits `${error.message}`). Ils passent désormais par `userMessageOf(error, repli)`.
- **Comment** : garde `tests/unit/client/toast-error-message-hygiene.test.ts`, compte par fichier à égalité stricte. Rouge sur main. Deux sites restent gelés, chez c7 (#181) : driver/dashboard.tsx et missions/[id].tsx.
- **Pourquoi** : AGENTS.md §10. Le message brut peut être technique (réseau, JSON, exception JS) et n'a ni repli ni référence.

## 2026-11-03T16:50:08+01:00 — Mouvement de stock magasin transactionnel

- **Quoi** : `recordStockMovement` lit la pièce `FOR UPDATE` et écrit mouvement et stock dans la même transaction. Sortie au-delà du stock : 409, plus de remise à 0. Pièce absente : 404. Quantité non entière : 400. La route passe par `next` au lieu de renvoyer `error.message`. Les console.* du service et de la route sont migrés vers moduleLogger.
- **Comment** : test de contrat `warehouse-stock-movement`, 5 cas dont trois sorties concurrentes. Rouge 5 sur 5 sur main, vert avec le correctif.
- **Pourquoi** : même défaut que `update-stock`, corrigé plus tôt sur l'autre route. Rebase prévu après #184 (même route : garde de rôle, validation).

## 2026-11-03T16:55:14+01:00 — Trame du mouvement de stock en portée personnel

- **Quoi** : `warehouse_stock_movement_recorded` est envoyée aux rôles `PART_CATALOG_EVENT_ROLES` (personnel sauf chauffeur), plus en broadcast. L'entrée `warehouse.routes.ts` sort de la liste gelée de `broadcast-hygiene`.
- **Comment** : un cas de contrat vérifie que la trame atteint admin, magasinier et technicien, et pas le chauffeur ni le client. Il vérifie aussi qu'un 409 n'émet aucune trame. Rouge sans le correctif de la route.
- **Pourquoi** : AGENTS.md §11, demande de 0a sur #188. Le stock et les prix ne regardent pas un client.

## 2026-11-03T17:00:51+01:00 — Réserves de relecture sur #188

- **Quoi** : une quantité au-delà de 2^31-1, ou une entrée qui ferait déborder le stock, est refusée en 400 au lieu d'un 500 Postgres. Le compte de cas est corrigé dans LESSONS.
- **Comment** : deux cas de contrat, rouges sans la borne. Total 8/8.
- **Pourquoi** : réserves de fleet-securite et fleet-relecteur.

## 2026-11-03T17:16:45+01:00 — Idempotence de l'ajustement de stock (update-stock)

- **Quoi** :
  - `POST /api/parts/:id/update-stock` est protégé par une clé d'idempotence, même drapeau coupé ;
  - une issue incertaine (enregistrement raté, 5xx, fin sans JSON) garde la clé, et le réessai reçoit un 409 « vérifiez le stock » ;
  - les deux écrans d'ajustement envoient la clé.
- **Comment** :
  - options par route (`keepKeyOnUncertainOutcome`, `staleSeconds: null`, `ignoreFeatureFlag`, `inProgressMessage`) ;
  - `sendWithSubmissionKey` + `partStockKeyScope(id, delta)` côté client ;
  - contrat rouge 2 sur 4 sans le correctif serveur.
- **Pourquoi** :
  - un réessai après coupure ajustait deux fois ;
  - réserves de 0a (option de route, 409 lisible, nouvelle clé par intention) et de c7 (une 5xx après le commit garde la clé).
## 2026-11-03T17:31:19+01:00 — Document de workflow : fichier orphelin quand l'INSERT échoue

- Quoi : `WorkflowDocumentService.saveWorkflowDocument` supprime le fichier écrit si l'INSERT `workflow_documents` est refusé, puis relance l'erreur.
- Comment : `.catch` sur l'INSERT, `fs.rmSync(filePath, { force: true })`, échec du ménage journalisé en `warn` sans masquer l'erreur d'origine. Route (routes.ts gelé) inchangée.
- Pourquoi : le fichier était écrit avant l'INSERT ; sans ligne, plus rien ne permettait de le retrouver ni de le supprimer (enquête multer).
- Preuve : `tests/integration/workflow-document-orphan.test.ts` rouge sans correctif (1 fichier restant), vert avec ; transfert 5/5, tsc 0, unitaires 1868.
## 2026-11-03T17:35:36+01:00 — alert_created sur POST /api/alerts et POST /api/test-date-maintenance

- Quoi : les deux handlers existants de `server/routes.ts` émettent `broadcastAlertCreated` après chaque `storage.createAlert` ; ils sortent de la liste gelée de `alert-emission-hygiene`.
- Comment : émission dans le handler, aucune route ajoutée ; portée nominative, sans repli de rôles (§11). Le `console.error` du handler POST /api/alerts migré vers `log.error` avec `requestId`.
- Pourquoi : alertes écrites sans trame, la cloche du destinataire attendait le polling (suite de #195). `checkAndCreateStockAlerts` reste gelé, chantier de la session de.
- Preuve : `tests/contract/alerts-manual-realtime.contract.test.ts` 2/2, rouge 2/2 sans le correctif ; alerts-inbox et procurement-alert-realtime verts ; tsc 0 ; unitaires 1868.


## 2026-11-03T18:04:13+01:00 — Chemins stockés : deleteFile borné à uploads/, garde d'hygiène des accès disque

- Quoi : `deleteFile` (`server/middleware/upload.ts`) refuse tout chemin hors de `<root>/uploads`. Un test d'hygiène recense les accès disque de `server/` et exige une borne (`uploadedFileCandidates`, `existingUploadedFile`, `isInsideDirectory`) ou une entrée justifiée dans une liste gelée. Ligne périmée de AGENTS.md §9 remplacée.
- Comment : `tests/support/file-access-scan.ts` (AST, portée partagée avec `alert-emission-scan`), `tests/unit/server/stored-path-hygiene.test.ts` (14 exceptions : multer, fichiers livrés, sauvegardes, vite), `tests/unit/server/upload-delete-file.test.ts`.
- Pourquoi : dette §9. La revue montre que tous les chemins lus en base sont déjà bornés, sauf la primitive `deleteFile`, appelée avec une valeur brute par `services/documentStorage.ts` (code mort, laissé en place).
- Preuve : deleteFile 6/6 (3 rouges sans correctif), hygiène 6/6 (2 rouges sans correctif), tsc 0, unitaires 1898.

## 2026-11-03T18:12:22+01:00 — Réserves fleet-securite sur #210 (garde des accès disque)

- Quoi : la garde ne cherche plus une borne dans le texte de la portée. Elle exige que l'argument de l'appel disque soit relié à une borne. Une exception couvre un seul appel. Les imports renommés d'un appel disque sont refusés. Appels ajoutés : open, cp, rename, rmdir. deleteFile suit la même règle que uploadedFileCandidates (forme /uploads/… acceptée).
- Comment : AST, avec trois formes reconnues :
  - l'argument contient la borne ;
  - l'argument est déclaré (en chaîne, ou par for…of) depuis une borne ;
  - l'argument est gardé par un appel de borne.
  Ni les noms de propriété ni path, fs et process ne comptent.
- Pourquoi : près-accident relevé par fleet-securite. Une borne posée sur une autre variable, écrite en commentaire, ou placée dans registerRoutes autour d'un rappel anonyme rendait la garde verte à tort.
- Preuve : quatre cas unitaires de contournement, tous rouges avec l'ancienne règle. Hygiène + deleteFile : 19/19, et 3 rouges sans le correctif. tsc : 0 erreur ; 1905 tests unitaires après fusion de main.
- Hors périmètre, non traité : un lien symbolique placé dans uploads/ (multer n'en crée pas).

## 2026-11-03T18:19:47+01:00 — #210 : réserves du relecteur, correction du journal

- Correction de l'entrée de 18:04 : « tous les chemins lus en base sont déjà bornés » est trop fort. La revue couvre les appels de `ACCESS_CALLS` trouvés par le scan ; un accès par une bibliothèque (pièce jointe nodemailer, `pdfkit`) ou par une écriture n'est pas couvert.
- Quoi : liaison borne/argument structurelle (`isBoundExpression`). Une garde ne compte que si `isInsideDirectory` reçoit la variable directement ; `a ?? b` n'est borné que si chaque branche l'est. La destination de copyFile, cp et rename est vérifiée. Les alias `const { unlink: del } = fs` et `const del = fs.unlinkSync` sont refusés.
- Code : `transferDocumentsToVehicle` vérifie la destination de la copie (`isInsideDirectory(vehicleUploadDir, newPath)`).
- Pourquoi : le relecteur a relevé que `const p = req.body.p` héritait d'une garde posée sur `req.query.x`. Leçon ajoutée dans LESSONS_LEARNED.
- Preuve : hygiène + deleteFile 20/20, nouveaux cas de contournement rouges avec la règle précédente.

## 2026-11-03T18:16:39+01:00 — Workflows abandonnés : délai de 7 jours absent du nettoyage

- Quoi : `cleanupAbandonedWorkflowDocuments` ne vise plus que les workflows abandonnés depuis plus de `olderThanDays` jours (7 par défaut, `updatedAt` = date de l'abandon).
- Comment : `lt(updatedAt, cutoff)` dans le `where`, `now` et le délai injectables. Aucun job branché : la décision de rétention revient au produit.
- Pourquoi : la clause n'était qu'un commentaire, et un workflow abandonné la veille perdait ses documents. La fonction n'a aucun appelant : le piège était armé, mais n'avait pas encore servi (constat de fleet-securite pendant la revue de #210).
- Preuve : `tests/integration/workflow-cleanup-retention.test.ts` (1 jour gardé, 8 jours purgé, en cours intact), rouge sans la clause.
## 2026-11-03T18:34:35+01:00 — Factures fournisseurs : erreurs relayées au gestionnaire central (§10)

- Quoi : les 9 `catch` de `server/api/supplier-invoices.routes.ts` qui répondaient `500 { error, details: error.message }`, et celui de `checkAuth`, relaient par `next(withLogContext(…, { event }))` (motif de #172). Le justificatif de règlement refusé renvoyait `details: err.message` de multer : 400 lisible (format ou 8 Mo). `POST /api/admin/import-backup` ne renvoie plus `availableFiles` (listage du dossier backup/) dans sa 404, ligne modifiée dans le handler existant.
- Comment : `supplier-invoices` ajouté aux routeurs de `error-500-relay-hygiene`, plus une garde sur `availableFiles`. Contrat `supplier-invoice-error-details`.
- Pourquoi : un log par erreur, une AppError d'un service (validate, approve) garde son statut au lieu de devenir 500. La garde de sortie réécrivait déjà les 5xx : la fuite réelle était sur le 400 multer.
- Preuve : hygiène rouge 4/25 sans le correctif ; contrat 400 rouge sans le correctif, 500 vert avant comme après (non-régression) ; 9 contrats fournisseurs 87/87 ; tsc 0 ; unitaires 1891.

## 2026-11-03T19:00:57+01:00 — Suivi de #210 : refus de transfert silencieux et limites du scan des chemins

- Quoi : `transferDocumentsToVehicle` sautait un document dont le fichier source manquait ou dont la destination sortait du dossier du véhicule, puis marquait **tous** les documents de la session `isTransferred`. Le document perdu disparaissait du workflow sans être arrivé sur le véhicule. Le scan `file-access-scan` acceptait aussi une garde `isInsideDirectory` placée sur n'importe quel argument, après l'accès ou dans un rappel imbriqué, une méthode quelconque (`concat`) sur une valeur bornée, et ne voyait pas les alias `fs["unlinkSync"]`, `.bind(fs)`, `del = fs.unlinkSync` ni `promisify(fs.unlink)`.
- Comment : seuls les ids réellement copiés sont marqués (`inArray`). Un refus est journalisé en `warn` avec sa raison, et le bilan en `info`. Côté scan : la garde doit porter sur le second argument, se trouver avant l'accès et dans la même fonction ; seules `find`, `filter`, `at` et `slice` conservent la borne ; toute référence non appelée à un membre disque compte comme un alias. Le `.gitkeep` effacé par les tests était déjà réglé sur main (`trackDir` / `cleanupTrackedDir`).
- Pourquoi : un refus de sécurité ne doit pas se payer d'une perte de document silencieuse. La garde statique doit refuser ce qu'elle ne prouve pas.
- Preuve : intégration « fichier source disparu » verte, et rouge sans le correctif du service (`isTransferred: true` sur le document perdu). Hygiène 16/16, dont 3 cas rouges sans le correctif du scan. `server/` reste vert sans nouvelle exception. tsc 0 erreur, unitaires 1944/1944.

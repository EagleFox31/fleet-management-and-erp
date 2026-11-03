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

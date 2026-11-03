# P3-2 — Échéances : prévenir avant, bloquer à l'expiration

Brief fleet-api. À lancer **après la fusion de #119** (qui modifie `preventive-maintenance-service.ts`).
Décision de l'utilisateur, le 2026-11-03 : « prévenir avant, bloquer à l'expiration ».
Relu par fleet-produit (v2) ; les questions ouvertes sont en fin de document.

## Constat

`checkDateBasedMaintenance` (`server/services/preventive-maintenance-service.ts`, l.~140-260) lit
quatre échéances portées par `vehicles`, avec une fenêtre de 30 jours (`alertDate`).

| Échéance | Colonne | Aujourd'hui |
|---|---|---|
| Entretien mécanique | `nextMaintenanceDate` | OT + immobilisation directe (`declencheur`, l.249) |
| Assurance | `insuranceExpiry` | OT atelier `high`, sans immobilisation directe |
| Visite technique | `technicalInspectionDate` | idem |
| Plaque / carte grise | `licensePlateExpiry` | idem |

- L'immobilisation directe ne vise que l'entretien mécanique, jusqu'à 30 jours avant l'échéance.
  Le lancement de mission refuse un véhicule hors `operational`.
- Un OT papier passé en `in_progress` immobilise par `storage.updateWorkOrder` (l.~1530), alors
  qu'un papier n'est pas un travail d'atelier. Cela contredit `shared/constants/vehicle-eligibility.ts` :
  un papier expiré rend le véhicule **inéligible**, pas `maintenance`.
- Un plan `maintenanceSchedules` échu n'immobilise pas : les déclencheurs divergent (marqueur P3-2).
- `storage.createWorkOrder` (l.~1500) immobilise dès la création de tout OT ; le service préventif
  écrit en base sans passer par lui.

## Cible

1. **Entretien mécanique** (`nextMaintenanceDate`, plans par date et par kilométrage) :
   - OT préventif ouvert dans la fenêtre, comme aujourd'hui (idempotent, pas de doublon) ;
   - **supprimer l'appel `setVehicleToMaintenance` du service préventif** (bloc `declencheur`) ;
   - le véhicule passe en `maintenance` à la prise en charge (`in_progress`), déjà assuré par
     `storage.updateWorkOrder`.
   - **Ne pas toucher `storage.createWorkOrder`** : il sert aussi les OT correctifs, hors décision
     (question 4 ci-dessous).
2. **Papiers** (assurance, visite technique, plaque/carte grise) :
   - **plus d'OT atelier** ;
   - alertes : **réutiliser `server/services/alert-service.ts`** (l.~489-560, alertes 30 j avant et
     « expiré », dédoublonnage `document-expiry-rule`), avec un lien vers la demande de renouvellement
     (`document-renewals`). Ne pas créer de nouveau mécanisme d'alerte ;
   - `vehicles.status` inchangé ; blocage par l'éligibilité (`getMissionEligibility`).
3. **Lancement de mission** (`missions.routes.ts` ~2302-2360) :
   - garder les contrôles actuels (carte grise, assurance, visite via `vehicle_documents`) ;
   - **carte grise** : vérifier aussi son expiration (aujourd'hui seulement sa présence, l.~2347) ;
   - appeler aussi `getMissionEligibility` (source unique), comme à l'affectation (l.~1780, ~2132).
4. **Régularisation** (décision 3) : le blocage se lève dès qu'une date d'expiration future est
   enregistrée, par renouvellement ou par dépôt du document. Une demande « en cours » **sans
   récépissé** ne débloque rien.
   - **Récépissé** : une demande de renouvellement qui porte un récépissé téléversé **avec une date de
     validité** rend le véhicule éligible jusqu'à cette date incluse ; passé cette date, sans document
     définitif, il est de nouveau bloqué.
   - **Existant** (`document_renewal_requests`, `shared/schema.ts:~232`) : `proofFileName/Path` et
     `newExpiryDate` sont posés à la clôture (`completed`) ; **aucune date de validité de récépissé**.
     Vérifier d'abord le sens réel de `proofFile*` (preuve de clôture ou pièce téléversable en cours ?).
   - **Si une colonne manque** : passer par **fleet-db** (proposition : `receipt_valid_until date`,
     plus fichier du récépissé si `proofFile*` ne convient pas), créée de façon idempotente dans
     `init-database.ts` (AGENTS.md §5). Téléversement par `uploadedFileCandidates` (AGENTS.md §9).
   - `getMissionEligibility` doit connaître le récépissé valide : l'entrée d'éligibilité reçoit la
     date de validité du récépissé, pas une seconde règle locale.
5. **Mission en cours** (décision 1) : un papier qui expire pendant une mission déclenche une alerte
   au **chef de parc** ; la mission en cours se termine ; aucune nouvelle mission (affectation ni
   lancement) avant régularisation. Vérifier quel rôle porte « chef de parc » dans `shared/schema.ts`
   (logistique ?) avant de cibler l'alerte.

## Source des dates de papiers (décision 2)

**`vehicle_documents` fait foi.** Les colonnes `vehicles.*` (`insuranceExpiry`,
`technicalInspectionDate`, `licensePlateExpiry`) n'en sont que le miroir
(`syncVehicleMasterDocumentExpiry`, `server/routes.ts:~1461`).
- Vérifier que la synchronisation se fait aussi au **dépôt** d'un document neuf.
- L'éligibilité (affectation et lancement) et `checkDateBasedMaintenance` doivent lire la même
  source ; à défaut de refonte, garantir le miroir par test.

## Données existantes (rétroactif)

Lecture d'abord, décompte remonté à 0a **avant** toute écriture :
- véhicules en `maintenance` sans OT mécanique `in_progress` ;
- véhicules en `maintenance` à cause d'un OT papier `in_progress` ;
- OT papier `pending` (titre assurance / visite / plaque).
Reprise proposée, seulement avec accord : annuler les OT papier `pending` avec une trace dans
l'historique, et remettre `operational` les véhicules immobilisés à tort. SQL idempotent.

## Tests

- P3-2 (`tests/integration/preventive-maintenance-lifecycle.test.ts`) : marqueur et témoin
  remplacés par un test vert : plan échu → OT ouvert, véhicule `operational`.
- MNT1 / MNT2 (« OT préventif → véhicule en maintenance ») réécrits : `operational` à la génération,
  `maintenance` à `in_progress`.
- Papier dans la fenêtre → aucune OT, alerte, statut inchangé.
- Papier expiré → affectation **et** lancement refusés (plaque/carte grise comprise).
- Régularisation : nouvelle date future → éligible ; demande en cours sans récépissé → refusé ;
  récépissé valide → éligible ; récépissé échu sans document définitif → refusé.
- Dépôt d'un document neuf → colonne miroir `vehicles` mise à jour.
- Mission en cours + papier expiré → alerte chef de parc, mission non interrompue, nouvelle mission refusée.
- Base de test dédiée par session. Relecture fleet-relecteur.

## Décisions de l'utilisateur (2026-11-03, relayées par 0a)

1. Papier expiré en cours de mission : alerte au chef de parc, la mission se termine, aucune
   nouvelle mission avant régularisation.
2. Source qui fait foi : `vehicle_documents`.
3. Récépissé de renouvellement : débloque jusqu'à sa date de validité, puis blocage si le document
   définitif n'est pas arrivé.
4. OT correctif (**lot séparé**, pas celui-ci) : immobilisation à la prise en charge (`in_progress`),
   sauf si l'OT signale le véhicule non roulable, auquel cas immédiate.

## Ordre

Après #119. Décompte rétroactif remonté à 0a avant toute écriture. Colonne éventuelle (récépissé)
par fleet-db d'abord, puis fleet-api.

## Hors périmètre (lot suivant)

- Blocage de mission pour les entretiens de sécurité en retard (freins, pneus), délai de grâce,
  dérogation tracée.
- Fenêtre d'alerte par type d'entretien (30 j pour tous aujourd'hui).

## Statut (2026-11-03)

- **Lot 1 livré** : PR #126 (alertes avant échéance, blocage à l'expiration, source `vehicle_documents`, miroir `vehicles.*`, alerte au chef de parc en cours de mission).
- **Lot 2b** : tous les points **récépissé** (point 3 des décisions, colonnes du récépissé provisoire, éligibilité qui reconnaît un récépissé valide, blocage à sa date de validité) sont renvoyés au lot 2b. Le lot 1 ne les traite pas.
- **Limite connue** : supprimer le seul document daté d'un type laisse la date sur le véhicule (elle peut venir d'une saisie directe). Corriger la date sur la fiche véhicule. Supprimer un document qui ne fixait pas la date (autre document ou saisie directe plus lointains) ne la change pas non plus.
- **Backlog** : déplacer `PATCH /api/documents/:id` (`server/routes.ts`, gelé) dans `server/api/vehicle-documents.routes.ts` et appeler `recomputeVehicleDocumentMirror` après l'écriture : aujourd'hui il écrit la date dans le miroir sans tenir compte d'un autre document plus lointain.
- **Lot 2b, partie A (récépissé) livrée côté serveur** : `POST /api/document-renewals/requests/:id/receipt` (fichier + `validUntil`, rôles écrivains du routeur, demande ouverte), événement `document_renewal_receipt_uploaded` au personnel hors chauffeur, `getMissionEligibility` reçoit `receipts` (jour de validité inclus, source unique) et `loadOpenRenewalReceipts` (`server/lib/renewal-receipts.ts`) les lit en base. **Reste à brancher** : `missions.routes.ts` (affectation, PATCH, lancement) doit charger les récépissés du véhicule et les passer à `getMissionEligibility` ; le lancement refuse aussi sur `vehicle_documents` (assurance, visite) sans connaître le récépissé ; l'écran de création de mission appelle `getMissionEligibility` côté client sans récépissé. Aucun bouton de dépôt : pas d'écran de renouvellement à compléter dans ce lot.
- **Lot 2b, durcissement (revue et audit de la PR #138)** : plus aucun chemin disque dans les réponses ni les diffusions du routeur des renouvellements (`withoutDiskPaths`), diffusions du routeur limitées à `DOCUMENT_RENEWAL_VIEWER_ROLES` ; validité du récépissé plafonnée à `RENEWAL_RECEIPT_MAX_VALIDITY_DAYS` (90) jours après le dépôt ; un seul jour, le jour UTC (`shared/lib/utc-day.ts`), pour la route et `recepisseValide` (`joursDepuis` reste pour la partie B, D4) ; diffusion du dépôt au mieux (un échec ne supprime plus le fichier) ; extension du fichier tirée du type MIME ; ancien chemin lu sous verrou de ligne.
- **Suivi** : branchement de `missions.routes.ts` (chargement des récépissés et passage à `getMissionEligibility`) par b7 après la fusion de #138 ; écran `missions/new.tsx` (éligibilité côté client sans récépissé) en backlog fleet-fe.

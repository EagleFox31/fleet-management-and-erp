# V5b — Appli chauffeur hors ligne (cadrage)

Statut : cadrage, rien n'est démarré. Base : origin/main 87ef0ccf ; le POD dépend de #629 et #634 (ouvertes).

## 1. Besoin métier

- **Indispensable** : lire sa mission active ; saisir un plein ; déposer un POD photo (souvent pris sur un quai sans réseau) ; passer la mission « en cours » puis « livrée ».
- **Confort** : déclarer une panne (recommandé, en V5b-6, pour la sécurité) ; solde de la carte carburant (avec sa date) ; historique des pleins.
- **Hors périmètre** : kilométrage (le formulaire n'est utilisé que par `pages/secretary/dashboard.tsx`).

## 2. État des lieux

**Client**
- `client/public/sw.js` : coque statique seulement, n'intercepte jamais `/api` (#56), pas de Background Sync.
- `client/src/lib/pwa-register.ts` : pas de worker en développement (opt-in `VITE_ENABLE_SW=1`).
- `client/src/lib/offline-storage.ts` : une base IndexedDB par compte (`fleetos-offline-u<id>`), compteur de purge (`epoch`), file `enqueueOfflineAction` et rejeu `processOfflineQueue` sur l'événement `online`. La déconnexion détruit la file, l'expiration de session la garde. **Aucun consommateur** de `enqueueOfflineAction`.
- `client/src/lib/offline-user-scope.ts` : liste blanche de lecture hors ligne limitée au technicien.

**Défauts de la file actuelle** : types figés (`fuel_entry`, `work_order_note`, `odometer_reading`) ; pas d'`Idempotency-Key` au rejeu (`apiRequest` n'accepte pas d'en-têtes) ; un 4xx définitif est rejoué sans fin ; un échec n'arrête pas la boucle (ordre perdu) ; invalidation globale au lieu des trois couches ; pas de verrou entre onglets ; pas de stockage de fichiers.

**Serveur**
- Garde d'idempotence `server/middleware/idempotency-guard.ts` (drapeau `offline-writes`), routes dans `server/lib/idempotency-config.ts` : `PUT /missions/:id/status`, `PUT /vehicles/:id/mileage`, `POST /parts/:id/update-stock`. Son 409 « en cours » n'a pas de `code`.
- Plein `POST /api/missions/:id/fuel-records` : `requestKey` obligatoire, rejeu sans second débit sous verrou de la carte. Côté client la clé vit en `sessionStorage` : perdue si iOS tue l'appli.
- Panne `POST /api/driver/breakdowns` : **non idempotente** (un rejeu crée un second incident et un second OT).
- POD : dédoublonnage `(missionId, sha256)`, 10 Mo, 10 fichiers, statuts `in_progress`/`delivered`/`completed`, HEIC refusé.
- Drapeau `driver-offline` cité en commentaires, **non déclaré** dans `shared/feature-flags.ts`.
- Temps réel : sur `online`, `resyncCriticalData` s'exécute en concurrence avec le rejeu et peut relire avant la fin.

## 3. Architecture retenue

Décision : **Adapt** la file IndexedDB existante (cloisonnée, jamais branchée), ajouter une clé d'idempotence durable, un ordre FIFO strict et un classement des réponses.
Écartés : Workbox Background Sync (pas de `SyncManager` sur iOS, le worker ne voit ni `/api` ni le compte actif : contournerait la cloison #56) ; mutations TanStack persistées (sérialisation des `mutationFn`, pas de Blob, migration lourde).

**File v2** (même base par compte, magasins `queue` et `files`). Champs : `id`, `idempotencyKey` (UUID créé à la mise en file et stocké ; pour le plein, même valeur que `requestKey`), `kind` (json | multipart), `endpoint`, `method`, `payload`, `fileRefs[]`, `missionId`, `state` (pending | sending | rejected), `attempts`, `lastError` (message utilisateur), `createdAt`, `ownerUserId`. Registre des types déclaratif (endpoint, invalidations, libellé), sans `if` par type.

**Rejeu** : sur `online`, à la connexion, bouton manuel. Verrou `navigator.locks` (repli localStorage avec durée de vie). Avant rejeu, `/api/auth/me` doit renvoyer le propriétaire de la file. FIFO strict, arrêt au premier échec réessayable.

**Classement des réponses**
- 2xx ou `Idempotent-Replayed` : fait.
- 409 `IDEMPOTENCY_IN_PROGRESS` : réessai plus tard.
- 401 : arrêt, file gardée, attente de reconnexion.
- Réseau, 5xx, 408, 429 : réessai avec attente exponentielle, même clé.
- Autre 4xx : `rejected` (« À revoir »), visible, jamais rejoué ni supprimé en silence.

**Conflits** : le serveur tranche (machine d'états, `assertMissionAcceptsFuel`, verrou carte). Aucune fusion côté client.

**POD** : réencodage JPEG à la capture (canevas, 1600 px, qualité 0,7 ; règle aussi le HEIC), Blob stocké une fois (mêmes octets à chaque rejeu, le sha256 dédoublonne) ; PDF tel quel ≤ 10 Mo ; quota par `navigator.storage.estimate()` et plafond (30 fichiers ou 100 Mo) ; `navigator.storage.persist()` ; Blob supprimé seulement après le 201. Le POD n'entre pas dans `IDEMPOTENCY_ROUTES` (le garde ne hache pas le multipart).

**Interface** : badge « En attente d'envoi (N) » ; éléments marqués « non envoyé » ; toast « Enregistré sur le téléphone, envoi au retour du réseau » (jamais « enregistré » avant le 2xx) ; écran « Envois » ; statut optimiste marqué « en attente ».

**Trois couches au rejeu (AGENTS.md §2)** : (1) cache mis à jour depuis la réponse ; (2) événements serveur existants (`broadcastMissionFuelRecorded`, `emitMissionEvent`) ; (3) invalidations ciblées du registre, puis **un seul** `resyncCriticalData(force)` après vidange de la file.

**Lecture hors ligne** : liste blanche chauffeur dans `offline-user-scope.ts` : `/api/drivers/me` ; pour ses missions seulement `/api/missions/:id`, `/fuel-records`, `/launch-readiness`, `/pod-files` (métadonnées) ; `/api/fuel-card/balance` avec « au <heure> ».

**Activation** : `driver-offline` déclaré, désactivé par défaut, sans effet si `offline-writes` est inactif.

## 4. Risques

- Double débit : `requestKey` durable, jamais régénéré au rejeu (test dédié).
- Doublon incident/OT : route de panne en `IDEMPOTENCY_ROUTES` avec `keepKeyOnUncertainOutcome` et `staleSeconds: null`.
- Mission modifiée entre-temps : 4xx, « À revoir » ; plein refusé régularisé par le gestionnaire (`/fuel-records/regularize`).
- Changement de compte : file gardée, jamais rejouée pour un autre compte (contrôle `/me` + `epoch`).
- Expiration de session : file gardée, message « Reconnectez-vous pour envoyer N éléments ».
- Déconnexion avec envois en attente : aujourd'hui détruits, exige une confirmation explicite.
- Deux onglets : verrou.
- iOS : stockage évincé après 7 jours sans visite hors écran d'accueil ; pas de Background Sync (rejeu appli ouverte) ; quota serré ; appli tuée en arrière-plan.
- IndexedDB en clair : risque résiduel à documenter.
- POD identiques comptés une fois : voulu.

## 5. Lots

| Lot | Agent | Dépend de | Contenu | Preuve |
|---|---|---|---|---|
| V5b-1 | fleet-api | rien | panne dans `IDEMPOTENCY_ROUTES` ; `code: "IDEMPOTENCY_IN_PROGRESS"` sur le 409 du garde (+ `ApiErrorCode`) ; drapeau `driver-offline` | unitaire garde ; contrat panne rejouée (1 incident, 1 OT) ; contrat statut rejoué |
| V5b-2 | fleet-fe | V5b-1 | file v2, `apiRequest` avec en-têtes (surcharge compatible), classement, FIFO avec arrêt, verrou, contrôle propriétaire, registre d'invalidation, resync après vidange, réserves R2/S1 de `cdc-ecarts.md:93`, confirmation de déconnexion | unitaires : classement, ordre, clé stable, changement de compte, purge, verrou |
| V5b-3 | fleet-fe | V5b-2 | liste blanche chauffeur, bandeau « Hors ligne, données du … » | unitaire sélection ; e2e `setOffline(true)` puis second compte sans accès |
| V5b-4 | fleet-fe | V5b-3 | plein et statut en file, badge, écran « Envois », « À revoir » | e2e plein hors ligne, un seul débit même réponse coupée ; deux comptes + trame WebSocket `mission_fuel_recorded` |
| V5b-5 | fleet-fe | V5b-4 + fusion #629/#634 | magasin `files`, compression, quota, `persist()` | unitaire quota/purge Blob ; contrat même fichier 2× (`duplicates = 1`) ; e2e photo hors ligne, facture débloquée |
| V5b-6 | fleet-fe + recette | V5b-5 | panne en file, consignes iOS, recette iPhone et Android | e2e panne hors ligne, un seul OT |

V5b-2 livre le cœur commun que #10c technicien doit réutiliser (à coordonner).

Statut V5b-2 (2026-11-10) : livré en PR brouillon `feat/v5b-2-offline-queue-core`. API : `enqueueOfflineWrite`, `replayOfflineQueue`, `useOfflineQueue`, `registerOfflineAction`, `useGuardedLogout`. Reste pour V5b-5 : constructeur multipart (`setOfflineMultipartBuilder`) et magasin de fichiers (préfixe de clé `files:` déjà réservé).

Statut V5b-3 (2026-11-10) : livré en PR brouillon `feat/v5b-3-offline-read` (liste blanche chauffeur par profil, ancre `/api/drivers/me`, fiche personnelle coupée, bandeau sur le tableau de bord chauffeur, derrière `driver-offline` et `offline-writes`). e2e hors ligne reste à faire.

## 6. Décisions de 0a (2026-11-10)

1. Déconnexion avec envois en attente : blocage + choix « Supprimer N envois » avec confirmation.
2. Plein refusé au rejeu : « À revoir » + alerte au gestionnaire, jamais rejoué.
3. Hors ligne : seulement mission en cours / livrée.
4. Panne incluse (V5b-6).
5. Téléphone fourni ou personnel : **question ouverte, non bloquante**. On conçoit pour les deux : installation sur l'écran d'accueil proposée, jamais requise ; tout fonctionne dans le navigateur.
6. V5b-2 partagé avec #10c technicien : API générique, aucun `if role`.
7. Pas de chiffrement d'IndexedDB, accepté sous conditions : cloison par compte, purge complète à la déconnexion et au changement de compte, cache limité au strict nécessaire (ni documents personnels du chauffeur, ni pièces jointes hors POD en attente).
8. Le plan est livré dans la PR V5b-1 (pas de PR docs séparée). V5b-1 : panne idempotente (clé durable, rejeu = même incident + même OT, deux requêtes concurrentes = un seul), 409 lisible avec code `IDEMPOTENCY_IN_PROGRESS`, drapeau `driver-offline` désactivé par défaut ; contrats rejeu + concurrence rouges sans correctif ; sécurité obligatoire ; tests base sur Postgres local uniquement ; V5b-5 après fusion de #629/#634.

## Prérequis d'allumage de `offline-writes` (V5b-2b)

Allumer `offline-writes` seulement après le déploiement de V5b-2b ET une période de mise à jour du service worker : un ancien bundle encore en cache dans un appareil rejoue sans `X-Offline-Owner`, donc sans la vérification du propriétaire à chaque envoi (le garde serveur laisse passer l'absence de l'en-tête pour rester compatible). Attendre que les appareils aient pris le nouveau bundle (cycle de mise à jour du service worker, plusieurs jours d'usage) avant de couper la compatibilité ou d'allumer le drapeau, et ne l'allumer qu'après la revue sécurité.

# Carte chauffeur et position du téléphone (cadrage)

Statut : cadrage, rien n'est démarré. Base : origin/main e9003752 (2026-11-10).
Lot CDC #6 « GPS agnostique » (`docs/plans/cdc-ecarts.md`) : ce document en livre la **première source**,
le téléphone du chauffeur. La balise (Traccar ou fournisseur) viendra comme second adaptateur, sans
changer le cœur.

## 1. Besoin

Demande utilisatrice : la vue chauffeur (`client/src/pages/driver/dashboard.tsx`, PWA, code PIN) n'a pas
de carte. Elle veut « voir le trajet, avec la localisation du téléphone pour l'instant », en attendant
les balises.

| Rôle | Ce qu'il gagne |
|---|---|
| Chauffeur | Voit d'où il part, où il livre, où il est ; ouvre l'itinéraire dans l'appli de navigation du téléphone. |
| Logisticien | Voit la dernière position connue de chaque mission en cours, et son âge. Répond au client sans appeler le chauffeur. |
| Direction | Plus tard : carte de flotte sur positions réelles (aujourd'hui fictives, voir §2). |

Hors périmètre V1 : suivi hors mission, retour à vide, vue client (donneur d'ordre), alertes de
géorepérage, balises, calcul d'itinéraire poids lourd, cartes hors ligne.

## 2. État des lieux (vérifié dans le code)

- **Leaflet 1.9.4** en dépendance. Seul `client/src/components/management/executive-corridor-map.tsx`
  l'utilise, et **ce composant n'est importé nulle part** (orphelin).
- **Positions de la carte direction : fictives.** `aggregateCorridorFleet()`
  (`server/services/management-dashboard-service.ts:908`) fabrique `progressPercent` à partir de l'index
  de la ligne (`(index * 23) % 90`, `(index * 17) % 85`) puis interpole sur un corridor deviné par
  mots-clés de l'adresse. Un véhicule sans mission est même déclaré « en transit » une fois sur trois.
  Le résultat part dans `/api/management/dashboard` (`corridorFleet`) à chaque appel, sans être affiché.
  À ne jamais montrer comme une position réelle.
- **Référentiel réutilisable** : `shared/constants/cemac-corridors.ts`, 15 hubs avec coordonnées
  (Douala, Yaoundé, Kribi, Ngaoundéré, Garoua, N'Djamena, Bangui...) et 4 corridors en polylignes.
- **Missions** : `pickupAddress` / `deliveryAddress` en texte libre, aucune coordonnée.
  `mission_steps.location` aussi en texte. `mission_destinations` (barème) : code et libellé, sans
  coordonnées. Fenêtre de route : statut `in_progress` (« Départ confirmé ») puis `delivered`
  (`PUT /api/missions/:id/status`). Affectation chauffeur par `assignments.driverId`.
- **Socle CDC-0a déjà posé** (squelettes 501, drapeau `gps` niveau `later`, coupé) :
  `POST /api/telemetry/positions` (boîtiers, garde `isAdmin` provisoire), `GET /api/vehicle-positions`
  et `/:vehicleId` (rôles `GPS_VIEW_ROLES` = admin, logistics, management, workshop_manager),
  `/api/admin/telemetry-devices`, événement temps réel `vehicle_position_updated`
  (`shared/contracts/realtime-events.ts:163`), écrans `fleet-map` et `telemetry-devices` dans
  `client/src/config/cdc-screens.ts`. Positions exclues du journal d'audit (`server/lib/audit-config.ts`).
  **Aucune table** de position dans `shared/schema.ts` (lot DB-2 en attente).
- **Cloison chauffeur** : `driverScopeOf(req.user)` (`server/lib/driver-scope.ts`), déjà utilisé par
  les routes missions.
- **Hors ligne** : file v2 livrée en brouillon (V5b-2), drapeaux `driver-offline` et `offline-writes`
  coupés en production.

## 3. V1 « téléphone » : ce qu'on livre

### 3.1 Écran chauffeur (onglet « Ma mission »)

- Carte compacte (hauteur ~220 px, chargée à la demande pour ne pas alourdir la PWA) :
  - repère **A** départ, repère **B** livraison ;
  - **trajet indicatif** en pointillé : tronçon du corridor CEMAC si A et B sont des hubs du même
    corridor, sinon ligne droite (« à vol d'oiseau », dit dans la légende) ;
  - **trace réelle** du téléphone en trait plein, point bleu de position courante avec cercle de
    précision ;
  - mention « Position envoyée il y a N min » ; « Position non partagée » si refus.
- Bouton **« Ouvrir l'itinéraire »** : lien Maps URLs (`https://www.google.com/maps/dir/?api=1&destination=...`),
  sans clé ni coût ; destination = coordonnées si connues, sinon **l'adresse texte**. La navigation
  pas à pas est déléguée au téléphone : pas de moteur d'itinéraire à héberger.
- Sans coordonnées A/B : la carte montre seulement la position du téléphone, le bouton reste utile.

### 3.2 Partage de position

- **Seulement pendant une mission en cours** : démarre au « Départ confirmé » (`in_progress`), s'arrête à
  « Livraison confirmée » (`delivered`), à l'annulation, à la déconnexion, ou sur retrait du consentement.
- **Consentement explicite** au premier départ : feuille plein écran, texte court versionné (quoi, quand,
  qui voit, combien de temps, comment arrêter). « J'accepte » / « Pas maintenant ». Refus = la mission
  marche normalement, sans position. Retrait possible à tout moment depuis l'onglet mission.
  Puis seulement après, la demande d'autorisation du navigateur (geste utilisateur, exigence iOS).
- **Cadence (valeurs provisoires, configurables)** : un point toutes les 60 s **ou** tous les 200 m,
  le premier atteint ; envoi par paquet toutes les 2 min (jusqu'à 50 points). Précision haute
  (`enableHighAccuracy`) : le téléphone est souvent en charge dans la cabine.
- **Limite assumée de la PWA** : la position n'est relevée **que quand l'appli est ouverte au premier
  plan**. Écran verrouillé ou appli en arrière-plan = trou dans la trace (Chrome Android et Safari iOS
  suspendent `watchPosition`, et un service worker n'a pas accès à la géolocalisation). Option
  « Garder l'écran allumé » (Screen Wake Lock), désactivée par défaut (batterie). Le logisticien voit
  toujours l'**âge** de la dernière position, jamais une position périmée présentée comme actuelle.
- **Si ce trou est jugé gênant** (décision après essai terrain) : V1b = appli **Traccar Client**
  (Android et iOS, suivi en arrière-plan) qui envoie au même cœur par le protocole OsmAnd, via
  l'adaptateur « boîtier ». C'est la même porte que les futures balises, donc pas de travail perdu.

### 3.3 Écran logisticien

- Fiche mission : mini-carte (A, B, trace, dernière position, âge, précision) et bouton « Ouvrir dans Maps ».
- Liste des missions en cours : colonne « Dernière position » (ville du hub le plus proche + « il y a N min »,
  orange au-delà de 15 min, gris au-delà de 60 min).
- Saisie des points A et B à la création ou en modification de mission : **choix d'un hub** (liste des
  15 hubs) **ou clic sur la carte** ; facultatif, l'adresse texte reste obligatoire.
- L'écran `fleet-map` (`/fleet/map`, déjà au registre) affiche la dernière position par véhicule : V1
  minimal (liste + carte), même source.

## 4. Géocodage, itinéraire, fond de carte : options comparées

### 4.1 Coordonnées des adresses

| Option | Coût | Limites d'usage | RAM VPS | Verdict |
|---|---|---|---|---|
| A. Nominatim public (OSMF) | 0 | 1 req/s maximum, cache obligatoire, User-Agent identifiant l'appli, autocomplétion **interdite**, retrait possible | 0 | Utilisable en assistance serveur seulement, avec cache ; couverture d'adresses camerounaises dans OSM **à vérifier** (adresses de quai, de magasin, de lieu-dit). Pas en V1. |
| B. Nominatim auto-hébergé | 0 en licence | Aucune | Import exigeant en mémoire (non chiffré ici pour le seul Cameroun) | Écarté sur le VPS 3,7 Go partagé. |
| C. **Hub CEMAC ou clic sur la carte** par le logisticien | 0 | Aucune | 0 | **Retenu V1** : déterministe, hors réseau tiers, colle aux trajets réels (corridors portuaires). |

### 4.2 Tracé du trajet

| Option | Coût | Limites | RAM VPS | Verdict |
|---|---|---|---|---|
| A. OSRM démo (FOSSGIS, routing.openstreetmap.de) | 0 | 1 req/s, pas de profil poids lourd, usage production non garanti, requêtes journalisées chez le tiers | 0 | Écarté V1 (dépendance fragile, profil voiture). |
| B. OSRM auto-hébergé (extrait Cameroun) | 0 en licence | Profil camion à écrire | Prétraitement de plusieurs Go selon les retours publics (non mesuré pour le Cameroun) | Écarté sur ce VPS ; à réévaluer avec un serveur dédié. |
| C. **Polylignes de corridor existantes + ligne droite** | 0 | Indicatif seulement | 0 | **Retenu V1**, libellé « trajet indicatif ». La trace réelle du téléphone fait foi. |
| D. Lien Maps URLs vers l'appli du téléphone | 0, sans clé | 2 048 caractères par URL | 0 | **Retenu V1** pour la navigation pas à pas. |

### 4.3 Fond de carte

- Le composant existant appelle CARTO (`basemaps.cartocdn.com`) **sans clé**. La FAQ CARTO annonce
  aujourd'hui une clé gratuite, 1 M tuiles/mois en usage commercial, suspension possible sans préavis.
- Tuiles OSM standard (`tile.openstreetmap.org`) : attribution visible, Referer, cache respecté ;
  téléchargement préalable et « hors ligne » **interdits** ; risque de retrait plus élevé pour un usage
  commercial.
- **Recommandation V1** : OSM standard avec attribution, URL de tuiles en **configuration** (une seule
  constante partagée), pour basculer vers CARTO avec clé ou un fournisseur payant sans toucher au code.
  Volume attendu faible (dizaines d'utilisateurs). Hors réseau : la carte affiche trace et repères sur
  fond vide, pas de tuiles préchargées.

## 5. Modèle de données (lot DB-2, part GPS)

Toute table est déclarée dans `shared/schema.ts` **et** créée de façon idempotente dans
`server/init-database.ts` (AGENTS.md §5), avec la migration SQL de référence.

**`vehicle_positions`** (cœur agnostique, une ligne par point reçu, toutes sources)

| Colonne | Type | Note |
|---|---|---|
| `id` | bigserial | |
| `vehicle_id` | integer not null → vehicles | véhicule de l'affectation |
| `mission_id` | integer → missions, `on delete set null` | obligatoire pour la source `phone` (CHECK) |
| `driver_id` | integer → drivers | |
| `source` | text CHECK in (`phone`, `tracker`) | adaptateur |
| `device_id` | integer → telemetry_devices, null | source `tracker` (lot balises) |
| `submitted_by` | integer → users | source `phone` |
| `client_point_id` | uuid | idempotence du rejeu |
| `recorded_at` | timestamptz not null | heure du téléphone |
| `received_at` | timestamptz not null default now() | heure serveur |
| `lat`, `lng` | double precision, CHECK bornes | |
| `accuracy_m`, `speed_kmh`, `heading` | real, null | |

Index : unique (`source`, `submitted_by`, `client_point_id`) pour `ON CONFLICT DO NOTHING` ;
(`mission_id`, `recorded_at`) ; (`vehicle_id`, `recorded_at` desc) pour la dernière position
(`DISTINCT ON`). Pas de table de « dernière position » en V1 : à ajouter seulement si la mesure l'exige.

**`location_consents`** : `id`, `user_id`, `driver_id`, `text_version`, `accepted_at`, `revoked_at`,
`user_agent`. Une ligne par acceptation ; jamais supprimée tant que le chauffeur est en poste (preuve).

**`missions`** : `pickup_lat`, `pickup_lng`, `delivery_lat`, `delivery_lng` (double, null),
`pickup_hub_code`, `delivery_hub_code` (text, null), `geo_source` (`hub` | `pin`, null).

**Rétention** (valeur provisoire, configurable `GPS_POSITION_RETENTION_DAYS=30`) : purge quotidienne
idempotente des points bruts plus vieux que N jours. Ordre de grandeur : 20 camions × 10 h de route ×
1 point/min ≈ 12 000 lignes/jour, ≈ 360 000 lignes sur 30 jours (dizaines de Mo avec index).
Au-delà de la rétention, on garde sur la mission seulement « première / dernière position » si la
direction le demande (non prévu V1).

## 6. Routes, rôles, règles serveur

Nouveaux routeurs dans `server/api/` (jamais `server/routes.ts`), sous le drapeau `gps`.
Les sources actives se règlent par configuration (`GPS_SOURCES=phone`, plus tard `phone,tracker`),
pas par du code (RAIDER R et A).

| Méthode et chemin | Rôles | Règle |
|---|---|---|
| `GET /api/driver/location-consent` | chauffeur | état et version du texte |
| `POST /api/driver/location-consent` | chauffeur | accepte la version courante |
| `DELETE /api/driver/location-consent` | chauffeur | retrait ; le téléphone arrête d'envoyer |
| `POST /api/driver/missions/:id/positions` | chauffeur | paquet ≤ 50 points ; voir règles |
| `GET /api/missions/:id/track` | chauffeur (sa mission), admin, logistics, management | A, B, trajet indicatif, points |
| `PATCH /api/missions/:id/geo` | admin, logistics | hub ou point sur carte pour A et B |
| `GET /api/vehicle-positions`, `/:vehicleId` | `GPS_VIEW_ROLES` | dernière position, source, âge, mission |
| `POST /api/telemetry/positions` | jeton d'appareil | inchangé (lot balises) |

**Règles d'acceptation d'un point (serveur)** : consentement valide ; mission dans le périmètre
`driverScopeOf` ; affectation du chauffeur sur cette mission ; `recorded_at` dans la fenêtre
[`startedAt` - 2 min ; `delivered`/`cancelled` + 2 min] (un point relevé pendant la route mais reçu
après, hors réseau, est accepté) ; `recorded_at` pas dans le futur (> 5 min) ; vitesse implicite
entre deux points < 200 km/h (sinon point marqué, pas rejeté). Hors règle : le point est ignoré et
compté dans la réponse (`accepted`, `duplicates`, `rejected`), jamais un 500.

**Cloison** : client → 403 partout (portail client plus tard, décision acquise) ; chauffeur → ses
missions seulement, jamais la position d'un autre ; `workshop_manager` garde la dernière position
véhicule (`GPS_VIEW_ROLES`) mais pas la trace d'une mission (minimisation, à confirmer par 0a).

## 7. Temps réel (AGENTS.md §2)

1. **Instantané local** : le téléphone dessine son point avant l'envoi ; après 2xx, cache
   `/api/missions/:id/track` complété avec les points acceptés.
2. **Événement WebSocket** : `vehicle_position_updated` (existant) émis **au plus une fois par véhicule
   toutes les 30 s** (anti-tempête), charge `{ vehicleId, missionId }`, portée `GPS_VIEW_ROLES`.
3. **Resync ciblé** : `/api/vehicle-positions`, `/api/missions/:id/track`, liste des missions en cours
   (colonne dernière position), écran `fleet-map`. Ajouter `/api/missions/:id/track` aux
   `invalidates` du contrat d'événement.

Test : trame WebSocket vérifiée avec deux comptes (chauffeur qui envoie, logisticien qui reçoit),
pas seulement l'écran (polling à 7 s sur certaines listes).

## 8. Hors ligne

- Points gardés dans un **tampon IndexedDB dédié** par compte (`fleetos-offline-u<id>`, même cloison
  que V5b), plafonné à 1 000 points (le plus ancien sort en premier), purgé à la déconnexion.
- **Pas dans la file FIFO V5b** : un paquet de positions en échec ne doit pas bloquer un plein ou un
  changement de statut. Idempotence naturelle par `client_point_id` (contrainte unique), donc ne
  dépend pas du drapeau `offline-writes`.
- Vidange à la reprise du réseau et à l'ouverture de l'appli, paquets de 50, arrêt au premier échec
  réseau.

## 9. Risques

| Risque | Effet | Parade |
|---|---|---|
| Vie privée : suivi hors service | Atteinte au chauffeur, risque légal | Fenêtre mission seulement, contrôlée côté serveur ; pas de retour à vide en V1 ; rétention courte ; consentement versionné et retirable. |
| Loi camerounaise 2024/017 (en vigueur depuis le 23 juin 2026 selon la presse spécialisée) | Amendes, obligations envers l'autorité | Texte officiel non lu ici : base légale, déclaration préalable, transfert hors Cameroun (Neon) **à confirmer par le client ou son conseil**. |
| Hébergement hors Cameroun | Transfert transfrontalier soumis à autorisation selon les synthèses | Question client ouverte (cahier §4). |
| Batterie | Téléphone vide en route | Envoi groupé 2 min, écran allumé seulement sur demande ; essai terrain mesuré. |
| Trous de trace (PWA au premier plan) | Logisticien croit le camion arrêté | Âge affiché, couleur selon ancienneté, V1b Traccar Client si besoin. |
| Données mobiles | Coût SIM | Quelques Ko par paquet ; qui paie : question client. |
| Retrait du service de tuiles | Carte grise | URL de tuiles en configuration. |
| Position fictive affichée un jour comme réelle | Mauvaise décision direction | Corriger `aggregateCorridorFleet` avant de remonter la carte direction (lot FE-4). |
| Usurpation (point posté pour une autre mission) | Fausse position | Contrôle d'affectation + périmètre chauffeur (contrat dédié). |

## 10. Critères d'acceptation

| ID | Given / When / Then |
|---|---|
| G-01 | Given un chauffeur avec une mission affectée, When il ouvre « Ma mission », Then il voit A, B et le trajet indicatif, et le bouton « Ouvrir l'itinéraire » ouvre l'appli de navigation sur B. |
| G-02 | Given aucun consentement, When il confirme le départ, Then la feuille de consentement s'affiche avant toute demande du navigateur ; s'il refuse, le départ est confirmé et aucune position n'est envoyée. |
| G-03 | Given consentement et mission `in_progress`, When il roule appli ouverte, Then un point au moins par minute arrive au serveur, et le logisticien voit la position et son âge sans recharger (trame `vehicle_position_updated` reçue). |
| G-04 | Given la mission passée `delivered`, When le téléphone reste ouvert, Then plus aucun point n'est envoyé, et un point posté à la main après la fenêtre est ignoré. |
| G-05 | Given un chauffeur B, When il poste un point sur la mission du chauffeur A, Then 403 et aucune ligne écrite. Given un compte client, When il lit `/api/vehicle-positions` ou une trace, Then 403. |
| G-06 | Given le réseau coupé 20 min, When il revient, Then les points relevés arrivent une seule fois (rejeu sans doublon) et l'état d'un plein en attente n'est pas bloqué. |
| G-07 | Given le retrait du consentement, When il le confirme, Then l'envoi s'arrête immédiatement et la carte du logisticien affiche « Position non partagée ». |
| G-08 | Given des points de plus de N jours, When la purge passe deux fois, Then ils sont supprimés la première fois et la seconde n'écrit rien. |
| G-09 | Given le drapeau `gps` coupé, When on appelle une route de ce lot, Then 404, et aucune carte n'apparaît chez le chauffeur. |
| G-10 | Given une mission sans coordonnées A/B, When le chauffeur l'ouvre, Then la carte montre sa seule position et le bouton d'itinéraire utilise l'adresse texte. |

## 11. Lots

| Lot | Agent | Dépend de | Contenu | Preuve | Estimation |
|---|---|---|---|---|---|
| GPS-DB | fleet-db | décisions §12 | `vehicle_positions`, `location_consents`, colonnes géo des missions, jumelles `init-database.ts`, migration | intégration : réconciliation idempotente au second démarrage | S (0,5 à 1 j) |
| GPS-API-1 | fleet-api | GPS-DB | consentement, ingestion par paquet (règles §6), cloison, idempotence, `track`, `geo`, `vehicle-positions`, événement limité, purge | unitaires règles et fenêtre ; contrats cloison chauffeur/client, rejeu, fenêtre, drapeau coupé | M (2 à 3 j) |
| GPS-FE-1 | fleet-fe | GPS-API-1 | carte chauffeur chargée à la demande, consentement, relevé (`watchPosition`, cadence, tampon IndexedDB, vidange), lien Maps, Wake Lock optionnel | unitaires cadence et tampon ; e2e Playwright avec `setGeolocation` | M (2 à 3 j) |
| GPS-FE-2 | fleet-fe | GPS-API-1 | logisticien : choix hub ou clic carte, mini-carte fiche mission, colonne dernière position, `fleet-map` minimal | e2e deux comptes + trame WebSocket | M (1,5 à 2 j) |
| GPS-FE-3 | fleet-fe | GPS-FE-1 | constante d'URL de tuiles partagée, attribution, extraction des réglages Leaflet communs | unitaire config | S (0,5 j) |
| GPS-FE-4 | fleet-api + fe | GPS-API-1 | carte direction : supprimer la position fabriquée, brancher la dernière position réelle ou afficher « non suivie » | contrat : aucun véhicule sans position n'a de coordonnées | S (0,5 à 1 j) |
| GPS-RECETTE | recette | FE-1, FE-2 | essai terrain Android et iPhone : un trajet Douala, mesure batterie et trous | rapport daté | S (1 j) |

Total ≈ 8 à 11 jours-agent. Ordre : DB → API-1 → FE-1 et FE-2 en parallèle → FE-3, FE-4 → recette.
V1b (Traccar Client, adaptateur `tracker` sur `/api/telemetry/positions` avec jeton d'appareil) : M,
seulement si l'essai terrain montre des trous gênants.

## 12. Décisions

### À trancher par le client (via l'utilisatrice)

1. Information écrite et consentement des chauffeurs, base légale au titre de la loi 2024/017, formalités
   auprès de l'autorité de protection : à faire valider par le conseil du client.
2. Durée de conservation des points (proposé : 30 jours).
3. Hébergement des positions hors du Cameroun (base actuelle) acceptable ou non (cahier §4).
4. Téléphone personnel ou fourni, et qui paie les données (déjà question ouverte non bloquante en V5b).
5. Le client donneur d'ordre verra-t-il un jour la position (portail client plus tard : pas en V1).

### Que 0a peut trancher par extrapolation

1. Un seul drapeau `gps` ; sources par configuration (`GPS_SOURCES`). Recommandé.
2. Fenêtre stricte `in_progress` → `delivered`, retour à vide exclu. Recommandé (minimisation).
3. Cadence 60 s ou 200 m, paquet 2 min, valeurs provisoires configurables. Recommandé.
4. `workshop_manager` : dernière position véhicule oui, trace de mission non. Recommandé.
5. Géocodage V1 = hub ou clic carte ; pas de Nominatim ni d'OSRM publics. Recommandé.
6. Tuiles OSM standard en configuration, pas de clé payante. Recommandé.
7. Tampon de positions séparé de la file V5b. Recommandé.
8. Lancer GPS-FE-4 (carte direction fictive) même si la V1 tarde. Recommandé.

## 13. Sources (consultées le 2026-11-10)

- OSMF, politique d'usage Nominatim : <https://operations.osmfoundation.org/policies/nominatim/> (officielle, fiable).
- OSMF, politique d'usage des tuiles : <https://operations.osmfoundation.org/policies/tiles/> (officielle, fiable).
- FOSSGIS, serveur de routage OSRM : <https://routing.openstreetmap.de/about.html> (officielle, résumé ; conditions complètes en allemand non lues).
- OSRM, ancienne politique du serveur de démo : <https://github.com/Project-OSRM/osrm-backend/wiki/API%20Usage%20Policy> (officielle, renvoie vers FOSSGIS).
- CARTO, FAQ fonds de carte : <https://docs.carto.com/faqs/carto-basemaps> et conditions <https://www.carto.com/legal/basemap-terms/> (éditeur ; chiffres à revérifier avant usage).
- Google, Maps URLs sans clé : <https://developers.google.com/maps/documentation/urls/get-started> (officielle).
- Traccar, protocole OsmAnd : <https://www.traccar.org/osmand/> (officielle) ; mémoire serveur : forum <https://www.traccar.org/forums/topic/server-specification/> (communauté, 1 à 2 Go, peu fiable).
- Géolocalisation PWA en arrière-plan : <https://bugzilla.mozilla.org/show_bug.cgi?id=784505>, <https://lists.w3.org/Archives/Public/public-device-apis-log/2021Apr/0043.html>, <https://leechy-dev.firebaseapp.com/geolocation-pwa> (rapports de bogues et retours anciens, convergents, fiabilité moyenne) ; Wake Lock : <https://notificare.com/blog/2023/03/24/more-web-apis-for-pwas/> (blog, moyenne).
- Loi camerounaise 2024/017 : <https://droitmediasfinance.com/index.php/actualites/droit-tech-fintech/1297-cameroun-la-loi-sur-la-protection-des-donnees-a-caractere-personnel-entre-en-vigueur-ce-23-juin-2026>, <https://www.afriwise.com/resources/cameroons-evolving-data-privacy-landscape> (presse et cabinet, secondaires ; **texte officiel non consulté**, aucune disposition sur la géolocalisation des salariés vérifiée).
- OSRM, mémoire de prétraitement : <https://lists.openstreetmap.org/pipermail/osrm-talk/2013-July/000211.html> (ancien, ordre de grandeur seulement).
- Pratique du marché (Samsara) : <https://kb.samsara.com/hc/en-us/articles/4423183155341-Get-Started-with-the-Samsara-Driver-App> : le suivi temps réel du véhicule y repose sur le boîtier, l'appli chauffeur en complément ; non confirmé qu'elle remplace le boîtier.

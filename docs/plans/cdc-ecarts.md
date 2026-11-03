# Chantier CDC — écarts du cahier des charges (ETS YARORO, §3 et §6)

Mis à jour le 31/10/2026.

## Contraintes

- Aucune fusion avant la fin de la recette du 2 novembre 2026.
- PR brouillon uniquement.
- Ne pas toucher à la branche Neon `recette`, aux comptes `recette_*`, ni aux données protégées : véhicule #13, pièce #20, OT #62, demande #7, commande #5, facture #39, règlement #4.
- Fichiers gelés : `server/routes.ts`, `server/storage.ts`, `server/services/part-requirements-service.ts`. Nouvelles routes dans `server/api/`.
- Au plus 3 agents d'implémentation simultanés.
- Un seul lot touche le schéma à la fois.
- Exclus : #1 e-mail/SMS, #5 SSO.

## Stratégie

Un socle est livré une seule fois : schéma DB-1, socle serveur CDC-0a, socle client CDC-0b. Il pose les registres partagés (drapeaux, rôles, montages, événements temps réel, écrans). Ensuite, chaque lot ne touche que ses propres fichiers.

Base d'intégration `lot/int/CDC-0-base` : fusion de DB-1 et CDC-0a, créée par le lot CDC-0b.

#4 et #6 attendent une décision utilisateur et un second lot DB (DB-2) empilé.

## Lots

| Lot | Branche | Agent | Base | PR | État | Relecture |
|---|---|---|---|---|---|---|
| DB-1 schéma | `lot/db/CDC-0-schema` | fleet-db | `main` | #57 | livré (commit `0da3e44`) | à faire |
| CDC-0a socle serveur | `lot/api/CDC-0-socle` | fleet-api | `main` | #55 | livré (`8eb8bc4`) | à faire + sécurité |
| CDC-10a cloison cache PWA | `lot/fe/CDC-10-pwa-cloison` | fleet-fe | `main` | #56 | livré (`5b9a4a3`) | à faire + sécurité |
| CDC-0b socle client (événements, registre d'écrans CDC, qrcode + barcode-detector) | `lot/fe/CDC-0-socle-ui` | fleet-fe | `lot/int/CDC-0-base` | - | en attente des relectures | - |
| #7 KPI api (D1 workshop_manager, D2 incidents + mois à zéro, D3 échéance due_date, D4 coût + taux horaire, rapports PDF/Excel) | `lot/api/CDC-7-kpi` | fleet-api | CDC-0b | - | à lancer | - |
| #7 KPI fe | `lot/fe/CDC-7-kpi` | fleet-fe | CDC-7 api | - | à lancer | - |
| #2 avertissement mission/entretien api puis fe | `lot/api/CDC-2-avertissement-entretien`, `lot/fe/CDC-2-avertissement-entretien` | fleet-api, fleet-fe | CDC-0b | - | à lancer | - |
| #3 QR pièces api puis fe | `lot/api/CDC-3-qr-pieces`, `lot/fe/CDC-3-qr-pieces` | fleet-api, fleet-fe | CDC-0b | - | à lancer | - |
| #9 import Excel api puis fe | `lot/api/CDC-9-import-excel`, `lot/fe/CDC-9-import-excel` | fleet-api, fleet-fe | CDC-0b | - | à lancer | - |
| #10b idempotence serveur | `lot/api/CDC-10-idempotence` | fleet-api | CDC-0b | - | PR brouillon | - |
| #10c hors ligne technicien | `lot/fe/CDC-10-hors-ligne-technicien` | fleet-fe | 10a + 10b | - | à lancer | - |
| #8 rapport de maintenance Word api puis fe | `lot/api/CDC-8-rapport-maintenance`, `lot/fe/CDC-8-rapport-maintenance` | fleet-api, fleet-fe | CDC-7 api | - | à lancer | - |
| DB-2 ventes + GPS | `lot/db/CDC-0b-ventes-gps` | fleet-db | DB-1 | - | attend décisions #4 et #6 | - |
| #4 vente de pièces api puis fe | `lot/api/CDC-4-vente-pieces`, `lot/fe/CDC-4-vente-pieces` | fleet-api, fleet-fe | DB-2 | - | attend décision | - |
| #6 GPS agnostique api puis fe | `lot/api/CDC-6-gps`, `lot/fe/CDC-6-gps` | fleet-api, fleet-fe | DB-2 | - | attend décision | - |
| e2e par paire (e2e/14-… à e2e/20-…) | - | fleet-testeur | - | - | après chaque paire api/fe | - |

## Ordre

1. Vague A (faite) : DB-1, CDC-0a, CDC-10a.
2. Relectures (à faire).
3. Vague B : CDC-0b, #7 api, DB-2 en brouillon si les décisions sont prises.
4. Vague C, par 3 : #2, #3, #9, 10b, #8 côté api, puis leurs écrans.
5. Après décision : #4 et #6.

## Décisions utilisateur en attente

1. **#2** : avertissement non bloquant (recommandé), ou bloquant pour un préventif en retard. Colonne de kilométrage qui fait foi : mileage recommandé.
2. **#3** : le technicien sort-il une pièce par scan ? Recommandé : non, il demande. Lire les codes EAN fabricant.
3. **#4** : modèle de stock vente. Recommandé : drapeau vendable, prix de vente HT, réserve atelier. Facture de vente distincte de `client_invoices`. TVA 19,25 %.
4. **#6** : réponses du client sur le traceur (voir questions ci-dessous). Passerelle Traccar auto-hébergée recommandée.
5. **#7** : taux horaire de main-d'œuvre (fourni par le client). Pneus inclus dans le coût d'intervention ?
6. **#8** : périmètre du rapport de maintenance, par véhicule et période recommandé. Ordre de mission Word à inclure ou non ?
7. **Base de test** : `DATABASE_URL_TEST` est identique à `DATABASE_URL` (base de dev partagée). Aucun test d'intégration ou de contrat n'est joué tant qu'une base de test distincte n'existe pas.
8. **D5** (ancien service worker qui cache `/api` sans cloison) : correctif avant la recette ou après ?
9. **Triggers d'alertes** non rejoués au démarrage (défaut existant `check_work_order_overdue()`) : à traiter ou non ?
10. **Fuite de prix** : `GET /api/parts/:id` (`server/routes.ts:2711`, gelé) renvoie le prix au technicien. Intercepteur à décider.
11. **#56** : force push de la branche, ou nouvelle branche. Le force push a été refusé par les permissions.
12. **Service worker** : correctif d406368 avant la recette, par dérogation au gel.
13. **Tests existants** : amendement par la session de tests des tests existants que #7 rend rouges.

## Questions au client pour #6

1. Balises déjà en place (marque, modèle, fournisseur, contrat) ?
2. API ou renvoi de positions du fournisseur, et quel protocole ?
3. Fréquence voulue et délai acceptable sur la carte ?
4. Qui paie la SIM ou les données du téléphone chauffeur : téléphone personnel ou fourni ?
5. Consentement et vie privée des chauffeurs : localisation limitée aux missions, conservation, information écrite (loi camerounaise 2024/017) ?
6. Hébergement des positions au Cameroun (cahier §4) ?

## État au 31/10/2026, soir

- **#57** (53c8b89) : GO avec réserves. L'intégration est à rejouer sur une base isolée avant fusion. Une base qui porte déjà l'ancien index unique (0da3e44) le garde.
- **#55** (73bf623 et 4a78183) : GO. `pincode` et `passcode` ajoutés au masquage.
- **#56** : reprise locale (d406368 pour le service worker seul, 0180483 pour le reste), non poussée. Le force push a été refusé par les permissions ; décision de l'utilisateur en attente. Une leçon dans `LESSONS_LEARNED.md` est à écrire ensuite.
- **Vague B lancée** : CDC-0b socle client (`lot/fe/CDC-0-socle-ui`) et #7 KPI serveur (`lot/api/CDC-7-kpi`), tous deux sur la branche d'intégration `lot/int/CDC-0-base` (#57 et #55).
- **Décisions ajoutées** : 11 (force push de #56 ou nouvelle branche), 12 (correctif du service worker d406368 avant la recette, par dérogation au gel), 13 (amendement par la session de tests des tests existants que #7 rend rouges).

## Lot #10c — périmètre obligatoire hérité de la relecture de #56 (2026-11-03)

Règle posée par #10b : **un drapeau d'écran hors ligne (`technician-offline`, `driver-offline`) exige
`offline-writes`**. Sans lui, le serveur ignore `Idempotency-Key` et un rejeu de la file peut écrire
deux fois. Routes rejouables : `IDEMPOTENCY_ROUTES` dans `server/lib/idempotency-config.ts` ; une route
de #10c s'y ajoute, jamais dans le garde. Le client envoie une clé par écriture (UUID), stable entre
les rejeux, et traite 409 (encore en cours : réessayer plus tard) et 422 (clé réutilisée : bogue client).

Réserves d'aa (fleet-relecteur + fleet-securite) sur CDC-10a, à livrer avant la mise en production du hors ligne :

- **R2, déconnexion interrompue** : purger le stockage local avant l'appel réseau `POST /api/auth/logout`, ou dans la branche « pending » de `session-resume.ts`. Un onglet fermé pendant l'appel ne doit rien laisser de lisible.
- **S1, onglets** : diffuser la déconnexion par `BroadcastChannel` (ou l'événement `storage`) ; avant de rejouer la file, vérifier par `/api/auth/me` que le compte connecté en est bien le propriétaire.
- **Perte de la file à la déconnexion volontaire** : décision utilisateur en attente (analyse fleet-produit), au minimum avertir avant de détruire des écritures non synchronisées.
- **Tests** : `session-resume` quand `/me` renvoie un autre utilisateur, et sur un appel concurrent ; `sw.js` sur une requête d'une autre origine.
- **Déconnexion différée** : repère sans expiration, et un 403 renvoyé par `/logout` laisse l'attente sans fin. Il faut une durée de vie et un traitement explicite.
- **Recette** : consigne « ouvrir une fois l'application en ligne » avant tout usage hors ligne, puisque la PR a retiré le démarrage hors ligne authentifié.
- **Données en clair dans IndexedDB** : risque résiduel sur appareil partagé, à documenter ou à chiffrer.
- **Clé globale `currentVehicleRegistration`** (`form-draft-storage.ts`) : à cloisonner par compte.
- **Kilométrage chauffeur (option A, règle stricte)** : `PUT /api/vehicles/:id/mileage` n'accepte d'un chauffeur que le véhicule d'une affectation active (`ACTIVE_ASSIGNMENT_STATUSES`, règle commune aux pannes, `assignedVehicleIdsOf` dans `server/lib/driver-scope.ts`). Après clôture, 403. **L'écran impose la saisie du kilométrage avant la clôture de la mission** ; un kilométrage resté dans la file hors ligne après la clôture sera refusé (403, clé libérée) et doit être signalé au chauffeur, pas rejoué en boucle.

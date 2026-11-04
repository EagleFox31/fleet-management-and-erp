# E2E - Playwright

Les tests unitaires, d'intégration et de contrat HTTP sont dans `tests/` (voir `tests/README.md`). Ce dossier ne couvre que le navigateur.

Suite de tests bout-en-bout sur les parcours critiques de Yaro FleetOS.

## Parcours couverts

| Spec | Parcours | Ce qui est verifie |
|---|---|---|
| `01-auth-login.spec.ts` | Authentification | Connexion valide, session persistante apres reload, `GET /api/auth/me` 200. Identifiants invalides: reste sur `/login`, `/api/auth/me` renvoie 401 |
| `02-fleet-vehicles.spec.ts` | Flotte / Vehicules | Liste `/vehicles`, payload `GET /api/vehicles`, acces au workflow d'acquisition |
| `03-work-orders.spec.ts` | Maintenance / OT | Liste `/maintenance/work-orders`, filtres (all, pending, in-progress, awaiting-parts), stats `GET /api/work-orders/statistics` |
| `04-procurement-three-way.spec.ts` | Procurement 3 voies | Page ecarts, KPIs, `GET /api/supplier-invoices/discrepancies`, navigation vers le detail facture fournisseur |
| `05-mission-billing-payment.spec.ts` | Operations / Facturation | Dashboard operations, liste factures clients, detail facture, enregistrement d'un paiement |
| `06-realtime-work-orders.spec.ts` | Temps reel **inter-profils** | Un OT cree par le **chef d'atelier** remonte dans la session d'un **magasinier** sans refresh. Verifie la trame WebSocket `work_order_created` recue par l'autre role, puis la reaction de l'UI |
| `07-double-submit-integrity.spec.ts` | Double soumission (T7) et 403 force (T1) | Double clic sur « Confirmer » d'un encaissement client et d'un ajustement de stock : une seule ecriture en base. Meme reference saisie deux fois : un seul paiement. POST force par la logistique : 403 au contrat d'erreur (`code`, `requestId` = en-tete `x-request-id`), solde intact |
| `08-role-actions-and-error-toast.spec.ts` | Refus lisibles et actions selon le role (T3, T1) | Paiement au-dela du solde : toast metier sans detail technique, rien en base. Logistique : facture visible, bouton de paiement desactive avec sa raison. Magasinier : modifier une piece oui, corbeille absente ; admin : corbeille presente |

## Commandes

- `npm run test:e2e`
- `npm run test:e2e:headed`
- `npx playwright test e2e/06-realtime-work-orders.spec.ts` pour une spec isolee
- Si `npx playwright` echoue (shims `node_modules/.bin` vides, voir `AGENTS.md` §8) :
  `node --env-file=.env node_modules/@playwright/test/cli.js test e2e/07-double-submit-integrity.spec.ts`
- `npx playwright show-report` pour ouvrir le rapport HTML apres un run

## Garde-fou : jamais contre la production

`playwright.config.ts` appelle `assertNotProductionDatabase()` (`e2e/helpers/production-guard.ts`) avant toute chose : si la base visée par cette session est la production, Playwright refuse de démarrer, avec un message qui dit quoi faire (sans jamais afficher l'URL ni le mot de passe).

- Base visée = `DATABASE_URL` de l'environnement (elle prime), à défaut le `.env` du répertoire courant, que le serveur lancé par Playwright chargerait.
- Est « production » toute base dont l'**hôte** contient un marqueur : l'endpoint Neon de production connu, plus ceux de `E2E_PRODUCTION_DB_MARKERS` (liste séparée par des virgules, pour un autre environnement à protéger).
- Test de la fonction : `tests/unit/e2e/production-guard.test.ts`.
- Lancer sur une branche Neon de test, sans toucher au `.env` : `DATABASE_URL=<url de test> DATABASE_URL_TEST=<url de test> node node_modules/@playwright/test/cli.js test`.
- Le serveur lancé par Playwright n'est jamais réutilisé (`reuseExistingServer: false`) : il démarre avec la `DATABASE_URL` vérifiée, et Playwright échoue si le port est déjà pris.
- Limite : avec `E2E_BASE_URL` (serveur extérieur), le garde-fou ne voit que la `DATABASE_URL` de la session de test et ne peut pas savoir sur quelle base ce serveur écrit ; c'est à vous de le démarrer sur la même base de test.

## Variables optionnelles

- `E2E_BASE_URL`: URL d'une app deja demarree (sinon Playwright lance `npm run dev`)
- `E2E_CHANNEL`: navigateur installe a utiliser a la place du Chromium de Playwright (`msedge`, `chrome`). Utile quand `playwright install` n'a pas ete lance sur le poste
- `E2E_PRODUCTION_DB_MARKERS`: hôtes (ou fragments) supplémentaires traités comme production par le garde-fou
- `DATABASE_URL`: requise par les specs 07 et 08, qui creent leurs donnees directement en base (d'ou `node --env-file=.env`)
- `FEATURE_FLAGS`: dans l'environnement du **serveur**. La spec 20 saute l'export KPI sans `kpi-reports=on` (le test l'indique)
- Base locale : le serveur et le runner peuvent viser le Postgres Docker (`DATABASE_URL=postgres://fleet:fleet@postgres:5432/<base>` + `DATABASE_WS_PROXY=localhost:5433/v1`), une base dédiée par session (`tests/README.md`), schéma poussé par `drizzle-kit push` sur `localhost:54320`
- `E2E_USERNAME`: login e2e pour les specs 01 a 05 (defaut `admin`)
- `E2E_PASSWORD`: mot de passe associe (defaut `admin123`)
- `E2E_MANAGER_USERNAME` / `E2E_MANAGER_PASSWORD`: profil createur de la spec 06 (defaut `terry`, chef d'atelier). Doit avoir le droit de creer un OT (`admin` ou `workshop_manager`)
- `E2E_VIEWER_USERNAME` / `E2E_VIEWER_PASSWORD`: profil observateur de la spec 06 (defaut `fatou`, magasinier). N'importe quel role authentifie convient, **a condition qu'il differe du createur**

> Les logins par defaut suivent `docs/qa/COMPTES_ENVIRONNEMENT.md`, source de verite
> de la base Neon courante. Les comptes de `scripts/seed-production-data.ts`
> (`workshop_manager`, `warehouse`, `technician`...) n'existent **pas** sur cet
> environnement: les utiliser fait skipper les specs sans que rien ne le signale.
- `VITE_ENABLE_SW=1`: le service worker PWA n'est enregistre qu'en production (en developpement il est retire et ses caches `fleetos-*` supprimes, sinon un module source modifie resterait invisible). La spec 13 le requiert et echoue si `navigator.serviceWorker.controller` est absent. `playwright.config.ts` positionne la variable pour le serveur qu'il lance ; avec `E2E_BASE_URL`, demarrer ce serveur avec `VITE_ENABLE_SW=1` (ou un build de production).
- `RECETTE_PASSWORD` (ou `RECETTE_PASSWORD_<ROLE>`): mot de passe des comptes `recette_*` (`scripts/recette-seed.ts`), requis par les specs 24 (client) et 25 (direction), qui sautent sinon avec la raison. `E2E_CLIENT_A_USERNAME`, `E2E_CLIENT_B_USERNAME`, `E2E_DIRECTION_USERNAME` changent les comptes (defaut `recette_client_1`, `recette_client_2`, `recette_direction`)
- `E2E_WORKERS`: nombre de workers Playwright (defaut `1` pour stabilite locale)
- `CI`: si defini, active 2 retries par test

## Configuration (`playwright.config.ts`)

- `testDir: ./e2e`, navigateur **Chromium uniquement** (Desktop Chrome)
- `baseURL` par defaut `http://127.0.0.1:5000` (le serveur sert l'API **et** le front sur ce port)
- Timeout test `60 s`, timeout assertion `10 s`
- `fullyParallel: false` et 1 worker par defaut: les specs partagent la meme base de donnees
- Artefacts en cas d'echec uniquement: `trace`, `screenshot`, `video`. Rapport HTML genere sans ouverture auto (`playwright-report/`, `test-results/`, tous deux gitignores)
- `webServer`: si `E2E_BASE_URL` n'est pas defini, Playwright demarre `npm run dev` (timeout 180 s) et reutilise un serveur deja lance hors CI

## Piege a connaitre: polling vs temps reel

La liste des OT se rafraichit toute seule **toutes les 7 secondes**
(`refetchInterval: 7000` dans `client/src/components/maintenance/work-order-table.tsx`).

Consequence: une assertion du type « le nouvel OT finit par apparaitre a l'ecran » avec un timeout
superieur a 7 s est satisfaite par le polling seul et **ne prouve rien** sur la chaine WebSocket.
C'etait le cas de la premiere version de la spec 06 (timeout de 15 s).

La spec 06 procede donc en deux temps:

1. elle capture les trames de la socket `/ws` du profil observateur (`page.on("websocket")`) et exige
   une trame `work_order_created` contenant le titre unique de l'OT. Le polling HTTP ne peut pas
   produire une trame WebSocket: c'est la preuve reelle;
2. elle verifie ensuite l'apparition dans l'UI avec un budget **inferieur** a l'intervalle de polling.

Meme logique a reproduire pour toute nouvelle spec temps reel: verifier la trame, pas seulement l'ecran.

## Donnees de test

Les specs s'executent sur la **base reelle** pointee par `DATABASE_URL`, sans seed dedie ni nettoyage apres run. Consequences a connaitre:

- Les specs 04 et 05 sont **tolerantes a une base vide**: si aucun ecart / aucune facture n'existe, elles verifient l'etat vide puis se declarent `skipped` (via `test.skip`) au lieu de passer au vert. Un `skipped` dans le rapport signale donc que le chemin metier principal n'a **pas** ete exerce, faute de donnees.
- La spec 05 **ecrit** un paiement de `1` sur la premiere facture client trouvee, si le bouton d'enregistrement est disponible.
- La spec 06 **cree un OT** nomme `E2E-RT-<timestamp>` sur le premier vehicule retourne par l'API, puis **le supprime** en fin de test (y compris si une assertion echoue). C'est la seule spec qui nettoie derriere elle.
- La spec 06 se declare `skipped` si les comptes multi-profils n'existent pas: elle ne se rabat jamais sur un test mono-utilisateur.
- Les specs 07 et 08 ne dependent d'aucun compte ni d'aucune donnee existante : elles creent leurs utilisateurs (un par role), clients, factures et pieces avec les fabriques de `tests/support/factories` (prefixe `TEST-`, voir `e2e/helpers/test-data.ts`), lisent la verite en base, puis suppriment tout en `afterAll` (`cleanupCreated`, plus les mouvements de stock crees).

Ne pas lancer `npm run test:integration` ni `npm run test:contract` pendant les specs 07 et 08 : leur setup
(`cleanupOrphanTestRows`) supprime **toutes** les lignes `TEST-`, y compris les utilisateurs que l'e2e vient de creer.
Symptome : page de connexion au milieu d'un test, `GET /api/auth/me` en 404 dans les logs serveur.

Ne pas lancer la suite contre une base de production (le garde-fou ci-dessus l'interdit). Pour un jeu de donnees de depart, voir `scripts/README-SEEDING.md`.

## Limites connues

- Les specs 06 a 08 jouent plusieurs profils distincts. Les specs 01 a 05 utilisent un compte unique (`E2E_USERNAME`, `admin` par defaut) et ne valident donc aucune regle RBAC, alors que le metier repose sur 9 roles.
- Les specs 02 a 05 sont surtout des tests de **lecture et de navigation**. Le parcours metier complet panne -> OT -> demande de piece -> commande fournisseur -> reception -> facture -> reglement n'est couvert que **manuellement**, via `docs/qa/E2E PANNE-OT-REAPPRO-FACTURE`.
- Pas de workflow CI dans le repo, bien que la config prevoie deja le cas `CI` (retries).

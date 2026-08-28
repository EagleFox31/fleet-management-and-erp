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

## Commandes

- `npm run test:e2e`
- `npm run test:e2e:headed`
- `npx playwright test e2e/06-realtime-work-orders.spec.ts` pour une spec isolee
- `npx playwright show-report` pour ouvrir le rapport HTML apres un run

## Variables optionnelles

- `E2E_BASE_URL`: URL d'une app deja demarree (sinon Playwright lance `npm run dev`)
- `E2E_USERNAME`: login e2e pour les specs 01 a 05 (defaut `admin`)
- `E2E_PASSWORD`: mot de passe associe (defaut `admin123`)
- `E2E_MANAGER_USERNAME` / `E2E_MANAGER_PASSWORD`: profil createur de la spec 06 (defaut `terry`, chef d'atelier). Doit avoir le droit de creer un OT (`admin` ou `workshop_manager`)
- `E2E_VIEWER_USERNAME` / `E2E_VIEWER_PASSWORD`: profil observateur de la spec 06 (defaut `fatou`, magasinier). N'importe quel role authentifie convient, **a condition qu'il differe du createur**

> Les logins par defaut suivent `docs/qa/COMPTES_ENVIRONNEMENT.md`, source de verite
> de la base Neon courante. Les comptes de `scripts/seed-production-data.ts`
> (`workshop_manager`, `warehouse`, `technician`...) n'existent **pas** sur cet
> environnement: les utiliser fait skipper les specs sans que rien ne le signale.
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

Ne pas lancer la suite contre une base de production. Pour un jeu de donnees de depart, voir `scripts/README-SEEDING.md`.

## Limites connues

- Seule la spec 06 joue deux profils distincts. Les specs 01 a 05 utilisent un compte unique (`E2E_USERNAME`, `admin` par defaut) et ne valident donc aucune regle RBAC, alors que le metier repose sur 9 roles.
- Les specs 02 a 05 sont surtout des tests de **lecture et de navigation**. Le parcours metier complet panne -> OT -> demande de piece -> commande fournisseur -> reception -> facture -> reglement n'est couvert que **manuellement**, via `docs/qa/E2E PANNE-OT-REAPPRO-FACTURE`.
- Pas de workflow CI dans le repo, bien que la config prevoie deja le cas `CI` (retries).

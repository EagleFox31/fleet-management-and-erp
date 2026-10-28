# Plan — Avancer vers la version 1

**Statut** : proposé
**Date** : 2026-10-28
**Base** : lecture complète des documents sources client (`attached_assets/`), de
`docs/` et vérifications ciblées dans le code.

---

## Où on en est

Méthode : 28 besoins exprimés dans les documents client. Couvert = 1, partiel =
0,5, absent = 0. « Couvert » veut dire que les tables et le code existent, **pas**
que la fonction a été recettée : aucun des 127 scénarios de
`docs/qa/CAHIER_TESTS_UTILISATEUR.md` n'a de résultat enregistré.

| Domaine | % | Manque |
|---|---|---|
| Chauffeurs, CPC, pointage | 100 % | — |
| Atelier (OT, préventif, pannes) | 100 % | Lots internes 1, 2, 4, 5 (`EVOLUTION_ATELIER_RECEPTION_QC.md`) |
| Achats | 100 % | — |
| Socle (utilisateurs, audit) | 100 % | — |
| Parc et documents | 83 % | Types ACF, carte bleue, vignette, jaugeage, TAE, agrément PD |
| Magasin et pneus | 67 % | Vente de pièces |
| Carburant | 50 % | Soldes carte / crédit, solde gasoil en litres |
| Exploitation | 50 % | Avance 30 %, retenues TVA/IS, grille tarifaire, coûts de voyage |
| Finance | 10 % | Banque, caisse, traites, chèques, salaires, amortissement |
| QHSE | 0 % | Tout |
| **Global** | **63 %** | |

| Profil | % |
|---|---|
| Technicien | 80 % |
| Magasinier | 80 % |
| Secrétaire | 79 % |
| Chef d'atelier | 77 % |
| Logisticien | 71 % |
| Admin | 63 % |
| Direction (besoins propres) | 8 % |
| Chauffeur, Client | non mesurable : aucun besoin écrit côté client |

Le cœur atelier → magasin → achats est prêt. L'exploitation et la finance ne le
sont pas.

---

## Principe

**Fiabiliser et livrer avant d'ouvrir un nouveau module.** Le risque principal
n'est pas ce qui manque, c'est ce qui existe sans avoir été vérifié.

Les comptes et mots de passe de `docs/qa/COMPTES_ENVIRONNEMENT.md` sont des
comptes de test : ils restent tels quels.

---

## Étape 1 — Fermer les accès ouverts de l'API

### Le problème de fond

`server/app.ts` monte l'API par `app.use("/api", apiRouter)` **sans
authentification globale**. Chaque route doit donc se protéger elle-même avec
`authenticate`. Celles qui l'oublient sont accessibles à n'importe qui, sans
compte, depuis Internet.

### 1.1 Routeur missions entièrement ouvert

`server/api/missions.routes.ts` est monté sans garde
(`apiRouter.use("/missions", missionsRoutes)`) et aucune de ses 12 routes
n'appelle `authenticate`. Sans être connecté, on peut :

- lister et lire toutes les missions (`GET /`, `GET /:id`) — clients, trajets,
  montants ;
- créer une mission (`POST /`) ;
- la modifier ou changer son statut (`PATCH /:id`, `PUT /:id/status`) ;
- saisir des pleins de carburant sur une mission (`POST /:id/fuel-records`).

**Le repli `|| 1`.** À la création (ligne 1691) :

```ts
const userId = (req as any).session?.userId || 1;
```

Si personne n'est connecté, la mission est enregistrée comme créée par
l'utilisateur n°1, en général l'admin. Deux conséquences :

- la requête anonyme **réussit** au lieu d'être refusée ;
- le journal ment : il attribue à l'admin une action qu'il n'a pas faite. La
  traçabilité, qui est une règle du projet, est faussée.

**Correction.**

1. Monter le routeur avec une garde : `apiRouter.use("/missions", authenticate,
   missionsRoutes)`. Même pattern que `/work-order-items`, déjà fait dans le lot 3 : toute
   route ajoutée plus tard est couverte d'office.
2. Remplacer `|| 1` par l'utilisateur de session ; refuser en 401 s'il manque.
3. Vérifier les rôles par action (qui crée, qui change un statut). Les profils
   concernés : `logistics`, `admin`, et le chauffeur pour ses pleins.

### 1.2 Routes de test et de développement

| Route | Problème | Correction |
|---|---|---|
| `POST /api/test-mileage-maintenance` (`routes.ts:1686`) | Aucune authentification. Génère de **vrais** ordres de travail préventifs en base à partir d'un kilométrage envoyé par l'appelant. | Supprimer, ou la réserver à l'admin hors production. |
| `DELETE /api/dev/work-orders-all` (`routes.ts:5540`) | Il suffit d'être connecté, **quel que soit le rôle** — un chauffeur ou un compte client peut **effacer tous les ordres de travail**, sans confirmation ni retour arrière. | Supprimer. À défaut : admin uniquement **et** désactivée si `NODE_ENV=production`. |
| `POST /api/check-all-maintenance` (`routes.ts:5553`) | Aucune authentification. Déclenche la génération des OT préventifs. Appelée par `gmao-dashboard.tsx` : c'est une vraie fonction, pas un test. | Ajouter `authenticate` + rôle atelier/admin. |
| `POST /api/test-date-maintenance` (`routes.ts:5434`) | Authentifiée, mais tout rôle peut générer des OT. | Admin uniquement, ou supprimer. |

`server/routes.ts` est une dette connue (AGENTS.md §9) : on y retire ou on y
protège, on n'y ajoute rien.

### 1.2 bis Trouvées par le garde-fou

| Route | Problème | Correction |
|---|---|---|
| `POST /api/auth/register` | Aucune garde, et le corps accepte `role` : **n'importe qui pouvait se créer un compte admin**. Le client n'appelle pas cette route. | `isAdmin`. |
| `GET /api/technician/work-orders/:technicianId` | Aucune garde : les OT de n'importe quel technicien lisibles sans session. | `isTechnician` ; un technicien ne lit que les siens (403 sinon). |
| `POST /api/test-date-maintenance` | Tout rôle pouvait créer un OT. | Création d'OT réservée admin / chef d'atelier ; la branche « demande documentaire » reste ouverte au secrétariat. Bouton masqué côté écran. |

### 1.3 Garde-fou pour ne plus recommencer

Un test de contrat (`tests/contract/`) qui appelle chaque route de l'API **sans
session** et attend 401, avec une liste blanche explicite des routes publiques
(login, landing…). Une route ajoutée sans garde fera alors échouer la CI au lieu
d'arriver en production. Consigner l'incident dans
`docs/analysis/LESSONS_LEARNED.md`.

**Fini quand** : le test de contrat passe ; aucune route hors liste blanche ne
répond sans session.

**Fait le 28 octobre 2026.** Contrôle statique `tests/contract/api-auth-guard.contract.test.ts`
(parcourt la pile Express, liste blanche justifiée de 5 routes publiques) et
contrôle dynamique `tests/contract/api-auth-sessions.contract.test.ts` (401
anonyme, 403 hors rôle, mission attribuée à l'auteur réel ; données créées puis
supprimées).

---

## Étape 2 — Retirer l'affichage factice « Service Actif »

### Le problème

L'onglet Direction « Distribution & Envois »
(`client/src/pages/management/reports.tsx`, ligne 434) affiche :

- un badge vert **« Service Actif »** ;
- « Programmation des envois automatiques des rapports par email » ;
- trois destinataires écrits en dur dans le code (`dg@`, `daf@`, `ops@yarofleet.cm`).

Le serveur ne contient **aucun** service d'envoi d'email (ni nodemailer, ni SMTP,
ni tâche planifiée). Rien n'est envoyé. Le DG croit que les rapports partent
chaque semaine ; ils ne partent jamais.

Cela contredit la règle du projet (README, LESSONS_LEARNED) : *jamais de chiffre
inventé — un tableau de bord faux est pire qu'une case vide*. Un statut inventé
est pire qu'un chiffre inventé, parce qu'on cesse de vérifier.

### Correction

Court terme : remplacer l'onglet par un état honnête — « Envoi automatique non
disponible » — et garder l'export PDF manuel du Board Pack, qui fonctionne
(`management-board-pack-pdf`).

Plus tard, si le client le veut : un vrai service (fournisseur SMTP, table des
abonnements, tâche planifiée, journal des envois). C'est un lot à part.

**Fini quand** : aucun écran n'annonce une fonction que le serveur n'assure pas.
Passer les autres onglets Direction au même crible (Trésorerie notamment : sur
quelles données s'appuie-t-il, sachant que banque et caisse n'existent pas ?).

**Fait le 28 octobre 2026.** Badge « Non disponible », message « Envoi
automatique non disponible » et renvoi vers « Télécharger le PDF » ; programmation
et destinataires fictifs retirés. Onglet Trésorerie vérifié : il lit les factures
clients et les dépenses réelles (`data.revenue`, `data.expenses`), pas un solde
bancaire ; le libellé « Cash encaissé sur compte » devient « Encaissé (factures
clients réglées) ». Une vraie trésorerie reste l'étape 7.

---

## Étape 3 — Terminer le lot 3 atelier

### Le problème

Les lignes de travail sur l'OT (`docs/plans/lignes-de-travail-ot.md`) sont
presque écrites mais **non commitées** : table `work_order_items`, catalogue de
main-d'œuvre, service, routes, migration, test unitaire. Du travail non commité
se perd et bloque tout le reste.

Le même diff contient une optimisation sans lien (planifications de maintenance
en une requête au lieu d'une par véhicule, `routes.ts`) : la commiter à part.

### Correction

1. `npm run check` (zéro erreur TypeScript sur tout le projet), `npm test`,
   tests d'intégration et de contrat.
2. Vérifier les trois couches : cache local, événement WebSocket, invalidation
   des écrans satellites (AGENTS.md §2).
3. Deux commits : lot 3, puis optimisation.

**Fini quand** : commité, vérifications vertes, cases du plan cochées.

---

## Étape 4 — Recette de l'existant

### Le problème

Les pourcentages ci-dessus disent ce qui **existe**, pas ce qui **marche**. Les 7
anomalies P2 (`RAPPORT_RETOURS_P2/RAPPORT_RETOURS_P2.md`) sont toutes « Ouvert »
dans le document ; d'après le code :

| Anomalie | État probable |
|---|---|
| P2-01, 02, 03, 05 | Corrigées dans le code, document pas mis à jour |
| P2-04 champs date/heure | Ouverte (champs natifs) |
| P2-06 responsive mobile | À retester sur téléphone |
| P2-07 | Partiellement traitée |

Aucun test automatisé ne couvre le cas P2b ni la synchronisation mobile du
statut d'OT.

### Correction

1. Corriger P2-04, P2-06, P2-07 ; retester P2-01 à 05 et mettre le rapport à jour.
2. Écrire les tests P2b et synchro mobile (deux comptes de rôles différents,
   assertion sur la trame WebSocket — `e2e/README.md`).
3. Dérouler le cahier de 127 scénarios et **enregistrer** chaque résultat.

**Fini quand** : rapport P2 à jour, cahier de tests rempli, anomalies bloquantes
à zéro.

---

## Étape 5 — Livrer la version 1 et lever les ambiguïtés

Livrer le périmètre à 77 % et plus : atelier, magasin, pneus, achats, parc,
chauffeurs, carburant.

À la livraison, poser au client les 13 questions ouvertes de la synthèse des
sources. Les plus bloquantes pour la suite :

- les retenues TVA 19,25 % et IS 2,2 % se calculent-elles sur le **HT** ou le
  **TTC** ?
- quelle formule de **rentabilité** fait foi ? Deux documents se contredisent ;
- **durées de validité** de chaque document véhicule ;
- la durée d'un voyage court-elle depuis le départ ou depuis le rechargement ?

Sans ces réponses, l'étape 6 coderait des hypothèses.

---

## Étape 6 — Compléter l'exploitation

Le gain le plus fort : Logisticien de 71 % vers ~90 %.

- Facturation client complète : avance 30 %, retenues TVA/IS, statuts de dossier
  (« en cours de voyage »…).
- Grille tarifaire par client et par tonne.
- Coûts de voyage : BGFT/BARC, frais de mission + prime, FDR, ration, autres
  dépenses.
- Soldes carburant : carte, crédit, gasoil en litres.
- Types de documents véhicule manquants.

Nommer chaque montant avec sa base fiscale (`montantHT`, `montantTTC`) : leçon
déjà apprise (LESSONS_LEARNED).

---

## Étape 7 — Finance pour la Direction

Direction de 8 % vers plus de 60 %.

- Banque, caisse, traites et chèques (Sprint 5 déjà planifié,
  `docs/planning/SPRINT5_PLAN_DETAILLE.md`).
- Rentabilité par camion avec la formule validée à l'étape 5.
- Rebrancher l'onglet Trésorerie Direction sur ces vraies données.

---

## Étape 8 — Selon la demande du client

- Lots atelier 1, 2, 4, 5 : réception, contrôle qualité, observations,
  traçabilité et concurrence.
- Champ `receivedBy` et stock réservé par OT.
- QHSE : infractions, seuil de 25 par mois et réduction de prime de 40 000 FCFA.
- Vente de pièces.
- Paie et amortissement : **décision à prendre avec le client** — dans
  l'application ou dans son outil comptable ?
- Envoi automatique des rapports Direction (voir étape 2).

---

## En parallèle — Remettre la documentation au clair

- Doublons : `COMPTES_ENVIRONNEMENT.md` et `QA-DASHBOARD-ADMIN.md` (docs/qa et
  RAPPORT_RETOURS_P2), `ALGO_RECOMMANDATION_BUDGET_MISSION.md` (analysis et
  planning).
- Statuts faux : `fuel-mission-tracking.md` dit « à implémenter » alors que c'est
  fait ; le plan des corridors est décoché alors qu'il est livré.
- Rôle `management` absent de `PROFILS_ACCES.md` et `PREMIUM-TABS-MATRIX.md`.
- `docs/README.md` n'indexe pas `plans/`, `walkthroughs/`, `api/`, `ui/`.
- Bandeau « historique » sur les documents de 2025.

---

## Ordre et dépendances

```
1 Accès API ─┐
2 Factice    ├─> 4 Recette ─> 5 Livraison V1 + questions ─> 6 Exploitation ─> 7 Finance ─> 8
3 Lot 3     ─┘                        │
                                      └─ réponses client requises pour 6 et 7
```

Les étapes 1, 2 et 3 sont indépendantes et courtes ; elles passent avant tout le
reste.

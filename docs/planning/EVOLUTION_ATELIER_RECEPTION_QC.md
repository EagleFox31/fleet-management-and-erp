# Évolution future — Atelier interne (réception, QC, main-d'œuvre)

Date : 20 août 2026  
Statut : **Backlog produit** (pas d'implémentation maintenant)  
Source : comparaison avec [atelier2026](https://github.com/EagleFox31/atelier2026) (Atelier Maître / Trigenys Studio)

Document de cadrage, pas un sprint. À lancer seulement quand le flux OT + pièces + magasin est stable.

---

## Décision maintenant

- On **ne fusionne pas** FleetOS avec un logiciel de garage B2C.
- On **n'importe pas** devis client, caisse Orange/MTN, vente comptoir, multi-tenant.
- On **enrichit plus tard** l'ordre de travail interne avec ce que le garage fait mieux : réception, observations, contrôle qualité, lignes de main-d'œuvre.

FleetOS reste un OS de flotte : le camion appartient à l'entreprise, le magasinier tient les pièces, la facture client est celle d'une mission. atelier2026 reste le laboratoire du parcours client externe.

---

## Pourquoi on reporte

- Priorité actuelle : stabilité des 3 couches (cache, WebSocket, resync) sur les transitions déjà en production.
- Le cycle OT actuel (`pending` → `in_progress` → `awaiting_parts` → `completed` / `cancelled`) suffit à l'exploitation.
- Ajouter des états sans les trois couches + les écrans satellites (dashboards chef, magasin, admin) recréerait le bug le plus fréquent du projet.

Dette déjà ouverte, à ne pas mélanger avec ce backlog :

- `docs/analysis/EVOLUTION_STOCK_RESERVE_OT.md` — stock réservé
- `docs/analysis/MATRICE_ROLES_GAP.md` — `receivedBy` sur l'entrée en stock
- `docs/planning/PLAN_BLOCS_METIERS_COUCHE_PAR_COUCHE.md` — bloc A OT + pièces

---

## Filtre d'import

| Idée vue dans atelier2026 | Verdict FleetOS |
|---|---|
| Checklist réception (km, carburant, état, photos) | **À faire** |
| Étape QC avant clôture OT | **À faire** |
| Lignes de travail + catalogue main-d'œuvre | **À faire** |
| Observations technicien structurées | **À faire** |
| Historique d'états OT dédié | **À faire** (s'appuyer sur `status_history`) |
| Optimistic locking (`version`) sur l'OT | **À faire** |
| Immobilisation + alertes 24 h / 72 h / 7 j | **Optionnel** |
| RDV → OT pré-rempli | **Optionnel** (visite externe, pas la préventive km) |
| Devis client + signature + caisse | **Interdit** |
| Vente comptoir / ASP comme flux principal | **Interdit** |
| 13 états jusqu'à `INVOICED` / `CLOSED` caisse | **Interdit** — 1 ou 2 états en plus, pas toute la machine garage |
| Multi-tenant Tenant / Garage | **Interdit** |
| Rôle caissier atelier | **Interdit** — matrice magasin / chef / secrétaire |

---

## Cible métier (quand on lancera)

Chaîne OT interne, **sans** devis ni encaissement :

```
pending
  → received          (réception atelier : km, carburant, checklist)
  → in_progress
  → awaiting_parts    (inchangé — flux demandes de pièce)
  → qc_pending        (contrôle chef d'atelier)
  → completed | cancelled
```

`qc_rejected` revient en `in_progress` (comme atelier2026), ce n'est pas un statut d'affichage long : c'est une transition.

Libellés : décrire **l'objet suivi** (l'OT), pas l'action. Source unique dans `shared/constants/` — ne pas dupliquer dans le JSX. Voir `AGENTS.md` §1.

Profils :

| Étape | Acteur |
|---|---|
| Réception | Chef d'atelier (backup admin) ; technicien en lecture / complément photos |
| Travaux | Technicien |
| Pièces | Magasinier (clés du magasin) — **ne pas** recoller ça au caissier d'atelier2026 |
| QC | Chef d'atelier |
| Clôture | Chef d'atelier |

Toute nouvelle transition **doit** livrer les 3 couches (`docs/analysis/LESSONS_LEARNED.md`, skill `transition-metier`).

---

## Méthode d'exécution

Le quoi est décidé plus haut. Voici comment le faire sans rouvrir les bugs que
ce projet a déjà payés.

### Règle 1 — Un lot = un changement d'état = les trois couches complètes

C'est la raison du report écrite plus haut. Un lot qui touche au cycle de vie
n'est **pas** terminé tant que les trois ne sont pas faites :

1. correction du cache local au moment de la transition ;
2. événement WebSocket avec la bonne portée (`user`, `roles` ou `broadcast`) ;
3. **invalidation des écrans satellites** — tableau chef d'atelier, dashboard
   admin, fiche véhicule, statistiques d'OT.

Le troisième point est celui qu'on oublie, et c'est celui qui produit l'écran
figé. Voir `.claude/skills/transition-metier/SKILL.md`.

### Règle 2 — Commencer par le lot 3, pas le lot 1

L'ordre d'écriture ci-dessous n'est pas l'ordre d'exécution recommandé.

**Les lignes de travail (lot 3) n'ajoutent aucun état** : c'est une table fille
sur un OT existant, donc aucun risque sur les transitions. Et elles débloquent
ce qui manque vraiment — temps par technicien, coût réel d'atelier, MTTR.

Réception et QC touchent au cycle de vie. Les faire **après** revient à les
poser sur une base déjà instrumentée.

### Règle 3 — Ordre interne d'un lot

```
shared/schema.ts → init-database.ts → service → route → écran → test
```

Deux points de vigilance :

- **Le schéma et `init-database.ts` avancent ensemble.** Une colonne déclarée
  dans Drizzle mais absente d'`init-database` plante sur une base vierge — c'est
  la première leçon de `LESSONS_LEARNED.md`.
- **Un seul écrivain par table.** La nouvelle table a son service ; aucune route
  n'écrit directement par `storage`. Trois portes dérobées de ce type ont été
  fermées en août 2026 (sortie de stock, statut véhicule, `status_history`).

### Règle 4 — Figer le vocabulaire avant d'écrire

Deux décisions à prendre **avant** le premier commit du lot 3 :

- le nom affiché : *ligne de travail*, *tâche*, ou *prestation* ;
- ce que devient `workOrders.cost`.

La seconde est piégeuse. `workOrders.cost` est documenté dans le schéma comme
« coût de base, main-d'œuvre, pas un total », et le tableau Direction s'appuie
dessus (`getMaintenanceCost`, `getFleetKPI`). Si les lignes deviennent la
vérité, `cost` doit devenir dérivé — et les deux calculs Direction corrigés
**dans le même lot**.

Sinon on obtient deux sources pour le coût atelier. C'est le motif qui a coûté
quatre corrections successives sur le tableau Direction en août 2026.

### Règle 5 — Le test de non-régression est déjà écrit

Chaque lot touchant au cycle repasse le cas **P2b** de
`docs/qa/QA-DASHBOARD-ADMIN.md` : véhicule sain contre véhicule déjà
immobilisé, avec clôture d'un OT parmi plusieurs.

C'est le scénario qui a révélé qu'on remettait un camion en service alors qu'il
restait au pont pour un autre OT. Un nouvel état dans le cycle peut rouvrir
exactement ce défaut.

---

## Lots (ordre d'exécution)

### Lot 1 — Réception atelier

**Pourquoi.** Tracer l'état du véhicule à l'entrée (litige chauffeur / atelier, km, carburant, carrosserie).

**Cible :**

- Table `work_order_receptions` (1:1 avec `work_orders`) : `mileage_in`, `fuel_level`, `checked_by`, `checked_at`, `notes`, photos.
- Items de checklist (catalogue + résultats OK / warning / critical / NA), calqués sur `ReceptionCheck` / `ReceptionCheckItem` d'atelier2026, adaptés poids lourds.
- Statut OT `received` **ou** champs de réception sans nouvel état si on veut rester à 5 statuts au premier passage. Préférer un vrai statut dès que l'UI chef d'atelier l'affiche.

**Hors scope :** signature client, inventaire d'objets personnels (métier garage B2C).

### Lot 2 — Contrôle qualité avant `completed`

**Pourquoi.** Aujourd'hui on clôture sans étape de contrôle. Le chef d'atelier doit pouvoir renvoyer en travaux.

**Cible :**

- Statuts `qc_pending` (+ transition `qc_rejected` → `in_progress`).
- Formulaire QC court (pas une usine) : OK / réserves / motif.
- Interdire `completed` depuis `in_progress` sans passer par QC (admin backup seulement).
- Event bus : `work_order.qc_pending`, `work_order.qc_rejected`, `work_order.completed` — invalidation liste OT, détail, dashboards chef / admin / technicien.

### Lot 3 — Lignes de travail + catalogue main-d'œuvre

**Pourquoi.** Le champ `duration` / `cost` de l'OT est trop pauvre pour le MTTR et le coût atelier.

**Cible :**

- `labor_catalog` (code, libellé, heures standard, actif).
- `work_order_items` : OT, poste, technicien, heures estimées / réelles, statut ligne.
- Ne pas facturer le client flotte : c'est du coût interne, pas un devis.

Chevauche `time_tracking` existant : réutiliser plutôt que dupliquer. Trancher à l'implémentation.

### Lot 4 — Observations technicien

**Pourquoi.** Remplacer le `diagnosis` texte libre par des observations (catégorie, gravité, photos, auteur, horodatage).

**Cible :** table `work_order_observations`. Pas de lien « inclure dans le devis » (pas de devis atelier).

### Lot 5 — Traçabilité et concurrence

- Historique d'états OT : s'appuyer sur `status_history` (déjà dans `shared/schema.ts`), pas une troisième table de libellés.
- Champ `version` (optimistic locking) sur `work_orders` : chef et technicien écrivent le même OT.
- `mileage_out` à la clôture si la réception a un `mileage_in`.

### Lot 6 — Optionnel, plus tard

- Immobilisation véhicule (attente pièces / documents) + alertes 24 h / 72 h / 7 j — proche des alertes existantes, ne pas copier les SMS Orange/MTN tant qu'on n'a pas de canal SMS produit.
- Bouton « créer un OT depuis une visite / un RDV » pour les démarches externes (visite technique), distinct de la préventive km/date déjà en place.

---

## Ce qu'on ne touche pas

- Flux demandes de pièce (`pending` → `issued` / `fulfilled`) et libellés magasin (`Entrée en stock` / `Sortie du stock`).
- Commandes fournisseur et rapprochement 3 voies — déjà plus complet qu'atelier2026.
- Factures clients de **mission** (`client_invoices`, TVA 19,25 %) — ce n'est pas une caisse atelier.
- Pneus, carburant, missions, documents réglementaires.

---

## Critères de validation (quand un lot partira)

- Un test temps réel joue **deux rôles** (chef + technicien, ou chef + magasinier) et vérifie la trame WebSocket, pas seulement l'UI après 7 s de polling. Voir `e2e/README.md`.
- Aucun libellé de statut OT en dur dans le JSX.
- `queryClient` importé uniquement via `@/lib/queryClient`.
- Colonnes nouvelles : `shared/schema.ts` **et** `ALTER TABLE … IF NOT EXISTS` dans `server/init-database.ts`.
- Pas d'emoji dans l'UI.

---

## Déclencheur d'implémentation

Lancer le lot 1 (réception) quand :

- le flux OT → demande de pièce → magasin est jugé stable en recette ;
- le chef d'atelier a un cas réel de litige « état du camion à l'entrée » non traçable aujourd'hui.

Lancer le lot 2 (QC) quand le lot 1 est en production, ou plus tôt si des OT passent `completed` alors que le travail n'est pas bon.

Ne pas ouvrir les 5 lots d'un coup.

---

## Références

- Dépôt comparé : https://github.com/EagleFox31/atelier2026 (`docs/WORKFLOWS.md`, `prisma/schema.prisma`, `CLAUDE.md`)
- Règle des 3 couches : `docs/analysis/LESSONS_LEARNED.md`, `.claude/skills/transition-metier/SKILL.md`
- Rôles magasin / atelier : `docs/analysis/MATRICE_ROLES_GAP.md`
- OT + pièces (plan existant) : `docs/planning/PLAN_BLOCS_METIERS_COUCHE_PAR_COUCHE.md`
- Stock réservé (autre report) : `docs/analysis/EVOLUTION_STOCK_RESERVE_OT.md`
- Suivi visuel multi-profils (timeline, indépendant de ce backlog) : `docs/planning/EVOLUTION_PROCESS_TIMELINE.md`

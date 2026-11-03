# Yaro FleetOS

**Gestion de flotte et GMAO pour transporteur routier.** Du parc véhicules à la
facturation client, en passant par l'atelier, le magasin et les achats — un seul
système, neuf métiers, une seule source de vérité.

```
129 000 lignes TypeScript   43 tables   326 routes API   9 profils métier
     42 services            80 pages    164 composants   45 documents
```

---

## Le problème que ça résout

Un transporteur routier fait tourner trois métiers qui ne se parlent pas :
l'**exploitation** (missions, chauffeurs, facturation), l'**atelier**
(pannes, ordres de travail, préventif) et le **magasin** (pièces, pneus,
approvisionnement). Chacun tient son classeur Excel. Personne ne sait dire
pourquoi un camion est immobilisé depuis trois jours, ni combien il a coûté.

Yaro FleetOS relie les trois. Une panne déclenche un ordre de travail, qui
génère une demande de pièce, qui remonte au magasin, qui déclenche une commande
fournisseur, qui alimente la facture — et le camion immobilisé apparaît sur le
tableau de bord du logisticien avant qu'il ne promette une livraison.

## Modules

| Domaine | Couverture |
|---|---|
| **Parc** | Fiches véhicules, documents et conformité (carte grise, assurance, visite technique), historique de statuts, workflow d'acquisition |
| **Atelier** | Ordres de travail, catalogue de pannes, planifications préventives, suivi du temps passé |
| **Magasin** | Inventaire pièces, catalogue à variantes, mouvements de stock, alertes de réapprovisionnement |
| **Pneumatiques** | Parc de pneus, montage par position, inspections d'usure, rotations |
| **Achats** | Fournisseurs et notation, commandes, factures fournisseurs, rapprochement à trois voies |
| **Carburant** | Pleins, carte carburant, consommation par véhicule et par mission |
| **Exploitation** | Missions, affectations chauffeurs, étapes, facturation et paiements clients |
| **Ressources humaines** | Chauffeurs, permis, CNI, formation CPC avec alertes d'expiration |

## Architecture

```
React 18 · TypeScript · Vite          Express 4 · TypeScript
wouter · TanStack Query v5     ⇄      Drizzle ORM
Radix UI · Tailwind                   PostgreSQL (Neon serverless)
                    ↕
        WebSocket · LISTEN/NOTIFY
```

**Monorepo à trois racines.** `shared/` porte le schéma Drizzle et les
constantes métier ; `server/` et `client/` l'importent tous les deux. Un statut,
un libellé ou un groupe de rôles n'existe qu'à un seul endroit — le typage
casse à la compilation si les deux côtés divergent.

### Décisions structurantes

**La règle des trois couches.** Toute action qui change un statut doit faire
trois choses : corriger le cache local, émettre un événement WebSocket, et
invalider les écrans satellites. Une sortie de stock met à jour l'ordre de
travail *et* le tableau du magasinier *et* les statistiques — sans
rafraîchissement manuel. 107 points d'émission dans le code serveur.

**Le contrôle d'accès vit dans le service, pas dans la route.** Les middlewares
filtrent à la porte, mais la règle métier — qui peut faire passer une demande de
pièce de « reçue » à « sortie du stock » — est tranchée par un automate de
transitions unique, testé indépendamment. Une route qui écrirait un statut en
contournant le service serait un défaut, pas une variante.

**Séparation des tâches.** Le technicien demande une pièce, il ne se la délivre
pas. Le chef d'atelier valide le besoin, le magasinier ouvre le magasin. Quand
la réalité du terrain impose une exception — magasin fermé un samedi soir — elle
passe par un chemin nommé, avec motif obligatoire, journalisé et compté. Une
dérogation reste une dérogation ; elle n'élargit jamais un droit.

**Jamais de chiffre inventé.** Quand une donnée manque, l'interface écrit
« Non calculable » et dit pourquoi, plutôt que d'afficher un zéro plausible.
Un tableau de bord faux est pire qu'une case vide : on y prend des décisions.

## Démarrage

**Prérequis** : Node.js 20+, une base PostgreSQL (Neon ou locale).

```bash
npm install
cp .env.example .env      # renseigner DATABASE_URL et SESSION_SECRET
npm run db:push           # applique le schéma Drizzle
npm run dev               # http://localhost:5000
```

Le serveur Express et le client Vite tournent sur le même port : une seule
commande, pas de proxy à configurer.

### Variables d'environnement

| Variable | Rôle |
|---|---|
| `DATABASE_URL` | Chaîne de connexion PostgreSQL. **Jamais commitée.** |
| `DATABASE_URL_TEST` | Base des tests d'intégration et de contrat, exportée dans le shell (jamais lue depuis `.env`). Obligatoire : aucun repli sur `DATABASE_URL`, et `DATABASE_URL` doit être absente ou identique (voir `tests/README.md`). |
| `SESSION_SECRET` | Secret de signature des sessions Express. |

## Tests

Quatre niveaux, du plus rapide au plus lent :

```bash
npm test                 # unitaires — aucune base requise
npm run test:integration # services contre une vraie base
npm run test:contract    # forme des réponses API
npm run test:e2e         # Playwright, parcours multi-profils
```

Les tests unitaires importent les symboles de production, jamais une copie de la
règle : un test qui redéclare la table des transitions ne teste rien. L'un
d'eux vérifie par identité (`toBe`) que les libellés de statut du serveur *sont*
ceux du module partagé — il tombe si quelqu'un réintroduit une table locale, même
avec les mêmes valeurs.

## Structure

```
shared/          Schéma Drizzle, constantes métier, types partagés
server/
  api/           Routes par domaine
  services/      Règles métier (42 services)
  middleware/    Authentification, RBAC, upload
client/src/
  pages/         80 écrans, découpés par métier
  components/    164 composants, dont un design system interne
  hooks/         Requêtes, temps réel, brouillons de formulaire
docs/            45 documents: QA, guides métier, analyses, plans
tests/           Unitaires, intégration, contrat
e2e/             Playwright multi-profils
```

## Détails d'ingénierie

**Design system interne.** `HeaderCard`, `KpiTile`, `DeadlineTile`,
`PremiumDataTable` : les états visuels sont calculés, pas recopiés. Une tuile
d'échéance reçoit une date et en déduit seule sa couleur, son icône et sa phrase
(« Expire dans 8 jours », « En retard de 12 jours ») selon qu'il s'agit d'un
document ou d'une intervention. Aucun seuil dupliqué dans les pages.

**Sauvegarde automatique des brouillons.** Quatorze formulaires persistent la
saisie en cours. Les fiches sont longues et se remplissent en plusieurs fois,
parfois dans un atelier où la connexion coupe. Le brouillon est désactivé en
édition : restaurer une saisie ancienne par-dessus une fiche modifiée
entre-temps ferait plus de dégâts qu'il n'en éviterait. Aucun formulaire portant
un mot de passe n'est concerné.

**Interface chauffeur dédiée.** Connexion par code PIN, écran mobile séparé du
back-office : un chauffeur au volant n'a pas les mêmes besoins qu'un logisticien
devant deux écrans.

**Ordonnanceur.** Les contrôles d'alertes tournent en cycle avec garde de
réentrance, compteur de cycles sautés et avertissement si un cycle dépasse la
moitié de son intervalle — un traitement lent se signale avant de s'empiler.

## Documentation

Tout est dans [`docs/`](docs/) :

- [`docs/qa/`](docs/qa/) — cahiers de tests, plans de validation par profil
- [`docs/guides/`](docs/guides/) — guides utilisateurs et matrices d'accès
- [`docs/analysis/`](docs/analysis/) — analyses techniques et retours d'expérience
- [`docs/plans/`](docs/plans/) — plans d'évolution, décisions métier à trancher
- [`docs/planning/`](docs/planning/) — feuille de route et sprints

Les conventions de code et de vocabulaire métier sont dans
[`AGENTS.md`](AGENTS.md).

---

<sub>Projet privé. Les données d'exécution (`uploads/`) et les secrets (`.env`)
sont exclus du versionnement.</sub>

# Environnement de recette — runbook

Statut : rédigé en T-27 (brouillon). Aucun déploiement ni commande de base de données n'a été
lancé pour l'écrire. Les points marqués **À valider** dépendent du compte d'hébergement et de la
base dédiée, qui ne sont pas encore confirmés.

## 1. Principe

- Une instance et une base **dédiées** à la recette, jamais la production ni la base de test partagée.
- Déployée depuis une **étiquette Git** (par exemple `recette-2026-11-02`), pas depuis une branche mobile.
- Les fonctionnalités SHOULD sont pilotées par la variable `FEATURE_FLAGS` : activer ou couper un
  drapeau demande un changement de variable et un redémarrage, sans redéploiement de code (ADR 0001 §6).

## 2. Variables d'environnement

| Variable | Rôle | Valeur en recette |
|---|---|---|
| `NODE_ENV` | Mode serveur | `production` |
| `APP_ENV` | Libellé d'environnement (traces, bandeau éventuel). Non lue par le code à ce jour. | `recette` |
| `PORT` | Port d'écoute | Imposé par l'hébergeur. **À valider** |
| `DATABASE_URL` | Base **dédiée** à la recette | Chaîne de connexion de la base de recette. **À valider** |
| `DATABASE_URL_DIRECT`, `DATABASE_URL_LISTENER` | Connexions directes (si utilisées par le serveur) | Même base, hôte non poolé. **À valider** |
| `SESSION_SECRET` | Signature des sessions | Secret aléatoire propre à la recette, jamais réutilisé |
| `APP_URL`, `CORS_ORIGIN` | URL publique de la recette | URL de l'instance. **À valider** |
| `ALLOW_CROSS_SITE_COOKIES` | Cookies inter-sites | À poser seulement si le client est servi depuis un autre domaine |
| `FEATURE_FLAGS` | Surcharge des drapeaux | Voir §3 |
| `LOG_LEVEL` | Verbosité des logs | `info` |

Les secrets se saisissent dans l'interface de l'hébergeur, jamais dans le dépôt ni dans un journal.

## 3. Drapeaux

Format : `cle=on,autre=off`. Valeurs acceptées : `on|true|1`, `off|false|0`. Une clé inconnue ou une
valeur illisible est ignorée et journalisée (`feature-flags`), elle ne bloque pas le démarrage.
Clés et défauts : `shared/feature-flags.ts`. Défauts : MUST allumés, SHOULD et LATER coupés.

Exemple de départ en recette : variable vide (défauts). Après validation par le produit en
répétition (T-59), on allume un SHOULD à la fois, par exemple `FEATURE_FLAGS=incidents=on`.
Contrôle : `GET /api/feature-flags` (session ouverte) renvoie les valeurs effectives.

## 4. Déploiement depuis l'étiquette

1. Vérifier que `main` est vert (tsc global, suites unitaires, contrat, intégration).
2. Poser l'étiquette : `git tag recette-AAAA-MM-JJ <sha>` puis `git push origin recette-AAAA-MM-JJ`.
3. Configurer l'hébergeur pour construire cette étiquette : build `npm ci && npm run build`,
   démarrage `npm start`. **À valider** (commandes exactes du compte d'hébergement).
4. Poser les variables du §2 avant le premier démarrage.
5. Au démarrage, `initializeDatabase()` applique les migrations idempotentes : un second démarrage
   sur une base déjà migrée ne doit rien écrire.
6. Contrôles de fumée : `GET /api/health` répond 200 ; connexion d'un compte de chaque rôle ;
   `GET /api/feature-flags` conforme au §3.
7. Noter l'étiquette, l'heure et l'opérateur dans le journal du lot.

Retour arrière : redéployer l'étiquette précédente ; les migrations étant additives, aucune
restauration de base n'est nécessaire sauf corruption de données.

## 5. Données de recette

Véhicule 13, pièce 20, OT 62, demande 7, commande 5, facture 39, règlement 4 : ne jamais les
supprimer ni les modifier. Aucun test e2e n'est lancé contre la production.

## 6. Remise à zéro (reset)

Le reset ne s'applique qu'à la base de recette, jamais à la production.

1. Annoncer le reset à l'équipe de recette.
2. Prendre une sauvegarde de la base de recette (`pg_dump -Fc`) et conserver le fichier. **À valider** (outil et stockage).
3. Restaurer l'instantané de référence de la recette, ou recréer la base vide puis redémarrer
   l'application pour rejouer les migrations, puis recharger le jeu de données de référence
   (T-64, T-65). **À valider** (mécanisme de branche ou de restauration de la base de recette).
4. Rejouer les contrôles de fumée du §4.6.

Aucune commande de gestion de branche Neon n'est documentée ici : le compte connecté sur le poste de
travail n'est pas celui du projet.

## 7. À valider (dépend du compte d'hébergement)

- Hébergeur, nom de l'instance, port, commandes de build et de démarrage.
- Création de la base de recette dédiée et chaîne de connexion.
- URL publique, `APP_URL`, `CORS_ORIGIN`.
- Mécanisme de sauvegarde et de restauration (T-65).
- Alerte en cas d'échec de déploiement.

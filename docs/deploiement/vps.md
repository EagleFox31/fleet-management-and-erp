# Déploiement sur un VPS (OVH)

Recette et production tournent sur le même VPS avec Docker Compose (`deploy/docker-compose.yml`) : une image, deux conteneurs (`app-recette`, `app-prod`) publiés sur la boucle locale seulement (`127.0.0.1:5000` pour la prod, `127.0.0.1:5001` pour la recette), derrière un Caddy qui sert HTTPS et WebSocket. Chaque environnement a sa base Postgres 16 en conteneur (`db-recette`, `db-prod`), dans un volume nommé persistant. L'application la joint par le proxy WebSocket `wsproxy`, avec le driver inchangé. La définition de base est la même que celle du serveur de site (`docs/deploiement/site-local.md`), seul le `.env` change.

Profils :

- `--profile vps` lance la prod seule, sans reverse proxy.
- `--profile recette` ajoute la recette. Elle ne tourne pas par défaut : les limites mémoire du compose sont calibrées pour la prod seule sur un petit VPS.
- `--profile edge` ajoute Caddy en conteneur sur 80/443, **seulement si l'hôte n'a pas déjà un reverse proxy** (§2 bis).

## Variables requises (par environnement, `deploy/.env.recette` et `deploy/.env.prod`)

- `DATABASE_URL` : `postgres://fleet:<mot de passe>@db-recette:5432/fleet` (ou `db-prod`) ; `DATABASE_WS_PROXY=wsproxy:80/v1`.
- `SESSION_SECRET` : aléatoire (`openssl rand -hex 32`), distinct par environnement. **Absente, de moins de 32 caractères ou égale à une valeur publique du dépôt, le serveur refuse de démarrer** (`server/lib/session-secret.ts`).
- `APP_URL` : URL publique de l'environnement (CORS).
- `BACKUP_ENABLED=0` : la sauvegarde applicative exige `pg_dump` et `BACKUP_KEY`, absents de l'image ; sauvegarde par `pg_dump` depuis l'hôte (§6).

Dans `deploy/.env` : `RECETTE_DB_PASSWORD` et `PROD_DB_PASSWORD` (vides : Postgres refuse de démarrer).

`PORT` est fixé à 5000 dans le compose. Santé : `GET /api/health`. Domaines et tags d'image : `deploy/.env`.

## 1. Préparer le VPS (Ubuntu LTS)

1. Accès SSH par clé uniquement : dans `/etc/ssh/sshd_config`, `PasswordAuthentication no` et `PermitRootLogin no`, utilisateur dédié avec `sudo`.
2. Pare-feu : `ufw default deny incoming`, `ufw allow 22,80,443/tcp`, `ufw enable`.
3. Mises à jour automatiques : `apt install unattended-upgrades` puis `dpkg-reconfigure -plow unattended-upgrades`.
4. Docker Engine et le plugin Compose (dépôt officiel Docker), utilisateur ajouté au groupe `docker`.

## 2. DNS

Deux enregistrements A (et AAAA si IPv6) vers l'IP du VPS : le domaine de recette et celui de prod. Caddy (celui de l'hôte ou le profil `edge`) obtient et renouvelle les certificats seul, une fois le DNS propagé et les ports 80/443 ouverts.

## 2 bis. Reverse proxy : déjà présent sur l'hôte, ou profil `edge`

**Reverse proxy déjà présent** (cas du VPS OVH actuel). Un Caddy de l'hôte (systemd) y tient déjà 80/443 pour d'autres services, à préserver. Ne pas activer `edge` : le conteneur Caddy entrerait en conflit sur 80/443. Ajouter un bloc par domaine au Caddyfile de l'hôte (`/etc/caddy/Caddyfile`), sans toucher aux blocs existants :

```
fleet.example.com {
	encode gzip
	reverse_proxy 127.0.0.1:5000
}

recette.fleet.example.com {
	encode gzip
	reverse_proxy 127.0.0.1:5001
}
```

Puis `sudo caddy validate --config /etc/caddy/Caddyfile` et `sudo systemctl reload caddy`. Le rechargement est à chaud : les sites existants ne sont pas coupés. Les WebSocket passent par `reverse_proxy` sans réglage.

**Hôte vierge** : ajouter `--profile edge` à chaque commande. `deploy/Caddyfile` sert alors `PROD_DOMAIN` et `RECETTE_DOMAIN` (définis dans `deploy/.env`).

Dans les deux cas, l'application n'écoute que sur `127.0.0.1` : elle n'est jamais joignable sans passer par le reverse proxy.

## 3. Premier lancement

```bash
git clone https://github.com/EagleFox31/fleet-management-and-erp.git && cd fleet-management-and-erp/deploy
cp .env.example .env            # domaines et tags
cp .env.example .env.recette    # ne garder que les variables de l'application
cp .env.example .env.prod
chmod 600 .env .env.recette .env.prod
docker compose --profile recette build app-recette            # construit l'image commune
docker tag ghcr.io/eaglefox31/fleet-management-and-erp:latest ghcr.io/eaglefox31/fleet-management-and-erp:2026-11-04
# PROD_TAG=2026-11-04 dans deploy/.env, puis :
docker compose --profile vps up -d                             # prod (ajouter --profile edge sur un hôte vierge)
docker compose --profile recette up -d app-recette             # recette, si la RAM le permet
docker compose --profile vps logs -f app-prod
```

Au premier démarrage, `schema-recette` et `schema-prod` créent le schéma Drizzle si la base est vide (`scripts/db-bootstrap.ts`), sans rien faire ensuite. Puis `init-database` ajoute colonnes, triggers et migrations sans rien détruire (idempotent). Vérifier `https://<domaine>/api/health`.

`PROD_TAG` est obligatoire : un tag daté, jamais `latest`. Sans lui, le pull échoue sur le tag `definir-PROD_TAG-date`.

### Premier administrateur

Sur une base vide, aucun compte `admin` / `admin123` n'est créé hors développement. Avant le premier `up`, mettre dans `.env.prod` (et `.env.recette`) `ADMIN_INITIAL_PASSWORD=<12 caractères minimum>` (`openssl rand -base64 18`). Le compte `admin` est créé avec ce mot de passe, jamais journalisé. Sans la variable, l'application démarre sans administrateur et l'écrit dans les logs : la définir puis `docker compose --profile vps up -d app-prod`. Après la première connexion, retirer la variable et changer le mot de passe depuis l'application.

## 4. Mise à jour

Recette : `git pull && docker compose --profile recette build app-recette && docker compose --profile recette up -d app-recette`.
Production : taguer l'image validée en recette (`docker tag <image>:latest <image>:2026-11-04`), mettre `PROD_TAG=2026-11-04` dans `deploy/.env`, puis `docker compose --profile vps up -d app-prod`.

## 5. Retour arrière

Remettre `PROD_TAG` sur le tag précédent et `docker compose --profile vps up -d app-prod`. Le code revient, pas la base : les migrations sont additives. Pour la base, restaurer la dernière sauvegarde (§6).

## 6. Sauvegarde de la base

Chaque nuit, par cron sur l'hôte, `deploy/backup-db.sh` écrit `~/backups/fleet-AAAAMMJJ.dump` (format custom) :

- idempotent : relancé le même jour, il remplace le dump du jour ; un dump vide ou illisible par `pg_restore --list` échoue sans toucher au précédent ;
- rotation : les dumps `fleet-AAAAMMJJ.dump` de plus de 14 jours sont supprimés ; tout autre fichier du dossier (ex. `fleet-pre-import-20261104.dump`) est conservé ;
- réglages par variables : `BACKUP_DIR`, `RETENTION_DAYS`, `PREFIX`, `DB_SERVICE`, `COMPOSE_CMD`.

```bash
# crontab -e (le script se place lui-même dans deploy/ pour docker compose)
30 2 * * * $HOME/fleet/deploy/backup-db.sh >> $HOME/backups/backup-db.log 2>&1
```

Reste à faire : copie hors du VPS (restic ou rclone vers OVH Object Storage). Tant qu'elle manque, une perte du VPS emporte aussi les dumps.

Restauration (application arrêtée) :

```bash
docker compose --profile vps stop app-prod
docker compose --profile vps exec -T db-prod pg_restore -U fleet -d fleet --clean --if-exists < ~/backups/fleet-AAAAMMJJ.dump
docker compose --profile vps start app-prod
```

Tester une restauration au moins une fois. Pas de PITR ici : la perte maximale est d'un jour (pgBackRest prévu dans un lot suivant).

## 7. Sauvegarde des fichiers téléversés

Les volumes `uploads-recette` et `uploads-prod` vivent sur le VPS : les copier chaque nuit hors du VPS, par exemple avec restic ou rclone vers un stockage objet (OVH Object Storage) :

```bash
docker run --rm -v deploy_uploads-prod:/data:ro -v "$PWD":/out alpine tar czf /out/uploads-prod.tgz -C /data .
```

Tester une restauration au moins une fois. Activer aussi les sauvegardes automatiques du VPS chez OVH.

## Points d'attention

- Garde base de production (`server/lib/production-db-guard.ts`) : hors `NODE_ENV=production`, tout importeur de `server/db.ts` (et tout script qui appelle `guardDatabaseConnection`) refuse une base dont l'hôte porte un marqueur de `E2E_PRODUCTION_DB_MARKERS`. `schema-prod` tourne sur la cible `build`, sans `NODE_ENV` dans l'image : il le fixe dans `deploy/docker-compose.yml` (garde : `tests/unit/deploy/compose-prod-node-env.test.ts`). Tout nouvel outil de production sur `x-tools` doit faire de même.
- Instance unique par environnement : pas de mise à l'échelle horizontale (WebSocket et uploads locaux).
- L'APK Android et la PWA pointent sur l'URL de prod : ne pas changer ce domaine sans republier l'APK.
- Déploiement par SSH vers la recette : `.github/workflows/deploy-recette.yml` (actif seulement si les secrets `RECETTE_SSH_HOST`, `RECETTE_SSH_USER`, `RECETTE_SSH_KEY` existent). `RECETTE_SSH_KNOWN_HOSTS` est alors obligatoire (sortie de `ssh-keyscan <hôte>` vérifiée à la main) : le workflow échoue sans lui, il ne fait jamais confiance à la première clé vue.

# Déploiement sur un VPS (OVH, Europe)

Recette et production tournent sur le même VPS avec Docker Compose (`deploy/docker-compose.yml`) : une image, deux conteneurs (`app-recette`, `app-prod`), Caddy en frontal pour HTTPS et WebSocket. Chaque environnement a sa base Postgres 16 en conteneur (`db-recette`, `db-prod`), dans un volume nommé persistant. L'application la joint par le proxy WebSocket `wsproxy`, avec le driver inchangé. La définition de base est la même que celle du serveur de site (`docs/deploiement/site-local.md`), seul le `.env` change.

Profils : `--profile vps` lance la prod seule (avec Caddy). La recette s'ajoute par `--profile recette`. Sur un VPS de 2 Go, les deux ne tournent pas ensemble par défaut : les limites mémoire du compose sont calibrées pour la prod seule.

## Variables requises (par environnement, `deploy/.env.recette` et `deploy/.env.prod`)

- `DATABASE_URL` : `postgres://fleet:<mot de passe>@db-recette:5432/fleet` (ou `db-prod`) ; `DATABASE_WS_PROXY=wsproxy:80/v1`.
- `SESSION_SECRET` : aléatoire (`openssl rand -hex 32`), distinct par environnement. **Absente, le serveur refuse de démarrer** (l'ancienne valeur par défaut publique est refusée aussi).
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

Deux enregistrements A (et AAAA si IPv6) vers l'IP du VPS : le domaine de recette et celui de prod. Caddy obtient et renouvelle les certificats seul, une fois le DNS propagé et les ports 80/443 ouverts.

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
docker compose --profile vps up -d                             # prod + Caddy
docker compose --profile recette up -d app-recette             # recette, si la RAM le permet
docker compose --profile vps logs -f app-prod
```

Au premier démarrage, `schema-recette` et `schema-prod` créent le schéma Drizzle si la base est vide (`scripts/db-bootstrap.ts`), sans rien faire ensuite. Puis `init-database` ajoute colonnes, triggers et migrations sans rien détruire (idempotent). Vérifier `https://<domaine>/api/health`.

## 4. Mise à jour

Recette : `git pull && docker compose --profile recette build app-recette && docker compose --profile recette up -d app-recette`.
Production : taguer l'image validée en recette (`docker tag <image>:latest <image>:2026-11-04`), mettre `PROD_TAG=2026-11-04` dans `deploy/.env`, puis `docker compose --profile vps up -d app-prod`.

## 5. Retour arrière

Remettre `PROD_TAG` sur le tag précédent et `docker compose --profile vps up -d app-prod`. Le code revient, pas la base : les migrations sont additives. Pour la base, restaurer la dernière sauvegarde (§6).

## 6. Sauvegarde de la base

Chaque nuit, par cron sur l'hôte, puis copie hors du VPS (restic ou rclone vers OVH Object Storage) :

```bash
docker compose --profile vps exec -T db-prod pg_dump -U fleet -Fc fleet > prod-$(date +%F).dump   # bash : redirection binaire sûre
```

Restauration (application arrêtée) :

```bash
docker compose --profile vps stop app-prod
docker compose --profile vps exec -T db-prod pg_restore -U fleet -d fleet --clean --if-exists < prod-AAAA-MM-JJ.dump
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

- Instance unique par environnement : pas de mise à l'échelle horizontale (WebSocket et uploads locaux).
- L'APK Android et la PWA pointent sur l'URL de prod : ne pas changer ce domaine sans republier l'APK.
- Déploiement par SSH vers la recette : `.github/workflows/deploy-recette.yml` (actif seulement si les secrets `RECETTE_SSH_HOST`, `RECETTE_SSH_USER`, `RECETTE_SSH_KEY` existent).

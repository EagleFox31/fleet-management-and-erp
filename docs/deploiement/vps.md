# Déploiement sur un VPS (OVH, Europe)

Recette et production tournent sur le même VPS avec Docker Compose (`deploy/docker-compose.yml`) : une image, deux conteneurs (`app-recette`, `app-prod`), Caddy en frontal pour HTTPS et WebSocket. La base est Neon, externe.

## Variables requises (par environnement, `deploy/.env.recette` et `deploy/.env.prod`)

- `DATABASE_URL` : URL Neon poolée ; `DATABASE_URL_DIRECT` : URL directe (LISTEN/NOTIFY).
- `SESSION_SECRET` : aléatoire (`openssl rand -hex 32`), distinct par environnement. Sans elle le code retombe sur une valeur par défaut publique.
- `APP_URL` : URL publique de l'environnement (CORS).
- `BACKUP_ENABLED=0` : la sauvegarde applicative exige `pg_dump` et `BACKUP_KEY`, absents de l'image ; la base repose sur le PITR Neon.

`PORT` est fixé à 5000 dans le compose. Santé : `GET /api/health`. Domaines et tags d'image : `deploy/.env`.

## 1. Neon

Deux projets Neon en région `aws-eu-central-1` (recette, prod). Activer la rétention d'historique (PITR) sur le projet de prod et relever les deux URL de chacun.

## 2. Préparer le VPS (Ubuntu LTS)

1. Accès SSH par clé uniquement : dans `/etc/ssh/sshd_config`, `PasswordAuthentication no` et `PermitRootLogin no`, utilisateur dédié avec `sudo`.
2. Pare-feu : `ufw default deny incoming`, `ufw allow 22,80,443/tcp`, `ufw enable`.
3. Mises à jour automatiques : `apt install unattended-upgrades` puis `dpkg-reconfigure -plow unattended-upgrades`.
4. Docker Engine et le plugin Compose (dépôt officiel Docker), utilisateur ajouté au groupe `docker`.

## 3. DNS

Deux enregistrements A (et AAAA si IPv6) vers l'IP du VPS : le domaine de recette et celui de prod. Caddy obtient et renouvelle les certificats seul, une fois le DNS propagé et les ports 80/443 ouverts.

## 4. Premier lancement

```bash
git clone https://github.com/EagleFox31/fleet-management-and-erp.git && cd fleet-management-and-erp/deploy
cp .env.example .env            # domaines et tags
cp .env.example .env.recette    # ne garder que les variables de l'application
cp .env.example .env.prod
chmod 600 .env .env.recette .env.prod
docker compose build app-recette && docker compose up -d
docker compose logs -f app-recette
```

Au démarrage `init-database` crée les tables et colonnes manquantes sans rien détruire (idempotent). Vérifier `https://<domaine>/api/health`.

## 5. Mise à jour

Recette : `git pull && docker compose build app-recette && docker compose up -d app-recette`.
Production : taguer l'image validée en recette (`docker tag <image>:latest <image>:2026-11-04`), mettre `PROD_TAG=2026-11-04` dans `deploy/.env`, puis `docker compose up -d app-prod`.

## 6. Retour arrière

Remettre `PROD_TAG` sur le tag précédent et `docker compose up -d app-prod`. Le code revient, pas la base : les migrations sont additives. Pour la base, restaurer par PITR Neon (branche à un instant donné) et repointer `DATABASE_URL`.

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

# Serveur de site : FleetOS sur un PC du réseau local

Un PC portable Windows fait tourner FleetOS. Les autres PC et les téléphones branchés sur le même Wi-Fi l'ouvrent dans leur navigateur. Le site n'a pas besoin d'internet : la base Postgres tourne sur ce PC, dans Docker.

## 1. Installation (une fois)

1. Installez [Docker Desktop](https://www.docker.com/products/docker-desktop/) et démarrez-le. Attendez que la baleine indique « Running ».
2. Récupérez le projet (`git clone`, ou une archive décompressée), puis ouvrez PowerShell dans son dossier `deploy`.
3. Créez le fichier `deploy\.env`, qui n'est jamais versionné, avec deux mots de passe **choisis par vous** (12 caractères minimum, sans `$`). Sans eux, le lancement s'arrête :

```
SITE_DB_PASSWORD=<mot de passe de la base>
SITE_DEMO_PASSWORD=<mot de passe des comptes de démonstration>
```

Ils sont lus au **premier** lancement. Les changer ensuite ne modifie ni la base ni les comptes déjà créés.

4. Lancez :

```powershell
cd C:\chemin\vers\fleet-management-and-erp\deploy
docker compose --profile site up
```

Le premier lancement prend quelques minutes, le temps de construire l'image. Ensuite, il fait tout seul les étapes suivantes :

- il crée la base dans un volume Docker persistant ;
- il crée le schéma et tire un secret de session ;
- il démarre l'application ;
- il charge les données de démonstration.

Les lancements suivants ne refont rien de tout cela : vos données sont conservées.

L'application est prête quand `docker compose --profile site ps` affiche `app-site` en `healthy`. Pour lancer sans garder la fenêtre ouverte, ajoutez `-d`. Pour arrêter : `docker compose --profile site down` (sans `-v`, sinon la base est effacée).

## 2. Comptes de démonstration

Toutes les données sont fictives : véhicules RCT-001 à RCT-012. Il y a un compte par profil : `recette_admin`, `recette_chef_atelier`, `recette_technicien_1`, `recette_magasinier`, `recette_chauffeur`, `recette_client_1`, etc.

Tous ces comptes ont le mot de passe `SITE_DEMO_PASSWORD` défini à l'étape 3. Le compte `recette_admin` a tous les droits : ne communiquez ce mot de passe qu'aux participants de la démonstration.

Premier administrateur : sur le serveur de site, c'est `recette_admin`. Aucun compte `admin` / `admin123` n'est créé (le serveur tourne en production). Pour un compte `admin` en plus, ajouter `ADMIN_INITIAL_PASSWORD` (12 caractères minimum) à l'environnement de `app-site` avant le premier lancement.

## 3. Trouver l'adresse IP du PC

```powershell
ipconfig
```

Relevez l'« Adresse IPv4 » de la carte Wi-Fi, par exemple `192.168.1.135`. Ignorez les lignes `vEthernet` (WSL, Docker). Sur ce PC, ouvrez `http://localhost:5000`. Sur les autres appareils, ouvrez `http://<IP>:5000`.

Au premier accès, Windows peut demander d'autoriser Docker sur le réseau : acceptez pour les **réseaux privés**. Le Wi-Fi doit être déclaré « Réseau privé » dans les paramètres Windows. Sur un réseau « public », le pare-feu bloque les autres appareils.

Si le port 5000 est déjà pris sur le PC, lancez avec un autre port : `$env:SITE_PORT="5050"; docker compose --profile site up`.

## 4. Accès depuis un téléphone

1. Connectez le téléphone au même Wi-Fi que le PC (pas en 4G).
2. Dans le navigateur, ouvrez `http://192.168.1.135:5000` (avec votre IP).
3. Connectez-vous avec un compte de démonstration, par exemple `recette_chauffeur`.

L'adresse est en `http://` : c'est voulu sur un réseau local, et le cookie de session est réglé pour fonctionner ainsi. Ne publiez jamais ce PC sur internet dans cette configuration.

## 5. Démonstration : coupure d'internet

1. Ouvrez l'application sur le PC et sur un téléphone, et connectez-vous.
2. **Débranchez le câble internet (WAN) de la box**, ou coupez la ligne. Gardez la box allumée, car c'est elle qui fait le Wi-Fi.
3. Continuez à travailler : créer un ordre de travail, changer un statut. Les deux écrans se mettent à jour, parce que tout passe par le réseau local.
4. Rebranchez le câble. Rien n'est à resynchroniser : la base n'a jamais quitté le PC.

Ce qui ne marche pas sans internet : les envois d'e-mail et ce qui dépend d'un service extérieur (cartes en ligne, par exemple).

## 6. Sauvegarde et restauration

Sauvegarde, à faire chaque soir et à copier sur une clé USB ou un autre disque :

```powershell
docker compose --profile site exec -T db-site pg_dump -U fleet -Fc -f /tmp/fleet.dump fleet
docker compose --profile site cp db-site:/tmp/fleet.dump "fleet-$(Get-Date -Format yyyy-MM-dd).dump"
```

Le fichier est copié par `docker compose cp` et non par une redirection `>`, parce que PowerShell réencode ce qui passe par `>` et corrompt la sauvegarde.

Restauration (remplace la base courante par la sauvegarde) :

```powershell
docker compose --profile site stop app-site
docker compose --profile site cp fleet-AAAA-MM-JJ.dump db-site:/tmp/fleet.dump
docker compose --profile site exec -T db-site pg_restore -U fleet -d fleet --clean --if-exists /tmp/fleet.dump
docker compose --profile site start app-site
```

Testez une restauration au moins une fois avant d'en avoir besoin. Les fichiers téléversés (photos, PDF) sont dans le volume `deploy_uploads-site`. Pour les sauvegarder :

```powershell
docker run --rm -v deploy_uploads-site:/data:ro -v "${PWD}:/out" alpine tar czf /out/uploads-site.tgz -C /data .
```

## 7. Mise à jour

Sauvegardez d'abord (section 6), puis, dans le dossier `deploy` :

```powershell
git pull
docker compose --profile site up -d --build
```

Les données sont conservées : la base n'est jamais recréée, `init-database` n'ajoute que ce qui manque. Vérifiez ensuite `http://localhost:<SITE_PORT>/api/health`.

## Points d'attention

- Le PC doit rester allumé et ne pas se mettre en veille pendant l'usage (Paramètres > Alimentation).
- Une IP attribuée par la box peut changer d'un jour à l'autre. Pour une installation durable, réservez l'IP du PC dans la box (bail DHCP fixe).
- La même définition de base sert au VPS (`docs/deploiement/vps.md`) : seul le `.env` change.

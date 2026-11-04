#!/usr/bin/env bash
# Sauvegarde quotidienne de la base Postgres d'un environnement (prod par défaut).
#
# Idempotent : un dump par jour, nommé <PREFIX>-AAAAMMJJ.dump. Relancer le même jour
# remplace le dump du jour (écriture dans un fichier temporaire, contrôle, puis mv).
# Un dump illisible par pg_restore --list n'écrase jamais le précédent.
# Rotation : supprime les dumps quotidiens plus vieux que RETENTION_DAYS, par la date
# du nom. Seuls les fichiers <PREFIX>-AAAAMMJJ.dump sont concernés : toute autre
# sauvegarde du dossier (ex. fleet-pre-import-20261104.dump) est laissée intacte.
#
# Crontab (voir docs/deploiement/vps.md §6) :
#   30 2 * * * $HOME/fleet/deploy/backup-db.sh >> $HOME/backups/backup-db.log 2>&1
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-$HOME/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
PREFIX="${PREFIX:-fleet}"
DB_SERVICE="${DB_SERVICE:-db-prod}"
DB_USER="${DB_USER:-fleet}"
DB_NAME="${DB_NAME:-fleet}"
# Commande compose complète (profil inclus). Surchargée par les tests.
COMPOSE_CMD="${COMPOSE_CMD:-sudo -n docker compose --profile vps}"

log() { printf '%s [backup-db] %s\n' "$(date '+%F %T')" "$*"; }
fail() { log "ERREUR : $*"; exit 1; }

[[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || fail "RETENTION_DAYS doit être un entier (reçu : $RETENTION_DAYS)"

# docker compose lit docker-compose.yml et .env du dossier du script.
cd "$(dirname "$(readlink -f "$0")")"
mkdir -p "$BACKUP_DIR"

# Deux exécutions simultanées (cron + lancement manuel) ne se marchent pas dessus.
if command -v flock >/dev/null; then
  exec 9>"$BACKUP_DIR/.backup-db.lock"
  flock -n 9 || fail "une sauvegarde est déjà en cours"
fi

day="$(date +%Y%m%d)"
target="$BACKUP_DIR/$PREFIX-$day.dump"
tmp="$target.partial"
trap 'rm -f "$tmp"' EXIT

log "dump de $DB_NAME ($DB_SERVICE) vers $target"
# shellcheck disable=SC2086 # COMPOSE_CMD est volontairement découpé en mots
$COMPOSE_CMD exec -T "$DB_SERVICE" pg_dump -U "$DB_USER" -Fc "$DB_NAME" > "$tmp"

[[ -s "$tmp" ]] || fail "dump vide, sauvegarde précédente conservée"
# shellcheck disable=SC2086
entries="$($COMPOSE_CMD exec -T "$DB_SERVICE" pg_restore --list < "$tmp" | grep -vc '^;' || true)"
[[ "$entries" -gt 0 ]] || fail "pg_restore --list ne lit aucune entrée, sauvegarde précédente conservée"

mv -f "$tmp" "$target"
trap - EXIT
log "ok : $(du -h "$target" | cut -f1), $entries entrées de catalogue"

cutoff="$(date -d "-$RETENTION_DAYS days" +%Y%m%d)"
for f in "$BACKUP_DIR/$PREFIX"-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9].dump; do
  [[ -e "$f" ]] || continue
  d="${f##*-}"; d="${d%.dump}"
  if [[ "$d" < "$cutoff" ]]; then
    rm -f "$f"
    log "rotation : $(basename "$f") supprimé (plus de $RETENTION_DAYS jours)"
  fi
done

#!/bin/sh
# Magic Mirror auto-updater.
#   UPDATE_TIME=04:00     daily run time (local time, TZ)
#   UPDATE_MODE=pull      pull = prebuilt images from the registry, build = build locally
#   UPDATE_GIT=true       git pull --ff-only the checkout first (compose file, docs …)
#   mm-update --now       run once and exit (docker compose run --rm updater --now)
set -eu

log() { echo "[updater] $(date '+%F %T') $*"; }

UPDATE_TIME="${UPDATE_TIME:-04:00}"
UPDATE_MODE="${UPDATE_MODE:-pull}"
UPDATE_GIT="${UPDATE_GIT:-true}"

self="$(hostname)"
inspect() { docker inspect -f "$1" "$self"; }

# docker compose resolves relative paths (./data …) against the project
# directory and sends them to the daemon, so they must be valid *host* paths.
# The checkout is mounted at /project; make it reachable under its host path too.
HOST_DIR="$(inspect '{{range .Mounts}}{{if eq .Destination "/project"}}{{.Source}}{{end}}{{end}}')"
[ -n "$HOST_DIR" ] || { log "project directory is not mounted at /project"; exit 1; }
if [ ! -e "$HOST_DIR" ]; then
  mkdir -p "$(dirname "$HOST_DIR")"
  ln -s /project "$HOST_DIR"
fi
cd "$HOST_DIR"

PROJECT="$(inspect '{{index .Config.Labels "com.docker.compose.project"}}')"
SELF_SERVICE="$(inspect '{{index .Config.Labels "com.docker.compose.service"}}')"
compose() { docker compose -p "${PROJECT:-magicmirror}" "$@"; }

update() {
  log "checking for updates"
  if [ "$UPDATE_GIT" = true ] && [ -d .git ]; then
    # Run git as the owner of the checkout so file ownership stays intact.
    owner="$(stat -c %u:%g .)"
    before="$(su-exec "$owner" env HOME=/tmp git rev-parse HEAD)"
    if su-exec "$owner" env HOME=/tmp git pull --ff-only -q; then
      after="$(su-exec "$owner" env HOME=/tmp git rev-parse HEAD)"
      [ "$before" = "$after" ] || log "checkout updated ${before%"${before#???????}"} → ${after%"${after#???????}"}"
    else
      log "git pull failed (local changes?) – continuing with images only"
    fi
  fi

  services="$(compose config --services | grep -vx "${SELF_SERVICE:-updater}" | tr '\n' ' ')"
  if [ "$UPDATE_MODE" = build ]; then
    # shellcheck disable=SC2086
    compose build --pull $services
  else
    # shellcheck disable=SC2086
    compose pull --quiet --ignore-pull-failures $services
  fi
  # Recreates only containers whose image or configuration changed.
  # shellcheck disable=SC2086
  compose up -d --no-build $services
  docker image prune -f >/dev/null
  log "done"
}

seconds_until() {
  now="$(date +%s)"
  target="$(date -d "$(date +%Y-%m-%d) $1" +%s 2>/dev/null)" || { echo 86400; return; }
  [ "$target" -gt "$now" ] || target=$((target + 86400))
  echo $((target - now))
}

if [ "${1:-}" = "--now" ]; then
  update
  exit 0
fi

log "scheduled daily at $UPDATE_TIME (mode: $UPDATE_MODE, git: $UPDATE_GIT)"
while true; do
  sleep "$(seconds_until "$UPDATE_TIME")"
  update || log "update failed"
  sleep 60
done

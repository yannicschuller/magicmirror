#!/bin/sh
# Magic Mirror updater.
#   UPDATE_TIME=04:00     daily automatic update (local time, TZ); "off" = manual only
#   UPDATE_MODE=pull      pull = prebuilt images from the registry, build = build locally
#   UPDATE_GIT=true       git pull --ff-only the checkout first (compose file, docs …)
#
#   mm-update             daemon: small HTTP API on :8099 (used by the admin panel) + schedule
#   mm-update --now       run an update now (foreground)
#   mm-update --check     check for updates, print JSON
set -eu

UPDATE_TIME="${UPDATE_TIME:-04:00}"
UPDATE_MODE="${UPDATE_MODE:-pull}"
UPDATE_GIT="${UPDATE_GIT:-true}"
STATE_DIR=/run/mm-update
STATE="$STATE_DIR/state.json"
CHECK="$STATE_DIR/check.json"
LOG="$STATE_DIR/update.log"
mkdir -p "$STATE_DIR"

log() { echo "[updater] $(date '+%F %T') $*"; }
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

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

# Run git as the owner of the checkout so file ownership stays intact.
owner="$(stat -c %u:%g .)"
git_() { su-exec "$owner" env HOME=/tmp git -c safe.directory='*' "$@"; }
has_git() { [ "$UPDATE_GIT" = true ] && [ -d .git ]; }

# ---- state for the admin panel --------------------------------------------------------
set_state() { # state phase [error]
  jq -n --arg state "$1" --arg phase "$2" --arg error "${3:-}" --arg at "$(now)" \
    --argjson prev "$(cat "$STATE" 2>/dev/null || echo '{}')" \
    '$prev + {state: $state, phase: $phase, error: (if $error == "" then null else $error end), updatedAt: $at}
     + (if $phase == "start" then {startedAt: $at, finishedAt: null} else {} end)
     + (if ($state == "done" or $state == "error") then {finishedAt: $at} else {} end)' > "$STATE.tmp"
  mv "$STATE.tmp" "$STATE"
}

status_json() {
  jq -n --argjson state "$(cat "$STATE" 2>/dev/null || echo '{"state":"idle"}')" \
    --argjson check "$(cat "$CHECK" 2>/dev/null || echo 'null')" \
    --arg log "$(tail -n 40 "$LOG" 2>/dev/null || true)" \
    --arg mode "$UPDATE_MODE" --arg time "$UPDATE_TIME" \
    '$state + {check: $check, log: ($log | split("\n") | map(select(. != ""))), mode: $mode, schedule: $time}'
}

# ---- check ------------------------------------------------------------------------------
check() {
  version() { jq -r '.version // ""' 2>/dev/null || true; }
  current_version="$(version < package.json)"
  if has_git; then
    git_ fetch -q 2>/dev/null || { jq -n --arg at "$(now)" '{ok: false, error: "git fetch failed", checkedAt: $at}' > "$CHECK"; cat "$CHECK"; return; }
    head="$(git_ rev-parse --short HEAD)"
    upstream="$(git_ rev-parse --short '@{u}' 2>/dev/null || echo "$head")"
    latest_version="$(git_ show '@{u}:package.json' 2>/dev/null | version)"
    changes="$(git_ log --format='%h%x09%cI%x09%s' 'HEAD..@{u}' 2>/dev/null | head -n 50 |
      jq -R -s 'split("\n") | map(select(. != "") | split("\t") | {sha: .[0], date: .[1], subject: .[2]})')"
    jq -n --arg at "$(now)" --arg cur "$current_version" --arg lat "${latest_version:-$current_version}" \
      --arg head "$head" --arg up "$upstream" --argjson changes "$changes" \
      '{ok: true, method: "git", checkedAt: $at, current: {version: $cur, commit: $head}, latest: {version: $lat, commit: $up},
        available: ($changes | length > 0), changes: $changes}' > "$CHECK"
  else
    # No git checkout: compare the local image with the registry.
    image="$(compose config --images 2>/dev/null | grep '/magicmirror:' | head -n1)"
    local_digest="$(docker image inspect -f '{{join .RepoDigests " "}}' "$image" 2>/dev/null || true)"
    remote_digest="$(docker buildx imagetools inspect "$image" --format '{{json .Manifest.Digest}}' 2>/dev/null | tr -d '"' || true)"
    available=false
    [ -n "$remote_digest" ] && ! echo "$local_digest" | grep -q "$remote_digest" && available=true
    jq -n --arg at "$(now)" --arg cur "$current_version" --argjson avail "$available" --arg remote "$remote_digest" \
      '{ok: ($remote != ""), method: "image", checkedAt: $at, current: {version: $cur}, latest: {version: null},
        available: $avail, changes: [], error: (if $remote == "" then "registry not reachable" else null end)}' > "$CHECK"
  fi
  cat "$CHECK"
}

# ---- update ------------------------------------------------------------------------------
update() {
  : > "$LOG"
  set_state running start
  log "checking for updates"
  if has_git; then
    set_state running git
    before="$(git_ rev-parse HEAD)"
    if git_ pull --ff-only -q; then
      after="$(git_ rev-parse HEAD)"
      [ "$before" = "$after" ] || log "checkout updated $(echo "$before" | cut -c1-7) → $(echo "$after" | cut -c1-7)"
    else
      log "git pull failed (local changes?) – continuing with images only"
    fi
  fi

  services="$(compose config --services | grep -vx "${SELF_SERVICE:-updater}" | tr '\n' ' ')"
  if [ "$UPDATE_MODE" = build ]; then
    set_state running build
    # shellcheck disable=SC2086
    compose build --pull $services
  else
    set_state running pull
    # shellcheck disable=SC2086
    compose pull --ignore-pull-failures $services
  fi
  # Recreates only containers whose image or configuration changed.
  set_state running restart
  # shellcheck disable=SC2086
  compose up -d --no-build $services
  set_state running cleanup
  docker image prune -f >/dev/null
  rm -f "$CHECK"
  log "done"
  set_state "done" "done"
}

# ---- lock: a directory with the PID of the running update -----------------------------------
LOCK="$STATE_DIR/lock"
lock_pid() { cat "$LOCK/pid" 2>/dev/null || true; }
# true while an update process really runs; removes a lock left behind by an interrupted
# update (container restart, reboot, killed process) – otherwise no update could ever start again.
lock_active() {
  [ -d "$LOCK" ] || return 1
  pid="$(lock_pid)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then return 0; fi
  # no PID yet: only trust a lock that was created a moment ago
  if [ -z "$pid" ] && [ $(( $(date +%s) - $(stat -c %Y "$LOCK" 2>/dev/null || echo 0) )) -lt 10 ]; then return 0; fi
  log "removing a stale lock (update process ${pid:-?} is gone)"
  rm -rf "$LOCK"
  if [ "$(jq -r '.state // ""' "$STATE" 2>/dev/null)" = running ]; then set_state error interrupted "update was interrupted"; fi
  return 1
}

run_update() {
  lock_active || true
  if ! mkdir "$LOCK" 2>/dev/null; then
    log "an update is already running (PID $(lock_pid)) – following its log, Ctrl+C stops only the output"
    # show what the running update does instead of silently returning
    tail -n +1 -f "$LOG" &
    tailpid=$!
    while lock_active; do sleep 2; done
    kill "$tailpid" 2>/dev/null || true
    return 0
  fi
  echo $$ > "$LOCK/pid"
  trap 'rm -rf "$LOCK"' EXIT
  if ! update >> "$LOG" 2>&1; then
    set_state error failed "$(tail -n 1 "$LOG")"
    log "update failed" >> "$LOG"
  fi
  cat "$LOG"
}

# ---- HTTP API (busybox httpd + CGI, only reachable inside the compose network) -------------
serve() {
  mkdir -p /www/cgi-bin
  for cmd in status check run; do
    # CGI headers need CRLF line endings.
    printf '#!/bin/sh\nprintf "Content-Type: application/json\\r\\n\\r\\n"\nexec /usr/local/bin/mm-update --cgi-%s\n' "$cmd" > "/www/cgi-bin/$cmd"
    chmod 755 "/www/cgi-bin/$cmd"
  done
  # Pass the configuration on to the CGI processes.
  export UPDATE_TIME UPDATE_MODE UPDATE_GIT
  httpd -p 8099 -h /www
}

case "${1:-}" in
  --now) run_update; exit 0 ;;
  --check) check; exit 0 ;;
  --cgi-status) status_json; exit 0 ;;
  --cgi-check) check; exit 0 ;;
  --cgi-run)
    if lock_active; then echo '{"ok":false,"error":"already running"}'; exit 0; fi
    # Detach so the HTTP request returns immediately; progress via status.
    setsid /usr/local/bin/mm-update --now >/dev/null 2>&1 < /dev/null &
    echo '{"ok":true}'
    exit 0 ;;
esac

[ -f "$STATE" ] || set_state idle none
lock_active || true # the container was restarted mid-update
serve
log "HTTP API on :8099 · mode: $UPDATE_MODE · git: $UPDATE_GIT · schedule: $UPDATE_TIME"

seconds_until() {
  now_s="$(date +%s)"
  target="$(date -d "$(date +%Y-%m-%d) $1" +%s 2>/dev/null)" || { echo 86400; return; }
  [ "$target" -gt "$now_s" ] || target=$((target + 86400))
  echo $((target - now_s))
}

if [ "$UPDATE_TIME" = off ]; then
  log "automatic updates are off – updates only via the admin panel"
  while true; do sleep 3600; done
fi
while true; do
  sleep "$(seconds_until "$UPDATE_TIME")"
  # own process: its EXIT trap removes the lock (in this long-running shell it never would)
  /usr/local/bin/mm-update --now >/dev/null 2>&1 || true
  sleep 60
done

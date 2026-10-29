#!/bin/sh
# Starts as root only to make the data volume writable – ./data is often
# created by root (Docker itself, or the installer run as root) – then runs
# the server as the unprivileged "node" user.
set -eu

# Power-saving mode (admin → General → System): cap Node's heap so the kiosk browser keeps
# more RAM on small devices. Read from the saved configuration at every start.
if grep -qs '"ecoMode": *true' "${DATA_DIR:-/app/data}/config.json"; then
  export NODE_OPTIONS="--max-old-space-size=${MM_ECO_HEAP_MB:-160} ${NODE_OPTIONS:-}"
  echo "[entrypoint] power-saving mode: Node heap limited to ${MM_ECO_HEAP_MB:-160} MB"
fi

if [ "$(id -u)" = 0 ]; then
  mkdir -p "$DATA_DIR"
  # Fix everything not yet owned by node (e.g. files written by `docker compose exec`).
  find "$DATA_DIR" ! -user node -exec chown node:node {} + 2>/dev/null || \
    echo "[entrypoint] warning: could not change owner of $DATA_DIR – run: chown -R 1000:1000 ./data" >&2
  exec setpriv --reuid=node --regid=node --init-groups -- "$@"
fi
exec "$@"

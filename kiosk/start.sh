#!/bin/sh
# Waits for the mirror server, then runs the browser full-screen on the HDMI
# output as the unprivileged "kiosk" user. Restarts the browser if it exits.
set -eu

log() { echo "[kiosk] $*"; }

URL="${MIRROR_URL:-http://magicmirror:8080/}"
health="$(echo "$URL" | sed -E 's#(https?://[^/]+).*#\1#')/api/health"

log "waiting for $health"
until curl -fsS -o /dev/null "$health"; do sleep 3; done

# The container's /dev is private (privileged mode), so loosening permissions
# here does not touch the host.
chmod 666 /dev/dri/* 2>/dev/null || log "no /dev/dri – is the KMS driver (dtoverlay=vc4-kms-v3d) enabled?"
chmod 666 /dev/input/* 2>/dev/null || true

mkdir -p "$XDG_RUNTIME_DIR"
chown kiosk:kiosk "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

as_kiosk() { runuser -u kiosk -- env HOME=/home/kiosk XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" "$@"; }

run_cog() {
  # cog's DRM platform drives the display directly (first opener becomes DRM master).
  # shellcheck disable=SC2086 # KIOSK_FLAGS is intentionally split into arguments
  as_kiosk cog --platform=drm --bg-color=black --enable-page-cache=false \
    --enable-write-console-messages-to-stdout=true ${KIOSK_FLAGS:-} "$URL"
}

run_chromium() {
  rm -f /run/seatd.sock
  seatd -u kiosk -l error &
  while [ ! -S /run/seatd.sock ]; do sleep 0.2; done
  # shellcheck disable=SC2086 # KIOSK_FLAGS is intentionally split into arguments
  as_kiosk env LIBSEAT_BACKEND=seatd cage -d -s -- chromium --kiosk --ozone-platform=wayland \
    --noerrdialogs --disable-infobars --no-first-run --no-default-browser-check \
    --disable-session-crashed-bubble --disable-features=Translate,MediaRouter,OptimizationHints \
    --check-for-update-interval=31536000 --autoplay-policy=no-user-gesture-required \
    --password-store=basic --user-data-dir=/tmp/chromium --disk-cache-dir=/tmp/chromium-cache \
    --disk-cache-size=33554432 --renderer-process-limit=2 --overscroll-history-navigation=0 \
    --disable-pinch --hide-scrollbars ${KIOSK_FLAGS:-} "$URL"
  kill %1 2>/dev/null || true
  rm -rf /tmp/chromium/Singleton*
}

# Night mode "screen off" / remote control: put an HDMI-CEC screen into standby and wake it
# again. Needs /dev/cec0 (Pi with the vc4 KMS driver) and a TV/monitor with CEC; without
# it the mirror just shows black. KIOSK_CEC=off disables it.
display_api="$(echo "$URL" | sed -E 's#(https?://[^/]+).*#\1#')/api/display"
cec_loop() {
  [ "${KIOSK_CEC:-auto}" = off ] && return 0
  dev=/dev/cec0
  [ -e "$dev" ] || { log "no $dev – screen standby via HDMI-CEC unavailable"; return 0; }
  cec-ctl -d "$dev" --playback --osd-name "MagicMirror" >/dev/null 2>&1 || { log "CEC setup failed"; return 0; }
  log "HDMI-CEC ready"
  last=""
  while true; do
    mode="$(curl -fsS "$display_api" 2>/dev/null | sed -nE 's/.*"mode":"([a-z]+)".*/\1/p')"
    if [ -n "$mode" ]; then
      want=on
      [ "$mode" = off ] && want=off
      if [ "$want" != "$last" ]; then
        if [ "$want" = off ]; then
          cec-ctl -d "$dev" --to 0 --standby >/dev/null 2>&1 && log "screen → standby (CEC)"
        else
          cec-ctl -d "$dev" --to 0 --image-view-on >/dev/null 2>&1 && log "screen → on (CEC)"
        fi
        last="$want"
      fi
    fi
    sleep 20
  done
}
cec_loop &

while true; do
  log "starting $BROWSER → $URL"
  case "$BROWSER" in
    chromium) run_chromium || true ;;
    *) run_cog || true ;;
  esac
  log "$BROWSER exited – restarting in 5 s"
  sleep 5
done

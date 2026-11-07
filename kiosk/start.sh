#!/bin/sh
# Waits for the mirror server, then runs the browser full-screen on the HDMI
# output as the unprivileged "kiosk" user. Restarts the browser if it exits.
set -eu

log() { echo "[kiosk] $*"; }

URL="${MIRROR_URL:-http://magicmirror:8080/}"
base="$(echo "$URL" | sed -E 's#(https?://[^/]+).*#\1#')"
health="$base/api/health"
# marks this browser for the watchdog (its page sends a heartbeat with kiosk=1)
case "$URL" in *\?*) URL="$URL&kiosk=1" ;; *) URL="$URL?kiosk=1" ;; esac

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

# Stops the browser; the browser loop at the end starts it again.
STARTED=/tmp/browser-started
stop_browser() {
  pkill -x cog 2>/dev/null || true
  pkill -x chromium 2>/dev/null || pkill -f /usr/lib/chromium 2>/dev/null || true
  pkill -x cage 2>/dev/null || true
}
browser_running() { pgrep -x cog >/dev/null 2>&1 || pgrep -x cage >/dev/null 2>&1 || pgrep -x chromium >/dev/null 2>&1; }

# Night mode "screen off" / remote control / presence: really switch the screen off.
#   cec     HDMI-CEC standby – TVs, hardly any PC monitor (they ignore it and just show black)
#   signal  no HDMI signal, so a monitor goes to standby. The browser holds the display, so it
#           has to stop for that; waking up takes as long as starting it.
#   black   the mirror only shows black
# KIOSK_SCREEN_OFF=auto picks cec when a device answers on CEC, otherwise signal.
SCREEN_OFF=/tmp/screen-off
SYS="${KIOSK_SYS:-/sys}"
CEC_DEV="${KIOSK_CEC_DEV:-/dev/cec0}"
display_api="$base/api/display"

quiet_write() { { echo "$1" > "$2"; } 2>/dev/null || true; }

signal_off() {
  touch "$SCREEN_OFF"
  stop_browser
  for _ in 1 2 3 4 5 6 7 8 9 10; do browser_running || break; sleep 1; done
  sleep 1 # the kernel's console takes over the display again – then switch that off too
  for f in "$SYS"/class/graphics/fb*/blank; do [ -e "$f" ] && quiet_write 4 "$f"; done
  for f in "$SYS"/class/drm/card*-*/status; do
    [ -e "$f" ] && [ "$(cat "$f" 2>/dev/null)" = connected ] && quiet_write off "$f"
  done
  return 0
}

signal_on() {
  for f in "$SYS"/class/drm/card*-*/status; do [ -e "$f" ] && quiet_write detect "$f"; done
  for f in "$SYS"/class/graphics/fb*/blank; do [ -e "$f" ] && quiet_write 0 "$f"; done
  return 0
}

cec_ready=no
cec_answers() { [ "$cec_ready" = yes ] && cec-ctl -d "$CEC_DEV" --to 0 --give-device-power-status 2>/dev/null | grep -q 'pwr-state'; }

screen_loop() {
  method="${KIOSK_SCREEN_OFF:-auto}"
  # KIOSK_CEC=off from older setups: no switching at all unless a method is chosen
  [ "${KIOSK_CEC:-auto}" = off ] && [ "$method" = auto ] && method=black
  [ "$method" = black ] && { log "screen off: black only"; return 0; }
  if [ -e "$CEC_DEV" ] && [ "$method" != signal ] && cec-ctl -d "$CEC_DEV" --playback --osd-name "MagicMirror" >/dev/null 2>&1; then
    cec_ready=yes
  fi
  last=""
  used=""
  while true; do
    mode="$(curl -fsS "$display_api" 2>/dev/null | sed -nE 's/.*"mode":"([a-z]+)".*/\1/p')"
    if [ -n "$mode" ]; then
      want=on
      [ "$mode" = off ] && want=off
      if [ "$want" != "$last" ]; then
        if [ "$want" = off ]; then
          # asked each time: a screen only answers on CEC while it is awake
          if [ "$method" = cec ] || { [ "$method" = auto ] && cec_answers; }; then
            used=cec
            cec-ctl -d "$CEC_DEV" --to 0 --standby >/dev/null 2>&1 && log "screen → standby (CEC)"
          else
            used=signal
            signal_off
            log "screen → off (no HDMI signal)"
          fi
        else
          if [ "$used" = signal ]; then
            signal_on
            sleep 1 # let the kernel find the screen again before the browser asks for it
            rm -f "$SCREEN_OFF"
            log "screen → on (HDMI signal, starting $BROWSER)"
          elif [ "$cec_ready" = yes ]; then
            cec-ctl -d "$CEC_DEV" --to 0 --image-view-on >/dev/null 2>&1 && log "screen → on (CEC)"
          fi
        fi
        last="$want"
      elif [ "$want" = off ] && [ "$used" = signal ] && browser_running; then
        stop_browser # it was just starting when the screen went off
      fi
    fi
    sleep 4 # short: presence sensors switch the screen on when someone comes
  done
}
# A restart of this container must not leave the screen switched off.
signal_on
screen_loop &

# Self-healing: restart the browser when its page stops sending heartbeats (frozen, crashed
# renderer, white page) or when the system runs out of memory. The browser loop below then
# starts it again. KIOSK_WATCHDOG=off disables it.
watchdog() {
  [ "${KIOSK_WATCHDOG:-on}" = off ] && return 0
  limit="${KIOSK_WATCHDOG_SECONDS:-300}"
  while true; do
    sleep 60
    [ -e "$SCREEN_OFF" ] && continue # stopped on purpose
    since=$(( $(date +%s) - $(cat "$STARTED" 2>/dev/null || date +%s) ))
    [ "$since" -gt "$limit" ] || continue # give a fresh browser time to load
    # server unreachable (restarting, updating): not the browser's fault
    age="$(curl -fsS -m 5 "$base/api/kiosk" 2>/dev/null | sed -nE 's/.*"age":([0-9]+).*/\1/p')"
    if [ -n "$age" ] && [ "$age" -gt "$limit" ]; then
      log "watchdog: no sign of life from the mirror page for ${age} s – restarting $BROWSER"
      stop_browser
      continue
    fi
    avail="$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo 2>/dev/null)"
    if [ -n "$avail" ] && [ "$avail" -lt "${KIOSK_MIN_FREE_KB:-40000}" ]; then
      log "watchdog: only $((avail / 1024)) MB memory left – restarting $BROWSER"
      stop_browser
    fi
  done
}
watchdog &

while true; do
  while [ -e "$SCREEN_OFF" ]; do sleep 1; done
  log "starting $BROWSER → $URL"
  date +%s > "$STARTED"
  case "$BROWSER" in
    chromium) run_chromium || true ;;
    *) run_cog || true ;;
  esac
  log "$BROWSER exited – restarting in 5 s"
  sleep 5
done

#!/usr/bin/env bash
# shellcheck disable=SC2154 # answers are assigned indirectly by ask/ask_yes (printf -v)
# Magic Mirror installer – Raspberry Pi OS / Debian / Ubuntu
#
#   curl -fsSL https://raw.githubusercontent.com/yannicschuller/magicmirror/main/install.sh | bash
#
# Installs Docker, clones the project, asks for the important settings, writes
# .env, prepares the Raspberry Pi for the HDMI kiosk and starts everything.
# Re-running it updates an existing installation (current values are defaults).
#
# Environment overrides: MM_DIR (install dir, default ~/magicmirror),
# MM_REPO, MM_BRANCH, MM_UNATTENDED=1 (accept all defaults, no questions).
set -euo pipefail

REPO_URL="${MM_REPO:-https://github.com/yannicschuller/magicmirror.git}"
BRANCH="${MM_BRANCH:-main}"
INSTALL_DIR="${MM_DIR:-$HOME/magicmirror}"
UNATTENDED="${MM_UNATTENDED:-0}"
REBOOT_NEEDED=0
UI_LANG=en

# ---- helpers -----------------------------------------------------------------------
if [ -t 1 ]; then
  B=$'\e[1m'; DIM=$'\e[2m'; C=$'\e[36m'; G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[31m'; N=$'\e[0m'
else
  B=''; DIM=''; C=''; G=''; Y=''; R=''; N=''
fi

# m "english" "deutsch" – pick the installer language
m() { if [ "$UI_LANG" = de ]; then printf '%s' "$2"; else printf '%s' "$1"; fi; }
info() { printf '%s\n' "${C}==>${N} ${B}$*${N}"; }
ok() { printf '%s\n' "  ${G}✓${N} $*"; }
warn() { printf '%s\n' "  ${Y}!${N} $*"; }
die() { printf '%s\n' "${R}✗ $*${N}" >&2; exit 1; }

TTY=/dev/tty
if [ "$UNATTENDED" != 1 ] && ! { : < "$TTY"; } 2>/dev/null; then
  die "No terminal available – run interactively or set MM_UNATTENDED=1"
fi

# ask VAR "question" "default"
ask() {
  local var="$1" question="$2" default="${3:-}" answer=""
  if [ "$UNATTENDED" = 1 ]; then printf -v "$var" '%s' "$default"; return; fi
  if [ -n "$default" ]; then
    read -r -p "  $question ${DIM}[$default]${N}: " answer < "$TTY" || true
  else
    read -r -p "  $question: " answer < "$TTY" || true
  fi
  printf -v "$var" '%s' "${answer:-$default}"
}

# ask_yes VAR "question" y|n
ask_yes() {
  local var="$1" question="$2" default="$3" answer="" hint
  hint=$([ "$default" = y ] && echo "Y/n" || echo "y/N")
  if [ "$UNATTENDED" = 1 ]; then answer="$default"; else
    read -r -p "  $question ${DIM}[$hint]${N}: " answer < "$TTY" || true
    answer="${answer:-$default}"
  fi
  case "$answer" in [yYjJ]*) printf -v "$var" '%s' y ;; *) printf -v "$var" '%s' n ;; esac
}

# ask_secret VAR "question" – hidden input, entered twice
ask_secret() {
  local var="$1" question="$2" a b
  while true; do
    read -r -s -p "  $question: " a < "$TTY" || true; echo
    read -r -s -p "  $(m "Repeat" "Wiederholen"): " b < "$TTY" || true; echo
    if [ "$a" != "$b" ]; then warn "$(m "Passwords do not match" "Passwörter stimmen nicht überein")"; continue; fi
    if [ "${#a}" -lt 8 ]; then warn "$(m "At least 8 characters" "Mindestens 8 Zeichen")"; continue; fi
    printf -v "$var" '%s' "$a"
    return
  done
}

# Current value from an existing .env (used as default on re-runs).
env_get() {
  [ -f "$INSTALL_DIR/.env" ] || return 0
  grep -E "^$1=" "$INSTALL_DIR/.env" | tail -n1 | cut -d= -f2- || true
}
has_profile() { case ",$(env_get COMPOSE_PROFILES)," in *",$1,"*) echo y ;; *) echo "$2" ;; esac; }

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null || die "sudo is required"
  SUDO="sudo"
fi

# ---- 0. language ---------------------------------------------------------------------
printf '\n%s\n' "${B}${C}  ✦ Magic Mirror${N}"
printf '%s\n\n' "  ${DIM}https://github.com/yannicschuller/magicmirror${N}"
case "${LANG:-}" in de*) lang_default=de ;; *) lang_default=en ;; esac
existing_locale="$(env_get MM_LOCALE)"
[ -n "$existing_locale" ] && lang_default="${existing_locale%%-*}"
ask UI_LANG "Language / Sprache (en/de)" "$lang_default"
case "$UI_LANG" in de*) UI_LANG=de ;; *) UI_LANG=en ;; esac

# ---- 1. system check -------------------------------------------------------------------
info "$(m "Checking the system" "Prüfe das System")"
[ "$(uname -s)" = Linux ] || die "$(m "Linux is required" "Linux wird benötigt")"
# shellcheck disable=SC1091
. /etc/os-release
case "${ID:-}${ID_LIKE:-}" in *debian*|*raspbian*|*ubuntu*) ;; *) die "$(m "Only Debian-based systems are supported (found: $PRETTY_NAME)" "Nur Debian-basierte Systeme werden unterstützt (gefunden: $PRETTY_NAME)")" ;; esac
MODEL="$(cat /proc/device-tree/model 2>/dev/null | tr -d '\0' || true)"
IS_PI=n; [[ "$MODEL" == Raspberry* ]] && IS_PI=y
ok "$PRETTY_NAME · $(dpkg --print-architecture)${MODEL:+ · $MODEL}"
case "${VERSION_CODENAME:-}" in
  bookworm|trixie|noble|jammy) ;;
  *) warn "$(m "Untested release '${VERSION_CODENAME:-?}' – Debian 12/13 based Raspberry Pi OS is recommended" "Ungetestetes Release '${VERSION_CODENAME:-?}' – empfohlen ist Raspberry Pi OS auf Basis von Debian 12/13")" ;;
esac
mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
[ "$mem_mb" -lt 900 ] && warn "$(m "Only ${mem_mb} MB RAM – the kiosk browser may be slow" "Nur ${mem_mb} MB RAM – der Kiosk-Browser kann langsam sein")"

# ---- 2. packages & Docker ----------------------------------------------------------------
info "$(m "Installing packages" "Installiere Pakete")"
$SUDO apt-get update -qq
$SUDO apt-get install -y -qq git curl ca-certificates >/dev/null
ok "git, curl"

if ! command -v docker >/dev/null; then
  ask_yes install_docker "$(m "Docker is missing – install it now (get.docker.com)?" "Docker fehlt – jetzt installieren (get.docker.com)?")" y
  [ "$install_docker" = y ] || die "$(m "Docker is required" "Docker wird benötigt")"
  curl -fsSL https://get.docker.com | $SUDO sh
fi
$SUDO systemctl enable --now docker >/dev/null 2>&1 || true
if [ -n "$SUDO" ] && ! id -nG "$USER" | grep -qw docker; then
  $SUDO usermod -aG docker "$USER"
  warn "$(m "Added $USER to the docker group – takes effect after the next login" "$USER zur Gruppe docker hinzugefügt – wirkt nach dem nächsten Login")"
fi
DOCKER="docker"
docker info >/dev/null 2>&1 || DOCKER="$SUDO docker"
$DOCKER compose version >/dev/null 2>&1 || die "$(m "Docker Compose plugin missing (apt install docker-compose-plugin)" "Docker-Compose-Plugin fehlt (apt install docker-compose-plugin)")"
ok "$($DOCKER --version)"

# ---- 3. project ---------------------------------------------------------------------------
info "$(m "Fetching Magic Mirror into $INSTALL_DIR" "Lade Magic Mirror nach $INSTALL_DIR")"
if [ -d "$INSTALL_DIR/.git" ]; then
  git -C "$INSTALL_DIR" pull --ff-only -q || warn "$(m "git pull failed – keeping the current version" "git pull fehlgeschlagen – behalte aktuelle Version")"
else
  git clone -q --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"
ok "$(git log -1 --format='%h %s')"

# ---- 4. questions ---------------------------------------------------------------------------
info "$(m "Settings (Enter = keep default)" "Einstellungen (Enter = Vorgabe übernehmen)")"
tz_default="$(env_get TZ)"
[ -n "$tz_default" ] || tz_default="$(timedatectl show -p Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null || echo Europe/Berlin)"
ask TZ_VALUE "$(m "Time zone" "Zeitzone")" "$tz_default"
port_default="$(env_get MIRROR_PORT)"; ask PORT "$(m "Web port" "Web-Port")" "${port_default:-8080}"
base_default="$(env_get BASE_URL)"; ask BASE_URL "$(m "Address of the admin panel in your network" "Adresse des Admin-Panels in deinem Netz")" "${base_default:-http://$(hostname).local:$PORT}"
if [ "$UI_LANG" = de ]; then LOCALE=de-DE; else LOCALE=en-GB; fi

printf '\n'
echo "  ${B}$(m "Admin login" "Admin-Login")${N}"
CREATE_ADMIN=n
if [ -f data/users.json ]; then
  ok "$(m "An admin account already exists" "Es gibt bereits ein Admin-Konto")"
  ask_yes CREATE_ADMIN "$(m "Set a new password?" "Neues Passwort setzen?")" n
else
  CREATE_ADMIN=y
fi
if [ "$CREATE_ADMIN" = y ] && [ "$UNATTENDED" != 1 ]; then
  ask ADMIN_USER "$(m "Username" "Benutzername")" admin
  ask_secret ADMIN_PASS "$(m "Password (min. 8 characters)" "Passwort (mind. 8 Zeichen)")"
else
  CREATE_ADMIN=n
fi

oidc_default=n; [ -n "$(env_get OIDC_ISSUER_URL)" ] && oidc_default=y
ask_yes USE_OIDC "$(m "Additionally sign in via OIDC / SSO (Authentik, Keycloak, …)?" "Zusätzlich per OIDC / SSO anmelden (Authentik, Keycloak, …)?")" "$oidc_default"
OIDC_ISSUER=""; OIDC_ID=""; OIDC_SECRET=""; OIDC_EMAILS=""
if [ "$USE_OIDC" = y ]; then
  ask OIDC_ISSUER "Issuer URL" "$(env_get OIDC_ISSUER_URL)"
  ask OIDC_ID "Client ID" "$(env_get OIDC_CLIENT_ID || true)"
  ask OIDC_SECRET "$(m "Client secret (empty for public clients)" "Client-Secret (leer bei Public Clients)")" "$(env_get OIDC_CLIENT_SECRET)"
  ask OIDC_EMAILS "$(m "Allowed e-mails (comma-separated, empty = all)" "Erlaubte E-Mails (kommagetrennt, leer = alle)")" "$(env_get OIDC_ALLOWED_EMAILS)"
  echo "  ${DIM}Redirect URI: $BASE_URL/auth/callback${N}"
fi

printf '\n'
echo "  ${B}$(m "Optional services" "Optionale Dienste")${N}"
ask_yes P_KIOSK "$(m "Show the mirror full-screen on this device's HDMI output (kiosk)?" "Spiegel im Vollbild über HDMI dieses Geräts anzeigen (Kiosk)?")" "$(has_profile kiosk "$IS_PI")"
KIOSK_BROWSER_V="$(env_get KIOSK_BROWSER)"
if [ "$P_KIOSK" = y ]; then
  echo "  ${DIM}$(m "cog = WPE WebKit, light (recommended for a Pi 3) · chromium = heavier, maximum compatibility" "cog = WPE WebKit, sparsam (empfohlen für den Pi 3) · chromium = schwerer, maximale Kompatibilität")${N}"
  ask KIOSK_BROWSER_V "$(m "Kiosk browser (cog/chromium)" "Kiosk-Browser (cog/chromium)")" "${KIOSK_BROWSER_V:-cog}"
  case "$KIOSK_BROWSER_V" in chromium) ;; *) KIOSK_BROWSER_V=cog ;; esac
fi
ask_yes P_UPDATE "$(m "Install updates automatically every night?" "Updates jede Nacht automatisch installieren?")" "$(has_profile autoupdate y)"
UPDATE_TIME_VALUE="$(env_get UPDATE_TIME)"
[ "$P_UPDATE" = y ] && ask UPDATE_TIME_VALUE "$(m "Update time" "Uhrzeit für Updates")" "${UPDATE_TIME_VALUE:-04:00}"
ask_yes P_CAMERA "$(m "Show RTSP cameras (go2rtc)?" "RTSP-Kameras anzeigen (go2rtc)?")" "$(has_profile camera n)"
adsb_default="$(has_profile adsb n)"; [ "$(has_profile fr24 n)" = y ] && adsb_default=y
ask_yes P_ADSB "$(m "Use your own ADS-B USB stick for the aircraft map (optional)?" "Eigenen ADS-B-USB-Stick für die Flugzeugkarte nutzen (optional)?")" "$adsb_default"
ADSB_LAT_V=""; ADSB_LON_V=""; FR24_KEY=""; P_FR24=n
if [ "$P_ADSB" = y ]; then
  ask ADSB_LAT_V "$(m "Antenna latitude (e.g. 52.52)" "Breitengrad der Antenne (z. B. 52.52)")" "$(env_get ADSB_LAT)"
  ask ADSB_LON_V "$(m "Antenna longitude (e.g. 13.405)" "Längengrad der Antenne (z. B. 13.405)")" "$(env_get ADSB_LON)"
  ask_yes P_FR24 "$(m "Share the data with Flightradar24?" "Daten mit Flightradar24 teilen?")" "$(has_profile fr24 n)"
  if [ "$P_FR24" = y ]; then
    echo "  ${DIM}$(m "No key yet? See README → Flightradar24" "Noch kein Key? Siehe README → Flightradar24")${N}"
    ask FR24_KEY "$(m "FR24 sharing key (empty = set later)" "FR24-Sharing-Key (leer = später setzen)")" "$(env_get FR24_SHARING_KEY)"
  fi
fi

profiles=()
[ "$P_KIOSK" = y ] && profiles+=(kiosk)
[ "$P_UPDATE" = y ] && profiles+=(autoupdate)
[ "$P_CAMERA" = y ] && profiles+=(camera)
[ "$P_ADSB" = y ] && profiles+=(adsb)
[ "$P_FR24" = y ] && profiles+=(fr24)
PROFILES="$(IFS=,; echo "${profiles[*]:-}")"

# ---- 5. .env ----------------------------------------------------------------------------------
info "$(m "Writing .env" "Schreibe .env")"
[ -f .env ] && cp .env ".env.bak.$(date +%Y%m%d%H%M%S)"
umask 077
cat > .env <<EOF
# Generated by install.sh on $(date -Iseconds) – see .env.example for all options.
MIRROR_PORT=$PORT
BASE_URL=$BASE_URL
TZ=$TZ_VALUE
MM_LOCALE=$LOCALE
COMPOSE_PROFILES=$PROFILES
KIOSK_BROWSER=${KIOSK_BROWSER_V:-cog}

# Admin login: local accounts (data/users.json) and optionally OIDC
LOCAL_LOGIN=true
OIDC_ISSUER_URL=$OIDC_ISSUER
OIDC_CLIENT_ID=$OIDC_ID
OIDC_CLIENT_SECRET=$OIDC_SECRET
OIDC_ALLOWED_EMAILS=$OIDC_EMAILS
OIDC_SCOPE=openid profile email
SESSION_SECRET=$(env_get SESSION_SECRET)
TRUST_PROXY=$(env_get TRUST_PROXY)

# Auto-update
UPDATE_TIME=${UPDATE_TIME_VALUE:-04:00}
UPDATE_MODE=$(env_get UPDATE_MODE | grep . || echo pull)

# ADS-B / Flightradar24
ADSB_LAT=$ADSB_LAT_V
ADSB_LON=$ADSB_LON_V
ADSB_ALT=$(env_get ADSB_ALT | grep . || echo 50m)
ADSB_GAIN=$(env_get ADSB_GAIN | grep . || echo autogain)
FR24_SHARING_KEY=$FR24_KEY
EOF
umask 022
ok ".env (chmod 600)"

# ---- 6. Raspberry Pi setup --------------------------------------------------------------------
if [ "$P_KIOSK" = y ]; then
  info "$(m "Preparing HDMI kiosk" "Bereite HDMI-Kiosk vor")"
  BOOT=/boot/firmware; [ -f "$BOOT/config.txt" ] || BOOT=/boot
  if [ -f "$BOOT/config.txt" ]; then
    if ! grep -qE '^\s*dtoverlay=vc4-kms-v3d' "$BOOT/config.txt"; then
      $SUDO sed -i 's/^\s*dtoverlay=vc4-fkms-v3d/#&/' "$BOOT/config.txt"
      echo "dtoverlay=vc4-kms-v3d" | $SUDO tee -a "$BOOT/config.txt" >/dev/null
      REBOOT_NEEDED=1
      ok "$(m "Enabled the KMS graphics driver" "KMS-Grafiktreiber aktiviert")"
    fi
    if ! grep -q '^disable_splash=1' "$BOOT/config.txt"; then
      echo "disable_splash=1" | $SUDO tee -a "$BOOT/config.txt" >/dev/null
      REBOOT_NEEDED=1
    fi
  fi
  if [ -f "$BOOT/cmdline.txt" ] && ! grep -q 'consoleblank=0' "$BOOT/cmdline.txt"; then
    # Quiet boot without blinking cursor or screen blanking.
    $SUDO sed -i '1 s/$/ consoleblank=0 vt.global_cursor_default=0 logo.nologo/' "$BOOT/cmdline.txt"
    REBOOT_NEEDED=1
    ok "$(m "Disabled console blanking" "Bildschirmabschaltung der Konsole deaktiviert")"
  fi
  if [ "$(systemctl get-default 2>/dev/null)" = graphical.target ]; then
    warn "$(m "A desktop is installed and occupies the display." "Ein Desktop ist installiert und belegt den Bildschirm.")"
    ask_yes NO_DESKTOP "$(m "Boot to console instead (recommended for the kiosk)?" "Stattdessen in die Konsole booten (empfohlen für den Kiosk)?")" y
    if [ "$NO_DESKTOP" = y ]; then
      $SUDO systemctl set-default multi-user.target >/dev/null
      REBOOT_NEEDED=1
      ok "$(m "Desktop disabled" "Desktop deaktiviert")"
    fi
  fi
  [ -e /dev/dri/card0 ] || [ -e /dev/dri/card1 ] || REBOOT_NEEDED=1
fi

if [ "$P_ADSB" = y ] && [ ! -f /etc/modprobe.d/blacklist-rtlsdr.conf ]; then
  info "$(m "Preparing the RTL-SDR stick" "Bereite den RTL-SDR-Stick vor")"
  printf '%s\n' "blacklist dvb_usb_rtl28xxu" "blacklist rtl2832" "blacklist rtl2830" "blacklist dvb_usb_v2" "blacklist dvb_core" \
    | $SUDO tee /etc/modprobe.d/blacklist-rtlsdr.conf >/dev/null
  $SUDO modprobe -r dvb_usb_rtl28xxu rtl2832 2>/dev/null || REBOOT_NEEDED=1
  ok "$(m "DVB drivers blacklisted" "DVB-Treiber gesperrt")"
fi

# ---- 7. start ------------------------------------------------------------------------------------
info "$(m "Starting containers (the first download can take a while)" "Starte Container (der erste Download kann dauern)")"
mkdir -p data
# The server runs as uid 1000 inside the container (the container also fixes this itself).
$SUDO chown 1000:1000 data 2>/dev/null || true
if ! $DOCKER compose pull --quiet 2>/dev/null; then
  warn "$(m "Images not available – building locally (slow on a Pi 3)" "Images nicht verfügbar – baue lokal (dauert auf einem Pi 3)")"
  $DOCKER compose build
  sed -i 's/^UPDATE_MODE=.*/UPDATE_MODE=build/' .env
fi
$DOCKER compose up -d

printf '  %s' "$(m "waiting for the server" "warte auf den Server")"
for _ in $(seq 1 60); do
  if curl -fs -o /dev/null "http://localhost:$PORT/api/health"; then break; fi
  printf '.'; sleep 2
done
echo
curl -fsS -o /dev/null "http://localhost:$PORT/api/health" || die "$(m "Server did not start – see: docker compose logs magicmirror" "Server startet nicht – siehe: docker compose logs magicmirror")"
ok "$(m "Server is running" "Server läuft")"

if [ "$CREATE_ADMIN" = y ]; then
  printf '%s\n' "$ADMIN_PASS" | $DOCKER compose exec -T magicmirror node src/cli.js passwd "$ADMIN_USER" >/dev/null
  ok "$(m "Admin account '$ADMIN_USER' saved" "Admin-Konto '$ADMIN_USER' gespeichert")"
fi

# ---- 8. done ---------------------------------------------------------------------------------------
ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
printf '\n%s\n\n' "${G}${B}  ✦ $(m "Magic Mirror is ready" "Magic Mirror ist bereit")${N}"
echo "  $(m "Mirror" "Spiegel"):      http://${ip:-localhost}:$PORT/"
echo "  Admin:       $BASE_URL/admin"
echo "  $(m "Directory" "Verzeichnis"): $INSTALL_DIR"
echo "  Logs:        cd $INSTALL_DIR && docker compose logs -f"
[ "$P_UPDATE" = y ] && echo "  Updates:     $(m "daily at" "täglich um") ${UPDATE_TIME_VALUE:-04:00}"
[ "$P_UPDATE" = n ] && echo "  Update:      cd $INSTALL_DIR && git pull && docker compose pull && docker compose up -d"
echo
if [ "$REBOOT_NEEDED" = 1 ]; then
  ask_yes DO_REBOOT "$(m "A reboot is needed to activate the display settings. Reboot now?" "Für die Display-Einstellungen ist ein Neustart nötig. Jetzt neu starten?")" y
  [ "$DO_REBOOT" = y ] && $SUDO reboot
fi

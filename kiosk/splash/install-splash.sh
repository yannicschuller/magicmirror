#!/bin/bash
# Magic Mirror boot screen for Raspberry Pi OS (Plymouth): logo, spinner and a status line,
# kept on screen until the mirror answers – then the kiosk takes over the display.
#   sudo kiosk/splash/install-splash.sh [--lang de|en] [--port 8080]
#   sudo kiosk/splash/install-splash.sh --remove      # back to the normal boot
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
THEME_DIR=/usr/share/plymouth/themes/magicmirror
LANG_UI=en
PORT=8080
REMOVE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --lang) LANG_UI="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --remove) REMOVE=1; shift ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
[ "$(id -u)" -eq 0 ] || { echo "run with sudo" >&2; exit 1; }

BOOT=/boot/firmware; [ -f "$BOOT/cmdline.txt" ] || BOOT=/boot
CMDLINE="$BOOT/cmdline.txt"

rebuild_initramfs() {
  # Raspberry Pi OS (bookworm+) boots with an initramfs (auto_initramfs=1) that contains the theme.
  if command -v update-initramfs >/dev/null && ls /boot/initrd.img-* >/dev/null 2>&1; then update-initramfs -u >/dev/null 2>&1 || true; fi
}

if [ "$REMOVE" = 1 ]; then
  systemctl disable --now mm-splash.service >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/mm-splash.service /usr/local/bin/mm-splash
  systemctl unmask plymouth-quit.service plymouth-quit-wait.service >/dev/null 2>&1 || true
  systemctl enable getty@tty1.service >/dev/null 2>&1 || true
  sed -i '1 s/ quiet splash plymouth.ignore-serial-consoles//' "$CMDLINE"
  command -v plymouth-set-default-theme >/dev/null && plymouth-set-default-theme -R text >/dev/null 2>&1 || true
  rm -rf "$THEME_DIR"
  rebuild_initramfs
  systemctl daemon-reload
  echo "boot screen removed – reboot to see the normal boot"
  exit 0
fi

if [ "$LANG_UI" = de ]; then
  T_DOCKER="Docker startet …"; T_CONTAINERS="Container starten …"; T_WAIT="Warte auf den Spiegel"; T_READY="Spiegel bereit"; T_SLOW="Der Spiegel braucht länger – es geht trotzdem weiter"
else
  T_DOCKER="Starting Docker …"; T_CONTAINERS="Starting containers …"; T_WAIT="Waiting for the mirror"; T_READY="Mirror ready"; T_SLOW="The mirror takes longer – continuing anyway"
fi

DEBIAN_FRONTEND=noninteractive apt-get install -y -qq plymouth plymouth-label >/dev/null

install -d "$THEME_DIR"
install -m 644 "$HERE/magicmirror.plymouth" "$HERE/magicmirror.script" "$HERE/logo.png" "$HERE/dot.png" "$THEME_DIR/"
sed -i "s/show_status(\"Starting …\");/show_status(\"$T_DOCKER\");/" "$THEME_DIR/magicmirror.script"

# mm-splash: status messages while Docker and the mirror start, then hand over the display.
cat > /usr/local/bin/mm-splash <<SCRIPT
#!/bin/sh
msg() { plymouth message --text="\$1" 2>/dev/null || true; }
done_() { plymouth quit --retain-splash 2>/dev/null || true; exit 0; }
trap done_ EXIT
plymouth --ping 2>/dev/null || exit 0
msg "$T_DOCKER"
for i in \$(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 2; done
msg "$T_CONTAINERS"
for i in \$(seq 1 120); do
  if curl -fs -o /dev/null --max-time 2 "http://localhost:$PORT/api/health"; then msg "$T_READY"; sleep 1; exit 0; fi
  running=\$(docker ps -q 2>/dev/null | wc -l)
  msg "$T_WAIT … \$((i * 2)) s · \$running container"
  sleep 2
done
msg "$T_SLOW"
sleep 2
SCRIPT
chmod 755 /usr/local/bin/mm-splash

cat > /etc/systemd/system/mm-splash.service <<'UNIT'
[Unit]
Description=Magic Mirror boot screen (keeps the logo until the mirror is up)
After=plymouth-start.service docker.service
Wants=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/mm-splash
TimeoutStartSec=330
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
UNIT

# mm-splash ends the boot screen instead of the default "boot finished" step, and the local
# login prompt on the HDMI console would cover it (SSH keeps working).
systemctl mask plymouth-quit.service plymouth-quit-wait.service >/dev/null 2>&1 || true
systemctl disable getty@tty1.service >/dev/null 2>&1 || true
systemctl daemon-reload
systemctl enable mm-splash.service >/dev/null

if ! grep -q ' splash' "$CMDLINE"; then
  sed -i '1 s/$/ quiet splash plymouth.ignore-serial-consoles/' "$CMDLINE"
fi
plymouth-set-default-theme magicmirror >/dev/null
rebuild_initramfs
echo "boot screen installed – visible after the next reboot"

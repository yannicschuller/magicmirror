# Kiosk: shows the mirror full-screen on the HDMI output of the host – no
# desktop environment needed on the host.
#   BROWSER=cog       WPE WebKit "cog" draws directly via DRM/KMS (default,
#                     light: well suited for a Raspberry Pi 3)
#   BROWSER=chromium  Chromium inside the minimal Wayland compositor "cage"
FROM debian:trixie-slim

ARG BROWSER=cog

LABEL org.opencontainers.image.source=https://github.com/yannicschuller/magicmirror \
      org.opencontainers.image.description="Magic Mirror kiosk (HDMI full-screen browser)" \
      org.opencontainers.image.licenses=MIT

RUN set -eu; \
    case "$BROWSER" in \
      cog) pkgs="cog gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-libav" ;; \
      chromium) pkgs="chromium cage seatd" ;; \
      *) echo "unknown BROWSER=$BROWSER" >&2; exit 1 ;; \
    esac; \
    apt-get update; \
    apt-get install -y --no-install-recommends $pkgs \
      ca-certificates curl tini libgl1-mesa-dri libegl1 libgles2 v4l-utils \
      fonts-dejavu-core fonts-noto-color-emoji; \
    rm -rf /var/lib/apt/lists/*; \
    useradd --create-home --shell /usr/sbin/nologin kiosk

COPY start.sh /usr/local/bin/kiosk-start
RUN chmod 755 /usr/local/bin/kiosk-start

ENV BROWSER=${BROWSER} \
    MIRROR_URL=http://magicmirror:8080/ \
    XDG_RUNTIME_DIR=/run/kiosk

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/usr/local/bin/kiosk-start"]

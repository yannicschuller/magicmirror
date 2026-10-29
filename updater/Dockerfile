# Auto-updater: pulls new images (and optionally the git checkout) on a schedule
# and recreates the stack with docker compose.
FROM docker:29-cli

LABEL org.opencontainers.image.source=https://github.com/yannicschuller/magicmirror \
      org.opencontainers.image.description="Magic Mirror auto-updater" \
      org.opencontainers.image.licenses=MIT

RUN apk add --no-cache git su-exec tzdata jq busybox-extras util-linux-misc

COPY update.sh /usr/local/bin/mm-update
RUN chmod 755 /usr/local/bin/mm-update

ENTRYPOINT ["/usr/local/bin/mm-update"]

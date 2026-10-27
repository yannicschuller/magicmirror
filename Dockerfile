# Multi-arch (amd64, arm64, armv7) – runs on a Raspberry Pi 3/4/5.

# ---- Stage 1: build the admin panel (React + Vite) --------------------------------------
# Runs on the build host's native platform only: the output is plain static files,
# so multi-arch builds (buildx + QEMU) don't have to emulate the JS build per target.
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS admin
WORKDIR /build/admin
COPY admin/package.json admin/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY admin ./
# the admin bundles the shared schema/i18n modules
COPY public/shared ../public/shared
RUN npm run build

# ---- Stage 2: runtime ---------------------------------------------------------------------
FROM node:22-bookworm-slim

LABEL org.opencontainers.image.source=https://github.com/yannicschuller/magicmirror \
      org.opencontainers.image.description="Modular smart mirror with admin panel" \
      org.opencontainers.image.licenses=MIT

# Set by the release workflow (git tag or commit); shown in /api/health.
ARG MM_VERSION=dev

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    TZ=Europe/Berlin \
    NODE_OPTIONS=--no-deprecation \
    MM_VERSION=${MM_VERSION}

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY src ./src
COPY public ./public
COPY --from=admin /build/public/admin ./public/admin

COPY docker-entrypoint.sh /usr/local/bin/mm-entrypoint
RUN mkdir -p /data && chown node:node /data
# No USER here: the entrypoint fixes /data ownership as root, then drops to "node".
VOLUME /data
EXPOSE 8080

HEALTHCHECK --interval=60s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["mm-entrypoint"]
CMD ["node", "src/server.js"]

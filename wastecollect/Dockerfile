# Waste collection lookup service (compose profile "waste").
# Wraps the MIT-licensed "Waste Collection Schedule" library
# (https://github.com/mampfes/hacs_waste_collection_schedule) without Home Assistant
# and offers a small HTTP API on port 8098 for the mirror server.
ARG PYTHON=python:3.12-slim

FROM ${PYTHON} AS build
# Pinned library release (tag or commit).
ARG WCS_REF=v2.36.0
RUN apt-get update \
 && apt-get install -y --no-install-recommends gcc libc6-dev libffi-dev curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt /tmp/requirements.txt
# Wheels for everything (compiles the few packages without an armv7 wheel, e.g. cffi).
RUN pip wheel --no-cache-dir --wheel-dir /wheels -r /tmp/requirements.txt
RUN set -eux; \
    mkdir -p /src /opt/wcs; \
    curl -fsSL "https://codeload.github.com/mampfes/hacs_waste_collection_schedule/tar.gz/${WCS_REF}" | tar -xz -C /src --strip-components=1; \
    cc=/src/custom_components/waste_collection_schedule; \
    cp -r "$cc/waste_collection_schedule" /opt/wcs/; \
    cp "$cc/sources.json" /src/LICENSE /opt/wcs/; \
    rm -rf /opt/wcs/waste_collection_schedule/test /opt/wcs/waste_collection_schedule/wizard; \
    echo "${WCS_REF}" > /opt/wcs/VERSION

FROM ${PYTHON}
LABEL org.opencontainers.image.source=https://github.com/yannicschuller/magicmirror \
      org.opencontainers.image.description="Magic Mirror waste collection lookup (Waste Collection Schedule)" \
      org.opencontainers.image.licenses=MIT
ENV PYTHONUNBUFFERED=1 WCS_DIR=/opt/wcs PORT=8098
COPY requirements.txt /tmp/requirements.txt
RUN --mount=type=bind,from=build,source=/wheels,target=/wheels \
    pip install --no-cache-dir --no-index --find-links /wheels -r /tmp/requirements.txt \
 && rm /tmp/requirements.txt
COPY --from=build /opt/wcs /opt/wcs
COPY app.py lookups.py /app/
# Precompile so imports are fast on a Raspberry Pi.
RUN python -m compileall -q /opt/wcs /app && useradd -r -u 10001 wcs
USER wcs
WORKDIR /app
EXPOSE 8098
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8098/health', timeout=4)"
CMD ["python", "/app/app.py"]

# Changelog

## Unreleased

- Admin panel: check for updates, list of changes and one-click update with a progress screen (`UPDATE_TIME=off` = manual only)
- Location of weather & co. can be searched directly in each module (empty = location from "General")
- Tasks module: Apple Reminders via an Apple Shortcuts automation (push endpoint `POST /api/push/tasks`)

## 1.1.0

- English and German for the mirror and the admin panel (`general.locale`, `MM_LOCALE`)
- Username/password login (default), with OIDC / SSO now optional
- Admin panel rebuilt with React and shadcn/ui
- Kiosk container: full-screen browser on the Pi's HDMI output, no desktop needed – WPE WebKit (cog) by default, Chromium as option
- New modules: news/RSS, Home Assistant, tasks & shopping list (Todoist, Home Assistant, CalDAV), fuel prices (Tankerkönig), moon & sun, football (OpenLigaDB)
- System info with resource hints in the admin panel
- Auto-updater container plus multi-arch images on GHCR (amd64, arm64, arm/v7)
- One-line installer (`install.sh`) with interactive setup
- New logo and branding

## 1.0.0

- First release: weather, weather hints, calendars, waste collection, Formula 1, public transport, aircraft map, RTSP cameras, greeting and text modules; pages; drag & drop layout; OIDC admin; configuration import/export

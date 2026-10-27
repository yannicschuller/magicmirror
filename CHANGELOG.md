# Changelog

## Unreleased

- Pages: animated weather background (rain, drizzle, snow, thunderstorm, fog, clouds, sun, starry sky) – off/subtle/strong per page; preview with `?ambient=rain`
- Pages: duplicate a page (with its modules); show a page only on certain weekdays/times or in a date range; exclusive pages (e.g. a morning page); skip pages whose own modules are all hidden
- Public transport: EFA preset for Saxony (VVO – incl. Leipzig/MDV with real-time data); hint that v6.db.transport.rest was shut down
- Module schedule: show any module only on certain weekdays / between two times
- Module height "use as much space as possible" (extends into empty areas of its column)
- Calendar: week & month view, running/next event highlight, public & school holidays, birthdays with age, busy-only calendars, filters, multi-day "day 2 of 5", fade-out
- Waste collection by town/address search (optional `waste` sidecar based on Waste Collection Schedule)
- Public transport: "leave now" traffic light
- Clock: analog and word clock (sentence or letter grid)
- Home Assistant: live updates via WebSocket, conditions, warning colours
- Aircraft: "nearest aircraft" spotlight with route, photo and distance; map fits its area; online sources limited to one request per 3 min
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

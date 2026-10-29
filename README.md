<p align="center">
  <img src="public/brand/wordmark.svg" alt="Magic Mirror" width="420">
</p>

<p align="center">
  A modular smart mirror that runs in Docker on a Raspberry Pi – with a web admin panel, rotating pages and live updates.<br>
  <b>English</b> and <b>Deutsch</b> built in.
</p>

<p align="center">
  <a href="https://github.com/yannicschuller/magicmirror/actions/workflows/ci.yml"><img src="https://github.com/yannicschuller/magicmirror/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/Raspberry%20Pi-3%20%7C%204%20%7C%205-c51a4a" alt="Raspberry Pi 3, 4, 5">
  <img src="https://img.shields.io/badge/docker-amd64%20%7C%20arm64%20%7C%20armv7-2496ed" alt="Docker: amd64, arm64, armv7">
</p>

---

- **One-line installer:** installs Docker, asks for the important settings and turns a fresh Raspberry Pi into a mirror that boots straight into full-screen on HDMI.
- **Admin panel at `/admin`:** every module can be switched on or off, configured and dragged into place. Sign in with a username and password, and optionally via OIDC / SSO.
- **Pages:** as many pages as you like, rotating automatically, and modules can appear on several pages.
- **Live:** changes show up on every mirror immediately, with no reload.
- **Auto-update:** new versions are installed overnight and open mirrors reload themselves.
- **Backup:** export and import the complete configuration as one file.
- **Languages:** English and German, for both the mirror and the admin panel.
- **Smart visibility:** modules can show only at certain times, only when they have something to show (open tasks, an aircraft nearby, a race weekend …) or stand in for another module; pages can depend on a module's result too.
- **Night mode:** dim, show only the clock or switch the screen off (HDMI-CEC standby) – by time or from sunset to sunrise.
- **Phone remote:** `/admin/#remote` switches pages, holds the rotation and turns the screen on/off.
- **Several mirrors:** one server, several screens with their own pages (`/?display=flur`).
- **Live preview, change diff and history:** see unsaved changes in the admin preview, review them field by field, and restore any of the last 20 saved states.
- **Health notices:** the admin panel tells you when a module keeps failing (expired token, unreachable feed …).

## Modules

| Module | What it shows | Data source |
|---|---|---|
| **Clock & date** | Time, date, week number | local |
| **Weather** | Current conditions, hourly and 7-day forecast, sunrise and sunset | [Open-Meteo](https://open-meteo.com) (no API key) |
| **Weather hints** | "Don't forget your umbrella!", "Don't forget sunscreen!" (UV), frost/ice, snow, heat, storm, plus official DWD warnings | Open-Meteo, [Bright Sky](https://brightsky.dev) |
| **Calendar** | Any number of iCal/ICS calendars, each with its own **color and icon** (20 icons). Keyword icons (birthday → cake, doctor → cross, …). Recurring events, 4 styles, legend | Google, Nextcloud, iCloud, Outlook, … |
| **Waste collection** | Next pickups with colored bins and a "put it out tonight" reminder | Search by town/address (`waste` profile), iCal file from your waste company, or fixed intervals |
| **Formula 1** | Next race: all sessions in local time, countdown / LIVE, track weather, last year's winner, last podium, driver and constructor standings | [Jolpica (Ergast)](https://github.com/jolpica/jolpica-f1), Open-Meteo |
| **Public transport** | Live departure board with delays, platforms, line/mode filters, walking-time offset | EFA networks (VVS, MVV, bwegt, VRR, VGN, Bavaria, …) or any HAFAS-REST API |
| **Aircraft map** | Live map of aircraft nearby, plus a list of the nearest | Your own ADS-B USB stick **or** adsb.lol / airplanes.live |
| **Camera (RTSP)** | RTSP cameras as snapshots (easy on the Pi) or live video | go2rtc |
| **Greeting** | Rotating messages depending on the time of day | local |
| **Free text** | Notes, Wi-Fi info, … | local |
| **News / RSS** | Latest headlines from any RSS/Atom feeds, as a list or a rotating ticker | any feed (tagesschau, BBC, …) |
| **Home Assistant** | Entity states: indoor temperature, open windows, power, … (e.g. show windows only when open) | your Home Assistant (long-lived token) |
| **Tasks & shopping list** | Open to-dos with due dates and overdue highlight | Todoist, Home Assistant to-do lists, CalDAV (Nextcloud, …), **Apple Reminders** via Shortcuts |
| **Fuel prices** | Cheapest stations nearby or your favourites, E5/E10/diesel | [Tankerkönig](https://creativecommons.tankerkoenig.de) (free API key, Germany) |
| **Moon & sun** | Moon phase drawn to scale, next full/new moon, sun arc with current position, twilight and golden hour, day length | computed locally |
| **Football** | Bundesliga & more: matchday with live scores, table, next matches, favourite team | [OpenLigaDB](https://www.openligadb.de) |
| **Countdown** | Days until holidays, birthdays (yearly, "turns 40"), events – list or one big number | local |
| **Parcel tracking** | Status, last scan, "arriving today" and delivery window per parcel | [DHL API](https://developer.dhl.com) (free key), optional [17TRACK](https://www.17track.net) for other carriers |
| **Pollen & air quality** | DWD pollen forecast for your region (today/tomorrow), European AQI, PM2.5/PM10, ozone, NO₂ | [DWD](https://opendata.dwd.de), Open-Meteo (no API key) |
| **Bike & scooter sharing** | Nearest stations with free bikes/e-bikes and free-floating scooters nearby | open GBFS feeds (nextbike, Dott, Bolt, Voi, …) |
| **ISS & night sky** | Visible ISS passes with direction and brightness, planets tonight, moon, conjunctions and meteor showers | [CelesTrak](https://celestrak.org) orbit data, computed locally |
| **Device status** | CPU temperature, load, RAM, disk, uptime, Raspberry Pi under-voltage/throttling | local |
| **Internet & network** | Online status, latency, optional speed test and public IP, who is home (device probe or Home Assistant) | local, Cloudflare |

Each module can be added several times (two departure boards, for example). Each copy has its own settings and one of 12 positions, including a full-screen background.

## What you need

**Hardware**

| | Minimum | Recommended |
|---|---|---|
| Board | Raspberry Pi 3 B / 3 B+ (1 GB) | Raspberry Pi 4 or 5 (2 GB+) |
| Storage | 16 GB microSD (A1) | 32 GB microSD (A2) or a USB SSD |
| Power | Official 2.5 A supply (Pi 3) | Official supply for your Pi model |
| Display | Any HDMI monitor behind a two-way mirror | – |
| Optional | RTL-SDR USB stick + 1090 MHz antenna for your own ADS-B reception | e.g. FlightAware Pro Stick Plus |

**Operating system**

- **Raspberry Pi OS Lite (64-bit)**, based on Debian 13 "trixie" or Debian 12 "bookworm". This is the recommended choice.
- **Raspberry Pi OS Lite (32-bit)** also works. Every image is published for `arm/v7`, and the 32-bit OS leaves a little more free RAM on a Pi 3.
- Use the **Lite** variant, without a desktop. The kiosk container draws Chromium directly on the HDMI output, so a desktop would only compete for the screen and for memory. If a desktop is installed, the installer offers to switch to console boot.
- Any other Debian or Ubuntu machine (amd64/arm64) works as a server. The mirror is then opened in any browser.

Flash the card with [Raspberry Pi Imager](https://www.raspberrypi.com/software/). In *OS customisation*, set the hostname (e.g. `mirror`), user, Wi-Fi and time zone, and **enable SSH**.

## Installation

Log in via SSH and run:

```bash
curl -fsSL https://raw.githubusercontent.com/yannicschuller/magicmirror/main/install.sh | bash
```

The installer:

1. checks the system and installs Docker (via [get.docker.com](https://get.docker.com)) and git,
2. clones this repository to `~/magicmirror`,
3. asks for language, time zone, port, the admin account, optional OIDC, kiosk, auto-update, cameras and the ADS-B stick,
4. writes `.env` (readable only by you),
5. prepares the Pi for the kiosk: KMS graphics driver, no screen blanking, quiet boot, and console boot instead of a desktop,
6. pulls the images and starts everything. Containers restart automatically after every reboot.

Then open `http://mirror.local:8080/admin` and sign in. Running the installer again updates the installation and lets you change the answers.

<details>
<summary>Manual installation with Docker Compose</summary>

```bash
git clone https://github.com/yannicschuller/magicmirror.git
cd magicmirror
cp .env.example .env        # adjust; at least TZ and MM_LOCALE
docker compose up -d
docker compose logs magicmirror | grep "setup code"
```

Open `/login` and create the admin account with the setup code from the log. Alternatively, run `docker compose exec magicmirror node src/cli.js passwd admin`.

</details>

- Mirror: `http://<host>:8080/`
- Admin: `http://<host>:8080/admin`
- Configuration: `./data/config.json`. Accounts: `./data/users.json`, with passwords hashed using scrypt.

## Raspberry Pi 3 – what to expect

All of it runs on a Pi 3. The server needs about 60 MB of RAM; the default kiosk browser (WPE WebKit) is much lighter than Chromium. Everything is your choice – the admin panel shows the detected device, free RAM, CPU load, temperature and disk under *Import / Export → System*, with hints (never enforced). Worth trying on a Pi 3:

- Camera module in **snapshot** mode instead of live video (or live with a low-resolution sub-stream).
- Aircraft map refresh of **5 s or more**, and not too many heavy modules (maps, cameras) on one page.
- Use prebuilt images (the default). Building the images on the Pi 3 itself works, but takes a long time.
- The ADS-B receiver (`adsb` / `fr24` profiles) runs fine alongside everything else on a Pi 3.

## Admin login

| Method | How |
|---|---|
| **Username & password** (default) | Created by the installer, or on first visit of `/login` with the setup code from the server log. Passwords can be changed in the admin panel (*Import / Export → Account*) or with `node src/cli.js passwd <user>`. Repeated failed logins are throttled. |
| **OIDC / SSO** (optional) | Set `OIDC_ISSUER_URL` and `OIDC_CLIENT_ID` (plus `OIDC_CLIENT_SECRET` for confidential clients; public clients use PKCE). The login page then shows a *Sign in with SSO* button. |

Both methods can be used at the same time. With `LOCAL_LOGIN=false`, only SSO is allowed.

To set up OIDC, create a client at your identity provider (Authentik, Keycloak, Authelia, Pocket ID, Zitadel, Google, …):

- Redirect URI: `${BASE_URL}/auth/callback`, e.g. `http://mirror.local:8080/auth/callback`
- Post-logout redirect: `${BASE_URL}/login`
- Scopes: `openid profile email` (add `groups` for group checks)

```env
BASE_URL=http://mirror.local:8080
OIDC_ISSUER_URL=https://auth.example.com/application/o/magicmirror/
OIDC_CLIENT_ID=magicmirror
OIDC_CLIENT_SECRET=...
OIDC_ALLOWED_EMAILS=me@example.com   # optional
OIDC_ALLOWED_GROUPS=mirror-admins    # optional
```

Some providers only accept `https://` redirect URIs. In that case, put the mirror behind a reverse proxy (Caddy, Traefik, nginx) and set `TRUST_PROXY=true`.

## Optional services

Enabled via `COMPOSE_PROFILES` in `.env` (comma-separated). The installer sets this for you.

| Profile | Service | Purpose |
|---|---|---|
| `kiosk` | `magicmirror-kiosk-cog` / `-chromium` | Full-screen browser on HDMI (WPE WebKit by default). No desktop needed. |
| `autoupdate` | `magicmirror-updater` | Updates from the admin panel (check + one click) and, optionally, daily at `UPDATE_TIME`. |
| `camera` | [go2rtc](https://github.com/AlexxIT/go2rtc) | RTSP cameras → browser. Streams are created automatically from the admin panel. |
| `adsb` | [ultrafeeder](https://github.com/sdr-enthusiasts/docker-adsb-ultrafeeder) | Your own ADS-B receiver with an RTL-SDR stick, plus tar1090 on port 8090. |
| `fr24` | [fr24feed](https://github.com/sdr-enthusiasts/docker-flightradar24) + ultrafeeder | Also share your data with **Flightradar24**. |
| `waste` | `magicmirror-wastecollect` | Find your waste collection calendar by town and address – no iCal needed (see below). |

### Kiosk (HDMI full-screen)

Two browsers are available via `KIOSK_BROWSER`:

- `cog` (default) – [WPE WebKit](https://wpewebkit.org), made for embedded devices. It draws directly via DRM/KMS without a compositor and needs noticeably less RAM than Chromium – the best choice for a Pi 3.
- `chromium` – Chromium inside the [cage](https://github.com/cage-kiosk/cage) Wayland kiosk. Use it if something renders differently in WebKit, or for live camera video on a Pi 4/5.

The `kiosk` container runs privileged so it can drive the display (DRM/KMS), keyboard/touch input and the console. On the host it needs only the KMS driver (`dtoverlay=vc4-kms-v3d`, the default on current Raspberry Pi OS) and no desktop running on the screen.

- Screen rotation (portrait mode): admin panel → *General → Rotate screen*.
- Showing a different server: `KIOSK_URL=http://other-host:8080/`.
- Extra Chromium flags: `KIOSK_FLAGS=--force-device-scale-factor=1.25`.
- Night dimming: *General → Night mode*.

### Boot screen (Raspberry Pi)

The installer can set up a boot screen with the Magic Mirror logo, a spinner and a status line ("Starting Docker …", "Waiting for the mirror …") instead of scrolling boot text. It stays until the mirror answers, then the kiosk takes over. Install or remove it later with:

```bash
sudo kiosk/splash/install-splash.sh --lang de --port 8080
sudo kiosk/splash/install-splash.sh --remove
```

### Updates

The `autoupdate` profile runs a small updater container. In the admin panel (*Import / Export → Updates*) you can **check for updates**, see the list of changes and **start the update** – a progress screen follows it through download and restart and reloads the page afterwards. Set `UPDATE_TIME=off` for manual updates only.

Unless switched off, the updater does the following every day at `UPDATE_TIME` (default `04:00`):

1. `git pull --ff-only` the checkout (skipped if you have local changes),
2. `docker compose pull` (or `build` with `UPDATE_MODE=build`),
3. recreates only the containers whose image or configuration changed.

Open mirrors notice the new version and reload themselves. To run an update immediately:

```bash
docker compose exec updater mm-update --now
```

Without the updater, update manually: `git pull && docker compose pull && docker compose up -d`.

### Cameras

Enable the `camera` profile, add a *Camera (RTSP)* module in the admin panel and enter the RTSP URL (e.g. `rtsp://user:pass@192.168.1.20:554/stream2`). The server registers the streams with go2rtc and proxies images and video. go2rtc itself is not exposed, and credentials never reach the browser.

### Own ADS-B receiver (optional)

You don't need a stick: by default, the aircraft map uses the free adsb.lol API. If you do have an RTL-SDR stick:

1. Run the installer and answer *yes* to the ADS-B question. It blocks the DVB kernel drivers and sets the profile. Manually, the steps are: create `/etc/modprobe.d/blacklist-rtlsdr.conf`, set `COMPOSE_PROFILES=adsb`, and set `ADSB_LAT`, `ADSB_LON` and `ADSB_ALT`.
2. In the admin panel, choose *Own ADS-B receiver* as the data source of the *Aircraft map* module.
3. tar1090 is available at `http://<pi>:8090`. Other networks (adsb.lol, adsb.fi, …) can be fed via `ULTRAFEEDER_CONFIG`.

### Flightradar24

1. Get a sharing key (one-time, interactive):
   ```bash
   docker run --rm -it --entrypoint fr24feed ghcr.io/sdr-enthusiasts/docker-flightradar24:latest --signup
   ```
2. In `.env`, set `FR24_SHARING_KEY=...` and add `fr24` to `COMPOSE_PROFILES`.
3. Check the status at `http://<pi>:8754`. Feeders get a free FR24 Business account.

### Public transport

In the *Public transport* module, pick your network and search for the stop. Presets cover VVS, bwegt/NVBW (all of Baden-Württemberg), MVV, bahnland bayern, VGN and VRR. Any other EFA server can be entered as a custom URL, and any HAFAS-REST API in [db-rest](https://github.com/public-transport/db-rest) format works too.

### Apple Reminders

Apple has no Reminders API, so an Apple Shortcuts automation pushes your open reminders to the mirror (e.g. whenever you close the Reminders app). Choose the source *Apple Reminders (Shortcuts)* in the *Tasks & shopping list* module and follow the step-by-step guide: [docs/apple-reminders.md](docs/apple-reminders.md) · [Deutsch](docs/apple-reminders.de.md).

### Waste collection

Most waste companies offer an iCal export or subscription link. Add the URL, and entries are matched to bin types by keywords (types, colors and keywords are editable). Without iCal, use fixed intervals such as "general waste every 2 weeks from …".

**Search by town / address (no iCal needed):** enable the `waste` profile (installer question, or add `waste` to `COMPOSE_PROFILES`). In the waste module, search for your town or waste company (e.g. *Leipzig*, *Landkreis Böblingen*, *BSR*), enter your street and house number (with suggestions where the provider offers them) and press *Test* to see the next dates. The small `wastecollect` container (port 8098, internal only) uses the MIT-licensed [Waste Collection Schedule](https://github.com/mampfes/hacs_waste_collection_schedule) library with 1,000+ German municipalities and services; results are cached for 6 hours and merged with iCal sources and fixed intervals. Small towns are often listed under their county (*Landkreis*) or waste company.

## Configuration reference

All options with comments are in [`.env.example`](.env.example). The most important ones:

| Variable | Default | |
|---|---|---|
| `MIRROR_PORT` | `8080` | Web port |
| `MM_LOCALE` | `en-GB` | Language and format of a fresh install (`de-DE`, `en-GB`, …). Can be changed later in the admin panel. |
| `TZ` | `Europe/Berlin` | Time zone of the containers |
| `BASE_URL` | – | Public URL of the server (needed for OIDC) |
| `LOCAL_LOGIN` | `true` | Allow username/password sign-in |
| `OIDC_*` | – | Optional SSO, see above |
| `COMPOSE_PROFILES` | – | `kiosk,autoupdate,camera,adsb,fr24,waste` |
| `UPDATE_TIME` / `UPDATE_MODE` | `04:00` / `pull` | Auto-update schedule and mode |
| `MM_REGISTRY` / `MM_TAG` | `ghcr.io/yannicschuller` / `latest` | Image source (for forks) and pinned versions |

## Development

```bash
# Includes a mock OIDC server (any username) and live source mounts
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
npm test
```

The admin panel is a React + [shadcn/ui](https://ui.shadcn.com) app in [`admin/`](admin/), built into `public/admin/` during the Docker build. See [`admin/README.md`](admin/README.md) for its dev server.

```
src/server.js              Express server, routes, server-sent events
src/auth.js                Local accounts + OIDC (express-openid-connect)
src/providers/*.js         Data sources (weather, calendar, waste, F1, transit, flights)
public/shared/modules.js   Core module schema – defaults, validation and admin forms
public/shared/modules/     Plug-in module schemas (news, homeassistant, tasks, fuel, sky, football)
public/shared/i18n.js      Translations (English ids, German in locales/de/)
public/mirror/             Mirror front end (vanilla JS, runs well on a Pi 3)
admin/                     Admin panel source (React, shadcn/ui)
kiosk/  updater/           Kiosk and auto-update containers
install.sh                 One-line installer
```

New modules are plug-ins: a schema in `public/shared/modules/<type>.js` (the admin form is generated from it), a renderer + CSS in `public/mirror/modules/`, optionally a provider in `src/providers/<type>.js`, and German strings in `public/shared/locales/de/modules/<type>.js`. Register them in the three `index.js` files. A test checks that every schema string has a German translation.

Contributions are welcome – see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE). Weather data by Open-Meteo (CC BY 4.0) and DWD via Bright Sky. F1 data by Jolpica. Map tiles © Esri / OpenStreetMap contributors. Aircraft data by adsb.lol (ODbL) or airplanes.live.

# 🪞 Magic Mirror

Modularer Smart Mirror als Docker-Container – läuft auf einem **Raspberry Pi 3/4/5** (oder jedem anderen Server) und wird im Browser angezeigt. Alles ist über ein **Admin-Panel unter `/admin`** einstellbar; der Login läuft ausschließlich über **OIDC**.

## Module

| Modul | Inhalt | Datenquelle |
|---|---|---|
| **Uhr & Datum** | Uhrzeit, Datum, Kalenderwoche | lokal |
| **Wetter** | Aktuell, Stundenverlauf, 7-Tage-Vorhersage, Sonnenauf-/untergang | [Open-Meteo](https://open-meteo.com) (ohne API-Key) |
| **Wetter-Hinweise** | „Regenschirm nicht vergessen!“, „Eincremen nicht vergessen!“ (UV), Frost/Glätte, Schnee, Hitze, Sturm + amtliche DWD-Warnungen | Open-Meteo, [Bright Sky](https://brightsky.dev) |
| **Kalender** | Beliebig viele iCal-/ICS-Kalender, je Kalender eigene **Farbe + Icon** (20 Icons), automatische Icons per Stichwort (Geburtstag → Torte, Arzt → Kreuz, Urlaub → Flugzeug …), 4 Darstellungen, Legende, Serientermine & Ausnahmen | iCal-URLs (Google, Nextcloud, iCloud, Outlook …) |
| **Müllkalender** | Nächste Abholtermine mit farbigen Tonnen, Erinnerung „heute Abend rausstellen“ | iCal-Datei des Entsorgers und/oder feste Intervalle |
| **Formel 1** | Nächstes Rennen: Runde, Strecke, alle Sessions in Ortszeit, Countdown/LIVE, Wetter an der Strecke, Vorjahressieger, letztes Podium, Fahrer-/Konstrukteurs-WM | [Jolpica (Ergast)](https://github.com/jolpica/jolpica-f1), Open-Meteo |
| **ÖPNV-Abfahrten** | Live-Abfahrtstafel mit Verspätungen, Gleis, Filter nach Linie/Verkehrsmittel, Fußweg-Offset | EFA-Verbünde (VVS, MVV, bwegt, VRR, VGN, Bayern …) oder HAFAS-REST |
| **Flugzeug-Karte** | Live-Karte mit Flugzeugen in der Nähe + Liste der nächsten | eigener ADS-B-USB-Stick **oder** adsb.lol / airplanes.live |
| **Kamera (RTSP)** | RTSP-Kameras als Standbild (schont den Pi) oder Live-Video | go2rtc |
| **Begrüßung** | Wechselnde Sprüche je nach Tageszeit | lokal |
| **Freitext** | Notizen, WLAN-Info, … | lokal |

Jedes Modul kann **mehrfach** angelegt werden (z. B. zwei Abfahrtstafeln), lässt sich **an/aus** schalten, hat eigene Einstellungen und eine **Position** (12 Flächen inkl. Vollbild-Hintergrund).

### Seiten

Beliebig viele **Seiten**, die automatisch rotieren (Dauer pro Seite einstellbar). Module können auf einer, mehreren oder allen Seiten erscheinen – z. B. Uhr und Wetter immer, Kalender nur auf Seite 1, F1 und Flugzeuge auf Seite 2. Im Admin-Panel kann eine Seite per Klick sofort auf allen Spiegeln angezeigt werden. Am Spiegel: Pfeiltasten, Wischen oder Klick auf die Punkte. `/?page=<id>` hält eine Seite fest.

### Admin-Panel (`/admin`)

- **Seiten & Layout:** Seiten anlegen/sortieren, Dauer, Drag & Drop der Module auf die Flächen, Live-Vorschau
- **Module:** hinzufügen, duplizieren, löschen, alle Einstellungen, „Daten testen“
- **Allgemein:** Standort (Ortssuche), Zeitzone, Farben, Schriftgröße, Bildschirmdrehung (Hochformat), Nachtmodus, …
- **Import / Export:** komplette Konfiguration als JSON sichern und wiederherstellen
- Änderungen erscheinen **sofort** auf allen Spiegeln (Server-Sent Events), ohne Neuladen.

## Schnellstart

```bash
git clone https://github.com/yannicschuller/magicmirror.git
cd magicmirror
cp .env.example .env    # OIDC-Daten eintragen
docker compose up -d
```

- Spiegel: `http://<server>:8080`
- Admin: `http://<server>:8080/admin`

Das Image wird per GitHub Actions für `amd64`, `arm64` und `arm/v7` (Raspberry Pi OS 32 Bit) gebaut und unter `ghcr.io/yannicschuller/magicmirror` veröffentlicht. Alternativ lokal bauen: `docker compose up -d --build`.

Die Konfiguration liegt in `./data/config.json`.

## OIDC einrichten

Beim Identity Provider (Authentik, Keycloak, Authelia, Pocket ID, Zitadel, Google, …) einen **OIDC-Client** anlegen:

- **Redirect-URI:** `${BASE_URL}/auth/callback`, z. B. `http://magicmirror.local:8080/auth/callback`
- **Post-Logout-Redirect:** `${BASE_URL}/`
- Scopes: `openid profile email` (für Gruppen ggf. `groups`)
- Vertraulicher Client mit Secret – oder öffentlicher Client (dann `OIDC_CLIENT_SECRET` leer lassen, PKCE wird genutzt)

In `.env`:

```env
BASE_URL=http://magicmirror.local:8080
OIDC_ISSUER_URL=https://auth.example.com/application/o/magicmirror/
OIDC_CLIENT_ID=magicmirror
OIDC_CLIENT_SECRET=…
# optional: nur bestimmte Benutzer/Gruppen
OIDC_ALLOWED_EMAILS=ich@example.com
OIDC_ALLOWED_GROUPS=mirror-admins
```

Ohne OIDC-Konfiguration ist das Admin-Panel gesperrt – der Spiegel selbst läuft trotzdem. Manche Provider erlauben Redirect-URIs nur mit `https://`; dann den Mirror hinter einen Reverse-Proxy (Caddy, Traefik, nginx) stellen und `TRUST_PROXY=true` setzen.

## Raspberry Pi 3 als Spiegel

1. **Raspberry Pi OS (Bookworm)** mit Desktop installieren, Docker installieren:
   ```bash
   curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER
   ```
2. Projekt wie oben starten.
3. **Kiosk-Modus:** `~/.config/labwc/autostart` (Wayland) anlegen:
   ```bash
   chromium-browser --kiosk --noerrdialogs --disable-infobars --incognito \
     --check-for-update-interval=31536000 --disable-features=Translate \
     http://localhost:8080
   ```
4. Bildschirmschoner aus: `sudo raspi-config` → *Display Options* → *Screen Blanking* → *No*.
5. Hochformat: im Admin-Panel unter *Allgemein → Bildschirm drehen* (oder per `wlr-randr`).

**Tipps für den Pi 3 (1 GB RAM):** Kamera im Modus *Standbild* betreiben (Live-Video dekodiert der Pi 3 nur mit kleinen Substreams flüssig), Flugzeug-Aktualisierung auf ≥ 5 s, nicht zu viele Module pro Seite. Der Server selbst braucht ca. 60 MB RAM.

Der Spiegel kann auch auf einem anderen Rechner laufen – dann ruft der Pi einfach `http://<server>:8080` im Kiosk-Browser auf.

## Optionale Dienste

Über `COMPOSE_PROFILES` in `.env` (kommagetrennt):

| Profil | Dienst | Zweck |
|---|---|---|
| `camera` | [go2rtc](https://github.com/AlexxIT/go2rtc) | RTSP-Kameras → Browser (Streams werden automatisch aus dem Admin-Panel angelegt) |
| `adsb` | [ultrafeeder](https://github.com/sdr-enthusiasts/docker-adsb-ultrafeeder) | eigener ADS-B-Empfänger mit RTL-SDR-USB-Stick, tar1090 auf Port 8090 |
| `fr24` | [fr24feed](https://github.com/sdr-enthusiasts/docker-flightradar24) + ultrafeeder | Daten zusätzlich an **Flightradar24** senden |

```env
COMPOSE_PROFILES=camera,adsb,fr24
```

### Kameras

Profil `camera` aktivieren, im Admin-Panel ein Modul *Kamera (RTSP)* anlegen und die RTSP-URL eintragen (z. B. `rtsp://user:pass@192.168.1.20:554/stream2`). Der Mirror-Server registriert die Streams bei go2rtc und leitet Bild/Video durch – go2rtc selbst ist nicht von außen erreichbar und Zugangsdaten werden nicht an den Browser gegeben. Jede go2rtc-Quelle funktioniert, z. B. auch `ffmpeg:…`- oder `onvif://`-Quellen.

### Eigener ADS-B-Empfänger (USB-Stick)

Ja, das läuft direkt in Docker auf dem Pi 3. Benötigt wird ein RTL-SDR-Stick (z. B. FlightAware Pro Stick) mit 1090-MHz-Antenne.

1. DVB-Treiber auf dem Host sperren, damit Docker den Stick nutzen kann:
   ```bash
   echo -e "blacklist dvb_usb_rtl28xxu\nblacklist rtl2832\nblacklist rtl2830" | sudo tee /etc/modprobe.d/blacklist-rtlsdr.conf
   sudo reboot
   ```
2. In `.env`: `COMPOSE_PROFILES=adsb`, `ADSB_LAT`, `ADSB_LON`, `ADSB_ALT` (Antennenhöhe, z. B. `120m`).
3. `docker compose up -d` – die Weboberfläche tar1090 läuft auf `http://<pi>:8090`.
4. Im Admin-Panel beim Modul *Flugzeug-Karte* die Datenquelle *Eigener ADS-B-Empfänger* wählen (URL `http://ultrafeeder/data/aircraft.json` ist vorbelegt).

Weitere Netzwerke (adsb.lol, adsb.fi, airplanes.live …) lassen sich über `ULTRAFEEDER_CONFIG` zusätzlich beliefern.

### An Flightradar24 senden

1. Sharing-Key holen (einmalig, interaktiv):
   ```bash
   docker run --rm -it --entrypoint fr24feed ghcr.io/sdr-enthusiasts/docker-flightradar24:latest --signup
   ```
   Details: [docker-flightradar24](https://github.com/sdr-enthusiasts/docker-flightradar24#obtaining-a-flightradar24-sharing-key)
2. In `.env`: `FR24_SHARING_KEY=…` und `COMPOSE_PROFILES=fr24` (startet ultrafeeder automatisch mit).
3. Status: `http://<pi>:8754`. Als Dankeschön gibt es einen kostenlosen FR24-Business-Account.

## ÖPNV

Im Modul *ÖPNV-Abfahrten* den Verkehrsverbund wählen und die Haltestelle über die Suche auswählen. Vorbelegt sind VVS, bwegt/NVBW (ganz BW), MVV, bahnland bayern, VGN und VRR; jeder andere EFA-Server kann als eigene URL eingetragen werden. Alternativ funktioniert jede HAFAS-REST-API im Format von [db-rest](https://github.com/public-transport/db-rest) (`/locations`, `/stops/:id/departures`).

## Müllkalender

Die meisten Entsorger bieten einen iCal-Export bzw. Abo-Link an (oft unter „Abfuhrkalender → Kalender exportieren“). URL eintragen – die Termine werden über Suchbegriffe den Müllarten zugeordnet (Farben und Begriffe sind anpassbar). Ohne iCal können feste Intervalle (z. B. „Restmüll alle 2 Wochen ab …“) angelegt werden.

## Entwicklung

```bash
# inkl. Test-OIDC-Server (beliebiger Benutzername) und Live-Reload der Quellen
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile camera up --build
npm test
```

Aufbau:

```
src/server.js            Express-Server, Routen, SSE
src/auth.js              OIDC (express-openid-connect), Zugriffsprüfung
src/config.js            Konfiguration in /data/config.json
src/go2rtc.js            Kamera-Sync & Proxy
src/providers/*.js       Datenquellen (Wetter, Kalender, Müll, F1, ÖPNV, Flüge)
public/shared/modules.js Modul-Schema – Grundlage für Defaults, Validierung und Admin-Formulare
public/mirror/           Spiegel-Oberfläche
public/admin/            Admin-Panel
```

Ein neues Modul braucht nur einen Eintrag in `public/shared/modules.js` (Felder → Admin-Formular entsteht automatisch), einen Renderer in `public/mirror/renderers.js` und optional einen Provider in `src/providers/`.

## Lizenz

MIT

// Service status from an Uptime Kuma status page (fromKuma() in src/providers/status.js).
import { iso, addMin, LONG } from './index.js';

const HISTORY = 30;
const hist = (pattern) => Array.from({ length: HISTORY }, (_, i) => pattern(i));

export default ({ now, long }) => {
  const ago = (m) => iso(addMin(now, -m));
  const svc = (key, name, status, latency, extra = {}) => ({
    key, name, group: 'Zuhause', status, latency, message: null, since: null, uptime: 1, history: hist(() => 'up'), ...extra,
  });
  const services = [
    svc('1', 'Home Assistant', 'up', 12),
    svc('2', 'Nextcloud', 'up', 184, { uptime: 0.9986, history: hist((i) => (i === 11 ? 'down' : 'up')) }),
    svc('3', 'Pi-hole', 'up', 3),
    svc('4', 'Jellyfin', 'degraded', 1240, { message: 'Antwortzeit über 1000 ms', since: ago(23), uptime: 0.9712, history: hist((i) => (i >= 26 ? 'degraded' : 'up')) }),
    svc('5', 'Paperless-ngx', 'down', null, { message: 'connect ECONNREFUSED 192.168.178.40:8000', since: ago(47), uptime: 0.9531, history: hist((i) => (i >= 25 ? 'down' : i === 8 ? 'pending' : 'up')) }),
    svc('6', 'Vaultwarden', 'up', 41),
    svc('7', 'Immich', 'maintenance', null, { since: ago(15), uptime: 0.9999, history: hist((i) => (i >= 28 ? 'maintenance' : 'up')) }),
  ];
  const incidents = [
    { title: 'Paperless startet nach dem Update nicht', status: 'down', since: ago(45) },
    { title: 'NAS-Festplattentausch (Immich offline)', status: 'maintenance', since: null },
  ];
  if (long) {
    const more = [
      ['Mosquitto MQTT-Broker', 8], ['Zigbee2MQTT', 15], ['Node-RED', 22], ['Grafana', 96], ['InfluxDB', 31], ['Frigate NVR', 412],
      ['Gitea', 58], ['Uptime Kuma', 2], ['Traefik Reverse Proxy', 5], ['AdGuard Home', 4], ['Syncthing', 27], ['Audiobookshelf', 120],
      [`${LONG} Dienst`, 98765], ['Nginx Proxy Manager (externer Zugang über DynDNS)', 77],
    ];
    more.forEach(([name, ms], i) => services.push(svc(String(10 + i), name, 'up', ms, { history: hist((j) => (j % 9 === i % 9 && i % 3 === 0 ? 'degraded' : 'up')) })));
    services.push(svc('30', 'Fritz!Box Fernzugang über MyFRITZ! und WireGuard-VPN', 'down', null, { message: `Request failed with status code 503 – ${LONG}`, since: ago(60 * 26), uptime: 0.8123, history: hist((i) => (i > 3 ? 'down' : 'up')) }));
    incidents.push({ title: `Geplante Wartung des Glasfaseranschlusses durch die Leipziger Stadtwerke – ${LONG}`, status: 'degraded', since: ago(300) });
  }
  const problems = services.filter((x) => x.status === 'down' || x.status === 'degraded').length;
  return { title: 'Heimserver', services, incidents, problems, total: services.length };
};

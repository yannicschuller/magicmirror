// Server-Sent Events: pushes config changes and remote commands to all mirrors.
import { VERSION } from './version.js';

const clients = new Set();

export function sseHandler(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 5000\n\n');
  // Mirrors reload themselves when they reconnect to a newer server (auto-update).
  res.write(`event: hello\ndata: ${JSON.stringify({ version: VERSION })}\n\n`);
  clients.add(res);
  req.on('close', () => clients.delete(res));
}

export function broadcast(event, data = {}) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}

export function clientCount() {
  return clients.size;
}

setInterval(() => {
  for (const res of clients) res.write(': ping\n\n');
}, 25000).unref();

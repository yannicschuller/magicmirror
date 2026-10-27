import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The Express server (port 8080) serves the API, auth and shared assets.
const backend = process.env.MM_BACKEND || 'http://localhost:8080';
// Everything outside /admin/ (API, auth, login page, /brand, /vendor, /shared, /go2rtc and the
// mirror itself for the preview iframe) is forwarded to the server.

export default defineConfig({
  base: '/admin/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  server: {
    port: 5173,
    proxy: {
      '^/(?!admin(/|$))': { target: backend, ws: true },
    },
    fs: { allow: [path.resolve(import.meta.dirname, '..')] },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, '../public/admin'),
    emptyOutDir: true,
    // single-page admin: React + Radix in one ~170 kB (gzip) bundle is fine
    chunkSizeWarningLimit: 800,
  },
});

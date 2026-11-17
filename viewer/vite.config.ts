import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The read-only JSON API (src/api/server.mjs) binds 127.0.0.1:7731 by
// default. Override with VITE_API_TARGET when the API runs elsewhere on
// loopback; the proxy keeps the viewer same-origin so no CORS is needed.
const apiTarget = process.env.VITE_API_TARGET ?? 'http://127.0.0.1:7731';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false },
    },
  },
});

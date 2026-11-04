import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Same-origin in dev too: the browser talks to Vite, Vite forwards /api to Fastify.
    proxy: { '/api': { target: 'http://localhost:8080', changeOrigin: false } },
  },
});

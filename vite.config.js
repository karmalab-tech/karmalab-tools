import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Multi-page build: one HTML entry per tool. Routing stays on the backend
// (server/routes.js), so each tool ships only its own JS bundle. Shared React
// components live in src/shared and are imported by each tool.
//
// In dev, Vite serves the pages with HMR and proxies `/v1/...` straight to
// Replicate (server-to-server, so no browser CORS problem). In production,
// `vite build` emits to dist/ and the Node server serves it + the same proxy.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        index: 'index.html',
        prompt: 'prompt.html',
        video: 'video.html',
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/v1': {
        target: 'https://api.replicate.com',
        changeOrigin: true,
      },
    },
  },
});

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // MapLibre is by far the heaviest dep; load it as its own chunk.
          maplibre: ['maplibre-gl'],
          // Globe libs in their own chunk (world-atlas is a JSON import,
          // not a resolvable package entry, so it's not listed here).
          globe: ['d3-geo', 'topojson-client'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Dev-only: forward API calls to the local NestJS instance.
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});

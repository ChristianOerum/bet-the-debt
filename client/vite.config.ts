import { defineConfig } from 'vite';

// In development the website runs on 5173 and forwards game traffic to the server on 3000.
export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/socket.io': { target: 'http://127.0.0.1:3000', ws: true },
    },
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1500 },
});

import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:5001/otokichi-app/asia-northeast1/api',
        rewrite: (path) => path,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});

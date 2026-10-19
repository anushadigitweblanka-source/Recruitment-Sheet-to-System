import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  test: {
    setupFiles: ['./tests/setup.js'],
    testTimeout: 20000,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    // In development, API calls go through Vite to the backend, so the
    // frontend always calls /api/... and never needs the backend's address.
    proxy: {
      '/api': 'http://127.0.0.1:3000',
    },
  },
});

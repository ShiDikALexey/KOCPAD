import { defineConfig } from 'vite';

// Tauri expects a fixed port and a plain SPA build.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  clearScreen: false,
  base: './',
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    watch: {
      ignored: [
        '**/src-tauri/**',
        '**/.tmp/**',
        '**/test-results/**',
        '**/playwright-report/**',
        '**/dist/**',
      ],
    },
  },
  build: {
    target: 'chrome120',
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
});

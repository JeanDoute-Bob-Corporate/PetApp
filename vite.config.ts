import { defineConfig } from 'vite';

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    // WebView2 est un Chromium récent : pas de polyfills ni de transpilation lourde.
    target: 'es2022',
    minify: 'esbuild',
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
    outDir: 'dist',
    emptyOutDir: true,
  },
});

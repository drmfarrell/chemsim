import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { resolve } from 'path';

// Dev & preview serve HTTPS with a self-signed cert so non-localhost IP
// hosts (e.g. http://10.x.y.z:3000) become "secure contexts". Without a
// secure context the browser disables SharedArrayBuffer and service
// workers, which means crossOriginIsolated stays false and wasm threads
// never initialise — silently downgrading every parallel code path to
// serial. First visit triggers a "your connection is not private" warning;
// click Advanced -> Proceed (the cert is trusted only for that host, no
// real cert-authority involvement).
export default defineConfig({
  plugins: [
    wasm(),
    basicSsl(),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    // Cross-origin isolation: required for SharedArrayBuffer, which
    // wasm-bindgen-rayon uses to share wasm memory across its worker threads.
    // Without these headers `crossOriginIsolated` is false and the parallel
    // path falls back to single-threaded.
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  optimizeDeps: {
    exclude: ['chemsim-physics'],
  },
});

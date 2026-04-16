import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    wasm(),
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

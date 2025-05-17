// example/vite.config.ts
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: __dirname,
  server: {
    open: true,
  },
  resolve: {
    alias: {
      // Option A: Use built library
      //'frame-ble': path.resolve(__dirname, '../dist/frame-ble.es.js'),

      // Option B Use source code instead of built bundle
      'frame-ble': path.resolve(__dirname, '../src/index.ts'),
    },
  },
});

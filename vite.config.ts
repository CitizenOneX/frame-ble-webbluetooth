import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'frame-ble',
      fileName: (format) => `frame-ble.${format}.js`,
      formats: ['umd', 'es'],
    },
    outDir: 'dist',
  },
  plugins: [dts()],
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dts from 'vite-plugin-dts';
import { resolve } from 'node:path';

// Library build: emits an ESM bundle + a single CSS file + .d.ts types into
// dist/. React/ReactDOM/three are externalized so consumers (and the
// design-sync bundler) provide them. The single CSS file is the style closure
// design-sync uploads.
export default defineConfig({
  plugins: [
    react(),
    dts({ insertTypesEntry: true, include: ['src'] })
  ],
  build: {
    cssCodeSplit: false,
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'MundialUI',
      formats: ['es'],
      fileName: () => 'mundial-ui.js'
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime', 'three'],
      output: {
        assetFileNames: (asset) =>
          asset.name === 'style.css' ? 'mundial-ui.css' : (asset.name ?? 'asset')
      }
    }
  }
});

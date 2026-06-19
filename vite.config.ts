import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
    hmr: process.env.DISABLE_HMR !== 'true',
    watch: process.env.DISABLE_HMR === 'true' ? null : {},
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        npcr: path.resolve(__dirname, 'npcr.html'),
        molitva: path.resolve(__dirname, 'molitva.html'),
        opros: path.resolve(__dirname, 'opros.html'),
        pamyatki: path.resolve(__dirname, 'pamyatki.html'),
        survey: path.resolve(__dirname, '222222.html'),
        styles_analyze: path.resolve(__dirname, 'styles-analyze.html'),
      }
    }
  }
});

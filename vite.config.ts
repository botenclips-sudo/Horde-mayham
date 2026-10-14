import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `--mode single` inlines everything into one HTML file (handy for sharing a playable build).
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  define: { __PWA__: JSON.stringify(mode !== 'single') },
  build: { outDir: mode === 'single' ? 'dist-single' : 'dist' },
}));

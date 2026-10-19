import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works on GitHub Pages sub-paths.
  base: './',
  server: { host: true, port: 5173 },
  build: {
    chunkSizeWarningLimit: 2000,
  },
});

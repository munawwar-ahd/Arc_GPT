import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  const envPath = path.resolve(__dirname, '.env.production');

  let backendUrl = '';

  if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, 'utf8');

    const line = envFile
      .split(/\r?\n/)
      .find((line) => line.trim().startsWith('VITE_BACKEND_URL='));

    if (line) {
      backendUrl = line
        .substring(line.indexOf('=') + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
    }
  }

  console.log('[ArcGPT] Backend URL:', backendUrl);

  /**
   * Public base path for built asset URLs.
   *
   * The default is '/', which is what the ArcGPT backend expects: it mounts
   * `dist/` at the root and answers every other path with index.html. A base of
   * '/Arc_GPT/' emits asset URLs like /Arc_GPT/assets/index.js, which Express
   * does not serve -- the SPA fallback returns index.html for them, the browser
   * gets HTML where it expected JavaScript, and the app renders blank.
   *
   * That sub-path is only correct for the GitHub Pages deployment, where the
   * site is served from https://<user>.github.io/Arc_GPT/. Set VITE_BASE_PATH
   * to use it, e.g.
   *
   *   $env:VITE_BASE_PATH='/Arc_GPT/'; npm run build
   *
   * Leave it unset for local and single-origin use.
   */
  const base = process.env.VITE_BASE_PATH?.trim() || '/';

  console.log('[ArcGPT] Base path:', base);

  return {
    base,

    plugins: [
      react(),
      tailwindcss(),
    ],

    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },

    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},

      port: 5173,
      strictPort: true,

      proxy: {
        '/api': {
          target:
            process.env.VITE_DEV_PROXY_TARGET ||
            'http://localhost:3000',
          changeOrigin: false,
        },
      },
    },

    define: {
      __ARCGPT_BACKEND_URL__: JSON.stringify(backendUrl),
    },
  };
});
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},

      /**
       * Dev server for split development: `npm run dev` here runs Vite on 5173
       * with hot reload while the API runs separately on 3000.
       *
       * The proxy is what makes this safe. The browser only ever talks to
       * 5173, so the `sameSite: 'strict'` session cookie the API sets is
       * first-party for the page and comes back on every call. A *direct*
       * cross-origin call from 5173 to 3000 would not work — avoiding that is
       * the entire reason this proxy exists.
       *
       * Configure the backend with `SERVE_FRONTEND=false` when running this
       * way. In the normal single-origin setup the backend serves the built or
       * middleware-mounted bundle itself and this proxy simply goes unused.
       */
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: process.env.VITE_DEV_PROXY_TARGET || 'http://localhost:3000',
          changeOrigin: false,
        },
      },
    },
  };
});

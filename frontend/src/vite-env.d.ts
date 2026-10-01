/**
 * Build-time constants injected by Vite.
 *
 * `__ARCGPT_BACKEND_URL__` is defined in `vite.config.ts` via `define`, which
 * replaces the identifier in the bundle with a string literal at build time. It
 * therefore has no runtime source and no `import.meta.env` entry to infer it
 * from — it is declared here so the only module that reads it type-checks.
 *
 * The value comes from `VITE_BACKEND_URL` in `.env.production`, defaulting to an
 * empty string. Empty means same-origin, which is the normal deployment: the
 * ArcGPT backend serves this bundle and the API from one origin so its
 * `sameSite: 'strict'` session cookie is always presented.
 */
declare const __ARCGPT_BACKEND_URL__: string;

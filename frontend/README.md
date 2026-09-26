# ArcGPT — Frontend

The ArcGPT user interface. This package is a **static browser bundle**: it has no
server, no database access and no secrets. All LLM, database and authentication
work happens in [`../backend`](../backend).

## Layout

```text
public/arc, public/brand   animations, brand marks, favicons
src/user/                  the ArcGPT chat surface
  UserChat.tsx             threads, send flow, generation animation
  ChatSidebar.tsx          chat-history sidebar
  LiquidMetalSendButton.tsx
  MarkdownMessage.tsx
  ArcVideo.tsx
  user.css                 black + gold theme
src/components/            admin panel and dashboards (served at /admin)
src/lib/apiClient.ts       the only place a backend URL appears
src/data/demoUsers.ts      display list for the admin persona picker
```

`src/lib/apiClient.ts` is the seam between the UI and the backend. It owns
`VITE_BACKEND_URL`, attaches the HTTP-only session cookie, retries once on a
401 so the development bootstrap session can take effect, and normalises the
backend's status vocabulary. Components do none of that themselves.

## Commands

```bash
npm run build     # production bundle into dist/
npm run preview   # serve the built bundle
npm run lint      # tsc --noEmit
```

There is no `dev` script here. In development the Express server runs Vite in
middleware mode against this directory, so `npm run dev` is run from
`../backend` and serves both the UI and the API on one origin.

## Configuration

`VITE_BACKEND_URL` — see `.env.example`. Leave it unset for the normal
same-origin setup. Anything prefixed `VITE_` is inlined into the public bundle
at build time, so it must never contain a secret.

See the [root README](../README.md) for the full setup, including PostgreSQL and
Ollama.

# ArcGPT

Natural-language questions over an institutional PostgreSQL database, answered by a
local LLM through a read-only, validated query pipeline.

This repository is the merge of two projects:

- **`frontend/`** — the ArcGPT user interface. Kept exactly as designed.
- **`backend/`** — the LLM, database, validation and authentication services.

Project 2's original frontend and Project 1's original backend were both removed;
neither is part of this application.

---

## Architecture

```text
Browser
  │  ArcGPT chat UI  (frontend/, src/user/*)
  │  landing · history sidebar · liquid-metal send button
  │  generation animation · black + gold theme
  ↓  same origin, HTTP-only session cookie
Express  (backend/server.ts)
  ├── /api/query/translate        natural-language question → SQL → rows
  ├── /api/conversations          history sidebar data source
  ├── /api/auth/*                 local login, sessions
  └── /api/admin/*, /api/stats …  admin panel + dashboards
  ↓
  ├── Ollama            qwen2.5-coder-7b-instruct  (structured SQL)
  ├── SQL validation    read-only, single-statement, whitelisted tables
  └── PostgreSQL        arcgpt_institution, read-only pool
```

The browser never touches the database, and no credential, API key or backend
secret is present in the frontend bundle.

### Why one origin

`backend/server.ts` serves the frontend itself — Vite in middleware mode in
development, `frontend/dist` in production. This is not a convenience. The
session cookie is `sameSite: 'strict'`, so a frontend served from a different
port would never present it and every API call would return 401.

---

## Running it

### Prerequisites

- Node.js 20+
- PostgreSQL 14+
- Ollama with the configured model

### 1. Backend

```bash
cd backend
npm ci
cp .env.example .env      # then edit it — see below
```

`.env` needs real local values. At minimum change `DB_PASSWORD` and
`SESSION_SECRET`, and set `LOCAL_ADMIN_PASSWORD` to something other than the
example placeholder. That account is created on first run and is the identity
the chat uses.

### 2. Database

```powershell
createdb -U postgres arcgpt_institution
# institution schema and seed data first
psql -h localhost -U postgres -d arcgpt_institution -f src/migration/sql/institution.sql
psql -h localhost -U postgres -d arcgpt_institution -f src/migration/sql/seed_institution.sql
# then ArcGPT's control tables, then the student expansion
psql -h localhost -U postgres -d arcgpt_institution -f src/migration/sql/file1.sql
psql -h localhost -U postgres -d arcgpt_institution -f src/migration/sql/file2_student_expansion.sql
psql -h localhost -U postgres -d arcgpt_institution -f src/migration/sql/seed_student_expansion.sql
```

`file1.sql` creates ArcGPT's own control tables (users, sessions, queries,
conversations, messages, audit and security logs). It does not create the
institution tables.

`file2_student_expansion.sql` and `seed_student_expansion.sql` add the guardian,
residency and student-profile model and expand the dataset. Both are idempotent
and transactional. Configure the seed in the `seed_config` block at the top of the
seed file: `students_per_department`, `day_scholar_percentage`,
`hosteller_percentage`. It has been run to give 50 active students in each of the
6 departments (300 total). Verify with:

```powershell
psql -h localhost -U postgres -d arcgpt_institution -f src/migration/sql/verify_student_expansion.sql
```

Optionally enable the dedicated read-only role so that `SELECT` statements cannot
reach control tables:

```sql
ALTER ROLE arcgpt_reader LOGIN PASSWORD 'use-a-local-secret';
GRANT CONNECT ON DATABASE arcgpt_institution TO arcgpt_reader;
```

Then set `DB_READONLY_USER` / `DB_READONLY_PASSWORD` in `.env`. `file1.sql` grants
it `SELECT` on approved institution tables only; `file2` extends that grant to
the new tables and to `student_profile_view`. The view needs its own grant
because a PostgreSQL view does not inherit the privileges of the tables it
reads — without it every profile query fails with `permission denied for view`.

### 3. AI engine

```powershell
ollama serve
ollama pull qwen2.5-coder-7b-instruct
```

### 4. Start

```bash
cd backend
npm run dev              # development
npm run build && npm start   # production
```

Open <http://localhost:3000>. The chat is at `/`; the admin panel is at `/admin`.

---

## Frontend configuration

`frontend/.env` is optional and should normally stay empty.

`VITE_BACKEND_URL` exists only for the case where the frontend is deployed
separately from the API. Left unset, requests are same-origin. Anything prefixed
`VITE_` is inlined into the public bundle at build time and is therefore public —
never put a secret in it. All backend configuration lives in `backend/.env`.

---

## The development auto-session

The chat screen has no login form, by design. The API is nevertheless
session-gated, which would leave a first-time visitor with a 401 on their first
message.

In development only, a request arriving without a valid session cookie is
given a session for the `LOCAL_ADMIN` account, so the chat works on first load
without altering the interface. The credentials are read from `LOCAL_ADMIN_*` on
the server; the browser only ever receives the HTTP-only cookie.

It is **unconditionally disabled when `NODE_ENV=production`**, and can be turned
off locally with `LOCAL_AUTO_SESSION=false`. See `server.ts`
(`allowBootstrapSession`) and `auth.service.ts` (`loginAsBootstrapUser`).

---

## Layout

```text
ArcGPT/
├── frontend/                    Project 1 — the UI, kept
│   ├── public/arc, public/brand animations, favicons
│   └── src/
│       ├── user/                the ArcGPT chat surface
│       │   UserChat.tsx         threads, send flow, generation animation
│       │   ChatSidebar.tsx      history sidebar
│       │   LiquidMetalSendButton.tsx
│       │   user.css             black + gold theme
│       ├── components/          admin panel and dashboards
│       ├── lib/apiClient.ts     the only place a backend URL appears
│       └── data/demoUsers.ts    display list for the admin persona picker
└── backend/                     Project 2 — the brain
    ├── server.ts                API, sessions, static hosting
    ├── src/server/              ai · db · schema · sql-generation
    │                            sql-validation · auth · audit · import …
    ├── src/migration/sql/       control tables + institution schema
    ├── tests/
    └── scripts/
```

---

## Checks

```bash
cd backend && npm run lint && npm test
cd frontend && npm run lint && npm run build
```

`npm test` covers the SQL guardrails and runs without PostgreSQL.
`npm run test:integration` needs both PostgreSQL and Ollama running.

---

## Notes

- A conversation restored from history shows the stored transcript text. Result
  tables are not stored, so a restored answer has no rows beneath it until the
  question is asked again.
- `GET /api/health` reports the live state of Express, PostgreSQL and Ollama.
  When Ollama is down the API says so explicitly and generates no fallback SQL;
  it never queries the database with a guess.

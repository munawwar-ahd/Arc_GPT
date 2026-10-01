# ArcGPT — Backend

The Express API, the LLM provider layer, the SQL query pipeline, the PostgreSQL
access layer, local authentication, and the static host for the ArcGPT frontend.

This package also **serves the frontend** (`../frontend`) so that both share one
origin. The session cookie is `sameSite: 'strict'`, so a separately-hosted
frontend would never present it and every API call would 401.

See the [root README](../README.md) for the full setup and the architecture
diagram.

## Layout

```text
server.ts                     API, sessions, model API, conversation routes, hosting
src/server/
  llm/
    types.ts                  the provider contract
    ollama.provider.ts        Ollama (default engine)
    lmstudio.provider.ts      LM Studio, with runtime model-id detection
    structured-output.ts      tolerant JSON parsing, strict shape check
    index.ts                  the router: catalogue, selection, generateSql
  sql-prompt.service.ts       schema briefing and prompt construction
  sql-generation.service.ts   the seven-step pipeline
  sql-validation.service.ts   read-only guardrails
  result-interpreter.service.ts  conversational answers
  schema.service.ts           declared schema + live introspection + relevance
  db.ts                       admin and read-only pools, database safety guard
  auth.service.ts             auth · audit · department · student · import · permissions
src/migration/sql/            legacy migrations for another project's database
tests/                        security, provider, answer and injection tests
scripts/                      database setup helpers
```

## Architecture

```text
User
  ↓
React / Vite
  ↓ HTTP-only session cookie
Express API
  ├── model router  (src/server/llm)
  │     ├── Ollama at 127.0.0.1:11434  →  qwen2.5-coder:7b
  │     └── LM Studio at localhost:1234/v1  →  detected Qwen3-Coder id
  │           ↓
  │       structured SQL response
  ├── schema retrieval and prompt construction
  ├── SQL validation, read-only
  ├── logging and conversation persistence
  ↓
Local PostgreSQL: arcgpt_new, via arcgpt_new_reader
  ↓
Real institution rows
  ↓
Deterministic result interpretation
  ↓
Conversational answer + result table in the React UI
```

No React code imports `pg` or connects to PostgreSQL. No browser code requires a
database URL, Supabase key, cloud AI key, or external API.

## The provider layer

A provider receives a prompt and returns a string. It never sees a database
connection, a validator, a role, or a result set — which is what makes model
switching a display concern rather than a security one.

```ts
interface LlmProvider {
  readonly id: 'ollama' | 'lmstudio';
  readonly baseUrl: string;
  readonly configuredModel: string;
  describe(): Promise<LlmModelDescriptor>;          // live availability
  generateSql(model: string, request: LlmSqlRequest): Promise<LlmSqlResponse>;
}
```

The router is provider-agnostic, as the pipeline sees it:

```ts
generateSql({ provider, model, userQuestion, databaseSchema })
```

`src/server/ai.ts` remains as a thin back-compatible facade over the Ollama
provider, so `/api/health` and the integration test are unchanged.

Failures are typed (`LlmProviderError`) with a reason of `unavailable`,
`model_not_loaded`, `timeout`, `malformed_output` or `request_failed`, so the
pipeline can turn each into an actionable message. Provider error details are
safe by construction: they name the engine and what to do, and never carry a
URL, a port, a stack trace or a credential.

## Prerequisites

- Node.js 20 or newer
- PostgreSQL 14 or newer
- Ollama with `qwen2.5-coder:7b` installed
- LM Studio, only if you want the second model
- `psql` or another PostgreSQL administration client

The institution schema and seed data must already exist in `arcgpt_new`. See
`../database/README.md`.

## Database setup

```powershell
powershell -ExecutionPolicy Bypass -File ..\database\run_all.ps1 -Reset
```

`11_permissions.sql` creates the two runtime roles and needs a **superuser**
connection; the runner defaults to `-DbUser postgres`.

| Role | Pool | Can do |
| --- | --- | --- |
| `arcgpt_user` | `DB_USER` | Auth, sessions, conversations, query log, audit, CSV import. Reads every institution table and view. Writes only the control tables. Not a superuser. |
| `arcgpt_new_reader` | `DB_READONLY_USER` | **The only role generated SQL ever runs as.** `SELECT` on institution tables and views; no privilege at all on the control tables. |

`src/migration/sql/` holds legacy migrations for `arcgpt_institution`, another
project's database. They are unused, and `assertArcgptDatabase()` makes the
process refuse to start if `DB_NAME` is ever pointed at it.

## Environment

Copy `.env.example` to `.env` and set local values. Never put real credentials in
`.env.example` or commit `.env`.

```text
LLM_PROVIDER=ollama
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5-coder:7b
LMSTUDIO_BASE_URL=http://127.0.0.1:1234/v1
LMSTUDIO_MODEL=qwen3-coder-30b-a3b-instruct

SERVER_PORT=3000
SESSION_SECRET=...
LOCAL_ADMIN_EMAIL=admin@institution.edu
LOCAL_ADMIN_PASSWORD=...
```

`LOCAL_ADMIN_EMAIL` and `LOCAL_ADMIN_PASSWORD` are the first-run bootstrap
administrator. The password is bcrypt-hashed before insertion into
`arcgpt_users` and is never returned to the browser.

## AI engine setup

Ollama, which is the default:

```powershell
ollama serve
ollama pull qwen2.5-coder:7b
```

LM Studio, for the second model: load **Qwen3-Coder 30B A3B Instruct** in the
app, then **Developer → Start Server**. ArcGPT reads the model id from
`GET /v1/models`; it is never guessed. See the root README.

**On a single small GPU the two models cannot both stay resident.** LM Studio's
30B leaves roughly 1.3 GB free on a 6 GB card, which is not enough for the 7B, so
switching means unloading the model you are not using. ArcGPT detects the
resulting server error and reports it as a memory problem rather than telling
you to start a server that is already running.

ArcGPT does not download models automatically. If a provider is stopped, the
model is absent, or there is no memory for it, the API returns an explicit
message and does not generate fallback SQL or query the database.

## Run ArcGPT

```powershell
npm ci
npm run dev        # Vite middleware + Express, UI and API on port 3000
npm run build      # builds ../frontend into ../frontend/dist
npm start          # production
```

Open `http://localhost:3000`.

## API behavior

- `GET /api/health` — Express, PostgreSQL, and per-provider model availability.
- `GET /api/models` — the model catalogue with live `available` flags. Excludes
  endpoint addresses and credentials.
- `GET /api/debug/database` — administrators only, never in production.
- `POST /api/query` and `/api/query/translate` — accept `question` and an
  optional `model`. Raw `sql` in the body is rejected with 400.
- Query results distinguish `SUCCESS`, `EMPTY`, `ERROR`, `BLOCKED`,
  `NOT_AVAILABLE`, `ACCESS_DENIED`, `UNSUPPORTED` and `UNAUTHORIZED`.
- Every successful response carries `model` (id, name, provider) and
  `resultDigest`, which the client forwards to resolve follow-up questions.
- Query history, saved queries, feedback, conversations, audit logs and
  security events are stored in local PostgreSQL.

## SQL and privacy controls

- natural-language gate for destructive verbs, pasted SQL, system catalogs and
  protected tables, applied before the model is involved;
- one-statement read-only validation with `pgsql-ast-parser`;
- DDL/DML, stacked statement, comment, system-catalog, sensitive-column and
  unknown-table blocking;
- per-role authorization, including a structural proof of department scope for
  an HOD;
- query complexity limits and a clamped `LIMIT`;
- a single repair attempt for a wrong column or table name, in which the
  corrected statement is re-validated by the same validator and must retain
  every literal the original filtered on;
- PostgreSQL read-only transactions and statement timeouts on a dedicated
  reader role;
- backend role authorization independent of frontend navigation;
- HTTP-only session cookies and server-side password hashes;
- Helmet headers, CORS restrictions, rate limiting, request-size limits, and
  structured safe logs.

Supported institutional roles include `ADMIN`, `PRINCIPAL`, `HOD`, `FACULTY`,
`STUDENT`, `ACCOUNTS`, `PLACEMENT_OFFICER` and `LIBRARIAN`. Department and
student scope is enforced on the backend; client-side role checks are only
presentation controls.

## Verification

```powershell
npm run lint
npm test
npm run test:integration   # needs PostgreSQL + Ollama
npm run test:e2e           # needs PostgreSQL + at least one model server
```

`npm test` needs nothing running. See the root README for the suite table.

Verify these questions after signing in:

1. `Show all AIML students.`
2. `Show students with attendance below 75%.`
3. `What is the CGPA of AIML32022A07?`
4. `What was the GPA of AIML32022A07 in semester 2?`
5. `Show the IAT marks of AIML32022A07.`
6. `Which subjects does AIML32022A07 have a backlog in?`
7. `How much hostel fee is pending for AIML32022A07?`
8. `What class does AIML32022A07 have at 2 PM on Monday?`
9. `Who are the parents of AIML32022A07?`
10. `Which of them have backlogs?` — a follow-up over the previous result
11. `Delete all student records.`

The last request must be blocked and must not change PostgreSQL. Stopping
PostgreSQL must produce a database error; stopping a provider must produce that
provider's unavailable message without querying the database.

## Troubleshooting

- **PostgreSQL offline:** verify the service, host, port, database name and
  server-side password. Never put the password in React or a `VITE_*` variable.
- **`Refusing to start: DB_NAME is set to arcgpt_institution`:** that database
  belongs to another project. Point `DB_NAME` at `arcgpt_new`.
- **Ollama offline:** start Ollama, check `http://127.0.0.1:11434/api/tags`, and
  pull the exact configured model. `qwen2.5-coder-7b-instruct` does not exist in
  the registry; use `qwen2.5-coder:7b`.
- **LM Studio shows as unavailable:** the local server is not started, or has no
  model loaded. Open **Developer → Start Server** and load the model, then
  reload the app.
- **LM Studio reports an unexpected model id:** that is what the server
  reported. `LMSTUDIO_MODEL` is set to the exact id this machine serves;
  change it only to pin a different one.
- **"could not free enough memory to load …":** the other model holds the GPU.
  Unload it in LM Studio, or run `ollama stop`, then retry. Both providers stay
  selectable.
- **A 30B model is slow (40–90s per question):** expected on this hardware.
  Raise `LLM_REQUEST_TIMEOUT_MS` if you see a timeout instead.
- **"answered, but not in a form I could turn into a database query":** the
  server is running and answered, but not in the requested JSON structure. This
  is most often the model refusing or explaining itself instead of answering.
  Rephrase the question; do not restart the server, which is already up.
- **Production build renders a blank page:** `frontend/dist` must be referenced
  from the site root. If `VITE_BASE_PATH` is set to `/Arc_GPT/` the bundle's
  asset URLs do not resolve against the API server and the SPA fallback returns
  `index.html` for them. Leave `VITE_BASE_PATH` unset except for a GitHub Pages
  build, and rebuild after changing it.
- **The browser calls a dead `*.trycloudflare.com` address:** `VITE_BACKEND_URL`
  is set in `frontend/.env.production`. It is inlined into the public bundle at
  build time, so an ephemeral tunnel URL there outlives the tunnel. Empty it for
  same-origin use and rebuild.
- **"LM Studio returned status 400" repeatedly:** some builds reject
  `response_format`. ArcGPT already retries without it; a persistent 400 means
  the model itself cannot serve the request.
- **Permission denied for reader role:** apply `database/11_permissions.sql`
  as a superuser and confirm `DB_READONLY_USER` can log in.
- **A view is missing a column the prompt advertises:** re-apply the migration
  with a superuser, for example `psql -h localhost -U postgres -d arcgpt_new -f
  database/04_views.sql`. Each file's `current_database()` guard makes this
  safe.
- **Schema metadata says "declared" rather than "postgresql":** the database
  was reachable but the institution tables were not visible; check the active
  schema.
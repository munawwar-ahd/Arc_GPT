# ArcGPT — Backend

The Express API, the LLM query pipeline, the PostgreSQL access layer, local
authentication, and the static host for the ArcGPT frontend.

This package also **serves the frontend** (`../frontend`) so that both share one
origin. The session cookie is `sameSite: 'strict'`, so a separately-hosted
frontend would never present it and every API call would 401.

See the [root README](../README.md) for the full setup.

## Layout

```text
server.ts                     API, sessions, conversation routes, static hosting
src/server/                   ai · db · schema · sql-generation · sql-validation
                              auth · audit · department · student · import · permissions
src/migration/sql/            control tables + institution schema and seed
tests/                        security and SQL-validation tests
scripts/                      database setup helpers
```


## Architecture

```text
User
  ↓
React / Vite
  ↓ HTTP-only session cookie
Express API
  ├── Ollama at 127.0.0.1:11434
  │     ↓
  │   qwen2.5-coder-7b-instruct
  │     ↓
  │   structured SQL response
  ├── schema retrieval
  ├── authorization and SQL validation
  ├── logging and conversation persistence
  ↓
Local PostgreSQL: arcgpt_institution
  ↓
Real institution rows
  ↓
React ResultViewer, charts, CSV/PDF export
```

No React code imports `pg` or connects to PostgreSQL. No browser code requires a database URL, Supabase key, cloud AI key, or external API.

## Prerequisites

- Node.js 20 or newer
- PostgreSQL 14 or newer
- Ollama with the configured model installed
- `psql` or another PostgreSQL administration client

The institution schema and seed data must already exist in the local database. The repository migration creates ArcGPT's local control tables and the attendance view when the institution tables are present; it does not invent or replace the institution schema.

## Database setup

1. Start PostgreSQL.
2. Create the database without destroying an existing one:

```powershell
createdb -U postgres arcgpt_institution
```

3. Import the existing institution schema and seed data using the institution's original SQL/dump files.
4. Apply the ArcGPT control migration:

```powershell
$env:PGPASSWORD = "your-local-postgres-password"
psql -h localhost -U postgres -d arcgpt_institution -f src/migration/sql/file1.sql
```

The migration creates `arcgpt_users`, `arcgpt_sessions`, `ai_queries`, `saved_queries`, `ai_conversations`, `ai_messages`, `feedback`, `audit_logs`, `security_events`, `system_settings`, role/permission tables, indexes, and `student_attendance_percentage` when that view does not already exist.

### Read-only query role

The application uses `DB_USER` for migrations, authentication, health checks, and local logging. Query execution uses `DB_READONLY_USER` when configured.

After applying the migration, enable the dedicated role and set its password through a local secret-management step:

```sql
ALTER ROLE arcgpt_reader LOGIN PASSWORD 'use-a-local-secret';
GRANT CONNECT ON DATABASE arcgpt_institution TO arcgpt_reader;
```

The migration grants `SELECT` only on approved institution tables/views. It never grants control-table access to that role.

## Environment

Copy `.env.example` to `.env` and set local values. Never put real credentials in `.env.example` or commit `.env`.

Required server variables:

```text
DB_HOST=localhost
DB_PORT=5432
DB_NAME=arcgpt_institution
DB_USER=postgres
DB_PASSWORD=...
DB_READONLY_USER=arcgpt_reader
DB_READONLY_PASSWORD=...
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5-coder-7b-instruct
SERVER_PORT=3000
```

`LOCAL_ADMIN_EMAIL` and `LOCAL_ADMIN_PASSWORD` are an explicit first-run bootstrap option. The password is hashed with bcrypt before insertion into `arcgpt_users`; it is never returned to the browser. Remove the bootstrap variables after creating the account if desired.

## Ollama setup

Start Ollama and install the model before starting ArcGPT:

```powershell
ollama serve
ollama pull qwen2.5-coder-7b-instruct
```

ArcGPT does not download models automatically. If Ollama is stopped or the configured model is absent, the API returns an explicit unavailable response and does not generate fallback SQL or query the database.

## Run ArcGPT

Development, with Vite middleware and Express. Vite runs against `../frontend`,
so the UI and the API share port 3000:

```powershell
npm ci
npm run dev
```

Production build, then serve the built bundle:

```powershell
npm run build          # builds ../frontend into ../frontend/dist
$env:NODE_ENV = "production"
npm start
```

Open `http://localhost:3000`.

## API behavior

- `GET /api/health` checks Express, PostgreSQL with `SELECT 1`, and Ollama's local tags API.
- `GET /api/debug/database` is available only outside production and to administrators. It returns actual student count, department count, departments, and sample students.
- `POST /api/query` and `/api/query/translate` accept `question`, not raw `sql`.
- Query results distinguish `SUCCESS`, `EMPTY`, `ERROR`, `BLOCKED`, and `UNAUTHORIZED`.
- Query history, saved queries, feedback, conversations, audit logs, and security events are stored in local PostgreSQL.
- CSV and PDF exports use the rows returned by PostgreSQL.

## SQL and privacy controls

The controlled pipeline applies:

- one-statement read-only validation;
- DDL/DML, stacked statement, comment, system-catalog, sensitive-column, and unknown-table blocking;
- explicit-column checks instead of unbounded `SELECT *`;
- query complexity and result limits;
- PostgreSQL read-only transactions and statement timeouts;
- backend role authorization independent of frontend navigation;
- HTTP-only session cookies and server-side password hashes;
- Helmet headers, CORS restrictions, rate limiting, request-size limits, and structured safe logs.

Supported institutional roles include `ADMIN`, `PRINCIPAL`, `HOD`, `FACULTY`, `STUDENT`, `ACCOUNTS`, `PLACEMENT_OFFICER`, and `LIBRARIAN`. Department and student scope is enforced on the backend; client-side role checks are only presentation controls.

## Offline operation

After PostgreSQL, Ollama, the model, and ArcGPT are running, disconnect the network. The React bundle, Express API, Ollama inference, PostgreSQL queries, local authentication, history, saved queries, and exports continue to operate locally. The application does not call Supabase, OpenAI, Gemini, Anthropic, OpenRouter, or any external analytics or logging service.

## Verification

```powershell
npm run lint
npm test
npm run test:integration
```

The integration test requires PostgreSQL and Ollama. Verify these questions after signing in:

1. `How many students are there?`
2. `How many students are in each department?`
3. `Which AIML students have attendance below 75%?`
4. `What is the average CGPA of each department?`
5. `Which students have more than one active backlog?`
6. `Which faculty members teach Machine Learning?`
7. `Who has not submitted Assignment 1?`
8. `Delete all student records.`

The last request must be blocked and must not change PostgreSQL. Stopping PostgreSQL must produce a database error; stopping Ollama must produce the local AI unavailable message.

## Troubleshooting

- **PostgreSQL offline:** verify the service, host, port, database name, and server-side password. Never put the password in React or a `VITE_*` variable.
- **Ollama offline:** start Ollama, verify `http://127.0.0.1:11434/api/tags`, and pull the exact configured model.
- **Authentication unavailable:** apply `file1.sql`, set `LOCAL_ADMIN_*` for first-run bootstrap, and use a password of at least 12 characters for manually created users.
- **Permission denied for reader role:** apply the read-only grants in the migration and confirm `DB_READONLY_USER` can log in.
- **Missing relation or view:** verify the existing institution schema and seed data were imported before the ArcGPT migration. The application reports the database error and does not substitute empty or fake rows.
- **Schema metadata says declared rather than PostgreSQL:** the database was reachable but the institution tables were not visible; check the active schema and migration connection.

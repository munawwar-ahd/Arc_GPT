# ArcGPT

Natural-language questions over an institutional PostgreSQL database, answered by
a local LLM through a read-only, validated query pipeline.

This repository is the merge of two projects:

- **`frontend/`** — the ArcGPT user interface. Kept exactly as designed.
- **`backend/`** — the LLM, database, validation and authentication services.

Project 2's original frontend and Project 1's original backend were both removed;
neither is part of this application.

---

## Architecture

```text
                        USER
                         |
                         v
                ARCGPT FRONTEND  (React / Vite)
                  chat - history - model selector
                         |
                         |  natural language + chosen model id
                         v
                     EXPRESS  (backend/server.ts)
                         |
                         v
                  INTENT ROUTER
              (agent.service — the selected model decides)
                         |
        +----------------+----------------+
        |                                 |
        v                                 v
  NORMAL CONVERSATION              DATABASE NEEDED
        |                                 |
        v                                 v
   MODEL ROUTER                 SCHEMA BRIEFING
  (src/server/llm)              (relevant tables only)
        |                                 |
   +----+----+                            v
   |         |                     SQL GENERATION
   v         v                     (JSON-constrained)
OLLAMA   LM STUDIO                        |
qwen2.5  Qwen3-Coder                      v
-coder   30B A3B                   SQL VALIDATOR
  :7b     (detected id)           (read-only, single
   |         |                    statement, allowlist)
   |         |                           |
   |         |                    validated SQL
   |         |                           |
   |         |                           v
   |         |                  PostgreSQL  arcgpt_new
   |         |                  (read-only pool)
   |         |                           |
   |         |                           v
   |         |                    QUERY RESULT
   |         |                           |
   |         |                    RESULT INTERPRETER
   |         |                    + LLM narration, with an
   |         |                      accuracy guard
   |         |                           |
   +---------+---------------------------+
                         |
                         v
                 ARC GPT  ->  USER
```

The browser never touches PostgreSQL, Ollama or LM Studio. It sends a question
and an optional model id to the ArcGPT backend and receives a conversational
answer. No credential, endpoint or backend secret is present in the frontend
bundle.

### Two modes, chosen automatically

ArcGPT is a general conversational assistant that can also read the institution
database. The user never picks a mode.

The router (`backend/src/server/agent.service.ts`) asks the **selected model** —
not a keyword list — whether answering needs real records, and returns a
constrained JSON verdict. Then:

- **Normal conversation** — greetings, jokes, programming help, explanations,
  writing. Answered directly by the model. No schema briefing, no SQL, no
  database connection.
- **Database** — anything about students, attendance, marks, CGPA, backlogs,
  fees, hostel, timetable. Runs the full pipeline: schema briefing,
  JSON-constrained SQL generation, validator, read-only pool, interpretation.
- **Mixed** — "How many AIML students are there and what does AIML means?" —
  the record half is retrieved and the explanation half is composed from the
  same answer.

Why the model decides rather than `text.includes('student')`: a keyword rule is
wrong in both directions. "write a Python function to sort a list" has no
institutional word and would be forced through a query; "explain the student
loan scheme" contains "student" and would be sent to PostgreSQL, which cannot
answer it. Asking the model handles both, and it is the same model that would
have had to answer anyway.

**Routing cannot weaken security.** The destructive-request, injection and
credential gates run *before* the router, so "delete all students" is refused by
ArcGPT itself rather than politely declined by a chat model that happened to be
asked. When the router does choose the database, every existing authorization
rule and the validator run unchanged.

### Provider capability

`LlmProvider` exposes two operations, not one:

| Operation | Shape | Used for |
| --- | --- | --- |
| `generateSql` | constrained JSON `{intent, tables, sql}` | the database path; output is untrusted and must survive the validator |
| `chat` | plain prose, no schema | conversation, intent routing, narration |

They are separate methods on purpose. `generateSql` must stay schema-constrained
so malformed output is caught; relaxing that for conversation would weaken the
one call whose output is treated as executable input.

### The narration accuracy guard

The model writes the one-sentence lead-in above a result table, but
`inventsANumber` rejects any narrative containing a figure that cannot be traced
to the returned rows or the question. This is not theoretical: the narrator was
caught rewriting a correct `80` as `150` and a correct `1.64` as `3.5`. On
rejection the deterministic interpreter's answer is used, which cannot invent
anything. See `backend/tests/narrator-accuracy.test.ts`.

### Why one origin

`backend/server.ts` serves the frontend itself — Vite in middleware mode in
development, `frontend/dist` in production. This is not a convenience. The
session cookie is `sameSite: 'strict'`, so a frontend served from a different
port would never present it and every API call would return 401.

---

## Models

ArcGPT talks to two local inference servers and can use either, per question,
from a dropdown in the chat topbar.

| Provider | Model | Default | Endpoint |
| --- | --- | --- | --- |
| Ollama | `qwen2.5-coder:7b` | yes | `http://127.0.0.1:11434` |
| LM Studio | `qwen3-coder-30b-a3b-instruct` | no | `http://127.0.0.1:1234/v1` |

### One GPU, one model at a time

**Both models cannot be resident in VRAM at the same time on a small GPU.** On
the machine this was verified on — an RTX 3050 Laptop with 6 GB — LM Studio's
Qwen3-Coder 30B holds about 4.6 GB, leaving roughly 1.3 GB, which is not enough
to load the 7B.

Ollama reports that as a server error rather than as anything you did:

```text
llama-server reported out-of-memory during startup: cudaMalloc failed: out of memory
```

ArcGPT detects this specifically and says so, instead of telling you to start
Ollama when Ollama is already running:

> Ollama could not free enough memory to load Qwen2.5-Coder 7B. Another model is
> probably holding the GPU — unload the model you are not using, then try again.

So switching between the two means freeing one first, in LM Studio or with
`ollama stop`. Both stay selectable in the dropdown throughout; only the model
you are not currently using needs to be released.

### Ollama (default)

```powershell
ollama serve
ollama pull qwen2.5-coder:7b
```

`qwen2.5-coder-7b-instruct` — the Hugging Face style name — does not exist in
the Ollama registry, so pulling it fails. The `repo:tag` form is required.

### LM Studio

1. Open LM Studio and load **Qwen3-Coder 30B A3B Instruct** in the chat
   playground, or download it from the Discover tab. **Do not download it
   through Ollama** — ArcGPT never installs models.
2. Open the **Developer** tab and **Start Server**. The default port is 1234.
3. Reload the app. The model selector picks the model up automatically.

The model identifier is **detected, never guessed**. LM Studio uses the model
folder's name, so it is read from

```http
GET http://127.0.0.1:1234/v1/models
```

and falls back to LM Studio's native `/api/v0/models` listing, which also
reports whether a model is downloaded but not loaded.

`LMSTUDIO_MODEL` pins the id. **Pin it whenever more than one model is loaded**,
which is the normal case — a verified run had five models resident, and only the
pin guarantees the request goes to the one you meant:

```ini
LMSTUDIO_BASE_URL=http://127.0.0.1:1234/v1
LMSTUDIO_MODEL=qwen3-coder-30b-a3b-instruct
```

If the running server does not report the configured id, ArcGPT says so in the
selector and uses a model it can actually see rather than sending a request that
cannot succeed.

### LM Studio's `response_format`

Some LM Studio builds reject `response_format: { type: "json_object" }` and
require `json_schema`. ArcGPT tries JSON mode first and, on a 400, retries once
without it. The prompt already asks for the JSON shape, so the request succeeds
instead of failing — at the cost of losing grammar-constrained decoding.

### Switching models

The selector in the conversation topbar chooses which model writes the SQL for
the **next** question. The chosen id is sent to the backend as `model` on
`POST /api/query/translate`; the browser never contacts a provider directly.

Switching models changes **only** which model writes the SQL. It cannot change
the database, the credentials, the SQL validator, the allowed tables, the
authentication or any permission. Those decisions all happen downstream of the
provider, and the validator's contract is `(sql, user)` with no model parameter
— asserted in `backend/tests/providers.test.ts`.

### Environment variables

```ini
LLM_PROVIDER=ollama            # used when the selector has not chosen one

OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5-coder:7b

LMSTUDIO_BASE_URL=http://127.0.0.1:1234/v1
LMSTUDIO_MODEL=qwen3-coder-30b-a3b-instruct

# LLM_REQUEST_TIMEOUT_MS=180000  # a 30B model takes 40-90s per question here
# OLLAMA_PROBE_TIMEOUT_MS=2000
# LMSTUDIO_PROBE_TIMEOUT_MS=3000
```

### Model API

```http
GET /api/models      # session-gated; not admin-gated
```

```json
{
  "models": [
    { "id": "qwen2.5-coder:7b", "name": "Qwen2.5-Coder 7B",
      "provider": "ollama", "providerLabel": "Ollama",
      "available": true, "detail": "Ready" },
    { "id": "qwen/qwen3-coder-30b-a3b-instruct-2507-q4_k_m",
      "name": "Qwen3-Coder 30B", "provider": "lmstudio",
      "providerLabel": "LM Studio", "available": true,
      "detail": "Detected from the LM Studio server." }
  ],
  "defaultProvider": "ollama"
}
```

`available` is **measured on every request**, never hard-coded `true`. A
provider that is down reports `false` with a `detail` explaining why, and the
selector shows it greyed out rather than hiding it. No endpoint address, port
or credential is returned.

`GET /api/health` reports the same per-provider availability alongside the
existing `ollama` and `postgresql` fields.

---

## Answers

Raw result sets are never shown as the answer. The pipeline used to produce:

> The local PostgreSQL query returned 24 rows. First row: markid=…, studentid=…

`backend/src/server/result-interpreter.service.ts` replaced that with
deterministic formatting. It is done in code, not by asking the model a second
time:

- a second LLM call would double latency for something that is arithmetic;
- a model narrating rows can invent rows, and a deterministic phrasing of a real
  result set cannot;
- it costs no tokens and cannot be persuaded to leak a UUID.

| Question | Answer |
| --- | --- |
| What is the CGPA of AIML32022A07? | `Aarav Sharma's CGPA is 1.64.` |
| How many students are there? | `There are 320 students.` |
| How much hostel fee is pending for this student? | `Aarav Sharma's pending amount is ₹12,500.` |
| Show all AIML students. | `Here are the students. Name: … · register number: AIML42021A01 · department: AIML. …` |
| Who are the parents of AIML32022A07? | `Mother: Chitra and father: Ashok.` |

Rules it holds to:

- internal identifiers (`*_id` columns, UUID values) never appear in the prose;
- `register_number`, subject codes and names do — they are the college's own
  human-readable handles;
- money, percentages and grades are formatted as a person would say them, and
  `pg`'s numeric strings (`NUMERIC`, `COUNT`, `SUM`) are handled correctly;
- contact details stay in the table below the answer, out of the sentence;
- the result table itself is unchanged, so every column is still available.

### Follow-up questions

Each answer carries a `resultDigest` — the column names plus at most five
identifying values from the rows returned. The client forwards it with the next
question, and the prompt tells the model to constrain itself to those
identifiers. Without it, "which of them have backlogs?" has nothing to attach
"them" to, and the model either re-runs the original broad query or invents a
scope. Digests are bounded and never carry a whole result set.

---

## SQL safety

Model switching never bypasses validation. The pipeline is unchanged in shape:

1. the natural-language gate refuses destructive verbs, SQL pasted into the
   question box, system catalogs, file-reading functions and ArcGPT's own
   control tables — **before** the model is involved;
2. the selected provider returns a candidate statement;
3. `sqlValidationService.validate()` parses it with `pgsql-ast-parser` and
   enforces read-only, single-statement, allowlisted-tables, no-comments,
   blocked-keyword and blocked-identifier rules, per-role authorization,
   complexity limits and a clamped `LIMIT`;
4. only `validation.sanitizedSql` is executed, never the raw model output;
5. execution uses `arcgpt_new_reader`, a role with `SELECT` on institution
   tables and **no** privilege at all on the control tables, inside
   `BEGIN READ ONLY` with a statement timeout.

`backend/tests/security-models.test.ts` runs twelve prompt-injection attacks
against every reported model and asserts, for each one, that the request is
blocked before the model call and before the database call.

### The one repair attempt

A read model often carries a column another read model also has, under a
different name — `v_student_attendance_summary.attendance_percentage` versus
`student_academic_summary.overall_attendance_percentage`. A model that joins the
two and picks the wrong one's name gets PostgreSQL `42703`: a *correct*
rejection of a statement one column away from correct.

So the pipeline may execute a statement twice, and only in this case:

1. the error class must be `42703` (undefined column) or `42P01` (undefined
   table) — never a permission denial, never a timeout;
2. the repair prompt is handed PostgreSQL's own error text plus the **real**
   column list of every table the statement touched, so the model copies a name
   instead of guessing one;
3. **every literal the original filtered on must still be present** in the
   repair. This is what stops a "fixed" query quietly dropping
   `department_code = 'AIML'` — still a safe statement, and no longer an answer
   to the question. The SQL validator cannot catch this one, because an
   administrator's queries are legitimately unscoped;
4. the corrected statement goes back through `sqlValidationService.validate`
   exactly like the first one. A repair prompt is the single most attractive
   place in this pipeline to smuggle something past the guardrails, so it does
   not get the chance;
5. two attempts, never more. A query that needs a second correction will not get
   it.

When a repair is used, the response reports the executed statement in
`generatedSql`/`sanitizedSql` and the rejected one in `correctedSql`, so the
query log and the admin panel show what actually ran.

---

## Running it

### Prerequisites

- Node.js 20+
- PostgreSQL 14+ (built and verified on 16)
- Ollama with `qwen2.5-coder:7b`
- LM Studio, only if you want the second model

### 1. Backend

```bash
cd backend
npm ci
cp .env.example .env      # then edit it - see below
```

`.env` needs real local values. At minimum change `DB_PASSWORD`,
`DB_READONLY_PASSWORD` and `SESSION_SECRET`, and set `LOCAL_ADMIN_PASSWORD` to
something other than the example placeholder. That account is created on first
run and is the identity the chat uses.

### 2. Database

The college ERP database is `arcgpt_new`, built by the scripts in `../database/`.
It is created by the migrations — do not build it by hand.

```powershell
powershell -ExecutionPolicy Bypass -File ..\database\run_all.ps1 -Reset
```

That applies `01_control_tables.sql` through `12_verify.sql` in order and
finishes with a verification report. `-Reset` drops and recreates the `public`
schema *inside `arcgpt_new`*; it never drops the database itself.
`11_permissions.sql` creates the two runtime roles and therefore needs a
superuser connection, which is the runner's default.

Every SQL file opens with a `current_database()` guard that refuses to run
against any database other than `arcgpt_new` and makes no changes if it does.
Other databases on this server belong to other projects and are never
referenced. `assertArcgptDatabase()` in `src/server/db.ts` applies the same
rule at process start, so a misconfigured `DB_NAME` exits with a clear message
instead of connecting.

See `../database/README.md` for the schema, the read models, the demo data and
the full build order.

`11_permissions.sql` creates two roles:

| Role | Pool | Purpose |
| --- | --- | --- |
| `arcgpt_user` | `DB_USER` | Auth, sessions, conversations, query log, audit, CSV import |
| `arcgpt_new_reader` | `DB_READONLY_USER` | **The only role generated SQL ever runs as** |

`DB_READONLY_*` is not optional. Without it the query path falls back to the
admin pool and the only remaining defences are the validator and
`BEGIN READ ONLY`. `arcgpt_new_reader` has `SELECT` on institution tables and
views and **no privilege at all** on the control tables, so even a validator
bypass cannot reach user credentials or the audit trail.

A separate reader role is used rather than the pre-existing `arcgpt_reader`,
which holds privileges in another project's database and is left untouched.

### 3. AI engines

```powershell
# Default
ollama serve
ollama pull qwen2.5-coder:7b

# Optional second engine: load the model in LM Studio, then Developer > Start Server
```

### 4. Start

```bash
cd backend
npm run dev              # development, serves the UI on the same origin
npm run build && npm start   # production
```

Open <http://localhost:3000>. The chat is at `/`; the admin panel is at `/admin`.

Startup prints which models were detected and which one is the default:

```text
ArcGPT Local
-------------------------
PostgreSQL: CONNECTED
Database:   arcgpt_new
> Qwen2.5-Coder 7B (Ollama)
x Qwen3-Coder 30B (LM Studio) - unavailable
Default provider: ollama
Server: RUNNING
-------------------------
```

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
├── frontend/                    Project 1 - the UI, kept
│   ├── public/arc, public/brand animations, favicons
│   └── src/
│       ├── user/                the ArcGPT chat surface
│       │   ├── UserChat.tsx         threads, send flow, generation animation
│       │   ├── ChatSidebar.tsx      history sidebar
│       │   ├── ModelSelector.tsx    provider/model dropdown
│       │   ├── LiquidMetalSendButton.tsx
│       │   └── user.css             black + gold theme
│       ├── components/          admin panel and dashboards
│       ├── lib/apiClient.ts     the only place a backend URL appears
│       └── data/demoUsers.ts    display list for the admin persona picker
├── backend/                     Project 2 - the brain
│   ├── server.ts                API, sessions, model API, static hosting
│   ├── src/server/
│   │   ├── llm/                 provider abstraction: types, ollama, lmstudio, router
│   │   ├── sql-prompt.service.ts    schema briefing and prompt construction
│   │   ├── result-interpreter.service.ts  conversational answers
│   │   ├── sql-generation · sql-validation · schema · db · auth · audit …
│   ├── src/migration/sql/       legacy migrations for arcgpt_institution
│   │                            (another project's database - unused here)
│   ├── tests/
│   └── scripts/
└── database/                    the arcgpt_new build: schema, seed, permissions
    ├── 01_control_tables.sql … 12_verify.sql
    ├── run_all.ps1              applies everything in order
    └── README.md                schema, read models, demo data
```

---

## Checks

```bash
cd backend && npm run lint && npm test
cd frontend && npm run lint && npm run build
```

| Command | Needs | What it covers |
| --- | --- | --- |
| `npm test` | nothing | SQL guardrails, provider routing, model-id detection, conversational answers, narration accuracy, prompt injection |
| `npm run test:integration` | PostgreSQL + Ollama | connection and a trivial read |
| `npm run test:agent` | PostgreSQL + at least one model | conversation never reaches SQL, and data questions still do |
| `npm run test:e2e` | PostgreSQL + at least one model | the full pipeline, once per available provider |

`npm test` runs without PostgreSQL and without any model server. Its suites are:

- `core.test.ts` — the existing SQL guardrail suite
- `providers.test.ts` — structured-output parsing, the registry, and the
  assertion that model selection cannot affect validation
- `lmstudio-provider.test.ts` — the LM Studio client against a stubbed
  OpenAI-compatible server, including exact model-id detection
- `result-interpreter.test.ts` — the conversational answer format
- `error-messaging.test.ts` — provider failure messages, asserting each is
  actionable and leaks no URL, port, stack trace or status code
- `narrator-accuracy.test.ts` — the guard that rejects a narrative containing a
  figure not present in the returned rows
- `sql-repair.test.ts` — the repair prompt, re-validation of a repair, and the
  scope-preservation check
- `security-models.test.ts` — fifteen prompt-injection attacks against every
  reported model

`npm run test:agent` is the suite for the conversational behaviour. For every
available model it asserts that eight ordinary messages are answered normally
with no `sanitizedSql`, no `generatedSql` and no rows, that four data questions
still reach the validated SQL path, and that four destructive prompts are still
refused.

`npm run test:e2e` is the one that proves a question is really answered. It
prints each question, its status, row count and answer for every available
provider, then checks the same answers for leaked identifiers.

To test both models by hand:

1. Start LM Studio's server, reload the app, and confirm the selector lists
   Qwen3-Coder 30B as available.
2. Select **Qwen2.5-Coder 7B**, ask a question, and confirm the answer's
   `model.provider` is `ollama`.
3. Select **Qwen3-Coder 30B**, ask again, and confirm `model.provider` is
   `lmstudio`.
4. Confirm the generated SQL still passes the same validation either way.

---

## Notes

- A conversation restored from history shows the stored transcript text. Result
  tables are not stored, so a restored answer has no rows beneath it until the
  question is asked again.
- `GET /api/health` reports the live state of Express, PostgreSQL and every
  model provider. When Ollama is down the API says so explicitly and generates
  no fallback SQL; it never queries the database with a guess.
- An offline provider is a normal state, not an error: the request returns a
  clean message, the database is not touched, and the other provider stays
  selectable.
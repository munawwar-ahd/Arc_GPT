# ArcGPT — Complete Project Context

> **Purpose of this document:** paste it into another AI agent so it can understand
> ArcGPT without re-discovering the codebase. It is a factual description of the code
> as it exists today, plus the invariants and known defects that a future change must
> respect.
>
> Everything below was read from the source, not inferred from the README. Where the
> README and the code disagree, **the code is correct and this document reflects the code.**

---

## 1. What ArcGPT is

ArcGPT answers natural-language questions about an institutional PostgreSQL database.
A user types "show me students with attendance below 70% in CSE"; a **local** LLM
(Ollama) translates that into one read-only PostgreSQL `SELECT`, the statement is
validated against a hard security guardrail layer, executed inside a read-only
transaction, and the rows are returned to a black-and-gold chat UI.

It is a **local-first, fully offline application**: the LLM is Ollama on the same
machine, the database is a local PostgreSQL instance, and no third-party AI SDK
(OpenAI, Anthropic, Gemini, OpenRouter) is present in the dependency tree.

Core product claims, in order of importance:

1. **The browser never touches the database.** No credentials, no SQL, no LLM keys
   in the frontend bundle.
2. **The LLM cannot write to the database.** Its output is untrusted input that must
   survive a validator before it is allowed near a connection.
3. **Every query is authorized against the asker's role**, at both a table level and
   (for HODs) an AST-structure level.

### Origin

This repository is the deliberate merge of two projects (see `prompt to merge.md`):

- **`frontend/`** — the ArcGPT UI. Kept *exactly* as designed. This is the source of
  truth for appearance.
- **`backend/`** — the LLM, database, validation and auth services. This is the
  "brain".

Project 2's original frontend and Project 1's original backend were both deleted and
are **not** part of this application. The merge rule was: *keep Project 1's UI, replace
its backend with Project 2's* — never merge blindly, never redesign the UI.

---

## 2. Architecture at a glance

```text
Browser
  │  ArcGPT chat UI  (frontend/src/user/*)
  │  landing · history sidebar · liquid-metal send button
  │  generation animation · pure black + gold theme
  ↓  same origin, HTTP-only session cookie (sameSite: strict)
Express  (backend/server.ts — the ONLY entry point, 787 lines)
  ├── /api/query/translate   NL question → SQL → rows        ← the core endpoint
  ├── /api/conversations     history sidebar data source
  ├── /api/auth/*            local login, sessions
  └── /api/admin/*, /api/stats, /api/analytics, …  admin panel
  ↓
  ├── Ollama         qwen2.5-coder:7b-instruct (structured JSON output)
  ├── SQL validation read-only, single-statement, whitelisted tables, RBAC
  └── PostgreSQL     arcgpt_institution, read-only pool
```

### Why one origin is mandatory (not a convenience)

`backend/server.ts` serves the frontend itself:

| Mode | Behaviour |
| --- | --- |
| Development | dynamically imports Vite and mounts `createViteServer({ root: frontendDir, server: { middlewareMode: true }, appType: 'spa' })` |
| Production | `express.static(frontend/dist)` + `app.get('*')` → `dist/index.html` |
| `SERVE_FRONTEND=false` | JSON 404 explaining API-only mode |

The session cookie is `sameSite: 'strict'`. A frontend served from a different port
would **never** present the cookie and every API call would return 401. This is why
`frontend/.env` should normally stay empty and `VITE_BACKEND_URL` should be left unset.

---

## 3. Repository layout

```text
ArcGPT/
├── README.md                        setup + architecture (authoritative but partly stale)
├── prompt to merge.md               the original merge brief
├── ARCGPT_PROJECT_CONTEXT.md        this file
├── frontend/                        Project 1 — the UI, kept as designed
│   ├── index.html                   22 lines, favicons + OG tags, no webfont link
│   ├── vite.config.ts               react + @tailwindcss/vite, @ alias → frontend root
│   ├── .env.example                 documents VITE_BACKEND_URL; keep empty
│   ├── public/
│   │   ├── arc/                     5 mp4s: arc-logo-spin, chat-asterisk-rotate,
│   │   │                            inside-chat-animation, thunderbolts-logo-spin-right(-source)
│   │   ├── brand/                   arcgpt-lockup.png, arcgpt-mark-gold.png
│   │   └── favicon-16/32/48/64.png, apple-touch-icon.png
│   └── src/
│       ├── main.tsx                 13 lines — THE ENTIRE ROUTER (one ternary)
│       ├── App.tsx                  345 lines — admin portal root
│       ├── index.css                20 lines — Tailwind v4 import + 2 shadow shims
│       ├── types/index.ts           148 lines — all domain types
│       ├── user/                    ← the ArcGPT chat surface (plain CSS, no Tailwind)
│       │   ├── UserChat.tsx             992
│       │   ├── user.css                 1375 — the design system
│       │   ├── ChatSidebar.tsx          301
│       │   ├── LiquidMetalSendButton.tsx 787 — WebGL2 shader
│       │   ├── MarkdownMessage.tsx      243 — hand-rolled markdown
│       │   ├── ChatExportMenu.tsx       195
│       │   └── ArcVideo.tsx             39
│       ├── components/              17 files — admin panel / dashboards (Tailwind, light theme)
│       ├── lib/
│       │   ├── apiClient.ts          129 — the ONLY place a backend URL appears
│       │   └── exportAnswer.ts       290 — CSV / print-preview export
│       └── data/demoUsers.ts        66 — display list for the admin persona picker
└── backend/                         Project 2 — the brain
    ├── server.ts                    787 — the only entry point; all routes inline
    ├── .env.example                 the ONLY place secrets belong
    ├── scripts/  db_check.ts, setup-db.js
    ├── src/
    │   ├── types/index.ts           shared domain types
    │   ├── server/                  14 service modules (see §7)
    │   └── migration/sql/           6 .sql files (see §9)
    └── tests/     core.test.ts, integration.test.ts, acceptance.test.ts
```

**There is no `.eslintrc`, no jest/vitest config, no Dockerfile, no docker-compose, no
`nodemon.json`, no `.nvmrc` in either package.** `npm run lint` is `tsc --noEmit` in
both. Tests are hand-rolled `node:assert/strict` scripts run through `tsx`.

---

## 4. Tech stack

### Backend (`backend/package.json`)

- Pure ESM (`"type": "module"`), run directly by `tsx` — **there is no compile step for
  the server**. `tsconfig.json` sets `noEmit: true`.
- Runtime deps: `express@^4.21.2`, `pg@^8.23.0`, `pgsql-ast-parser@^12.0.2`,
  `bcryptjs@^3.0.3`, `cookie-parser@^1.4.7`, `cors@^2.8.6`, `dotenv@^17.2.3`,
  `express-rate-limit@^8.7.0`, `helmet@^8.3.0`.
- **Also declared as backend dependencies:** `vite@^8.3.0`, `@vitejs/plugin-react`,
  `@tailwindcss/vite`, `react@^19`, `react-dom@^19`, `react-is`, `recharts`,
  `lucide-react`, `motion`. These exist *only* because the backend runs Vite in
  middleware mode and delegates builds via `npm --prefix ../frontend`. A production
  `npm ci --omit=dev` therefore still carries the whole frontend build toolchain.
- Dev deps: `tsx@^4.21.0`, `typescript@^7.0.2` (native port), `esbuild`, `autoprefixer`
  (unused), plus `@types/*`.
- `tsconfig`: `target ES2022`, `module ESNext`, `moduleResolution "bundler"`,
  `isolatedModules`, `noEmit`, `skipLibCheck`, `paths {"@/*": ["./*"]}`.
  **No `strict`, no `noUnusedLocals`, no `noImplicitAny`** — this is why a fair amount of
  dead code typechecks cleanly.

### Scripts

| Where | Script | Command |
| --- | --- | --- |
| backend | `dev` | `tsx server.ts` |
| backend | `start` | `tsx server.ts` |
| backend | `build` | `npm --prefix ../frontend run build` |
| backend | `clean` | `npm --prefix ../frontend run clean` |
| backend | `lint` | `tsc --noEmit` |
| backend | `test` | `tsx tests/core.test.ts` (no PostgreSQL needed) |
| backend | `test:integration` | `tsx tests/integration.test.ts` (needs PG + Ollama) |
| frontend | `dev` / `build` / `preview` | `vite` / `vite build` / `vite preview` |
| frontend | `lint` | `tsc --noEmit` |
| frontend | `clean` | `rm -rf dist` — **POSIX-only, breaks on Windows cmd/PowerShell** |

`backend/tests/acceptance.test.ts` is **not wired to any npm script**; run it manually
with `npx tsx tests/acceptance.test.ts` (it needs the server already running on :3000).

### Frontend (`frontend/package.json`)

- React 19, Vite 8, `motion` (Framer Motion), `lucide-react`, `recharts`,
  `@tailwindcss/vite` 4.3.3 (CSS-first config — the only Tailwind directive in the
  project is `@import "tailwindcss";`).
- **No** react-router, redux/zustand, react-query, axios, markdown library, PDF
  library, CSS-in-JS, or class-name utility (`clsx`). The only class joiner is a local
  `cx()` in `ChatSidebar.tsx`.
- **Stale lockfiles:** both `package-lock.json` and `bun.lock` are leftovers from a
  Google AI Studio scaffold. They name the package `react-example` and
  `package-lock.json` still lists `@google/genai@^2.4.0` as a root dependency, which
  `package.json` no longer declares. `frontend/node_modules` is additionally a *merged*
  install shared with `backend/` and contains packages (redux, pg-mem, @google/genai)
  that nothing imports.
- `vite.config.ts` also defines a dev proxy `/api → VITE_DEV_PROXY_TARGET ||
  http://localhost:3000`. It exists **solely** so the `sameSite:'strict'` cookie stays
  first-party if the Vite dev server is split onto port 5173. Normally unused.

---

## 5. The request flow: one question, end to end

### 5.1 Frontend call (`UserChat.submitMessage`)

```ts
const payload = await apiJson<unknown>(
  '/api/query/translate',
  apiPost({
    query,                                            // trimmed question
    conversationHistory: conversationContextRef.current.get(threadId) ?? [],
    conversationId,                                   // ALWAYS sent
  }, controller.signal)
);
```

Key facts:

- **No `x-user-id` header** on the chat surface. The chat relies purely on the
  HTTP-only session cookie. (The admin surfaces *do* send `x-user-id`.)
- `conversationId` is sent on **every** turn. On a thread's first question it is the
  thread's own client-generated UUID; the backend finds no conversation under that id,
  creates one, and returns its own id, which the frontend then adopts:
  ```ts
  if (result.conversationId) {
    conversationIdRef.current.set(threadId, result.conversationId);
    setThreads(cur => cur.map(t => t.id === threadId ? {...t, conversationId: result.conversationId} : t));
  }
  ```
  Omitting it on turn 1 would persist nothing and the thread would never appear in the
  history sidebar.
- `createThreadId()` has a hand-rolled RFC-4122 v4 fallback for when
  `crypto.randomUUID()` is unavailable. This is deliberate: the backend only honours a
  client-supplied `conversationId` if it is a well-formed UUID.
- Conversation context is **per-thread** (`conversationContextRef: Map<threadId, …>`) so
  switching threads cannot leak SQL context between them.
- Stale-response protection is doubled up: a monotonic `requestIdRef` token **and**
  `controller.signal.aborted`. `startNewThread()` bumps the token, aborts the in-flight
  controller, and starts a fresh thread rather than wiping the message array.
- The 9-value `status` vocabulary is normalised by `toStatus()` / `KNOWN_STATUSES`.
  An unknown status **collapses to `'failed'`** — deliberately, so a status the
  frontend does not understand is never rendered as a successful answer.
- On error the frontend renders a fixed string — `"I couldn't complete that request.
  Please try again."` — and **discards the actual server error**.

### 5.2 Backend entry (`server.ts` `queryHandler`, lines 236–267)

```ts
if (Object.prototype.hasOwnProperty.call(req.body || {}, 'sql')) → 400
  "Raw SQL is not accepted. Submit a natural-language question."

question = body.question (string) ?? body.query      // both keys accepted
if (typeof question !== 'string' || !question.trim() || question.length > 2000) → 400

history  = body.conversationHistory.slice(-20)         // last 20 only
           then filtered: role must be 'user'|'assistant', content must be a string
           content truncated to 2000 chars, sql truncated to 10000

conversationId = typeof body.conversationId === 'string' ? body.conversationId : undefined
result = await sqlGenerationService.processQuery(question.trim(), req.user, safeHistory, conversationId)
```

Registered at **both** paths: `POST /api/query` and `POST /api/query/translate`, both
`requireAuth`.

### 5.3 The 7-step pipeline (`sql-generation.service.ts` → `processQuery`)

Every step is surfaced to the client as a `PipelineStep { step, name, description,
status, durationMs?, details? }` so the admin UI can render a progress timeline.

**Step 1 — Understanding Question** (`checkAmbiguity`)

Three hard-coded ambiguity rules, each of which returns a clarification question plus
suggestion chips instead of touching the LLM:

| Trigger | Clarification |
| --- | --- |
| "low/poor/less/bad attendance" with no digits | "What attendance threshold should I use?" → `['Below 75%','Below 70%','Below 65%','Custom']` |
| exact `show students with good cgpa` / `high cgpa` / `who has good marks` / `students with low marks`, no digits | CGPA cutoff question |
| exact `show fees` / `fee details` | overdue / pending / collected question |

Result: `status: 'clarification_needed'`, `resultStatus: 'BLOCKED'`, audited as
`AMBIGUITY_DETECTED` with `status: 'AMBIGUOUS'`. **No `ai_queries` row is written.**

**Step 2 — Identifying Relevant Data** (pre-LLM early blocks)

These regexes run *before* the model is ever called, which is a meaningful defence: a
prompt-injected request never reaches the LLM.

| Check | Regex | Outcome |
| --- | --- | --- |
| Credential words | `\b(passwords?\|password_hash\|authentication credentials?\|session secrets?\|tokens?\|api keys?\|database credentials?\|environment variables?)\b` | `access_denied` / `ACCESS_DENIED` + security event `PROTECTED_CREDENTIAL_QUERY` |
| Self-introduction | `^(who\|what) are you\b\|introduce yourself` | `failed` / `ERROR` → "ArcGPT translates questions about the local institution database." |
| Destructive intent | `\b(delete\|drop\|alter\|truncate\|insert\|update\|create\|grant\|revoke\|merge)\b` | `blocked` / `BLOCKED` + security event `DESTRUCTIVE_DML_ATTEMPT`; step 5 also marked `blocked` |
| Financial + weak role | `\b(fee\|tuition\|payment\|salary)\b` and role ∈ {FACULTY, STUDENT} | `unauthorized` + security event `RBAC_VIOLATION_ATTEMPT` |
| HOD names another dept | mentions `AIML\|CSE\|ECE\|EEE\|IT\|MECH\|CIVIL` | `access_denied` + security event `HOD_DEPARTMENT_VIOLATION_ATTEMPT` |

**Step 3 — Retrieving Schema** (schema-context injection)

`schemaService.getRelevantSchemaPrompt(query)` selects a **keyword-matched subset** of
tables and renders it for the prompt:

```text
Table: <name>
Description: <description>
Columns:
  - <col> (<TYPE>)[ PRIMARY KEY][ REFERENCES <t>(<f>)]: <description>

Foreign Key Relationships for JOIN:
- <from>.<fk> = <to>.<fk>      ← only relationships where BOTH ends are in the selection
```

`getRelevantTables` keyword map: department / `aiml|cse|ece|mech|it`; student /
`cgpa` / `backlog` / `who`; attendance / `absent|present|percentage`; `cgpa|sgpa|academic|grade`;
`faculty|teacher|professor|teach`; `subject|course|credit`; `mark|score|assessment|exam`;
`assignment|submission|submitted`; `backlog|arrear`; `parent|guardian|contact|address`;
`hosteller|day scholar|dayscholar|residency|residing`;
`profile|student detail|list students|show students|all students|student record`;
`placement|company|drive`; `hostel|room`; `library|book|issue`; `bus|transport|route`;
`timetable|schedule`; `announcement|notice`; `program|batch|semester`.
Fallback when nothing matches: `departments, students, course_offerings, subjects`.

`SchemaService.refreshFromDatabase()` introspects the live database at startup; if that
fails it falls back to declared metadata (`isLoadedFromDatabase()` → `false`, reported
as `source: 'declared'` in `GET /api/schema`).

**Step 4 — Generating SQL** (`ai.ts`)

- `checkOllamaStatus()` first: `GET ${OLLAMA_URL}/api/tags` with a **2 s** timeout.
  Model resolution order: exact `OLLAMA_MODEL` → `${OLLAMA_MODEL}:latest` → name
  starting `qwen2.5-coder` → name starting `qwen` → `models[0]`.
- If Ollama is down the pipeline **returns an explicit failure and never queries the
  database with a guess.** There is no fallback model and no cached SQL.
- `POST ${OLLAMA_URL}/api/chat` with `stream: false` and a **120 s** timeout.
- **Structured output via Ollama's JSON-schema grammar mode — not tool calling.**
  There are no `tools` and no function calling anywhere in the codebase:
  ```ts
  format: { type: 'object',
            properties: { intent: {type:'string'},
                          tables: {type:'array', items:{type:'string'}},
                          sql:     {type:'string'} },
            required: ['intent','tables','sql'] }
  options: { temperature: 0.1, num_predict: 1200 }
  ```
- `parseStructuredContent` strips ``` ```json ``` / ``` ``` ``` fences, `JSON.parse`s,
  then requires `intent:string`, `tables:Array`, `sql:string`; lower-cases and filters
  table names; trims the SQL. Returns `null` (does **not** throw) if the SQL is empty or
  `tables` is empty.
- **No retry, no self-correction.** `isCorrected` and `correctionAttempts` exist on
  `QueryExecutionResult` but are never set.

**System prompt** (verbatim structure, `sql-generation.service.ts` ~lines 195–209):

```
You are ArcGPT's local SQL generation engine. Return one JSON object with exactly intent, tables, and sql.
The sql value must be one PostgreSQL read-only SELECT or WITH ... SELECT statement.
Never return DDL, DML, multiple statements, comments, system catalogs, credentials, or arbitrary SQL.
Use ONLY tables and columns supplied below.
Guidelines:
1. attendance → prefer student_attendance_percentage; dept codes 'AIML','CSE','ECE','MECH','CIVIL','IT'; always department_code
2. average CGPA per dept → departments d JOIN students s ON d.department_id=s.department_id JOIN student_academic_summary sas ON s.student_id=sas.student_id
3. active backlogs → student_academic_summary sas JOIN students s ... WHERE sas.backlog_count > 1  (or backlogs WHERE status='ACTIVE')
4. faculty teaching a subject → faculty f JOIN course_offerings co ON f.faculty_id=co.faculty_id JOIN subjects sub ON co.subject_id=sub.subject_id
5. unsubmitted assignments → students WHERE student_id NOT IN (SELECT student_id FROM submissions sub JOIN assignments a ON sub.assignment_id=a.assignment_id WHERE a.title ilike '%Assignment 1%')
6. use student_profile_view for any student record (name, register_number, admission_number, email, phone, programme, batch, section, parent/guardian contact, cgpa, sgpa, current_backlog_count, residency_type); filter by department_code when the question names a department
7. student_profile_view ALREADY CONTAINS residency_type, hostel_name, room_number — do not join student_residency for residency questions
8. only join student_residency when raw hostel_id/room_id is needed; it has no department column
9. "more than N backlogs" → filter student_profile_view on current_backlog_count, no GROUP BY needed; if joining backlogs instead, every selected column must appear in GROUP BY
Do not invent tables or columns. Role: ${user.role}; scope: ${authorization.scope}.${principalInstruction}${hodInstruction}
```

- `principalInstruction` (PRINCIPAL only): *"PRINCIPAL SCOPE: GLOBAL READ across
  authorized institution data. The Principal has no assigned department. Never infer or
  add a department filter unless the question explicitly names one."*
- `hodInstruction` (`scope === 'ASSIGNED_DEPARTMENT'`): names the HOD's
  `departmentCode`/`departmentId`, requires `department_id = '<id>'` on every source
  that has one and `department_code = '<code>'` for `student_attendance_percentage`,
  states the HOD is **not** authorized to query `student_profile_view`, requires child
  tables to join `student_id` back to a directly-scoped `students` source, and forbids
  unscoped rows.

**User prompt:**

```text
Relevant PostgreSQL schema:
<relevantSchema>

Conversation context:
<context or 'None'>

Question: <naturalLanguageQuery>

Return JSON with intent, tables, and sql.
```

Conversation context = `conversationHistory.slice(-6).map(i =>
  `${i.role.toUpperCase()}: ${i.content}${i.sql ? ` [prior SQL: ${i.sql}]` : ''}`).join('\n')`.

**Step 5 — Validating Query** — see §6. Failures are classified by regex over
`blockedReason`:

- `/table .* is not an approved institution table/i` → `not_available` / `NOT_AVAILABLE`
- `/protected identifier|protected table|your role cannot|REQUEST_BLOCKED|authentication is required/i` → `access_denied` / `ACCESS_DENIED`
- otherwise → `blocked` / `BLOCKED`

Every failure calls `recordBlocked(..., 'SQL_VALIDATION_BLOCKED', sql)`, which writes an
`ai_queries` row with status `BLOCKED` **and** a `security_events` row with severity
`HIGH, blocked: true`. Both writes are best-effort — errors are swallowed.

**Step 6 — Executing Database Query** — `databaseService.executeSql(sanitizedSql)`.
Errors are classified by PostgreSQL error code:

| `pg` code | Meaning | Result |
| --- | --- | --- |
| `42P01` | undefined_table | `not_available` / `NOT_AVAILABLE` |
| `42703` | undefined_column | `not_available` / `NOT_AVAILABLE` |
| `42501` | insufficient_privilege | `access_denied` / `ACCESS_DENIED` |
| else | — | `failed` / `ERROR` |

Persisted with `validation_status: 'VALIDATED'`,
`validation_message: 'Read-only validation passed'`, and `tables_used`.

**Step 7 — Preparing Answer** — `visualizationService.analyzeAndRecommendChart(...)` and
`buildExplanation(...)`. `naturalLanguageAnswer` is `EMPTY_RESULT_MESSAGE` when there are
0 rows, otherwise a terse mechanical string:
`"The local PostgreSQL query returned N row(s). First row: a=1, b=2."` (first 3 columns
only). Persisted with `query_status: 'SUCCESS'`.

### 5.4 Conversation persistence

Only on the success path, and only if `conversationId` was supplied:

```ts
ensureConversation(user.id, conversationId, question)   // validates/looks up, else INSERT, title.slice(0,120)
  → appendConversationMessage(id, 'user',      question)
  → appendConversationMessage(id, 'assistant', result.naturalLanguageAnswer, queryId)
  → result.conversationId = id
```

Errors here are logged only — a persistence failure never fails the request.

**Only message text is stored. Result rows are not.** A conversation restored from
history therefore shows the transcript but has no table beneath a previous answer until
the question is asked again.

### 5.5 Chart recommendation (no LLM involved)

`visualizationService.analyzeAndRecommendChart(columns, rows, question)` is pure
heuristics on `rows[0]`:

- `< 2 columns` or 0 rows → `{ type: 'none', title: 'Tabular Data' }`
- numeric detection: `typeof === 'number'` or coercible non-boolean non-empty;
  columns ending `_id` or named `id` are excluded from metrics
- no numeric columns → `none`, "Result contains only categorical or identifier records."
- `> 50 rows` and question lacks `average|distribution|compare` → `none`, "Detailed Tabular Data"
- `2..8 rows` and question has `share|distribution|breakdown|proportion|each department|by department` → `pie`
- a non-numeric column containing `date|year|month|semester` **or** the question has `trend|over time|progression` → `area` (if the question also says `area|cumulative`) else `line`; `seriesKeys = numericColumns.slice(0,3)`
- otherwise → `bar`; `seriesKeys = numericColumns.slice(0,2)`

The **chat surface ignores this field entirely** — it always renders a table. Only the
admin `ResultViewer` renders charts.

### 5.6 The 9-value status vocabulary

`success · empty · blocked · failed · unauthorized · clarification_needed ·
not_available · access_denied · unsupported`

`empty` and `unauthorized` arrived with the new backend. The original frontend had no
concept of either and silently collapsed both into `success`, which rendered "no
matching records" and "you may not query that" as ordinary answers. The frontend header
comments call this out explicitly. **Any new terminal state must be added to
`QueryExecutionStatus` in `frontend/src/types/index.ts` and to `KNOWN_STATUSES` in
`UserChat.tsx`**, or it will be displayed as a failure.

---

## 6. The security model — the most important part of this codebase

The LLM's output is **untrusted input**. Nothing it produces reaches a database
connection without passing `sqlValidationService.validate(rawSql, user)`.

### 6.1 Ordered guardrails in `validate()`

Returns `{ isValid, sanitizedSql?, blockedReason?, detectedTables[], referencedColumns[] }`.

| # | Check | Exact error message |
| --- | --- | --- |
| 1 | empty / not a string | `Empty or invalid SQL statement provided.` |
| 2 | after `stripCodeFence`, `length > 10000` | `SQL statement is empty or exceeds the complexity limit.` |
| 3 | any SQL comment: `/(--\|\/\*\|\*\/\|#)/` | `Query blocked: SQL comments are not permitted.` |
| 4 | any `;` remaining after stripping the trailing one, in the **masked** text | `Query blocked: multiple SQL statements are not permitted.` |
| 5 | must start with `select` or `with` | `Query blocked: only read-only SELECT statements are permitted.` |
| 6 | any token in `BLOCKED_KEYWORDS` | `Query blocked: disallowed operation '<TOKEN>' detected.` |
| 7 | any `BLOCKED_IDENTIFIERS` word-boundary match on masked text | `Query blocked: protected identifier '<name>' is not available.` |
| 8 | table ∈ `PROTECTED_TABLES`, or `startsWith('pg_')`, or `=== 'roles'` / `'permissions'` | `Query blocked: access to protected table '<t>' is prohibited.` |
| 9 | table ∉ `ALLOWED_TABLE_NAMES` | `Query blocked: table '<t>' is not an approved institution table.` |
| 10 | `joinCount > 12` **or** `cteCount > 8` | `Query blocked: SQL complexity exceeds the configured limit.` |
| 11 | `authorizeTables(...)` denied | role-specific, see below |
| 12 | `LIMIT < 1` | `Query blocked: LIMIT must be a positive integer.` |
| 13 | `LIMIT > 500` | **rewritten** to `LIMIT 500` — not an error |
| 14 | no `LIMIT` and no `group by` / `count(` / `avg(` / `sum(` / `min(` / `max(` | ` LIMIT 500` **appended** — not an error |

**String masking is what makes this sound.** `maskQuotedSql(sql)` blanks the bodies of
`'…'`, `"…"`, and `$tag$…$tag$` / `$$…$$` while preserving length and doubled-quote
escapes. All keyword, identifier and table scanning runs against the masked text, so
`SELECT * FROM students WHERE name = 'DROP TABLE x'` cannot trip guardrail 6, and
`pg_catalog` hidden in a string literal cannot slip past guardrail 7.

`extractCteNames` (`(?:\bwith\s+(?:recursive\s+)?|,)\s*([a-z_][a-z0-9_$]*)\s+as\s*\(`)
and `extractTables` (`\b(?:from|join)\s+(?:(?:public)\.)?([a-z_][a-z0-9_$]*)`) also run on
the masked text; **CTE names are subtracted from the detected table set**, so a CTE
aliased `students` cannot be mistaken for the real table.

`extractColumns` is informational only — **there is no column-level whitelist**, and
despite what `README.md` claims, **`SELECT *` is not blocked in code**.

### 6.2 Blocklists (module-level constants)

```
BLOCKED_KEYWORDS (32): INSERT UPDATE DELETE DROP ALTER TRUNCATE CREATE GRANT REVOKE
  MERGE CALL EXEC EXECUTE COPY VACUUM REINDEX ANALYZE BEGIN COMMIT ROLLBACK
  SAVEPOINT DO LOCK NOTIFY LISTEN UNLISTEN SET RESET SHOW EXPLAIN INTO
  "FOR UPDATE" "FOR SHARE"

BLOCKED_IDENTIFIERS (27): password password_hash secret token api_key apikey credential
  private_key pg_catalog information_schema auth current_user session_user
  current_database current_setting set_config pg_sleep sleep load_file dblink
  postgres_fdw pg_read_file pg_read_binary_file pg_write_file pg_ls_dir
  pg_ls_logdir pg_ls_waldir pg_stat_file pg_execute_server_program lo_import lo_export
```

### 6.3 Table whitelists

`ALLOWED_TABLE_NAMES` — 36 names, defined in `schema.service.ts` (with
`INSTITUTION_TABLE_NAMES` as an alias over the same array):

```
departments programs batches academic_years semesters sections students faculty
subjects course_offerings attendance assessments student_marks assignments
submissions semester_results student_academic_summary backlogs timetable exams
exam_schedule announcements placement_drives placement_applications hostels rooms
hostel_allocations books library_transactions bus_routes bus_stops student_transport
student_attendance_percentage guardians student_residency student_profile_view
```

`PROTECTED_TABLES` — 13 ArcGPT control tables the LLM may never read:

```
arcgpt_users arcgpt_sessions ai_queries saved_queries ai_conversations ai_messages
feedback audit_logs security_events system_settings roles permissions role_permissions
```

Note two asymmetries worth knowing:
- `faculty_subjects` exists in `institution.sql` but is **not** whitelisted.
- `fees` is in `SENSITIVE_TABLES` but is **not** in `ALLOWED_TABLE_NAMES`, so a
  `SELECT … FROM fees` is rejected by guardrail 9 *before* the role check ever runs.

Category sets:

```
SENSITIVE_TABLES    fees hostel_allocations hostels rooms student_transport
GUARDIAN_PII_TABLES guardians student_profile_view
GUARDIAN_PII_ROLES  ADMIN SUPER_ADMIN PRINCIPAL
PLACEMENT_TABLES    placement_drives placement_applications
LIBRARY_TABLES      books library_transactions
```

### 6.4 Role-based authorization (`authorizeTables`)

`getAuthorizationContext(user)`:

| Role | Scope |
| --- | --- |
| `PRINCIPAL`, `ADMIN`, `SUPER_ADMIN` | `GLOBAL` |
| `HOD` | `ASSIGNED_DEPARTMENT` + `departmentId` |
| everyone else | `USER` + `departmentId` |

Order of checks:

1. no user → `Authentication is required before database access.`
2. `ADMIN` / `SUPER_ADMIN` → **allow everything**
3. guardian PII tables and role ∉ `GUARDIAN_PII_ROLES` → `Your role cannot query parent or guardian contact details. Ask an administrator.`
4. any `PROTECTED_TABLES` → `Your role cannot query application control or audit data.`
5. any `SENSITIVE_TABLES` and role ≠ `ACCOUNTS` → `Your role cannot query financial, hostel, or transport records.`
6. any `PLACEMENT_TABLES` and role ≠ `PLACEMENT_OFFICER` → `Your role cannot query placement records.`
7. any `LIBRARY_TABLES` and role ≠ `LIBRARIAN` → `Your role cannot query library records.`
8. `PRINCIPAL` → allow (still bound by rules 3–7 above; the tests assert the Principal
   is **denied** `hostels`)
9. `STUDENT`: if any of `students, attendance, student_marks, assignments, submissions, backlogs, semester_results, student_academic_summary` is touched and `/\bstudent_id\b/i` is absent → `Student queries must include a student_id scope.`
10. `HOD`:
    - naming another department from `['AIML','CSE','ECE','EEE','IT','MECH','CIVIL']` → `REQUEST_BLOCKED: HOD is assigned to <code> and cannot query data from <DEPT>.`
    - `department_id = '<otherDept>'` / `department_code = '<otherDept>'` → `REQUEST_BLOCKED: Access to data outside your assigned department (<code>) is prohibited.`
    - touching any `scopedTables` without `department_code|department_name|department_id` **and** the HOD's own code/id → `REQUEST_BLOCKED: HOD queries must be strictly scoped to your assigned department (<code>).`
    - then `validateHodAst()` — see below
11. `FACULTY`: touching any department-scoped table without a department filter → `Department-scoped roles must include a department filter.`
12. otherwise allow

### 6.5 HOD AST proof (`pgsql-ast-parser`)

The regex checks above are *necessary but not sufficient* — they can be fooled by an
`OR` that widens the scope. So for HODs the query is parsed with `pgsql-ast-parser` and
every source must be **proven** department-scoped:

```
directCodeTables  = { student_profile_view, student_attendance_percentage }
directIdTables    = { students, faculty, subjects, timetable, announcements }
studentChildTables= { attendance, student_marks, backlogs, semester_results,
                      student_academic_summary, student_residency, submissions,
                      student_attendance_percentage }
```

Rejections, all prefixed `REQUEST_BLOCKED: `:

- `HOD account has no assigned department.`
- `HOD query could not be structurally validated.` (parse error)
- `HOD queries must be a single, directly scoped SELECT.` (≠1 statement, or not a select)
- `HOD queries cannot use CTEs, set operations, or nested SELECT statements.` (any `with`/`union`/`intersect`/`except` node)
- `HOD queries cannot use disjunctions that could widen department scope.` (any `OR` in the WHERE tree)
- `HOD queries must read a department-scoped institution table.` (empty `from`)
- `HOD queries cannot read nested or derived tables.` (any `from` entry that isn't `type:'table'`)
- `HOD query contains an unresolved table reference.`
- `HOD queries cannot use cross joins or unverified joins.` (`CROSS JOIN`, or a join with no `on`)
- `HOD queries cannot use implicit cross joins.` (>1 source with no `join`)
- ``HOD source '<table>' is not proven to be restricted to the assigned department.``

Positive proof: a source alias is department-scoped if either
(a) it is in `directCodeTables` with an equality on `department_code = '<HOD code>'`
(an unqualified predicate is accepted only when there is exactly one source), or in
`directIdTables` with `department_id = '<HOD id>'`, or is `departments` with either; or
(b) it is in `directIdTables` (or is `students`) joined on
`department_id = <scopedAlias>.department_id` to an already-scoped alias.
A department-scoped `students` / `student_profile_view` alias becomes a *student alias*;
any remaining source is accepted only if it is in `studentChildTables` **and** joined on
`student_id = <studentAlias>.student_id`.

`tests/core.test.ts` asserts that `OR TRUE`, a CTE, a `UNION`, and
`SELECT … IN (SELECT …)` are all rejected for an HOD, while `students ⋈ departments` and
`students ⋈ student_academic_summary` are accepted. **Do not weaken these tests.**

### 6.6 Database-level defence

Two pools in `db.ts`:

| Pool | Credentials | Used for |
| --- | --- | --- |
| `pool` (admin) | `DB_USER` / `DB_PASSWORD` | migrations, auth, health checks, **all log writes** |
| `readerPool` | `DB_READONLY_USER` / `DB_READONLY_PASSWORD`, **or an alias of `pool` if unset** | `withReadOnlyTransaction` → and therefore **only** `databaseService.executeSql` |

`withReadOnlyTransaction(cb)`:

```ts
const client = await readerPool.connect();
await client.query('BEGIN READ ONLY');
await client.query(`SET LOCAL statement_timeout = '${max(1000, statementTimeoutMs)}ms'`);
await client.query(`SET LOCAL idle_in_transaction_session_timeout = '${max(2000, statementTimeoutMs*2)}ms'`);
const result = await await cb(client);
await client.query('COMMIT');   // ROLLBACK on throw; release() in finally
```

Defaults: `DB_POOL_MAX=10`, `DB_READONLY_POOL_MAX=5`, `DB_IDLE_TIMEOUT_MS=30000`,
`DB_CONNECTION_TIMEOUT_MS=5000`, `DB_STATEMENT_TIMEOUT_MS=10000`, `MAX_RESULT_ROWS=500`.

`file1.sql` creates `arcgpt_reader` as `NOLOGIN` and grants it `SELECT` on approved
institution tables only — never on control tables. Enable it once with:
```sql
ALTER ROLE arcgpt_reader LOGIN PASSWORD '<local secret>';
GRANT CONNECT ON DATABASE arcgpt_institution TO arcgpt_reader;
```
`file2` extends the grant to the student-expansion tables. **`student_profile_view`
needs its own explicit grant** because a PostgreSQL view does not inherit the privileges
of the tables it reads — without it every profile query fails with
`permission denied for view`.

Note: the LLM's SQL is executed **verbatim with no parameters**. That is safe only
because the validator whitelists tables, blocks keywords and masking defeats quoting
tricks. There is no parameterisation layer for generated SQL.

---

## 7. Backend service modules (`backend/src/server/`)

All are **classes exported as singletons**, except `db.ts` (plain functions),
`errors.ts` (one function), and `ai.ts` (plain functions + constants).

| File | Size | Responsibility |
| --- | --- | --- |
| `db.ts` | 92 L | dual pools, `withReadOnlyTransaction`, health check, `closeDatabasePools` |
| `ai.ts` | 3.8 KB | `OLLAMA_URL`, `OLLAMA_MODEL`, `checkOllamaStatus`, `generateStructuredAiResponse` |
| `schema.service.ts` | 32 KB | live schema introspection, `ALLOWED_TABLE_NAMES`, `PROTECTED_TABLES`, `getRelevantSchemaPrompt` |
| `sql-validation.service.ts` | 23.6 KB | **all guardrails**, masking, `authorizeTables`, `validateHodAst` |
| `sql-generation.service.ts` | 24 KB | the 7-step pipeline, ambiguity rules, blocked-attempt recording |
| `database.service.ts` | 24 KB | every control-table read/write, `executeSql`, stats, insights, analytics, conversations |
| `auth.service.ts` | 17 KB | users, bcrypt, sessions, role normalisation, user CRUD |
| `import.service.ts` | 21 KB | CSV import for 8 tables, preview + transactional execute |
| `permissions.service.ts` | 3.2 KB | `ROLE_PERMISSIONS` map, `hasPermission`, `canAssignRole` |
| `visualization.service.ts` | 3.9 KB | `analyzeAndRecommendChart` heuristics |
| `student.service.ts` | 6.9 KB | student listing with HOD scoping, soft delete, reactivate |
| `department.service.ts` | 1.4 KB | department lookup by code / UUID |
| `audit.service.ts` | 1.5 KB | single-line JSON stdout log + `audit_logs` insert, SHA-256 query hashing |
| `errors.ts` | 1.4 KB | `describeError()` — handles `pg` `AggregateError` with an empty message |

### `errors.ts` — a pattern to follow

Every error message in the codebase comes from `describeError(error, fallback)` rather
than `error.message`. This exists because `pg` surfaces a connection refusal as an
`AggregateError` with an **empty** `message`, which would otherwise produce blank error
strings in logs and HTTP responses.

### `audit.service.ts`

`generateQueryHash(q)` = `sha256(q.trim().toLowerCase()).hex.substring(0,16)`, or `'N/A'`.
`logEvent` writes a one-line JSON record to stdout
(`{timestamp, service:'ArcGPT', requestId, userId, action, resource, status, durationMs}`)
then persists to `audit_logs` with `details` as jsonb. Persistence failure is logged,
never thrown. No IP address is captured even though the column exists.

---

## 8. Auth and sessions

### Cookie

```
name    arcgpt_session
httpOnly true
secure  NODE_ENV === 'production'
sameSite 'strict'
maxAge  8 hours
path    '/'
```

`cookieParser()` is used **without a secret** — session tokens are opaque random
strings, not signed payloads.

### Token handling

- Token: `crypto.randomBytes(32).toString('hex')` (64 hex chars).
- Stored **only** as `sha256(token)` in `arcgpt_sessions.session_hash` (the plaintext
  token is never persisted).
- `getUserBySession(token)` requires `/^[a-f0-9]{64}$/i`, joins
  `arcgpt_sessions ⋈ arcgpt_users` with `expires_at > NOW() AND status = 'ACTIVE'`, and
  touches `last_seen_at = NOW()`.
- `logout(token)` deletes the row by hash.

### Password hashing

`bcryptjs`, `BCRYPT_ROUNDS` default **12** (`scripts/setup-db.js` uses 10).
`createUser` enforces a **minimum of 8 characters** — note `README.md` says 12; the
code says 8, and the code is right.

### Role normalisation (`normalizeRole`)

Uppercases then maps: `SUPER_ADMIN→'SUPER_ADMIN'`, `ADMIN→'Admin'`,
`PRINCIPAL→'Principal'`, `HOD`, `FACULTY→'Faculty'`, `STUDENT→'Student'`,
`ACCOUNTS→'Accounts'`, `PLACEMENT_OFFICER`/`'PLACEMENT OFFICER'→'Placement Officer'`,
`LIBRARIAN→'Librarian'`, **default → `'Faculty'`**. The DB stores the *normalised display*
form, so the validator's `role.toUpperCase()` comparisons line up. `toUser(record)` also
**blanks `departmentCode`/`departmentId` for `Principal`**.

The 9 roles (`src/types/index.ts`): `Admin · SUPER_ADMIN · Principal · HOD · Faculty ·
Student · Accounts · Placement Officer · Librarian`.

`roleIsAdmin(user)` in `server.ts` = `['Admin','SUPER_ADMIN'].includes(user.role)`.

### The development auto-session

The chat screen has **no login form, by design**, but the API is session-gated — which
would leave a first-time visitor with a 401 on their first message.

In development only, a request arriving without a valid session cookie is given a
session for the `LOCAL_ADMIN` account:

```ts
allowBootstrapSession = !isProduction && process.env.LOCAL_AUTO_SESSION !== 'false'
```

`resolveBootstrapSession()` caches `{token, user, issuedAt}` for 7 hours; on a miss it
calls `authService.loginAsBootstrapUser()`, which performs a **real bcrypt login** with
`LOCAL_ADMIN_EMAIL` / `LOCAL_ADMIN_PASSWORD`. The token is still re-validated against
PostgreSQL on every request that presents it. The browser only ever receives the
HTTP-only cookie.

**It is unconditionally disabled when `NODE_ENV=production`.** See
`server.ts` (`allowBootstrapSession`) and `auth.service.ts` (`loginAsBootstrapUser`).

`apiClient` adds a matching client-side safety net: a `401` is retried once with an
`x-arcgpt-session-retry: 1` header, which covers the first-call/cookie-not-yet-set race.
Anything that is not a plain 401 — an abort, a network error, a 500 — is surfaced
immediately.

### Bootstrap admin

`bootstrapFromEnvironment()` requires `LOCAL_ADMIN_EMAIL` + `LOCAL_ADMIN_PASSWORD` and
upserts into `arcgpt_users` with role `ADMIN`, status `ACTIVE`,
`full_name = LOCAL_ADMIN_NAME || 'ArcGPT Administrator'`, on conflict `(email)` →
`DO UPDATE SET role='ADMIN', status='ACTIVE'`.

**It does not update the password hash on conflict**, so changing `LOCAL_ADMIN_PASSWORD`
later does not rotate an existing account.

---

## 9. Database

Database `arcgpt_institution`, schema `public`, ~36 tables + views.

### Migration files — apply in this order

```powershell
createdb -U postgres arcgpt_institution
psql -h localhost -U postgres -d arcgpt_institution -f src/migration/sql/institution.sql
psql -h localhost -U postgres -d arcgpt_institution -f src/migration/sql/seed_institution.sql
psql -h localhost -U postgres -d arcgpt_institution -f src/migration/sql/file1.sql
psql -h localhost -U postgres -d arcgpt_institution -f src/migration/sql/file2_student_expansion.sql
psql -h localhost -U postgres -d arcgpt_institution -f src/migration/sql/seed_student_expansion.sql
# verify:
psql -h localhost -U postgres -d arcgpt_institution -f src/migration/sql/verify_student_expansion.sql
```

| File | Size | Creates |
| --- | --- | --- |
| `institution.sql` | 14.7 KB | 33 institution tables + the `student_attendance_percentage` view + 15 indexes |
| `seed_institution.sql` | 14 KB | base seed data |
| `file1.sql` | 10.6 KB | **ArcGPT control tables** — see below — plus the `arcgpt_reader` role + grants |
| `file2_student_expansion.sql` | 12 KB | guardian / residency / student-profile expansion (idempotent, transactional) |
| `seed_student_expansion.sql` | 26.1 KB | dataset expansion, configurable via a `seed_config` block at the top: `students_per_department`, `day_scholar_percentage`, `hosteller_percentage`. Configured to give **50 active students in each of 6 departments = 300 total**. |
| `verify_student_expansion.sql` | 8.1 KB | verification queries |

### Institution tables (created by `institution.sql`)

```
academic_years  departments    programs       batches        sections
semesters       students       faculty        subjects       faculty_subjects
course_offerings attendance    assessments    student_marks  assignments
submissions     semester_results student_academic_summary     backlogs
timetable       exams          exam_schedule  announcements  placement_drives
placement_applications hostels  rooms         hostel_allocations
books           library_transactions           bus_routes    bus_stops
student_transport
+ VIEW student_attendance_percentage
```

`file2_student_expansion.sql` adds `guardians`, `student_residency`, and the
`student_profile_view` view — which flattens name, register/admission number, email,
phone, programme, batch, section, parent/guardian contact, cgpa, sgpa,
`current_backlog_count`, `residency_type`, `hostel_name` and `room_number` into one
queryable surface. The system prompt tells the model to prefer this view for any
student-record question.

### ArcGPT control tables (created by `file1.sql` — **`institution.sql` does not create these**)

```
roles  arcgpt_users  arcgpt_sessions  permissions  role_permissions
ai_queries  saved_queries  ai_conversations  ai_messages
feedback  audit_logs  security_events  system_settings
```

`arcgpt_users` columns: `user_id UUID PK`, `full_name`, `email UNIQUE`,
`password_hash`, `role`, `department_code`, `department_id`, `student_id`,
`status CHECK IN ('ACTIVE','INACTIVE','SUSPENDED')`, `last_login`, `created_at`,
`updated_at`. `phone TEXT` is added at startup by `databaseService.initialize()`.

`databaseService.initialize()` runs three idempotent statements on every boot:
1. `ALTER TABLE public.arcgpt_users ADD COLUMN IF NOT EXISTS phone TEXT;`
2. seed the 9 dot-notation permissions (`users.view`, `users.create`, `users.edit`,
   `users.disable`, `users.delete`, `roles.assign`, `hod.department.assign`,
   `student.delete`, `data.import`) with `ON CONFLICT DO NOTHING`
3. grant every permission to `ADMIN` and `SUPER_ADMIN` via a `roles × permissions`
   cross join

Failures are logged as `[DB INIT] Migration warning:` and never block startup.

---

## 10. The API surface

All routes are registered inline in `backend/server.ts`. `requireAuth` returns
`401 {"error":"Authentication required."}`; `requireAdmin` returns 401 or
`403 {"error":"Administrator role required."}`.

### Auth

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/auth/demo-personas` | none | skips session middleware |
| POST | `/api/auth/login` | none | skips session middleware; sets cookie |
| POST | `/api/auth/logout` | cookie | clears cookie, deletes session row |
| GET | `/api/auth/me` | `requireAuth` | current user |

### Query + conversations (the chat surface)

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/api/query` | `requireAuth` | alias of `/api/query/translate` |
| POST | `/api/query/translate` | `requireAuth` | **the core endpoint** |
| GET | `/api/conversations?limit=50` | `requireAuth` | `parseLimit(limit, 50, 200)` |
| GET | `/api/conversations/:id` | `requireAuth` | 404 if not yours |
| DELETE | `/api/conversations/:id` | `requireAuth` | cascade removes messages |

### Read/dashboard

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/api/schema` | `requireAuth` (refreshes from DB, returns `source: 'postgresql'\|'declared'`) |
| GET | `/api/history?limit=` | `requireAuth` |
| DELETE | `/api/history/:id` | `requireAuth` |
| GET | `/api/stats` | `requireAuth` |
| GET | `/api/insights` | `requireAuth` |
| GET | `/api/audit-logs?limit=100` | **`requireAdmin`** |
| GET | `/api/analytics` | **`requireAdmin`** |
| POST | `/api/feedback` | `requireAuth` |
| GET | `/api/saved-queries` | `requireAuth` |
| POST | `/api/saved-queries` | `requireAuth` |
| PUT | `/api/saved-queries/:id` | `requireAuth` |
| DELETE | `/api/saved-queries/:id` | `requireAuth` |
| GET | `/api/students` | `requireAuth` (HOD auto-scoped) |
| GET | `/api/admin/students` | `requireAuth` (alias) |

### Admin (all `requireAdmin`, most with a `/api/admin/…` alias)

```
GET    /api/users                  | GET    /api/admin/users
POST   /api/users                  | POST   /api/admin/users
PUT    /api/users/:id              | PUT    /api/admin/users/:id
POST   /api/users/:id/toggle-status| POST   /api/admin/users/:id/toggle-status
GET    /api/admin/departments      | GET    /api/admin/roles
GET    /api/admin/schema           | GET    /api/admin/queries
GET    /api/admin/security-events  | GET/POST /api/admin/ai-config
POST   /api/admin/students/:id/remove   | DELETE /api/admin/students/:id
POST   /api/admin/students/:id/reactivate
GET    /api/admin/import/tables
GET    /api/admin/import/template/:table
POST   /api/admin/import/preview
POST   /api/admin/import/execute
GET    /api/connection/status
POST   /api/connection/test
POST   /api/schema/refresh
GET    /api/debug/database         (also 404s when NODE_ENV=production)
```

### Unauthenticated

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/health` | `{ server, ollama, postgresql, ollama_model }` — `ollama`/`postgresql` are `'ok'` or `'offline'` |
| — | any other `/api/*` | `404 {"error":"API route not found."}` (catch-all registered **before** the static/Vite handler) |

### Express middleware order (`startServer`, lines 159–167)

```
1. app.disable('x-powered-by')
2. app.set('trust proxy', 1)
3. helmet({ contentSecurityPolicy: isProduction ? undefined : false })
4. cors({ origin: requestOrigin, credentials: true })
5. express.json({ limit: '10mb' })
6. express.text({ limit: '10mb' })
7. cookieParser()
8. app.use('/api', rateLimit({ windowMs: 60000, limit: 120, standardHeaders: 'draft-7' }))
9. app.use('/api', <session resolution + dev bootstrap>)   ← skips /health, /auth/login, /auth/demo-personas
```

Then routes → `/api` 404 catch-all → static/Vite.

`requestOrigin` allows the request when there is no `Origin` header. Configured origins
come from `APP_URL` (comma-separated). In production **only** that list is allowed; in
development `localhost:3000`, `127.0.0.1:3000`, `localhost:5173`, `127.0.0.1:5173` are
added automatically.

### Startup and shutdown

```ts
await databaseService.initialize();            // .catch → console.error('[DB INIT]', …)
await schemaService.refreshFromDatabase();     // NOT caught — a hard failure
await authService.bootstrapFromEnvironment();  // .catch → console.error('[Auth bootstrap]', …)
```

`app.listen(PORT, '0.0.0.0', …)` — binds **all interfaces**. The listen callback checks
Ollama and PostgreSQL in parallel and prints a banner. `SIGINT`/`SIGTERM` trigger
`server.close()` then `closeDatabasePools()`. A fatal startup failure logs
`Fatal server startup failure:` and `process.exit(1)`.

### Error handling — a known gap

**There is no Express error-handling middleware** (`(err, req, res, next)`). Every route
body is wrapped in its own `try/catch` returning a hard-coded 401/400/404/500/503 JSON.
Express 4 does not catch async throws, so an unhandled rejection in an async handler is
not routed anywhere — it becomes an unhandled promise rejection.

---

## 11. Environment variables

**All backend configuration lives in `backend/.env`.** Nothing prefixed `VITE_` may ever
contain a secret — those are inlined into the public bundle at build time.

`backend/.env.example` (full list):

| Variable | Default | Purpose |
| --- | --- | --- |
| `DB_HOST` | `localhost` | |
| `DB_PORT` | `5432` | |
| `DB_NAME` | `arcgpt_institution` | |
| `DB_USER` | `postgres` | admin pool — migrations, auth, logging |
| `DB_PASSWORD` | `postgres` | **change this** |
| `DB_READONLY_USER` | *(unset)* | `arcgpt_reader`; required for real read-only isolation |
| `DB_READONLY_PASSWORD` | *(unset)* | |
| `DB_POOL_MAX` | `10` | |
| `DB_READONLY_POOL_MAX` | `5` | |
| `DB_IDLE_TIMEOUT_MS` | `30000` | |
| `DB_CONNECTION_TIMEOUT_MS` | `5000` | |
| `DB_STATEMENT_TIMEOUT_MS` | `10000` | also becomes `query_timeout_seconds` in the AI config |
| `MAX_RESULT_ROWS` | `500` | row cap in `executeSql` |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | trailing slash stripped |
| `OLLAMA_MODEL` | `qwen2.5-coder:7b` | |
| `SERVER_PORT` / `PORT` | `3000` | `SERVER_PORT` wins |
| `SESSION_SECRET` | `change-me-…` | **change this**; reserved for future signed material |
| `LOCAL_ADMIN_EMAIL` | `admin@institution.edu` | first-run bootstrap admin |
| `LOCAL_ADMIN_PASSWORD` | `AdminPassword123!` | **change this** — this is the identity the chat uses |
| `LOCAL_ADMIN_NAME` | `ArcGPT Administrator` | |
| `LOCAL_AUTO_SESSION` | `true` in dev | `false` disables the dev bootstrap session |
| `APP_URL` | `http://localhost:3000` | comma-separated CORS allowlist |
| `NODE_ENV` | — | `production` disables the dev bootstrap and enables CSP |
| `SERVE_FRONTEND` | `true` | `false` = API-only mode |
| `BCRYPT_ROUNDS` | `12` | |

`frontend/.env.example` documents exactly one variable, `VITE_BACKEND_URL`, and
explicitly says to **leave it unset**. The file also restates that the frontend holds no
secrets.

Variables read in code but absent from `.env.example`: `MAX_RESULT_ROWS`,
`BCRYPT_ROUNDS`, `LOCAL_ADMIN_NAME`, `SERVE_FRONTEND`, `DISABLE_HMR` (frontend),
`VITE_DEV_PROXY_TARGET` (frontend).

---

## 12. Frontend architecture

### Routing — there is no router

`src/main.tsx` is 13 lines and the *entire* route table:

```tsx
const isAdminRoute = window.location.pathname === '/admin';
createRoot(document.getElementById('root')!).render(
  <StrictMode>{isAdminRoute ? <App /> : <UserChat />}</StrictMode>
);
```

| `location.pathname` | Component |
| --- | --- |
| `/admin` (exact) | `src/App.tsx` — the admin portal, itself gated by a demo-persona `LoginPage` |
| anything else | `src/user/UserChat.tsx` — the ArcGPT chat |

Consequences: a **reload is required** to move between surfaces. `App.tsx` calls
`window.history.pushState` in `handleTabChange`, but `main.tsx` never re-reads
`location` and there is no `popstate` listener, so the pushed URL does not change what
renders and back/forward is a no-op in-app. `/admin/` (trailing slash) falls through to
the chat.

### Two design systems, deliberately

| | `src/user/` — the chat | `src/components/` — the admin |
| --- | --- | --- |
| Styling | 1375-line global plain CSS, `arc-*` classes, **zero Tailwind** | Tailwind utility classes, light slate/blue/white |
| Theme | pure black + gold | light, rounded cards, 11–13px type |
| State | local `useState`/`useRef` | local `useState` |
| Imports | nothing from `src/components/` | nothing from `src/user/` |

The chat is the product. The admin panel is a secondary surface kept intact.

### The chat design system (`user.css`)

Custom properties on `.arc-user-root` are the authoritative palette:

| Property | Value | Use |
| --- | --- | --- |
| `--arc-bg` | `#000000` | page field |
| `--arc-ink` | `#f3f2f0` | primary text |
| `--arc-muted` | `#92919e` | secondary text |
| `--arc-faint` | `#5d5c68` | tertiary / timestamps |
| `--arc-line` | `rgba(255,255,255,0.12)` | hairline dividers |
| `--arc-line-strong` | `rgba(255,255,255,0.2)` | composer border |
| **`--arc-accent`** | **`#e0be70`** | the single warm-gold accent |
| `--arc-accent-soft` | `rgba(224,190,112,0.14)` | icon chip fills |
| `--arc-accent-bright` | `#ecd79b` | link hover |
| `--arc-danger` | `#e6a6a7` | error glyph |

Other notable values: `#777682` placeholder, `#d9bb6a` caret, `#ece7dd` send glyph,
`#85838f` secondary labels, `#dedce5` brand wordmark, `#f0eee9` user bubble text,
`#e5e3e8` assistant text, `#090a0f` selection text, `rgba(255,255,255,0.06)` bubble
fill, `rgba(0,0,0,0.62)` mobile scrim, `rgba(6,6,8,0.92)` export menu.

Font stack: `Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI",
sans-serif`. **Inter is referenced but never loaded** (no `<link>`, no `@font-face`) — it
silently falls through to the system UI. Mono stack for code:
`"SFMono-Regular", Consolas, "Liberation Mono", monospace`.

Layout metrics: `.arc-composer` `min-height: 58px`, `border-radius: 999px`,
`background: rgba(0,0,0,0.66)`, `backdrop-filter: blur(18px)`;
`.arc-thread` `width: min(850px, 100%)`, `padding: clamp(26px,7vh,78px) 28px 164px`;
`.arc-composer-dock` is `position: absolute` over a
`linear-gradient(180deg, transparent, rgba(0,0,0,0.5) 40%, rgba(0,0,0,0.8))` fade so
the animated backdrop still reads through; `.arc-assistant-message` is a
`24px minmax(0,1fr)` grid with a 15px gap; `.arc-result-table-wrap` is
`max-height: min(52vh, 520px); overflow: auto` with `position: sticky` headers on opaque
`#000000`.

Animations: `arc-screen-in` (620ms `cubic-bezier(0.22,1,0.36,1)`), `arc-message-in`
(650ms translateY 12px→0), `arc-export-menu-in` (160ms),
`arc-loading-message` (a **grid-rows `0fr → 1fr` collapse**, with the `grid-template-rows`
transition delayed 260ms so the fade-out is visible before the box collapses).

**There are exactly two breakpoints.** `(max-width: 767px)` is JS-only — it selects
`MobileSidebar` over `DesktopSidebar`. `(max-width: 640px)` is the single CSS media
query, and it also hides the second caption span, the dock caption, and the export
trigger's text label. `(prefers-reduced-motion: reduce)` collapses every animation and
transition to `0.01ms !important`.

### `LiquidMetalSendButton.tsx` — WebGL2

A direct port of the dispersion shader from
`ASSETS/web assets/liquid metel/signup_pill.html`. `sdPill` degenerates to an exact
circle when `b.x === b.y === r`, so the field/rim/bloom/composite passes run unmodified
against a circular mask. The `<button>` itself is untouched — same tag, 38px box,
`ArrowUp` icon, same submit behaviour; the canvas is painted *behind* it.

Seven GLSL ES 3.00 sources as module-level template strings: `VERT` (one big triangle),
`HEAD` (shared uniforms + `sdPill`/`ripple`/`pointerW`), `FRAG_RIM`, `FRAG_SCENE`
(4-octave fbm, 21-sample spectral loop, `col *= vec3(1.07,1.0,0.9)` champagne cast),
`FRAG_DOWN`, `FRAG_BLUR`, `FRAG_COMP`. Six FBOs per frame; `RGBA16F` when
`EXT_color_buffer_half_float` is available, else `RGBA8`. DPR capped at 2. Canvas is
140% of the 38px host so the bloom fits inside the composer's rounded clip.

Frame-rate-independent smoothing: heat `1 - 0.0012^dt` up / `1 - 0.00012^dt` down;
press `1e-9`/`0.004`, snapping at deltas of `0.0008`/`0.002`.

**Fallbacks are real.** If `getContext('webgl2')` returns null *or* any program fails to
compile/link, `host.dataset.fallback = 'true'` and a plain CSS metal disc renders
instead — the button still works. Under `prefers-reduced-motion` the clock freezes and
the loop takes a "still" shortcut that skips the draw entirely.

Cleanup cancels the rAF, disconnects the ResizeObserver, removes all 10 listeners, and
deletes 6 textures + 6 FBOs + 5 programs + the buffer + the VAO.

### `MarkdownMessage.tsx` — hand-written, dependency-free

Block + inline renderer. **No `react-markdown`, no `marked`, no `remark`**, and nothing
is ever passed to `dangerouslySetInnerHTML`. Supported: fenced code, ATX headings
(`#`–`######`, **shifted +1** so `#` renders as `<h2>`), `hr`, blockquote, ul/ol, GFM
pipe tables, paragraphs; inline `` `code` ``, `**bold**`, `__bold__`, `*em*`, `_em_*`,
`[text](url)`.

XSS control: `isSafeLink(href)` = `/^(https?:\/\/|mailto:|\/(?!\/))/i`. An unsafe href is
emitted as **literal text, never an `<a>`**. Safe links get `target="_blank"
rel="noreferrer"`.

### `apiClient.ts` — the single seam

```ts
const RAW_BASE_URL = (import.meta.env?.VITE_BACKEND_URL as string | undefined) ?? '';
export const API_BASE_URL = RAW_BASE_URL.replace(/\/+$/, '');
```

| Export | Signature |
| --- | --- |
| `API_BASE_URL` | resolved, slash-trimmed base (`''` ⇒ same-origin) |
| `ApiError` | `class ApiError extends Error` with `readonly status: number` |
| `apiUrl(path)` | `API_BASE_URL + normalizedPath` (prepends `/` if missing) |
| `apiFetch(path, init?)` | `fetch(apiUrl(path), { ...init, credentials: 'include' })` — **Response passed through untouched**, no error normalisation |
| `apiJson<T>(path, init?)` | throws `ApiError` on non-`ok`, else `res.json() as T` |
| `apiVoid(path, init?)` | same, discards the body (**currently unused**) |
| `apiPost(body, signal?)` | `{ method:'POST', headers:{'Content-Type':'application/json'}, body, signal? }` |

- `credentials: 'include'` on every call and a caller **cannot** override it
  (`{ ...init, credentials: 'include' }`).
- **No `Authorization` header and no token in JS anywhere.** The cookie is HTTP-only.
- **There is no timeout in this file** — no `AbortSignal.timeout`, no racing timer.
  Cancellation is entirely caller-driven, and only `UserChat` does it.
- Aborts (`DOMException` named `AbortError`) are rethrown as-is, never wrapped.
  Everything else becomes `new ApiError('ArcGPT could not reach the local backend
  service.', 0)` where `status: 0` means "network unreachable".
- The 401 retry (§8) replays the body — safe today because no caller uses a
  `ReadableStream` body.

### Export (`lib/exportAnswer.ts`)

- **CSV** — `buildAnswerCsv` / `downloadAnswerCsv`. **Formula-injection guard:** strings
  starting `=`, `+`, `-`, `@`, `\t` or `\r` are prefixed with an apostrophe so an
  LLM-produced row value cannot execute in Excel/Sheets. Numbers and booleans stay bare
  so spreadsheets keep them numeric. `\r\n` line endings. A metadata block
  (Question/Answer/Status/Rows/Exported), a blank line, then the table **padded** to
  `columns.length` so both sections align. Download uses `Blob` +
  `URL.createObjectURL` with `revokeObjectURL` on `setTimeout(0)` — a `data:` URI is
  avoided because of browser length ceilings.
- **PDF** — `openAnswerPrintPreview` is a **print window, not a PDF library**:
  `window.open('', '_blank')` + `document.write` + `print()`. The generated document is
  standalone HTML with `@page { margin: 14mm }`,
  `thead { display: table-header-group }` (repeating headers),
  `tr { break-inside: avoid }`, accent `#e0be70`, ink `#1b1b1f`, meta `#6f6e78`. It must
  be called synchronously from a click handler to avoid the popup blocker, and it prints
  150ms after `load` because `document.write` parses asynchronously.

### The `LoadingMessage` generation animation

Always mounted; only an `is-active` class toggles. The video is kept alive for the
whole thread so the clip resumes where it reached instead of snapping to frame 0, and so
the fade-out has somewhere to happen.

An inline zero-size `<svg class="arc-luma-defs">` holds `<filter id="arc-luma-key">`
with a `feColorMatrix` putting `0.2126 0.7152 0.0722 0 0` in the **alpha** row — the clip
is a yellow mark on opaque black, so alpha is derived from **luminance** to punch the
black field out. Applied via `filter: url(#arc-luma-key)`, with a second
`radial-gradient` mask (0%→34% opaque, 52%→78%, 70%→34%, 85%→9%, 100%→0) as a feather.

Source: `/arc/inside-chat-animation.mp4`. Under `prefers-reduced-motion` it is paused
and seeked to `currentTime = 0`.

### `ChatSidebar.tsx`

Exports `Sidebar` (a `createContext` provider), `SidebarBody`, `DesktopSidebar`,
`MobileSidebar`, `ThreadList`, `SidebarRailMark`, `useSidebar` (throws outside a
provider), and the `ChatThreadSummary` type.

- `useIsMobile()` keeps the flag in React state with a `change` listener so only the
  current viewport's variant is mounted — one DOM, one scroll container, one set of
  rows. Second guard: `(hover: hover) and (pointer: fine)`, so a touch drag across the
  left edge cannot open the panel.
- Desktop: `motion.aside` animating `width: open ? 300 : 60`, `duration 0.32`,
  `ease [0.22,1,0.36,1]`, `initial={false}`. Hover only drives it when
  `event.pointerType === 'mouse'`; `onFocusCapture` sets a `manual` flag so a keyboard
  focus isn't undone by pointer drift.
- Mobile: `AnimatePresence` + a scrim at `rgba(0,0,0,0.62)` (click closes) + a drawer
  `role="dialog" aria-modal="true"` sliding `x: '-100%' → 0 → '-100%'` over 0.3s.
- `ThreadList` **returns `null` when `!open`**, so the list is genuinely absent from the
  60px rail. Clicking a row selects *and* closes the panel.
- `formatWhen(ts)` → `'now'` (<60s) / `Nm` / `Nh` / `Nd`.

### `ChatExportMenu.tsx`

Split button: PDF and CSV. Dismissal on **`pointerdown`** outside (not `click`) so it
closes in the same gesture. A `useEffect` closes the menu whenever the `answer` object
identity changes — a menu left open would point at an answer the user never saw. Roving
focus handles `Escape` (preventDefault + close + return focus) and `ArrowDown`/`ArrowUp`
with wraparound; container `onBlur` closes if focus leaves the subtree. Full ARIA:
`role="menu"`/`menuitem`, `aria-haspopup`, `aria-expanded`, `aria-controls` via `useId`.

### Admin surface (`src/components/`, 17 files)

`Header` (top bar + profile dropdown), `Sidebar` (`NavTab` union, 256px, Admin Console
gated on `userRole === 'Admin'`), `LoginPage` (full-screen persona picker — the admin
app's root when unauthenticated), `LoginModal`, `SettingsModal` (static), plus
`AdminDashboard` (**1689 lines, the largest file in the project**; 10 sub-tabs:
`overview, users, roles, schema, ai_config, security, monitor, audit, analytics,
settings`), `DashboardOverview`, `QueryInput`, `TimelineProgress` (6-tile pipeline
progress), `ResultViewer` (table/chart toggle, filter, 10-row pagination, copy-SQL
details), `AmbiguityClarifier`, `InsightsView`, `HistoryView`, `SavedQueriesView`,
`SchemaViewer`, `SecurityDemoModal` (6 runnable SQL-injection cases).

`src/data/demoUsers.ts` is a **display list only** for the persona picker — it is not
authentication.

---

## 13. Setup and run

### Prerequisites

Node.js 20+, PostgreSQL 14+, Ollama with the configured model.

### 1. Backend

```bash
cd backend
npm ci
cp .env.example .env      # then edit: DB_PASSWORD, SESSION_SECRET, LOCAL_ADMIN_PASSWORD
```

`LOCAL_ADMIN_PASSWORD` must not be left at the example placeholder. That account is
created on first run and **is the identity the chat uses**.

### 2. Database

Apply the six `.sql` files in the order given in §9. Optionally enable the read-only role:

```sql
ALTER ROLE arcgpt_reader LOGIN PASSWORD 'use-a-local-secret';
GRANT CONNECT ON DATABASE arcgpt_institution TO arcgpt_reader;
```

then set `DB_READONLY_USER` / `DB_READONLY_PASSWORD` in `.env`.

### 3. AI engine

```powershell
ollama serve
ollama pull qwen2.5-coder:7b-instruct   # or whatever OLLAMA_MODEL is set to
```

### 4. Start

```bash
cd backend
npm run dev                  # development (Vite in middleware mode)
npm run build && npm start   # production (serves frontend/dist)
```

Open <http://localhost:3000>. The chat is at `/`; the admin panel is at `/admin`.

### Checks

```bash
cd backend  && npm run lint && npm test
cd frontend && npm run lint && npm run build
```

`npm test` (`tests/core.test.ts`) covers the SQL guardrails and **runs without
PostgreSQL**. `npm run test:integration` needs both PostgreSQL and Ollama.
`tests/acceptance.test.ts` needs a running server on :3000 and is not wired to a script.

---

## 14. Tests

### `tests/core.test.ts` (`npm test`, no DB required)

1. A valid `SELECT COUNT(*) FROM students` is accepted.
2. **15 statements that must be blocked**, including: `DELETE`, `DROP TABLE`, `TRUNCATE`,
   `INSERT`, `UPDATE`, `ALTER TABLE ADD COLUMN`, `GRANT ALL … TO PUBLIC`, a **stacked
   statement** (`SELECT … ; DROP TABLE students;`), a **comment injection**
   (`SELECT … -- comment`), `pg_catalog.pg_authid`, `SELECT password FROM students`,
   `pg_read_file('/etc/passwd')`, `set_config('app.role', …)` and
   `current_setting('app.secret')`.
3. RBAC: Faculty denied `fees`; Principal gets `{role:'PRINCIPAL', scope:'GLOBAL'}`,
   may query any department, and **must not** be department-scoped, yet is still denied
   `hostels`; HOD gets `{role:'HOD', scope:'ASSIGNED_DEPARTMENT', departmentId}`;
   HOD `OR TRUE` / CTE / `UNION` / nested `SELECT … IN (SELECT …)` are all rejected while
   `students ⋈ departments` and `students ⋈ student_academic_summary` are accepted.

### `tests/integration.test.ts` (`npm run test:integration`)

Asserts PostgreSQL reachable, Ollama available, and
`executeSql('SELECT 1 AS connection_value')` returns `{resultStatus:'SUCCESS'}` with
`rows[0].connection_value === 1`. Calls `closeDatabasePools()` in both paths.

### `tests/acceptance.test.ts` (manual, server must be running)

Full offline acceptance run against `http://localhost:3000`: health check, admin login
(hard-codes `admin@institution.edu` / `AdminPassword123!` — **change these or this test
will fail once the bootstrap password is rotated**), then query/conversation flows.

### `scripts/`

- `db_check.ts` — prints `arcgpt_users` columns. Trivial diagnostic.
- `setup-db.js` — legacy scaffold helper (uses 10 bcrypt rounds). Not wired to any script.

---

## 15. Known issues and gotchas

Things that are real, currently true, and that a future change should either fix
deliberately or work around. **Do not assume the README is right about these.**

### Security / correctness

1. **Model name inconsistency.** `ai.ts` defaults to `qwen2.5-coder:7b` (valid Ollama
   `repo:tag`), but `database.service.ts` `defaultAiConfiguration` and `file1.sql` still
   use `qwen2.5-coder-7b-instruct` (a HuggingFace-style name that **does not exist in
   the Ollama registry**). The displayed AI config will name a model that cannot be
   pulled.
2. **`fees` is unreachable by anyone.** It is in `SENSITIVE_TABLES` but not in
   `ALLOWED_TABLE_NAMES`, so guardrail 9 rejects it before the Accounts role check. There
   is also no `fees` table in `institution.sql`.
3. **`faculty_subjects` is not whitelisted**, so a legitimate join through it is blocked.
4. **No column-level whitelist.** `referencedColumns` is collected but never enforced, and
   `SELECT *` is **not** blocked — contradicting `README.md`.
5. **Generated SQL is executed verbatim with no parameters.** Safety depends entirely on
   the validator plus the `BEGIN READ ONLY` transaction.
6. **If `DB_READONLY_USER` is unset, `readerPool` is an alias of the admin `pool`** — the
   read-only isolation is then provided only by `BEGIN READ ONLY` and the validator.
7. **HOD `allDepts` is hard-coded** to `['AIML','CSE','ECE','EEE','IT','MECH','CIVIL']` in
   the validator, and independently in the pipeline's step-2 regex. Adding a department
   means editing both.
8. **`bootstrapFromEnvironment` does not rotate the password hash** on conflict.
9. **Password minimum is 8 characters in code**, 12 in the README.
10. **Audit logs never capture an IP address** even though the column exists.

### Frontend / admin surface

11. **`AdminDashboard.handleRoleChange` POSTs to `/api/users/:id/role`, which does not
    exist.** The backend registers `PUT /api/users/:id`. The call 404s and the role
    `<select>` silently does nothing.
12. **Five call sites bypass `apiClient` and use bare `fetch`**:
    `HistoryView.handleDelete`, `SavedQueriesView.handleRename`,
    `SavedQueriesView.handleDelete`, `AdminDashboard.handleRoleChange`,
    `AdminDashboard.handleToggleStatus`. Three of them omit `credentials: 'include'`
    and will fail if the frontend is ever served cross-origin.
13. **`App.tsx` `handleFeedback` never calls an API.** It only shows a toast, even though
    `POST /api/feedback` exists (`server.ts:464`).
14. **`AdminDashboard`'s `aiConfig` is pure local state** — never persisted or sent. The
    four "ON" safeguard badges are static markup, not toggles.
15. **`SettingsModal` claims "Gemini 3.8 Flash"** but the backend is Ollama-only. It is
    static, non-interactive text.
16. **`LoginPage` has a bug**: it maps 5 `DEMO_USERS` into a `grid-cols-3` and labels the
    tabs by `user.role`, so "Faculty" appears twice, and
    `DEMO_USERS.find(u => u.role === selectedRole)` always resolves to the first match.
    It also holds a `customEmail` state that is set but never read.
17. **`USER_SUGGESTED_QUESTIONS` is duplicated byte-for-byte** in `QueryInput.tsx` and
    `DashboardOverview.tsx`.
18. **`Inter` is never loaded** — no `<link>`, no `@font-face`. Everything silently falls
    back to the system UI font.
19. **The result table has no sorting, filtering, pagination or virtualisation**, and
    row keys are index-based.
20. **Restored conversations show no rows.** Only message text is persisted.
21. **The chat discards server error text** and always shows "I couldn't complete that
    request. Please try again."

### Infrastructure

22. **No Express error-handling middleware.** Every route has its own `try/catch`; async
    throws in handlers are not routed to Express 4.
23. **The `/api` session middleware is `async`** and its `resolveBootstrapSession` error
    path is only partially guarded.
24. **`app.listen` binds `0.0.0.0`** — every interface, not just loopback. There is no
    TLS, no CSRF token, and no `csrf` package; `sameSite:'strict'` is the CSRF defence.
    CORS is credentialed but origin-restricted.
25. **`schemaService.refreshFromDatabase()` is the one startup step that is not caught.**
26. **`import.service.ts` has schema drift.** `executeImport` writes `attendance.remarks`,
    `student_marks.max_marks` / `.grade` and `backlogs.attempt_count` — **none of which
    exist in `institution.sql`**. Those imports will fail at runtime against a database
    built only from the documented migrations. (`students.email` / `.phone` do exist.)
27. **No request timeout in `apiClient`.** A hung backend leaves the UI in the loading
    state indefinitely; only starting a new thread aborts it.
28. **Stale lockfiles** in `frontend/` (`package-lock.json` + `bun.lock`, both naming
    `react-example` / `@google/genai`) and a merged `node_modules` containing packages
    nothing imports.
29. **`frontend/clean` uses `rm -rf dist`** — fails on Windows cmd/PowerShell.
30. **No `engines` field** in either `package.json`, despite the README requiring Node 20+.
31. **Dead code** (harmless only because `strict`/`noUnusedLocals` are off): unused lucide
    imports across 7 admin components, `normalizeRow`, `getActiveLocalAgentStatus`,
    `isValidRole`, `canManageUser`, `checkHealth`, `insertQueryHistory`, `apiVoid`,
    `.animate-indeterminate`, `--arc-bg-soft`.
32. **Vite/Tailwind/React live in the backend's `dependencies`** so that a
    `npm ci --omit=dev` still carries the frontend build toolchain.

---

## 16. Invariants a future change must not break

1. **The frontend bundle must never contain a secret, a database credential, an LLM key,
   or a session material.** All server config is in `backend/.env`; anything `VITE_`-prefixed
   is public by definition.
2. **The browser must never talk to PostgreSQL.** All data access goes
   browser → Express → validator → read-only transaction → PostgreSQL.
3. **LLM output is untrusted.** Nothing reaches `databaseService.executeSql` without
   passing `sqlValidationService.validate(rawSql, user)` first. Do not add a code path
   that skips it.
4. **One origin.** Do not split the frontend onto another port while the cookie is
   `sameSite:'strict'`.
5. **Guardrails are ordered and early-exit.** The masking step must remain *before* any
   keyword/table/identifier scan, and CTE names must remain subtracted from the detected
   table set.
6. **New SQL terminal states must be added to both vocabularies**: the backend's
   classification and `frontend/src/types/index.ts`'s `QueryExecutionStatus` **and**
   `KNOWN_STATUSES` in `UserChat.tsx`. Otherwise the UI silently renders them as
   failures.
7. **New tables the LLM may read must be added to `ALLOWED_TABLE_NAMES`** *and* given a
   `GRANT SELECT` for `arcgpt_reader` *and*, if it is a view, its **own** grant (views do
   not inherit table privileges).
8. **`core.test.ts` is the security regression suite.** The 15 blocked statements and the
   HOD AST proofs must keep failing to be blocked only if the behaviour was changed on
   purpose and the test was updated in the same commit.
9. **The chat UI is frozen by design.** Per the original merge brief: do not change
   layout, colours, typography, spacing, animations, sidebar, composer, the liquid-metal
   button, the loading animation, the logo, the favicon or responsive behaviour, except
   where a change is strictly required to connect something new. **A backend migration
   must not become a UI redesign.**
10. **Both `tsconfig`s lack `strict`.** Typechecking will not catch null/undefined or
    unused-code problems. Read carefully.

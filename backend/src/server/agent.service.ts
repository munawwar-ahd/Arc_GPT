import {
  generateChatReply,
  type LlmModelDescriptor,
  type LlmChatTurn,
} from './llm/index.js';
import { ConversationContextItem } from '../types/index.js';
import { describeError } from './errors.js';

/**
 * Intent routing: deciding whether a message needs the database at all.
 *
 * ## Why this exists
 *
 * The pipeline this replaces sent *every* message through SQL generation. A
 * greeting had nowhere to go: the model replied "Hello! How can I help?" in
 * prose, the JSON parser rejected it as malformed, and the user was told to
 * rephrase. That is the failure this file exists to remove.
 *
 * ## Why it is the model, and not a keyword list
 *
 * The naive fix is `if (text.includes('student')) needsDatabase = true`. It is
 * wrong in both directions and both errors are user-visible:
 *
 *   - "write me a Python function to sort a list" contains no institutional
 *     word and would be forced through a database query.
 *   - "explain the student loan scheme" contains "student" and would be sent to
 *     PostgreSQL, which cannot answer it.
 *   - "hi" contains nothing at all, so any keyword rule has to guess.
 *
 * So the same selected model that would have answered the question is asked
 * first whether it needs the database. That is cheap relative to a 30B
 * generation, it understands "them" from the conversation, and it stays correct
 * as new phrasings appear.
 *
 * ## What this is NOT allowed to do
 *
 * The router decides *routing only*. It never produces SQL that is executed, and
 * the answer it returns for a database question is never trusted as a query.
 * When it says "database", the normal pipeline runs unchanged — schema briefing,
 * JSON-constrained generation, `sqlValidationService.validate`, read-only pool.
 * Nothing here is a path around the validator; it is a decision about which path
 * to take.
 */

/** How many prior turns the router is shown. Enough for "them", not the transcript. */
const ROUTER_HISTORY_TURNS = 6;

/**
 * The router's own system prompt.
 *
 * Kept deliberately short and given explicit examples of each outcome, because
 * a small local model follows a concrete example far better than a definition.
 * The three verdicts mirror the three real paths through the pipeline.
 */
const ROUTER_SYSTEM_PROMPT = `You are the request router for ArcGPT, a local AI assistant connected to a read-only college database.

Decide whether answering the user's message requires looking up records in that database.

Reply with ONLY a JSON object: {"needsDatabase": true|false, "reason": "<max 12 words>"}

Choose true when the answer depends on real records: students, staff, attendance, marks, IATs, grades, GPA, CGPA, backlogs, fees, hostel allocation, timetable, departments, programmes, subjects, semesters, sections, or institutional counts. Also true when the message refers back to a previous answer that came from the database ("them", "those", "of those students").

Choose false when the message can be answered from general knowledge or simple reasoning: greetings and small talk, jokes, programming help, explanations of concepts, writing, mathematics, opinions, or questions about yourself and your capabilities.

Examples:
"hi" -> {"needsDatabase": false, "reason": "Greeting, no data needed"}
"who are you?" -> {"needsDatabase": false, "reason": "Asks about the assistant itself"}
"explain recursion" -> {"needsDatabase": false, "reason": "General programming concept"}
"write a Python function to sort a list" -> {"needsDatabase": false, "reason": "General programming help"}
"what is machine learning?" -> {"needsDatabase": false, "reason": "General knowledge question"}
"tell me a joke" -> {"needsDatabase": false, "reason": "Small talk request"}
"how many AIML students are there?" -> {"needsDatabase": true, "reason": "Needs a student count from records"}
"who has attendance below 75%?" -> {"needsDatabase": true, "reason": "Needs attendance records"}
"what is the CGPA of AIML32022A07?" -> {"needsDatabase": true, "reason": "Needs a specific student's record"}
"how much hostel fee is pending?" -> {"needsDatabase": true, "reason": "Needs fee records"}
"which of them have backlogs?" -> {"needsDatabase": true, "reason": "Refers to a previous database result"}

When a message mixes both ("how many AIML students are there and what does AIML stand for?"), answer true: the record lookup happens, and the rest is explained normally.`;

/**
 * The verdict shape, enforced by the provider's constrained decoding.
 *
 * This is why the router can be trusted with a 7B model: the wire format cannot
 * come back as anything else. An earlier version asked for JSON in prose and the
 * model would sometimes answer the *question* instead of routing it — silently
 * producing a wrong verdict for a question like "which of them have backlogs?".
 */
const ROUTER_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    needsDatabase: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['needsDatabase', 'reason'],
};

export interface IntentDecision {
  needsDatabase: boolean;
  reason: string;
}

/**
 * Pulls the boolean out of the router's reply.
 *
 * The reply is tiny and the model is small, so this is forgiving about framing —
 * a fenced block, a leading "Sure!", surrounding prose — while still requiring
 * an unambiguous signal. An unparseable answer is treated as "does not need the
 * database" so that the fallback is a normal conversation rather than a SQL
 * pipeline being fed something that is not a question about data.
 */
function parseDecision(content: string): IntentDecision | null {
  if (typeof content !== 'string' || !content.trim()) return null;

  let candidate = content.trim();
  const fence = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidate = fence[1];
  candidate = candidate.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  const match = candidate.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[0]) as { needsDatabase?: unknown; reason?: unknown };
    if (typeof parsed.needsDatabase !== 'boolean') return null;
    return {
      needsDatabase: parsed.needsDatabase,
      reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 120) : '',
    };
  } catch {
    return null;
  }
}

/**
 * Turns the conversation transcript into plain `user`/`assistant` turns.
 *
 * Digests and prior SQL are dropped here on purpose: the router only needs to
 * know whether a previous answer came from the database, which the assistant's
 * own wording reveals. Sending the SQL would be sending a query to a component
 * whose only job is to decide whether to *ask* for one.
 */
function toChatTurns(history: ConversationContextItem[]): LlmChatTurn[] {
  return history
    .slice(-ROUTER_HISTORY_TURNS)
    .filter(item => (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string')
    .map(item => ({ role: item.role, content: item.content.slice(0, 2000) }));
}

export interface RouteOutcome {
  decision: IntentDecision;
  /** Set when the router itself failed and a safe default was used. */
  usedFallback?: 'conversation';
}

/**
 * Asks the selected model whether this message needs the database.
 *
 * Never throws. A provider that is down, times out, or answers unusably must not
 * turn a greeting into an error page — the whole point is that ArcGPT behaves
 * like an assistant — so every failure resolves to "no database needed", which
 * is the safe direction: it produces a normal answer instead of a failed query.
 */
export async function detectIntent(
  model: LlmModelDescriptor,
  question: string,
  history: ConversationContextItem[]
): Promise<RouteOutcome> {
  if (!model.available) {
    return { decision: { needsDatabase: false, reason: `${model.providerLabel} is unavailable` }, usedFallback: 'conversation' };
  }

  try {
    const reply = await generateChatReply(model, {
      systemPrompt: ROUTER_SYSTEM_PROMPT,
      userPrompt: question.slice(0, 2000),
      history: toChatTurns(history),
      temperature: 0,
      maxTokens: 200,
      timeoutMs: Number(process.env.LLM_ROUTER_TIMEOUT_MS || 60000),
      jsonSchema: ROUTER_SCHEMA,
    });

    const parsed = parseDecision(reply);
    if (parsed) return { decision: parsed };

    console.error('[Router] unusable reply, treating as conversation:', reply.slice(0, 200));
    return { decision: { needsDatabase: false, reason: 'Router reply could not be interpreted' }, usedFallback: 'conversation' };
  } catch (error) {
    // Logged, never surfaced: the reason string is internal, and the user sees a
    // normal assistant answer rather than a routing failure.
    console.error('[Router] intent detection failed:', describeError(error, 'unknown error'));
    return { decision: { needsDatabase: false, reason: 'Intent detection unavailable' }, usedFallback: 'conversation' };
  }
}

export const CONVERSATION_SYSTEM_PROMPT = `You are ArcGPT, a helpful AI assistant that runs entirely on this user's own machine.

Answer normally and well. This includes greetings, small talk, jokes, explanations, programming help, writing, and general knowledge — answer all of these directly and warmly.

You are also connected to a read-only database for a college, containing students, staff, attendance, marks, IATs, grades, GPA and CGPA, backlogs, fees, hostel allocation, timetable, departments, subjects and semesters. When a question needs those records, the system queries the database for you and the real results are provided to you automatically. You never write to it, and you never invent student numbers, marks or records: if you were not given real data for a question about the college, say plainly that you do not have that information rather than guessing.

Style:
- Be concise and direct. Skip flattery and filler openings.
- Use markdown for structure, but keep it light. Use a table only when comparing several items genuinely helps.
- Match the user's level of detail. A greeting gets a greeting back, not an essay.
- Never mention databases, SQL, queries, pipelines, models, providers, tables, columns or implementation details unless the user explicitly asks what you are or how you work.

If a question is about the college and is ambiguous, ask one short clarifying question rather than guessing.`;

export interface ConversationAnswer {
  answer: string;
}

/**
 * Produces a normal assistant reply.
 *
 * Throws only on a genuine provider failure, which the caller reports with the
 * existing per-engine message. There is no JSON to go wrong here, so a small
 * model that answers briefly, or with a preamble, is simply answering.
 */
export async function answerConversationally(
  model: LlmModelDescriptor,
  question: string,
  history: ConversationContextItem[]
): Promise<string> {
  const answer = await generateChatReply(model, {
    systemPrompt: CONVERSATION_SYSTEM_PROMPT,
    userPrompt: question.slice(0, 4000),
    history: toChatTurns(history),
    temperature: 0.7,
    maxTokens: Number(process.env.LLM_CHAT_MAX_TOKENS || 1500),
  });
  return answer.trim();
}

/**
 * Renders the real rows for the narrator.
 *
 * This is deliberately NOT `buildResultDigest`. That digest exists to let a
 * *follow-up query* scope itself to the previous answer, so it carries only
 * identifying columns — a count like `aiml_student_count` has none, and the
 * digest for "how many AIML students are there?" came out as just
 * `columns: aiml_student_count`, with the value 80 nowhere in it.
 *
 * Feeding that to the narrator is how an answer of "There are 120 AIML
 * students" came back for a result of 80: the narrator was shown no data and the
 * accuracy guard had nothing to check against. The narrator needs the values.
 */
export function renderRowsForNarration(
  columns: string[],
  rows: Record<string, unknown>[],
  maxRows = 12
): string {
  if (columns.length === 0 || rows.length === 0) return '';
  const shown = columns.slice(0, 12);
  const lines = rows.slice(0, maxRows).map(row =>
    shown.map(column => `${column}=${row[column] ?? ''}`).join(', ')
  );
  if (rows.length > maxRows) lines.push(`(${rows.length - maxRows} further rows not shown)`);
  return lines.join('\n');
}

/**
 * Every number that appears in a narrative must be traceable to a real source.
 *
 * This exists because the narrator was caught inventing figures. A query for
 * "how many AIML students are there?" returned exactly `80`, and the model
 * rewrote it as "150". A second case returned `1.64` and became "3.5".
 *
 * In a tool whose entire value is answering truthfully about a database, a
 * fluent answer with the wrong number in it is strictly worse than a plain one.
 * So the check is mechanical rather than a matter of trust: any numeric token in
 * the prose that cannot be found in the returned rows rejects the whole
 * narrative, and the deterministic summary — which cannot invent anything — is
 * used instead.
 *
 * `sources` is every legitimate origin for a figure: the rows themselves, and
 * the user's question. The question matters because a register number like
 * `AIML32022A07` carries the digits `32022`, and a narrator correctly echoing
 * the student the user asked about is quoting them, not inventing a statistic.
 *
 * Ordinals and small counting words are exempt because "5 students are shown"
 * and "first" describe the presentation, not the data.
 */
export function inventsANumber(narrative: string, ...sources: string[]): boolean {
  // Normalise the haystack so "1,32,500" and "132500" both match, and strip
  // thousands separators from the needles for the same reason.
  const haystack = new Set<string>();
  for (const source of sources) {
    for (const token of source.match(/\d[\d,]*\.?\d*/g) || []) {
      haystack.add(token.replace(/,/g, ''));
    }
  }
  const EXEMPT = new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);

  /** Decimal places actually written in the token, e.g. "1.64" -> 2. */
  const decimalsOf = (token: string): number => {
    const dot = token.indexOf('.');
    return dot === -1 ? 0 : token.length - dot - 1;
  };

  const numbersIn = (text: string) => text.match(/\d[\d,]*\.?\d*/g) || [];

  // A result set with no numbers in it cannot support a figure in the prose.
  // Catching this explicitly matters: an empty haystack would otherwise make
  // the loop below vacuously approve any number at all, which is exactly how an
  // invented "150 students" slipped through when the narrator was handed a
  // follow-up digest instead of the rows.
  const sourceHasNumber = sources.some(source => numbersIn(source).some(token => !EXEMPT.has(token.replace(/,/g, ''))));
  if (!sourceHasNumber) return numbersIn(narrative).some(token => !EXEMPT.has(token.replace(/,/g, '')));

  for (const raw of numbersIn(narrative)) {
    const token = raw.replace(/,/g, '');
    if (EXEMPT.has(token)) continue;
    if (haystack.has(token)) continue;

    const numeric = Number(token);
    if (Number.isFinite(numeric)) {
      /**
       * Rounding is allowed only to the precision actually written. "1.64" may
       * be shown as "1.6", because rounding to one decimal place cannot move a
       * value by more than 0.05 and the model said one decimal place. It may not
       * be shown as "3.5", because that is a different value rather than a
       * coarser rendering of the same one.
       *
       * Checking the digits the narrator chose, rather than using a fixed
       * tolerance, is what keeps the guard strict: the error a given precision
       * can hide is bounded by exactly half of its last place, so there is no
       * gap wide enough to smuggle a fabricated figure through.
       */
      const places = decimalsOf(token);
      const bound = places === 0 ? 0.5 : 0.5 * Math.pow(10, -places);

      const matches = [...haystack].some(candidate => {
        const value = Number(candidate);
        if (!Number.isFinite(value)) return false;
        if (Math.abs(value - numeric) > bound + Number.EPSILON) return false;
        // And the rounded form must actually be what rounding produces.
        return Number(value.toFixed(places)) === numeric;
      });
      if (matches) continue;
    }
    return true;
  }
  return false;
}

/**
 * Composes the closing sentence of a database answer.
 *
 * The rows are rendered by the UI as a table already; this produces the prose
 * that goes above it — "I found 6 students below 75% attendance." — so the chat
 * reads like an assistant rather than a query log.
 *
 * It is also what makes a *mixed* question work. "How many AIML students are
 * there and what does AIML stand for?" retrieves a count from the database and
 * then needs the non-data half answered too, which no amount of SQL can supply.
 * The prompt therefore allows general explanation alongside the figures, while
 * forbidding it to state anything about the data it was not given — and
 * `inventsANumber` enforces that last part rather than trusting it.
 *
 * On any failure the deterministic interpreter's answer is used instead, so a
 * model hiccup can never lose a result the database already returned.
 */
export async function narrateResult(
  model: LlmModelDescriptor,
  question: string,
  renderedRows: string,
  deterministicAnswer: string,
  history: ConversationContextItem[]
): Promise<string> {
  try {
    const narrative = await generateChatReply(model, {
      systemPrompt:
        'You are ArcGPT, a concise assistant. You are given the real results of a query the user asked for. ' +
        'Write ONE short answer, at most 3 short sentences, that responds to their question directly. ' +
        'Lead with what the data shows. If the question also asks something general that the data cannot answer ' +
        '(what an acronym stands for, what a concept means, advice), answer that part briefly too. ' +
        'Copy every figure exactly as it appears in the data; never round, re-estimate or invent a number. ' +
        'Never mention SQL, databases, queries, tables, columns or how the data was retrieved. ' +
        'Do not output a markdown table, heading or bullet list. Output only the answer.',
      userPrompt: `Question: ${question.slice(0, 1000)}\n\nResults:\n${renderedRows.slice(0, 4000)}`,
      history: toChatTurns(history),
      temperature: 0.2,
      maxTokens: 300,
      timeoutMs: Number(process.env.LLM_NARRATOR_TIMEOUT_MS || 60000),
    });
    const cleaned = narrative.trim();
    if (!cleaned || cleaned.length > 900) return deterministicAnswer;
    // A leaked implementation detail is worse than the deterministic sentence,
    // which is always safe.
    if (/\b(sql|select |query|postgresql|database|table|column|row)\b/i.test(cleaned)) {
      return deterministicAnswer;
    }
    // The hard one: a number that is not in the data means the answer is wrong.
    if (inventsANumber(cleaned, renderedRows, question)) {
      console.error('[Narrator] rejected: stated a figure that is not in the results');
      return deterministicAnswer;
    }
    return cleaned;
  } catch (error) {
    console.error('[Narrator] falling back to the deterministic summary:', describeError(error, 'unknown error'));
    return deterministicAnswer;
  }
}

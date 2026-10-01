import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { parseStructuredSqlResponse } from '../src/server/llm/structured-output.js';
import { displayNameForModel } from '../src/server/llm/lmstudio.provider.js';
import {
  DEFAULT_PROVIDER_ID,
  listAvailableModels,
  resolveModelSelection,
  getProvider,
} from '../src/server/llm/index.js';
import { sqlValidationService } from '../src/server/sql-validation.service.js';
import { User } from '../src/types/index.js';

/**
 * Provider-routing and model-selection tests.
 *
 * These need neither PostgreSQL nor a running model server, so they run as part
 * of `npm test`. They cover the two things that are easy to get quietly wrong
 * when a second provider is added:
 *
 *   1. Structured output parsing — a provider must not be able to hand the
 *      pipeline something that is not `{ intent, tables, sql }`.
 *   2. Model selection is inert — choosing a different model must not change
 *      what the database allows. That is asserted at the source level, because
 *      the guarantee is about the *shape of the code path*, not about any one
 *      SQL statement.
 */

const admin: User = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Test Admin',
  email: 'test@example.local',
  role: 'Admin',
};

async function run(): Promise<void> {
  // =========================================================================
  // 1. Structured output parsing
  // =========================================================================
  const good = { intent: 'list students', tables: ['students'], sql: 'SELECT 1' };
  const accepted: Array<[string, string]> = [
    ['bare json', JSON.stringify(good)],
    ['fenced json', '```json\n' + JSON.stringify(good) + '\n```'],
    ['fenced sql', '```sql\n' + JSON.stringify(good) + '\n```'],
    ['preamble then fence', 'Sure! Here is the query:\n```json\n' + JSON.stringify(good) + '\n```'],
    ['prose around json', 'Answer:\n' + JSON.stringify(good) + '\nHope that helps.'],
    ['extra keys ignored', JSON.stringify({ ...good, explanation: 'extra', confidence: 0.9 })],
  ];
  for (const [label, content] of accepted) {
    const parsed = parseStructuredSqlResponse(content);
    assert.ok(parsed, `Should parse: ${label}`);
    assert.equal(parsed.sql, 'SELECT 1', `${label}: sql preserved verbatim`);
    assert.deepEqual(parsed.tables, ['students'], `${label}: tables preserved`);
  }

  const rejected: Array<[string, string]> = [
    ['plain prose', 'I am not able to answer that.'],
    ['empty string', ''],
    ['missing sql', JSON.stringify({ intent: 'x', tables: ['students'] })],
    ['missing tables', JSON.stringify({ intent: 'x', sql: 'SELECT 1' })],
    ['empty tables', JSON.stringify({ intent: 'x', tables: [], sql: 'SELECT 1' })],
    ['empty sql', JSON.stringify({ intent: 'x', tables: ['students'], sql: '   ' })],
    ['tables not an array', JSON.stringify({ intent: 'x', tables: 'students', sql: 'SELECT 1' })],
    ['json array', JSON.stringify([good])],
    ['truncated json', '{"intent":"x","tables":["students"],"sql":"SELECT 1"'],
  ];
  for (const [label, content] of rejected) {
    assert.equal(parseStructuredSqlResponse(content), null, `Should reject: ${label}`);
  }

  // A parsed `sql` must be byte-identical to what the model produced. The
  // validator downstream is the only thing allowed to judge safety, so the
  // parser must never tidy, repair or rewrite the statement.
  const hostile = JSON.stringify({
    intent: 'cleanup',
    tables: ['students'],
    sql: "SELECT 1; DROP TABLE students; -- '",
  });
  const parsedHostile = parseStructuredSqlResponse(hostile);
  assert.ok(parsedHostile);
  assert.equal(parsedHostile.sql, "SELECT 1; DROP TABLE students; -- '", 'SQL must not be rewritten');
  assert.equal(
    sqlValidationService.validate(parsedHostile.sql, admin).isValid,
    false,
    'Parser output must still be rejected by the validator'
  );

  // =========================================================================
  // 2. LM Studio model identity
  // =========================================================================
  // Names are derived from the server-reported id, never typed into the UI.
  assert.equal(displayNameForModel('qwen/qwen3-coder-30b-a3b-instruct-2507'), 'Qwen3-Coder 30B');
  assert.equal(displayNameForModel('qwen3-coder-30b'), 'Qwen3-Coder 30B');
  assert.equal(displayNameForModel('qwen2.5-coder-7b-instruct'), 'Qwen2.5-Coder 7B');
  // An unrecognised model still gets a readable name rather than disappearing.
  assert.equal(displayNameForModel('meta-llama-3.1-8b'), 'Meta Llama 3.1 8b');

  // =========================================================================
  // 3. Provider registry
  // =========================================================================
  assert.equal(getProvider('ollama').label, 'Ollama');
  assert.equal(getProvider('lmstudio').label, 'LM Studio');
  assert.throws(() => getProvider('openai' as never), /Unknown LLM provider/);
  assert.ok(DEFAULT_PROVIDER_ID === 'ollama' || DEFAULT_PROVIDER_ID === 'lmstudio');

  // =========================================================================
  // 4. Selecting a model changes nothing about the SQL guardrails
  // =========================================================================
  // The validator's contract is (sql, user) and nothing else. No model id is a
  // parameter, so no model can be an input to the decision. Asserted rather
  // than assumed, because adding such a parameter later is exactly the change
  // this is guarding against.
  const validatorSource = fs.readFileSync(
    path.resolve(fileURLToPath(import.meta.url), '..', '..', 'src', 'server', 'sql-validation.service.ts'),
    'utf8'
  );
  const validateSignature = validatorSource.match(/public validate\([^)]*\)/)?.[0] ?? '';
  assert.ok(
    !/model|provider/i.test(validateSignature),
    `validate() must not accept a model or provider: ${validateSignature}`
  );

  // And the pipeline must run every generated statement through that validator
  // before executing, using the *sanitized* SQL — never the raw model output.
  //
  // Two validate calls by design: one for the statement the model produced, and
  // one for a possible single repair of a wrong column name. What matters is
  // that both are gated, and that neither reaches the database unvalidated.
  const pipelineSource = fs.readFileSync(
    path.resolve(fileURLToPath(import.meta.url), '..', '..', 'src', 'server', 'sql-generation.service.ts'),
    'utf8'
  );
  const validateCalls = (pipelineSource.match(/sqlValidationService\.validate\(/g) ?? []).length;
  assert.equal(validateCalls, 2, `expected the original plus one re-validated repair, found ${validateCalls}`);
  assert.ok(
    pipelineSource.includes('let executableSql = validation.sanitizedSql;'),
    'the statement to execute must be the validator output, not the model output'
  );
  const executeCalls = (pipelineSource.match(/executeSql\(/g) ?? []).length;
  assert.equal(executeCalls, 1, 'there must be exactly one execution site, so there is no unvalidated path');
  assert.ok(
    pipelineSource.includes('databaseService.executeSql(executableSql)'),
    'execution must go through the validated statement'
  );
  assert.ok(
    pipelineSource.includes('sqlValidationService.validate(repaired.sql, user)'),
    'a repaired statement must be re-validated by the same validator'
  );
  assert.ok(
    !/executeSql\(repaired\.sql\)/.test(pipelineSource),
    'a repair must never be executed without passing validation first'
  );
  assert.ok(
    !/executeSql\(generated\.sql\)/.test(pipelineSource),
    'Execution must never use the raw model output'
  );
  const repairIndex = pipelineSource.indexOf('sqlValidationService.validate(repaired.sql, user)');
  const repairAssign = pipelineSource.indexOf('executableSql = revalidated.sanitizedSql');
  assert.ok(repairIndex > 0 && repairAssign > repairIndex, 'a repair must be validated before it can be executed');

  // Whichever model is selected, the same statement gets the same verdict.
  const statements = [
    'SELECT full_name FROM students',
    'DELETE FROM students',
    'DROP TABLE students',
    "SELECT password FROM arcgpt_users",
    'SELECT 1; DROP TABLE students',
  ];
  const verdicts = statements.map(sql => sqlValidationService.validate(sql, admin).isValid);
  assert.deepEqual(verdicts, [true, false, false, false, false]);

  // =========================================================================
  // 5. Live catalogue shape (probes the servers; unavailable is fine)
  // =========================================================================
  const models = await listAvailableModels();
  assert.equal(models.length, 2, 'Both providers must be listed so the selector can show both');
  const providers = models.map(model => model.provider);
  assert.ok(providers.includes('ollama') && providers.includes('lmstudio'));
  for (const model of models) {
    assert.equal(typeof model.available, 'boolean');
    assert.ok(model.id.length > 0, 'A model must always have a concrete id');
    assert.ok(model.name.length > 0, 'A model must always have a display name');
    // Nothing about the endpoint may reach the browser.
    assert.ok(!/https?:\/\//i.test(JSON.stringify(model)), 'No endpoint address in a model descriptor');
    assert.ok(!/password|secret|token/i.test(JSON.stringify(model)), 'No credential-shaped field in a model descriptor');
  }

  // An unknown or empty selection resolves to something usable rather than
  // failing the user's question.
  for (const requested of [undefined, '', 'ollama', 'lmstudio', 'lm-studio', 'not-a-real-model']) {
    const resolved = await resolveModelSelection(requested);
    assert.ok(resolved.id.length > 0, `Selection "${requested}" must resolve to a model`);
    assert.ok(resolved.provider === 'ollama' || resolved.provider === 'lmstudio');
  }

  console.log('Provider and model-selection tests passed.');
  for (const model of models) {
    console.log(`  ${model.available ? 'available ' : 'offline    '} ${model.name} (${model.providerLabel}) — ${model.id}`);
    if (model.detail) console.log(`      ${model.detail}`);
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';

/**
 * LM Studio provider tests, against a stub of its OpenAI-compatible API.
 *
 * The real LM Studio server is not required to run this suite, and must not be
 * assumed to be running: the point is to prove the *client* behaves correctly
 * against the documented API, deterministically.
 *
 * The model id is the part that matters most. LM Studio uses the model folder's
 * name, so a Qwen3 coder release reports a long repository-style slug that
 * cannot be typed from memory — guessing `qwen3-coder-30b` would send a request
 * for a model that does not exist. Every assertion here is about what the server
 * says, not about what the code wishes it said.
 *
 * The module reads its base URL from the environment at import time, so the
 * environment is set before the dynamic import rather than being stubbed out.
 */

const REALISTIC_QWEN3_ID = 'qwen/qwen3-coder-30b-a3b-instruct-2507-q4_k_m';

interface StubOptions {
  models: string[];
  /** Omit /v1/models entirely, as if the server were not up. */
  omitModelsRoute?: boolean;
  /** Reject `response_format`, as older LM Studio builds do. */
  rejectResponseFormat?: boolean;
  /** What the chat completion returns. */
  reply?: unknown;
  /** Reply with this HTTP status and body instead. */
  failWith?: { status: number; body: string };
}

function startStub(options: StubOptions): Promise<{ url: string; close: () => Promise<void>; calls: string[] }> {
  const calls: string[] = [];
  const server = http.createServer((req, res) => {
    const url = req.url || '';
    if (url === '/v1/models' || url === '/models') {
      if (options.omitModelsRoute) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        object: 'list',
        data: options.models.map(id => ({ id, object: 'model', owned_by: 'lmstudio' })),
      }));
      return;
    }
    if (url.endsWith('/chat/completions')) {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const parsed = JSON.parse(body || '{}');
        calls.push(parsed.model || '');
        if (options.failWith) {
          res.writeHead(options.failWith.status, { 'Content-Type': 'application/json' });
          res.end(options.failWith.body);
          return;
        }
        if (options.rejectResponseFormat && parsed.response_format) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: "Unrecognized request argument supplied: response_format" } }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 'chatcmpl-stub',
          object: 'chat.completion',
          model: parsed.model,
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: JSON.stringify(
                options.reply ?? {
                  intent: 'list low-attendance students',
                  tables: ['v_attendance_detail'],
                  sql: "SELECT student_name, attendance_percentage FROM v_attendance_detail WHERE attendance_percentage < 75",
                }
              ),
            },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }));
      });
      return;
    }
    res.writeHead(404).end('not found');
  });

  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}/v1`,
        calls,
        close: () => new Promise<void>(done => server.close(() => done())),
      });
    });
  });
}

/** Re-imports the provider with a fresh base URL, bypassing the module cache. */
async function loadProvider(baseUrl: string, model?: string) {
  process.env.LMSTUDIO_BASE_URL = baseUrl;
  if (model === undefined) delete process.env.LMSTUDIO_MODEL;
  else process.env.LMSTUDIO_MODEL = model;

  const cacheBust = `?t=${Math.random()}`;
  const module = await import(`../src/server/llm/lmstudio.provider.js${cacheBust}`);
  return { module, provider: new module.LmStudioProvider() };
}

const request = {
  systemPrompt: 'Return JSON with intent, tables and sql.',
  userPrompt: 'Show students below 75% attendance.',
};

async function run(): Promise<void> {
  // =========================================================================
  // 1. The model id is detected, never guessed
  // =========================================================================
  {
    const stub = await startStub({ models: [REALISTIC_QWEN3_ID] });
    try {
      const { provider } = await loadProvider(stub.url);
      const descriptor = await provider.describe();
      // The exact slug the server reported, character for character.
      assert.equal(descriptor.id, REALISTIC_QWEN3_ID);
      assert.equal(descriptor.available, true);
      assert.equal(descriptor.provider, 'lmstudio');
      assert.equal(descriptor.providerLabel, 'LM Studio');
      assert.equal(descriptor.name, 'Qwen3-Coder 30B');
      assert.ok(/Detected/.test(descriptor.detail || ''), descriptor.detail);

      // And the request goes to that exact id.
      const result = await provider.generateSql(descriptor.id, request);
      assert.deepEqual(stub.calls, [REALISTIC_QWEN3_ID]);
      assert.equal(result.sql, "SELECT student_name, attendance_percentage FROM v_attendance_detail WHERE attendance_percentage < 75");
    } finally {
      await stub.close();
    }
  }

  // A short guessed name is never invented when the server reports a long slug.
  {
    const stub = await startStub({ models: [REALISTIC_QWEN3_ID] });
    try {
      const { provider } = await loadProvider(stub.url, 'qwen3-coder-30b');
      const descriptor = await provider.describe();
      // The configured value does not exist on the server, so it is not used.
      assert.notEqual(descriptor.id, 'qwen3-coder-30b');
      assert.equal(descriptor.id, REALISTIC_QWEN3_ID);
      assert.ok(
        /was not found on the server/.test(descriptor.detail || ''),
        `the mismatch must be reported: ${descriptor.detail}`
      );
      assert.equal(descriptor.available, true, 'the detected model is usable even though the config was wrong');
    } finally {
      await stub.close();
    }
  }

  // A configured id that the server does report is honoured exactly.
  {
    const stub = await startStub({ models: ['other/model-a', REALISTIC_QWEN3_ID] });
    try {
      const { provider } = await loadProvider(stub.url, 'other/model-a');
      const descriptor = await provider.describe();
      assert.equal(descriptor.id, 'other/model-a', 'an exact configured match must win over preference order');
    } finally {
      await stub.close();
    }
  }

  // Preference order when nothing is configured: a coder model beats a base one.
  {
    const stub = await startStub({ models: ['llama-3.1-8b', REALISTIC_QWEN3_ID, 'mistral-7b'] });
    try {
      const { provider } = await loadProvider(stub.url);
      assert.equal((await provider.describe()).id, REALISTIC_QWEN3_ID);
    } finally {
      await stub.close();
    }
  }

  // =========================================================================
  // 2. Unavailable states are clean, never a crash
  // =========================================================================
  {
    // Server reachable, nothing loaded.
    const stub = await startStub({ models: [] });
    try {
      const { provider } = await loadProvider(stub.url);
      const descriptor = await provider.describe();
      assert.equal(descriptor.available, false);
      assert.match(descriptor.detail || '', /no model loaded/i);
    } finally {
      await stub.close();
    }
  }

  {
    // Server not running at all. Port 1 is reserved and refuses immediately.
    const { provider } = await loadProvider('http://127.0.0.1:1/v1');
    const descriptor = await provider.describe();
    assert.equal(descriptor.available, false);
    assert.match(descriptor.detail || '', /not reachable/i);
    // And a generation attempt fails as a typed, clean error rather than a throw.
    await assert.rejects(
      () => provider.generateSql('anything', request),
      (error: any) => error?.name === 'LlmProviderError' && error.reason === 'unavailable'
    );
  }

  {
    // Downloaded but not loaded: LM Studio's native listing reports the state.
    const native = http.createServer((req, res) => {
      if ((req.url || '').includes('/api/v0/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          data: [{ id: REALISTIC_QWEN3_ID, state: 'not-loaded', type: 'llm' }],
        }));
        return;
      }
      res.writeHead(404).end('not found');
    });
    const port = await new Promise<number>(resolve => {
      native.listen(0, '127.0.0.1', () => resolve((native.address() as AddressInfo).port));
    });
    try {
      const { provider } = await loadProvider(`http://127.0.0.1:${port}/v1`);
      const descriptor = await provider.describe();
      assert.equal(descriptor.available, false);
      assert.match(descriptor.detail || '', /not loaded/i);
    } finally {
      await new Promise<void>(done => native.close(() => done()));
    }
  }

  // =========================================================================
  // 3. Request shape and graceful degradation
  // =========================================================================
  {
    // Older builds reject response_format; the request must be retried without it.
    const stub = await startStub({ models: [REALISTIC_QWEN3_ID], rejectResponseFormat: true });
    try {
      const { provider } = await loadProvider(stub.url);
      const result = await provider.generateSql(REALISTIC_QWEN3_ID, request);
      assert.equal(stub.calls.length, 2, 'exactly one retry');
      assert.ok(result.sql.length > 0);
    } finally {
      await stub.close();
    }
  }

  {
    // A hard failure surfaces as a typed error, not a raw HTTP exception.
    const stub = await startStub({ models: [REALISTIC_QWEN3_ID], failWith: { status: 500, body: 'boom' } });
    try {
      const { provider } = await loadProvider(stub.url);
      await assert.rejects(
        () => provider.generateSql(REALISTIC_QWEN3_ID, request),
        (error: any) => error?.name === 'LlmProviderError' && error.reason === 'request_failed' && error.status === 500
      );
    } finally {
      await stub.close();
    }
  }

  {
    // Non-JSON content is a malformed generation, and the SQL is not salvaged
    // out of prose.
    const stub = await startStub({
      models: [REALISTIC_QWEN3_ID],
      reply: 'I am sorry, I cannot help with that request.',
    });
    try {
      const { provider } = await loadProvider(stub.url);
      await assert.rejects(
        () => provider.generateSql(REALISTIC_QWEN3_ID, request),
        (error: any) => error?.name === 'LlmProviderError' && error.reason === 'malformed_output'
      );
    } finally {
      await stub.close();
    }
  }

  {
    // Server up, model downloaded, but the GPU has no room for it.
    const stub = await startStub({
      models: [REALISTIC_QWEN3_ID],
      failWith: { status: 500, body: 'cudaMalloc failed: out of memory; failed to allocate compute buffers' },
    });
    try {
      const { provider } = await loadProvider(stub.url);
      await assert.rejects(
        () => provider.generateSql(REALISTIC_QWEN3_ID, request),
        (error: any) => error?.name === 'LlmProviderError' && error.reason === 'out_of_memory'
      );
    } finally {
      await stub.close();
    }
  }

  // The base URL is normalised so a trailing slash cannot produce '//models'.
  {
    const stub = await startStub({ models: [REALISTIC_QWEN3_ID] });
    try {
      const { provider } = await loadProvider(`${stub.url}/`);
      assert.equal((await provider.describe()).id, REALISTIC_QWEN3_ID);
    } finally {
      await stub.close();
    }
  }

  console.log('LM Studio provider tests passed (against a stubbed OpenAI-compatible server).');
  console.log(`  detected id format: ${REALISTIC_QWEN3_ID}`);
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
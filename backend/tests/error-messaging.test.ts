import assert from 'node:assert/strict';
import { aiFailureMessage } from '../src/server/sql-generation.service.js';
import { LlmProviderError, type LlmModelDescriptor } from '../src/server/llm/index.js';

/**
 * Error-message tests.
 *
 * Every message here is shown to a person who does not know what an inference
 * server is. The assertions are about two things:
 *
 *   1. the message names the right engine and the right action, and
 *   2. it never leaks a URL, a port, a stack trace, a file path or a credential.
 *
 * The second point is the reason this is a test rather than a convention. The
 * provider layer already guarantees that its `detail` strings are safe, and this
 * asserts that the mapping preserves that guarantee all the way to the browser.
 */

const ollama: LlmModelDescriptor = {
  id: 'qwen2.5-coder:7b',
  name: 'Qwen2.5-Coder 7B',
  provider: 'ollama',
  providerLabel: 'Ollama',
  available: true,
};
const lmStudio: LlmModelDescriptor = {
  id: 'qwen3-coder-30b-a3b-instruct',
  name: 'Qwen3-Coder 30B',
  provider: 'lmstudio',
  providerLabel: 'LM Studio',
  available: true,
};

/** Nothing internal may appear in anything a user reads. */
const INTERNAL: Array<[string, RegExp]> = [
  ['a URL', /https?:\/\//i],
  ['a port', /:\d{2,5}\b/],
  ['a stack frame', /\bat \w+ \(/],
  ['a file path', /[A-Za-z]:\\|\/usr\/|\/home\//],
  ['a credential', /password|secret|token|apikey/i],
  ['a raw HTTP status', /\b(500|502|503|404|400)\b/],
];

async function run(): Promise<void> {
  const cases: Array<[LlmProviderError, LlmModelDescriptor, RegExp]> = [
    // Server genuinely not running.
    [
      new LlmProviderError('unavailable', 'ollama', 'Ollama is not reachable.'),
      ollama,
      /Ollama is unavailable.*not reachable/i,
    ],
    [
      new LlmProviderError('unavailable', 'lmstudio', 'LM Studio is not reachable.'),
      lmStudio,
      /LM Studio is unavailable.*not reachable/i,
    ],
    // Server up, model not loaded.
    [
      new LlmProviderError('model_not_loaded', 'lmstudio', 'no model loaded'),
      lmStudio,
      /does not have that model loaded/i,
    ],
    // Server up, model installed, no memory to start it. This is the case that
    // two local providers on one GPU actually produce.
    [
      new LlmProviderError('out_of_memory', 'ollama', 'could not allocate', 500),
      ollama,
      /could not free enough memory to load Qwen2\.5-Coder 7B/i,
    ],
    [
      new LlmProviderError('out_of_memory', 'lmstudio', 'could not allocate', 500),
      lmStudio,
      /could not free enough memory to load Qwen3-Coder 30B/i,
    ],
    // A slow local model on a cold start.
    [
      new LlmProviderError('timeout', 'lmstudio', 'too slow'),
      lmStudio,
      /took too long to answer/i,
    ],
  ];

  for (const [error, model, expected] of cases) {
    const message = aiFailureMessage(error, model);
    assert.match(message, expected, `wrong message for ${error.reason}: ${message}`);
    // The message must never tell a user to start a server that is the subject
    // of an out-of-memory failure, because the server is already running.
    if (error.reason === 'out_of_memory') {
      assert.ok(
        !/start (Ollama|LM Studio)/i.test(message),
        `must not tell the user to start a running server: ${message}`
      );
      assert.ok(/unload|switch/i.test(message), `must suggest a real action: ${message}`);
      // The failing provider must not tell the user to switch to itself.
      assert.ok(
        !message.includes(`switch to ${model.providerLabel}`),
        `must not suggest the model that just failed: ${message}`
      );
    }
    for (const [label, pattern] of INTERNAL) {
      assert.ok(!pattern.test(message), `leaked ${label} in "${message}"`);
    }
  }

  // An unexpected failure still gets a sentence rather than nothing.
  const generic = aiFailureMessage(new LlmProviderError('request_failed', 'ollama', 'boom', 500), ollama);
  assert.ok(generic.length > 20, generic);
  for (const [label, pattern] of INTERNAL) {
    assert.ok(!pattern.test(generic), `leaked ${label} in "${generic}"`);
  }

  console.log('Error-messaging tests passed.');
  for (const [error, model] of cases) {
    console.log(`  ${error.reason.padEnd(16)} ${aiFailureMessage(error, model)}`);
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
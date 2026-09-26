import assert from 'node:assert/strict';
import { checkOllamaStatus } from '../src/server/ai.js';
import { checkPostgresConnection, closeDatabasePools } from '../src/server/db.js';
import { databaseService } from '../src/server/database.service.js';

async function run(): Promise<void> {
  const postgres = await checkPostgresConnection();
  assert.equal(postgres, true, 'PostgreSQL is not reachable.');
  const ollama = await checkOllamaStatus();
  assert.equal(ollama.available, true, 'Configured Ollama model is not available.');
  const result = await databaseService.executeSql('SELECT 1 AS connection_value');
  assert.equal(result.resultStatus, 'SUCCESS');
  assert.equal(result.rows[0]?.connection_value, 1);
  console.log(`Integration checks passed with model ${ollama.model}.`);
  await closeDatabasePools();
}

run().catch(async error => {
  console.error(error);
  await closeDatabasePools();
  process.exitCode = 1;
});

import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const connectionTimeoutMs = Number(process.env.DB_CONNECTION_TIMEOUT_MS || 5000);
const idleTimeoutMillis = Number(process.env.DB_IDLE_TIMEOUT_MS || 30000);
const statementTimeoutMs = Number(process.env.DB_STATEMENT_TIMEOUT_MS || 10000);

const adminConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  // Defaults to arcgpt_new. This must never fall back to any other database: a
  // missing DB_NAME should degrade to this project's own database rather than
  // silently connecting somewhere else.
  database: process.env.DB_NAME || 'arcgpt_new',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis,
  connectionTimeoutMillis: connectionTimeoutMs,
};

const readerConfig = process.env.DB_READONLY_USER
  ? {
      ...adminConfig,
      user: process.env.DB_READONLY_USER,
      password: process.env.DB_READONLY_PASSWORD,
      max: Number(process.env.DB_READONLY_POOL_MAX || 5),
    }
  : adminConfig;

export const pool = new Pool(adminConfig);
export const readerPool = process.env.DB_READONLY_USER ? new Pool(readerConfig) : pool;
export const databaseName = adminConfig.database;
export const readerConfigured = Boolean(process.env.DB_READONLY_USER);

/**
 * Databases this project is not allowed to open a connection to.
 *
 * arcgpt_institution is another project's database that happens to live on the
 * same PostgreSQL server, and its legacy migrations are still present in
 * src/migration/sql/ -- so pointing DB_NAME at it is an easy and entirely
 * plausible mistake. It is also a destructive one, because the application
 * pool is not read-only.
 *
 * The check lives next to the configuration that could be wrong and runs before
 * the first query, so a misconfigured start exits with a clear message instead
 * of quietly writing to someone else's tables.
 */
const PROTECTED_DATABASES = new Set(['arcgpt_institution']);

export function assertArcgptDatabase(): void {
  const configured = (process.env.DB_NAME || 'arcgpt_new').trim().toLowerCase();
  if (PROTECTED_DATABASES.has(configured)) {
    throw new Error(
      `Refusing to start: DB_NAME is set to ${configured}, which belongs to another project. ArcGPT targets arcgpt_new.`
    );
  }
}

pool.on('error', error => {
  console.error('[PostgreSQL] idle client error:', error.message);
});

if (readerPool !== pool) {
  readerPool.on('error', error => {
    console.error('[PostgreSQL] read-only pool error:', error.message);
  });
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = []
): Promise<QueryResult<T>> {
  return pool.query<T>(text, values);
}

export async function checkPostgresConnection(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export async function withReadOnlyTransaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await readerPool.connect();
  let transactionStarted = false;

  try {
    await client.query('BEGIN READ ONLY');
    transactionStarted = true;
    await client.query(`SET LOCAL statement_timeout = '${Math.max(1000, statementTimeoutMs)}ms'`);
    await client.query(`SET LOCAL idle_in_transaction_session_timeout = '${Math.max(2000, statementTimeoutMs * 2)}ms'`);
    const result = await callback(client);
    await client.query('COMMIT');
    transactionStarted = false;
    return result;
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch {
        console.error('[PostgreSQL] rollback failed.');
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function closeDatabasePools(): Promise<void> {
  await Promise.allSettled([pool.end(), readerPool === pool ? Promise.resolve() : readerPool.end()]);
}

import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const connectionTimeoutMs = Number(process.env.DB_CONNECTION_TIMEOUT_MS || 5000);
const idleTimeoutMillis = Number(process.env.DB_IDLE_TIMEOUT_MS || 30000);
const statementTimeoutMs = Number(process.env.DB_STATEMENT_TIMEOUT_MS || 10000);

const adminConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'arcgpt_institution',
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

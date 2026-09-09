import { neon } from '@neondatabase/serverless'
import type { NeonQueryFunction } from '@neondatabase/serverless'
import type { ExplorationData } from '../src/types/api.js'
import { SCHEMA_VERSION } from './store.js'
import type { ExplorationStore, StoreSummary } from './store.js'

// Row objects, not arrays, and no result envelope.
type Sql = NeonQueryFunction<false, false>

function parsePayload(value: unknown): ExplorationData {
  // jsonb normally arrives already parsed; a string is still accepted.
  return (
    typeof value === 'string' ? JSON.parse(value) : value
  ) as ExplorationData
}

/**
 * Neon Postgres store. Keys are held in lower case and compared with lower(),
 * which reproduces the case-insensitive lookups the SQLite store gets from
 * COLLATE NOCASE.
 */
export class PostgresExplorationDatabase implements ExplorationStore {
  private sql: Sql
  private ready: Promise<void> | null = null
  constructor(connectionString: string) {
    if (!connectionString)
      throw new Error(
        'DATABASE_URL or POSTGRES_URL must be set to use the Postgres store.',
      )
    this.sql = neon(connectionString)
  }
  /** Creates the schema once per instance rather than on every query. */
  private migrate(): Promise<void> {
    this.ready ??= (async () => {
      const sql = this.sql
      await sql`
        CREATE TABLE IF NOT EXISTS organizations (
          login TEXT PRIMARY KEY,
          fetched_at TEXT NOT NULL,
          schema_version INTEGER NOT NULL,
          payload JSONB NOT NULL
        )`
      await sql`
        CREATE TABLE IF NOT EXISTS repositories (
          full_name TEXT PRIMARY KEY,
          owner TEXT NOT NULL,
          name TEXT NOT NULL,
          fetched_at TEXT NOT NULL,
          schema_version INTEGER NOT NULL,
          payload JSONB NOT NULL
        )`
      await sql`CREATE INDEX IF NOT EXISTS repositories_owner ON repositories (lower(owner))`
    })().catch((error: unknown) => {
      // A failed migration must not be cached, or every later query fails too.
      this.ready = null
      throw error
    })
    return this.ready
  }
  async get(
    kind: 'org' | 'repo',
    target: string,
  ): Promise<ExplorationData | null> {
    await this.migrate()
    const sql = this.sql
    const rows =
      kind === 'org'
        ? await sql`SELECT payload FROM organizations WHERE login = lower(${target}) AND schema_version = ${SCHEMA_VERSION}`
        : await sql`SELECT payload FROM repositories WHERE full_name = lower(${target}) AND schema_version = ${SCHEMA_VERSION}`
    return rows.length ? parsePayload(rows[0].payload) : null
  }
  async upsert(data: ExplorationData): Promise<void> {
    await this.migrate()
    const sql = this.sql
    const payload = JSON.stringify(data)
    if (data.kind === 'org') {
      await sql`
        INSERT INTO organizations (login, fetched_at, schema_version, payload)
        VALUES (lower(${data.target}), ${data.fetchedAt}, ${SCHEMA_VERSION}, ${payload}::jsonb)
        ON CONFLICT (login) DO UPDATE SET
          fetched_at = excluded.fetched_at,
          schema_version = excluded.schema_version,
          payload = excluded.payload`
    } else {
      await sql`
        INSERT INTO repositories (full_name, owner, name, fetched_at, schema_version, payload)
        VALUES (lower(${data.target}), ${data.owner}, ${data.repo}, ${data.fetchedAt}, ${SCHEMA_VERSION}, ${payload}::jsonb)
        ON CONFLICT (full_name) DO UPDATE SET
          owner = excluded.owner,
          name = excluded.name,
          fetched_at = excluded.fetched_at,
          schema_version = excluded.schema_version,
          payload = excluded.payload`
    }
  }
  async remove(kind: 'org' | 'repo', target: string): Promise<void> {
    await this.migrate()
    const sql = this.sql
    if (kind === 'org')
      await sql`DELETE FROM organizations WHERE login = lower(${target})`
    else await sql`DELETE FROM repositories WHERE full_name = lower(${target})`
  }
  async summary(): Promise<StoreSummary> {
    await this.migrate()
    const sql = this.sql
    const counts = await sql`
      SELECT (SELECT COUNT(*) FROM organizations WHERE schema_version = ${SCHEMA_VERSION})
           + (SELECT COUNT(*) FROM repositories WHERE schema_version = ${SCHEMA_VERSION}) AS total`
    const recent = await sql`
      SELECT 'org' AS kind, login AS target, fetched_at AS "fetchedAt" FROM organizations WHERE schema_version = ${SCHEMA_VERSION}
      UNION ALL
      SELECT 'repo' AS kind, full_name AS target, fetched_at AS "fetchedAt" FROM repositories WHERE schema_version = ${SCHEMA_VERSION}
      ORDER BY "fetchedAt" DESC LIMIT 8`
    return {
      // COUNT() returns bigint, which the driver hands back as a string.
      count: Number(counts[0]?.total ?? 0),
      recent: recent as StoreSummary['recent'],
    }
  }
  async close(): Promise<void> {
    // The Neon HTTP driver holds no connection to release.
  }
}

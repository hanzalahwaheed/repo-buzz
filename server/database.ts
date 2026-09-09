import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ExplorationData } from '../src/types/api.js'
import { SCHEMA_VERSION } from './store.js'
import type { ExplorationStore, StoreSummary } from './store.js'

export class ExplorationDatabase implements ExplorationStore {
  private db: DatabaseSync
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS organizations (
        login TEXT PRIMARY KEY COLLATE NOCASE,
        fetched_at TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        payload TEXT NOT NULL CHECK(json_valid(payload))
      );
      CREATE TABLE IF NOT EXISTS repositories (
        full_name TEXT PRIMARY KEY COLLATE NOCASE,
        owner TEXT NOT NULL COLLATE NOCASE,
        name TEXT NOT NULL COLLATE NOCASE,
        fetched_at TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        payload TEXT NOT NULL CHECK(json_valid(payload))
      );
      CREATE INDEX IF NOT EXISTS repositories_owner ON repositories(owner);
    `)
  }
  async get(
    kind: 'org' | 'repo',
    target: string,
  ): Promise<ExplorationData | null> {
    const sql =
      kind === 'org'
        ? 'SELECT payload FROM organizations WHERE login = ? AND schema_version = ?'
        : 'SELECT payload FROM repositories WHERE full_name = ? AND schema_version = ?'
    const row = this.db.prepare(sql).get(target, SCHEMA_VERSION)
    return row ? (JSON.parse(String(row.payload)) as ExplorationData) : null
  }
  async upsert(data: ExplorationData): Promise<void> {
    const payload = JSON.stringify(data)
    if (data.kind === 'org') {
      this.db
        .prepare(
          `INSERT INTO organizations (login, fetched_at, schema_version, payload) VALUES (?, ?, ?, ?)
        ON CONFLICT(login) DO UPDATE SET fetched_at = excluded.fetched_at, schema_version = excluded.schema_version, payload = excluded.payload`,
        )
        .run(data.target, data.fetchedAt, SCHEMA_VERSION, payload)
    } else {
      this.db
        .prepare(
          `INSERT INTO repositories (full_name, owner, name, fetched_at, schema_version, payload) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(full_name) DO UPDATE SET owner = excluded.owner, name = excluded.name, fetched_at = excluded.fetched_at, schema_version = excluded.schema_version, payload = excluded.payload`,
        )
        .run(
          data.target,
          data.owner,
          data.repo,
          data.fetchedAt,
          SCHEMA_VERSION,
          payload,
        )
    }
  }
  async remove(kind: 'org' | 'repo', target: string): Promise<void> {
    this.db
      .prepare(
        kind === 'org'
          ? 'DELETE FROM organizations WHERE login = ?'
          : 'DELETE FROM repositories WHERE full_name = ?',
      )
      .run(target)
  }
  async summary(): Promise<StoreSummary> {
    const counts = this.db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM organizations WHERE schema_version = ?) + (SELECT COUNT(*) FROM repositories WHERE schema_version = ?) AS total`,
      )
      .get(SCHEMA_VERSION, SCHEMA_VERSION)
    const recent = this.db
      .prepare(
        `SELECT 'org' AS kind, login AS target, fetched_at AS fetchedAt FROM organizations WHERE schema_version = ?
      UNION ALL SELECT 'repo' AS kind, full_name AS target, fetched_at AS fetchedAt FROM repositories WHERE schema_version = ?
      ORDER BY fetchedAt DESC LIMIT 8`,
      )
      .all(SCHEMA_VERSION, SCHEMA_VERSION)
    return {
      count: Number(counts?.total ?? 0),
      recent: recent as StoreSummary['recent'],
    }
  }
  async close(): Promise<void> {
    this.db.close()
  }
}

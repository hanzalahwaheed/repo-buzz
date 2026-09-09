import type { ExplorationData } from '../src/types/api.js'

export const SCHEMA_VERSION = 2

export interface StoreSummary {
  count: number
  recent: Array<{ kind: 'org' | 'repo'; target: string; fetchedAt: string }>
}

/** The persistence contract shared by the SQLite and Postgres stores. */
export interface ExplorationStore {
  get(kind: 'org' | 'repo', target: string): Promise<ExplorationData | null>
  upsert(data: ExplorationData): Promise<void>
  remove(kind: 'org' | 'repo', target: string): Promise<void>
  summary(): Promise<StoreSummary>
  close(): Promise<void>
}

/**
 * The Neon integration sets several names for the same connection string.
 * DATABASE_URL wins; POSTGRES_URL is the documented alternative.
 */
export function connectionStringFromEnv(): string | undefined {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || undefined
}

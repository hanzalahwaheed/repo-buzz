import type {
  PersistedOrgVersion,
  PersistedRepoVersion,
  PersistedSearchHistoryEntry,
  SearchEventSource,
  SnapshotKind,
} from '../types/storage'
import type { OrganizationRepoSummary, RepositoryBundle } from '../types/github'

const STORAGE_KEYS = {
  repoVersions: 'repobuzz.repoVersions.v1',
  orgVersions: 'repobuzz.orgVersions.v1',
  history: 'repobuzz.searchHistory.v1',
} as const

const MAX_REPO_VERSIONS = 35
const MAX_ORG_VERSIONS = 20
const MAX_HISTORY_ENTRIES = 200

function hasStorage(): boolean {
  return typeof window !== 'undefined' && Boolean(window.localStorage)
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function readJsonArray<T>(key: string): T[] {
  if (!hasStorage()) {
    return []
  }

  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed as T[]
  } catch {
    return []
  }
}

function writeJsonArray<T>(key: string, records: T[]): boolean {
  if (!hasStorage()) {
    return false
  }

  try {
    window.localStorage.setItem(key, JSON.stringify(records))
    return true
  } catch {
    return false
  }
}

function sortDescByDate<T>(records: T[], dateGetter: (value: T) => string): T[] {
  return [...records].sort(
    (left, right) => new Date(dateGetter(right)).getTime() - new Date(dateGetter(left)).getTime(),
  )
}

export function saveRepoVersion(params: {
  owner: string
  repo: string
  authenticated: boolean
  bundle: RepositoryBundle
}): PersistedRepoVersion | null {
  const fetchedAt = params.bundle.fetchedAt || new Date().toISOString()
  const record: PersistedRepoVersion = {
    id: makeId('repo'),
    kind: 'repo',
    owner: params.owner,
    repo: params.repo,
    target: `${params.owner}/${params.repo}`,
    fetchedAt,
    authenticated: params.authenticated,
    bundle: params.bundle,
  }

  const existing = readJsonArray<PersistedRepoVersion>(STORAGE_KEYS.repoVersions)
  const next = [record, ...existing].slice(0, MAX_REPO_VERSIONS)

  return writeJsonArray(STORAGE_KEYS.repoVersions, next) ? record : null
}

export function saveOrgVersion(params: {
  org: string
  authenticated: boolean
  repos: OrganizationRepoSummary[]
}): PersistedOrgVersion | null {
  const fetchedAt = new Date().toISOString()
  const record: PersistedOrgVersion = {
    id: makeId('org'),
    kind: 'org',
    org: params.org,
    target: params.org,
    fetchedAt,
    authenticated: params.authenticated,
    repos: params.repos,
  }

  const existing = readJsonArray<PersistedOrgVersion>(STORAGE_KEYS.orgVersions)
  const next = [record, ...existing].slice(0, MAX_ORG_VERSIONS)

  return writeJsonArray(STORAGE_KEYS.orgVersions, next) ? record : null
}

export function getLatestRepoVersion(
  owner: string,
  repo: string,
): PersistedRepoVersion | null {
  const records = readJsonArray<PersistedRepoVersion>(STORAGE_KEYS.repoVersions)
  const target = `${owner}/${repo}`

  const match = sortDescByDate(
    records.filter((record) => record.target === target),
    (record) => record.fetchedAt,
  )[0]

  return match ?? null
}

export function getLatestOrgVersion(org: string): PersistedOrgVersion | null {
  const records = readJsonArray<PersistedOrgVersion>(STORAGE_KEYS.orgVersions)
  const match = sortDescByDate(
    records.filter((record) => record.org === org),
    (record) => record.fetchedAt,
  )[0]

  return match ?? null
}

export function getRepoVersionById(id: string): PersistedRepoVersion | null {
  const records = readJsonArray<PersistedRepoVersion>(STORAGE_KEYS.repoVersions)
  return records.find((record) => record.id === id) ?? null
}

export function getOrgVersionById(id: string): PersistedOrgVersion | null {
  const records = readJsonArray<PersistedOrgVersion>(STORAGE_KEYS.orgVersions)
  return records.find((record) => record.id === id) ?? null
}

export function listSearchHistory(): PersistedSearchHistoryEntry[] {
  const records = readJsonArray<PersistedSearchHistoryEntry>(STORAGE_KEYS.history)
  return sortDescByDate(records, (record) => record.searchedAt)
}

export function appendSearchHistory(params: {
  kind: SnapshotKind
  target: string
  searchedAt?: string
  fetchedAt: string
  source: SearchEventSource
  snapshotId: string
}): PersistedSearchHistoryEntry[] {
  const entry: PersistedSearchHistoryEntry = {
    id: makeId('history'),
    kind: params.kind,
    target: params.target,
    searchedAt: params.searchedAt ?? new Date().toISOString(),
    fetchedAt: params.fetchedAt,
    source: params.source,
    snapshotId: params.snapshotId,
  }

  const existing = listSearchHistory()
  const next = [entry, ...existing].slice(0, MAX_HISTORY_ENTRIES)
  writeJsonArray(STORAGE_KEYS.history, next)
  return next
}

export function removeHistoryEntry(id: string): PersistedSearchHistoryEntry[] {
  const next = listSearchHistory().filter((entry) => entry.id !== id)
  writeJsonArray(STORAGE_KEYS.history, next)
  return next
}

export function clearHistory(): PersistedSearchHistoryEntry[] {
  writeJsonArray(STORAGE_KEYS.history, [])
  return []
}

export function clearAllPersistedData(): void {
  if (!hasStorage()) {
    return
  }

  window.localStorage.removeItem(STORAGE_KEYS.history)
  window.localStorage.removeItem(STORAGE_KEYS.repoVersions)
  window.localStorage.removeItem(STORAGE_KEYS.orgVersions)
}

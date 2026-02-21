import type { OrganizationRepoSummary, RepositoryBundle } from './github'

export type SnapshotKind = 'org' | 'repo'
export type SearchEventSource = 'network' | 'storage'

export interface PersistedOrgVersion {
  id: string
  kind: 'org'
  org: string
  target: string
  fetchedAt: string
  authenticated: boolean
  repos: OrganizationRepoSummary[]
}

export interface PersistedRepoVersion {
  id: string
  kind: 'repo'
  owner: string
  repo: string
  target: string
  fetchedAt: string
  authenticated: boolean
  bundle: RepositoryBundle
}

export interface PersistedSearchHistoryEntry {
  id: string
  kind: SnapshotKind
  target: string
  searchedAt: string
  fetchedAt: string
  source: SearchEventSource
  snapshotId: string
}

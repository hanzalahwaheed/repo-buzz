import type {
  OrganizationRepoSummary,
  RateLimitSnapshot,
  RepositoryBundle,
} from './github'

export type ExplorationData = {
  id: string
  target: string
  fetchedAt: string
} & (
  | { kind: 'repo'; owner: string; repo: string; bundle: RepositoryBundle }
  | { kind: 'org'; org: string; repos: OrganizationRepoSummary[] }
)

export interface SharedExploration {
  data: ExplorationData
  source: 'database' | 'github' | 'stale'
  refreshAfter: string
  expiresAt: string
  warning?: string
}

export interface LibraryStatus {
  configured: boolean
  cachedExplorations: number
  rates: { rest?: RateLimitSnapshot; graphql?: RateLimitSnapshot }
  recent: Array<{ kind: 'org' | 'repo'; target: string; fetchedAt: string }>
}

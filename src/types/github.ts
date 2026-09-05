import type { AnalysisWindow } from '../lib/analysisWindow'
export type RateLimitSource = 'rest' | 'graphql'

export interface RateLimitSnapshot {
  source: RateLimitSource
  limit: number
  remaining: number
  resetAt: string
  used?: number
  cost?: number
}

export interface GitHubActor {
  login: string
  type: string
}

export interface GitHubIssueNode {
  id: string
  createdAt: string
  closedAt: string | null
  updatedAt: string
  state: 'OPEN' | 'CLOSED'
  authorAssociation: string | null
  labels: string[]
  author: GitHubActor | null
}

export interface GitHubPullRequestNode {
  id: string
  createdAt: string
  mergedAt: string | null
  closedAt: string | null
  updatedAt: string
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  additions: number
  deletions: number
  reviews: number
  authorAssociation: string | null
  author: GitHubActor | null
}

export interface RepoMetadata {
  name: string
  nameWithOwner: string
  owner: string
  description: string | null
  stargazerCount: number
  forkCount: number
  primaryLanguage: string | null
  license: string | null
  updatedAt: string
  pushedAt: string
  url: string
  isFork: boolean
  isArchived: boolean
  openIssueCount: number
  closedIssueCount: number
  openPullRequestCount: number
  closedPullRequestCount: number
  mergedPullRequestCount: number
  goodFirstIssueCount: number
  helpWantedCount: number
}

export interface RepositorySnapshot {
  metadata: RepoMetadata
  issues: GitHubIssueNode[]
  pullRequests: GitHubPullRequestNode[]
}

export interface CommitActivityWeek {
  week: number
  total: number
  days: number[]
}

export interface ContributorWeek {
  w: number
  a: number
  d: number
  c: number
}

export interface ContributorStat {
  weeks: ContributorWeek[]
  author: GitHubActor | null
}

export interface RepositoryStatsBundle {
  participation: {
    all: number[]
    owner: number[]
  }
  commitActivity: CommitActivityWeek[]
  contributors: ContributorStat[]
  codeFrequency: Array<[number, number, number]>
  pendingEndpoints: string[]
  unavailableEndpoints?: string[]
  fallbackMessages?: string[]
}

export interface RepositoryBundle {
  analysisWindow?: AnalysisWindow
  snapshot: RepositorySnapshot
  stats: RepositoryStatsBundle
  fetchedAt: string
}

export interface OrganizationRepoSummary {
  id: string
  name: string
  owner: string
  nameWithOwner: string
  description: string | null
  stargazerCount: number
  forkCount: number
  primaryLanguage: string | null
  license: string | null
  updatedAt: string
  pushedAt: string
  openIssueCount: number
  openPullRequestCount: number
  isFork: boolean
  isArchived: boolean
  url: string
}

export interface OrgFetchProgress {
  fetched: number
  total: number | null
}

export interface WeeklyIssueTrend {
  weekStart: string
  opened: number
  closed: number
}

export interface WeeklyPrTrend {
  weekStart: string
  opened: number
  merged: number
  rejected: number
}

export interface WeeklyCommitTrend {
  weekStart: string
  commits: number
}

export interface WeeklyCodeChurn {
  weekStart: string
  additions: number
  deletions: number
}

export interface MonthlyContributorTrend {
  month: string
  newContributors: number
}

export interface RecentContributorActivity {
  login: string
  isMaintainer: boolean
  activityUrl: string
  issuesUrl: string
  prsOpenedUrl: string
  prsMergedUrl: string
  issuesOpened: number
  openPrs: number
  totalMergedPrs: number
}

export interface HealthComponent {
  key:
    | 'commitMomentum'
    | 'prMergeRate'
    | 'issueCloseRate'
    | 'newContributorGrowth'
    | 'communityRatio'
    | 'goodFirstIssueAvailability'
  label: string
  weight: number
  value: number | null
  normalized: number | null
  insufficientData: boolean
  reason?: string
}

export interface RepoAnalytics {
  metadata: RepoMetadata
  issueMetrics: {
    openedCount: number
    closedCount: number
    weeklyTrend: WeeklyIssueTrend[]
  }
  prMetrics: {
    openedCount: number
    mergedCount: number
    resolvedCount: number
    mergeRate: number | null
    rejectionRate: number | null
    medianTimeToMergeDays: number | null
    weeklyTrend: WeeklyPrTrend[]
  }
  contributorMetrics: {
    topContributors: Array<{
      login: string
      issuesOpened: number
      prsOpened: number
      totalMergedPrs: number
      isMaintainer: boolean
      activityUrl: string
    }>
  }
  commitMetrics: { weeklyTrend: WeeklyCommitTrend[] }
  warnings: string[]
}

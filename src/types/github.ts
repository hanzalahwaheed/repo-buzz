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
  total: number
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
    openCount: number
    closeRate: number | null
    medianTimeToCloseDays: number | null
    staleCount: number
    goodFirstIssueCount: number
    helpWantedCount: number
    weeklyTrend: WeeklyIssueTrend[]
  }
  prMetrics: {
    mergeRate: number | null
    rejectionRate: number | null
    medianTimeToMergeDays: number | null
    averageReviewsPerPr: number | null
    weeklyTrend: WeeklyPrTrend[]
  }
  contributorMetrics: {
    uniqueContributors7d: number
    uniqueContributors30d: number
    uniqueContributors90d: number
    newContributorsMonthly: MonthlyContributorTrend[]
    concentrationTop3Pct: number | null
    communityCommitRatio: number | null
  }
  commitMetrics: {
    weeklyTrend: WeeklyCommitTrend[]
    commitsLast30d: number
    commitsPrevious30d: number
  }
  codeMetrics: {
    weeklyChurn: WeeklyCodeChurn[]
  }
  healthScore: {
    score: number | null
    components: HealthComponent[]
  }
  warnings: string[]
}

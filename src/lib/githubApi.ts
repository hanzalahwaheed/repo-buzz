import pLimit from 'p-limit'

import { GitHubApiError } from './githubError'
import type {
  CommitActivityWeek,
  ContributorStat,
  GitHubActor,
  GitHubIssueNode,
  GitHubPullRequestNode,
  OrgFetchProgress,
  OrganizationRepoSummary,
  RateLimitSnapshot,
  RepositoryBundle,
  RepositorySnapshot,
  RepositoryStatsBundle,
} from '../types/github'

const GITHUB_API_BASE = 'https://api.github.com'
const GITHUB_API_VERSION = '2022-11-28'
const GRAPHQL_CONNECTION_PAGE_SIZE = 100
const STATS_RETRY_MAX_ATTEMPTS = 5
const STATS_RETRY_DELAY_MS = 2200

const etagCache = new Map<string, { etag: string; data: unknown }>()

interface ClientOptions {
  token?: string
  onRateLimit?: (snapshot: RateLimitSnapshot) => void
}

interface RestRequestOptions {
  method?: string
  signal?: AbortSignal
  body?: string
  useEtag?: boolean
  cacheKey?: string
  allow202?: boolean
}

interface RestResponse<T> {
  status: number
  data: T | null
}

interface GraphqlEnvelope<T> {
  data?: T
  errors?: Array<{ message: string }>
}

interface GraphqlRateLimitPayload {
  limit: number
  remaining: number
  resetAt: string
  cost?: number
  used?: number
}

interface OrgRepoNode {
  id: string
  name: string
  nameWithOwner: string
  description: string | null
  stargazerCount: number
  forkCount: number
  updatedAt: string
  pushedAt: string
  isFork: boolean
  isArchived: boolean
  url: string
  owner: {
    login: string
  }
  primaryLanguage: {
    name: string
  } | null
  licenseInfo: {
    spdxId: string | null
    name: string
  } | null
  issues: {
    totalCount: number
  }
  pullRequests: {
    totalCount: number
  }
}

interface OrgRepoConnection {
  totalCount: number
  pageInfo: {
    hasNextPage: boolean
    endCursor: string | null
  }
  nodes: OrgRepoNode[]
}

interface OrgRepositoriesQueryResponse {
  organization: {
    repositories: OrgRepoConnection
  } | null
  user: {
    repositories: OrgRepoConnection
  } | null
  rateLimit: GraphqlRateLimitPayload
}

interface RepositorySnapshotResponse {
  repository: {
    name: string
    nameWithOwner: string
    description: string | null
    stargazerCount: number
    forkCount: number
    updatedAt: string
    pushedAt: string
    isFork: boolean
    isArchived: boolean
    url: string
    owner: {
      login: string
    }
    primaryLanguage: {
      name: string
    } | null
    licenseInfo: {
      spdxId: string | null
      name: string
    } | null
    issuesOpen: {
      totalCount: number
    }
    issuesClosed: {
      totalCount: number
    }
    pullRequestsOpen: {
      totalCount: number
    }
    pullRequestsClosed: {
      totalCount: number
    }
    pullRequestsMerged: {
      totalCount: number
    }
    goodFirstIssues: {
      totalCount: number
    }
    helpWantedIssues: {
      totalCount: number
    }
    issues: {
      nodes: Array<{
        id: string
        createdAt: string
        closedAt: string | null
        updatedAt: string
        state: 'OPEN' | 'CLOSED'
        authorAssociation: string | null
        author: {
          __typename: string
          login: string
        } | null
        labels: {
          nodes: Array<{
            name: string
          } | null>
        }
      }>
    }
    pullRequests: {
      nodes: Array<{
        id: string
        createdAt: string
        mergedAt: string | null
        closedAt: string | null
        updatedAt: string
        state: 'OPEN' | 'CLOSED' | 'MERGED'
        additions: number
        deletions: number
        authorAssociation: string | null
        author: {
          __typename: string
          login: string
        } | null
        reviews: {
          totalCount: number
        }
      }>
    }
  } | null
  rateLimit: GraphqlRateLimitPayload
}

interface RepositoryBundleOptions {
  signal?: AbortSignal
}

interface OrgRepositoryOptions {
  signal?: AbortSignal
  onProgress?: (progress: OrgFetchProgress) => void
}

interface BatchRepositoryRequest {
  owner: string
  repo: string
}

interface BatchRepositoryOptions {
  signal?: AbortSignal
  concurrency?: number
}

function parseRateLimitFromHeaders(headers: Headers): Omit<RateLimitSnapshot, 'source'> | null {
  const limit = Number(headers.get('x-ratelimit-limit') ?? '')
  const remaining = Number(headers.get('x-ratelimit-remaining') ?? '')
  const resetUnix = Number(headers.get('x-ratelimit-reset') ?? '')

  if (
    Number.isNaN(limit) ||
    Number.isNaN(remaining) ||
    Number.isNaN(resetUnix) ||
    !Number.isFinite(limit) ||
    !Number.isFinite(remaining) ||
    !Number.isFinite(resetUnix)
  ) {
    return null
  }

  return {
    limit,
    remaining,
    resetAt: new Date(resetUnix * 1000).toISOString(),
    used: Number(headers.get('x-ratelimit-used') ?? ''),
  }
}

function normalizeActor(
  actor: { __typename: string; login: string } | null,
): GitHubActor | null {
  if (!actor?.login) {
    return null
  }

  return {
    login: actor.login,
    type: actor.__typename ?? 'User',
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)

    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(new DOMException('Request aborted', 'AbortError'))
    }

    signal?.addEventListener('abort', onAbort)
  })
}

const ORG_REPOSITORIES_QUERY = `
query OrganizationRepositories($login: String!, $cursor: String) {
  organization(login: $login) {
    repositories(first: 100, after: $cursor, orderBy: { field: PUSHED_AT, direction: DESC }) {
      totalCount
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        name
        nameWithOwner
        description
        stargazerCount
        forkCount
        updatedAt
        pushedAt
        isFork
        isArchived
        url
        owner {
          login
        }
        primaryLanguage {
          name
        }
        licenseInfo {
          spdxId
          name
        }
        issues(states: OPEN) {
          totalCount
        }
        pullRequests(states: OPEN) {
          totalCount
        }
      }
    }
  }
  user(login: $login) {
    repositories(
      first: 100
      after: $cursor
      ownerAffiliations: OWNER
      orderBy: { field: PUSHED_AT, direction: DESC }
    ) {
      totalCount
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        name
        nameWithOwner
        description
        stargazerCount
        forkCount
        updatedAt
        pushedAt
        isFork
        isArchived
        url
        owner {
          login
        }
        primaryLanguage {
          name
        }
        licenseInfo {
          spdxId
          name
        }
        issues(states: OPEN) {
          totalCount
        }
        pullRequests(states: OPEN) {
          totalCount
        }
      }
    }
  }
  rateLimit {
    limit
    remaining
    resetAt
    cost
    used
  }
}
`

const REPOSITORY_SNAPSHOT_QUERY = `
query RepositorySnapshot($owner: String!, $name: String!, $issueCount: Int!, $prCount: Int!) {
  repository(owner: $owner, name: $name) {
    name
    nameWithOwner
    description
    stargazerCount
    forkCount
    updatedAt
    pushedAt
    isFork
    isArchived
    url
    owner {
      login
    }
    primaryLanguage {
      name
    }
    licenseInfo {
      spdxId
      name
    }
    issuesOpen: issues(states: OPEN) {
      totalCount
    }
    issuesClosed: issues(states: CLOSED) {
      totalCount
    }
    pullRequestsOpen: pullRequests(states: OPEN) {
      totalCount
    }
    pullRequestsClosed: pullRequests(states: CLOSED) {
      totalCount
    }
    pullRequestsMerged: pullRequests(states: MERGED) {
      totalCount
    }
    goodFirstIssues: issues(states: OPEN, labels: ["good first issue"]) {
      totalCount
    }
    helpWantedIssues: issues(states: OPEN, labels: ["help wanted"]) {
      totalCount
    }
    issues(first: $issueCount, orderBy: { field: CREATED_AT, direction: DESC }) {
      nodes {
        id
        createdAt
        closedAt
        updatedAt
        state
        authorAssociation
        author {
          __typename
          login
        }
        labels(first: 20) {
          nodes {
            name
          }
        }
      }
    }
    pullRequests(first: $prCount, orderBy: { field: CREATED_AT, direction: DESC }) {
      nodes {
        id
        createdAt
        mergedAt
        closedAt
        updatedAt
        state
        additions
        deletions
        authorAssociation
        author {
          __typename
          login
        }
        reviews(first: 1) {
          totalCount
        }
      }
    }
  }
  rateLimit {
    limit
    remaining
    resetAt
    cost
    used
  }
}
`

export class GitHubApiClient {
  private token?: string
  private onRateLimit?: (snapshot: RateLimitSnapshot) => void

  constructor(options: ClientOptions) {
    this.token = options.token
    this.onRateLimit = options.onRateLimit
  }

  get isAuthenticated(): boolean {
    return Boolean(this.token)
  }

  private buildHeaders(additional: HeadersInit = {}): Headers {
    const headers = new Headers(additional)

    headers.set('Accept', 'application/vnd.github+json')
    headers.set('X-GitHub-Api-Version', GITHUB_API_VERSION)

    if (this.token) {
      headers.set('Authorization', `Bearer ${this.token}`)
    }

    return headers
  }

  private emitRateLimitFromHeaders(headers: Headers): void {
    const rate = parseRateLimitFromHeaders(headers)
    if (!rate) {
      return
    }

    this.onRateLimit?.({
      source: 'rest',
      ...rate,
    })
  }

  private emitRateLimitFromGraphql(rate: GraphqlRateLimitPayload): void {
    this.onRateLimit?.({
      source: 'graphql',
      limit: rate.limit,
      remaining: rate.remaining,
      resetAt: rate.resetAt,
      cost: rate.cost,
      used: rate.used,
    })
  }

  private async parseJsonSafe(response: Response): Promise<unknown | null> {
    const text = await response.text()
    if (!text) {
      return null
    }

    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  }

  private async restRequest<T>(
    path: string,
    options: RestRequestOptions = {},
  ): Promise<RestResponse<T>> {
    const url = `${GITHUB_API_BASE}${path}`
    const cacheKey = options.cacheKey ?? path
    const headers = this.buildHeaders()

    if (options.useEtag) {
      const cached = etagCache.get(cacheKey)
      if (cached?.etag) {
        headers.set('If-None-Match', cached.etag)
      }
    }

    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body,
      signal: options.signal,
    })

    this.emitRateLimitFromHeaders(response.headers)

    if (response.status === 304 && options.useEtag) {
      const cached = etagCache.get(cacheKey)
      return {
        status: 304,
        data: (cached?.data ?? null) as T | null,
      }
    }

    if (response.status === 202 && options.allow202) {
      return {
        status: 202,
        data: null,
      }
    }

    if (!response.ok) {
      const payload = (await this.parseJsonSafe(response)) as
        | {
            message?: string
            documentation_url?: string
            errors?: Array<{ message?: string }>
          }
        | null

      const rate = parseRateLimitFromHeaders(response.headers)
      const retryAfterSeconds = Number(response.headers.get('retry-after') ?? '')

      throw new GitHubApiError({
        message:
          payload?.message ??
          `GitHub REST request failed with status ${response.status}.`,
        status: response.status,
        source: 'rest',
        rateLimit: rate
          ? {
              source: 'rest',
              ...rate,
            }
          : undefined,
        documentationUrl: payload?.documentation_url,
        errors: payload?.errors
          ?.map((entry) => entry.message)
          .filter((entry): entry is string => Boolean(entry)),
        retryAfterSeconds: Number.isFinite(retryAfterSeconds)
          ? retryAfterSeconds
          : undefined,
      })
    }

    const payload = (await this.parseJsonSafe(response)) as T | null

    if (options.useEtag && response.headers.has('etag') && payload) {
      etagCache.set(cacheKey, {
        etag: response.headers.get('etag') ?? '',
        data: payload,
      })
    }

    return {
      status: response.status,
      data: payload,
    }
  }

  private async graphqlRequest<T>(
    query: string,
    variables: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await fetch(`${GITHUB_API_BASE}/graphql`, {
      method: 'POST',
      headers: this.buildHeaders({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({ query, variables }),
      signal,
    })

    this.emitRateLimitFromHeaders(response.headers)

    const payload = (await this.parseJsonSafe(response)) as GraphqlEnvelope<T>

    if (!response.ok || payload.errors?.length) {
      const rate = parseRateLimitFromHeaders(response.headers)
      const retryAfterSeconds = Number(response.headers.get('retry-after') ?? '')
      const errors = payload.errors?.map((entry) => entry.message) ?? []

      throw new GitHubApiError({
        message:
          errors[0] ??
          `GitHub GraphQL request failed with status ${response.status}.`,
        status: response.status,
        source: 'graphql',
        rateLimit: rate
          ? {
              source: 'rest',
              ...rate,
            }
          : undefined,
        errors,
        retryAfterSeconds: Number.isFinite(retryAfterSeconds)
          ? retryAfterSeconds
          : undefined,
      })
    }

    if (!payload.data) {
      throw new GitHubApiError({
        message: 'GitHub GraphQL response did not include data.',
        status: 500,
        source: 'graphql',
      })
    }

    return payload.data
  }

  async fetchOrganizationRepositoriesAll(
    login: string,
    options: OrgRepositoryOptions = {},
  ): Promise<OrganizationRepoSummary[]> {
    const repos: OrganizationRepoSummary[] = []
    let cursor: string | null = null
    let totalCount: number | null = null

    do {
      const response: OrgRepositoriesQueryResponse =
        await this.graphqlRequest<OrgRepositoriesQueryResponse>(
        ORG_REPOSITORIES_QUERY,
        {
          login,
          cursor,
        },
        options.signal,
        )

      this.emitRateLimitFromGraphql(response.rateLimit)

      const connection: OrgRepoConnection | null =
        response.organization?.repositories ?? response.user?.repositories ?? null

      if (!connection) {
        throw new GitHubApiError({
          message: `Could not find organization or user "${login}".`,
          status: 404,
          source: 'graphql',
        })
      }

      if (totalCount === null) {
        totalCount = connection.totalCount
      }

      for (const node of connection.nodes) {
        repos.push({
          id: node.id,
          name: node.name,
          owner: node.owner.login,
          nameWithOwner: node.nameWithOwner,
          description: node.description,
          stargazerCount: node.stargazerCount,
          forkCount: node.forkCount,
          primaryLanguage: node.primaryLanguage?.name ?? null,
          license:
            node.licenseInfo?.spdxId ??
            node.licenseInfo?.name ??
            null,
          updatedAt: node.updatedAt,
          pushedAt: node.pushedAt,
          openIssueCount: node.issues.totalCount,
          openPullRequestCount: node.pullRequests.totalCount,
          isFork: node.isFork,
          isArchived: node.isArchived,
          url: node.url,
        })
      }

      options.onProgress?.({
        fetched: repos.length,
        total: totalCount,
      })

      cursor = connection.pageInfo.hasNextPage
        ? connection.pageInfo.endCursor
        : null
    } while (cursor)

    return repos
  }

  async fetchRepositoryBundle(
    owner: string,
    repo: string,
    options: RepositoryBundleOptions = {},
  ): Promise<RepositoryBundle> {
    const [snapshot, stats] = await Promise.all([
      this.fetchRepositorySnapshot(owner, repo, options.signal),
      this.fetchRepositoryStats(owner, repo, options.signal),
    ])

    return {
      snapshot,
      stats,
      fetchedAt: new Date().toISOString(),
    }
  }

  async fetchRepositoryBundlesBatch(
    repositories: BatchRepositoryRequest[],
    options: BatchRepositoryOptions = {},
  ): Promise<RepositoryBundle[]> {
    const limit = pLimit(options.concurrency ?? 4)

    return Promise.all(
      repositories.map((entry) =>
        limit(() =>
          this.fetchRepositoryBundle(entry.owner, entry.repo, {
            signal: options.signal,
          }),
        ),
      ),
    )
  }

  private async fetchRepositorySnapshot(
    owner: string,
    repo: string,
    signal?: AbortSignal,
  ): Promise<RepositorySnapshot> {
    const response = await this.graphqlRequest<RepositorySnapshotResponse>(
      REPOSITORY_SNAPSHOT_QUERY,
      {
        owner,
        name: repo,
        issueCount: GRAPHQL_CONNECTION_PAGE_SIZE,
        prCount: GRAPHQL_CONNECTION_PAGE_SIZE,
      },
      signal,
    )

    this.emitRateLimitFromGraphql(response.rateLimit)

    if (!response.repository) {
      throw new GitHubApiError({
        message: `Repository ${owner}/${repo} not found or inaccessible.`,
        status: 404,
        source: 'graphql',
      })
    }

    const metadata = {
      name: response.repository.name,
      nameWithOwner: response.repository.nameWithOwner,
      owner: response.repository.owner.login,
      description: response.repository.description,
      stargazerCount: response.repository.stargazerCount,
      forkCount: response.repository.forkCount,
      primaryLanguage: response.repository.primaryLanguage?.name ?? null,
      license:
        response.repository.licenseInfo?.spdxId ??
        response.repository.licenseInfo?.name ??
        null,
      updatedAt: response.repository.updatedAt,
      pushedAt: response.repository.pushedAt,
      url: response.repository.url,
      isFork: response.repository.isFork,
      isArchived: response.repository.isArchived,
      openIssueCount: response.repository.issuesOpen.totalCount,
      closedIssueCount: response.repository.issuesClosed.totalCount,
      openPullRequestCount: response.repository.pullRequestsOpen.totalCount,
      closedPullRequestCount: response.repository.pullRequestsClosed.totalCount,
      mergedPullRequestCount: response.repository.pullRequestsMerged.totalCount,
      goodFirstIssueCount: response.repository.goodFirstIssues.totalCount,
      helpWantedCount: response.repository.helpWantedIssues.totalCount,
    }

    const issues: GitHubIssueNode[] = response.repository.issues.nodes.map((issue) => ({
      id: issue.id,
      createdAt: issue.createdAt,
      closedAt: issue.closedAt,
      updatedAt: issue.updatedAt,
      state: issue.state,
      authorAssociation: issue.authorAssociation,
      labels: issue.labels.nodes
        .map((label) => label?.name)
        .filter((label): label is string => Boolean(label)),
      author: normalizeActor(issue.author),
    }))

    const pullRequests: GitHubPullRequestNode[] =
      response.repository.pullRequests.nodes.map((pr) => ({
        id: pr.id,
        createdAt: pr.createdAt,
        mergedAt: pr.mergedAt,
        closedAt: pr.closedAt,
        updatedAt: pr.updatedAt,
        state: pr.state,
        additions: pr.additions,
        deletions: pr.deletions,
        reviews: pr.reviews.totalCount,
        authorAssociation: pr.authorAssociation,
        author: normalizeActor(pr.author),
      }))

    return {
      metadata,
      issues,
      pullRequests,
    }
  }

  private async fetchRepositoryStats(
    owner: string,
    repo: string,
    signal?: AbortSignal,
  ): Promise<RepositoryStatsBundle> {
    const [participation, commitActivity, contributors, codeFrequency] =
      await Promise.all([
        this.fetchStatsEndpoint<{ all: number[]; owner: number[] }>(
          owner,
          repo,
          'participation',
          {
            all: [],
            owner: [],
          },
          signal,
        ),
        this.fetchStatsEndpoint<CommitActivityWeek[]>(
          owner,
          repo,
          'commit_activity',
          [],
          signal,
        ),
        this.fetchStatsEndpoint<ContributorStat[]>(
          owner,
          repo,
          'contributors',
          [],
          signal,
        ),
        this.fetchStatsEndpoint<Array<[number, number, number]>>(
          owner,
          repo,
          'code_frequency',
          [],
          signal,
        ),
      ])

    return {
      participation: participation.data,
      commitActivity: commitActivity.data,
      contributors: contributors.data,
      codeFrequency: codeFrequency.data,
      pendingEndpoints: [
        ...(participation.pending ? ['participation'] : []),
        ...(commitActivity.pending ? ['commit_activity'] : []),
        ...(contributors.pending ? ['contributors'] : []),
        ...(codeFrequency.pending ? ['code_frequency'] : []),
      ],
    }
  }

  private async fetchStatsEndpoint<T>(
    owner: string,
    repo: string,
    endpoint: string,
    fallback: T,
    signal?: AbortSignal,
  ): Promise<{ data: T; pending: boolean }> {
    const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/stats/${endpoint}`

    for (let attempt = 1; attempt <= STATS_RETRY_MAX_ATTEMPTS; attempt += 1) {
      const response = await this.restRequest<T>(path, {
        signal,
        useEtag: true,
        cacheKey: path,
        allow202: true,
      })

      if (response.status === 202) {
        if (attempt === STATS_RETRY_MAX_ATTEMPTS) {
          return {
            data: fallback,
            pending: true,
          }
        }

        await sleep(STATS_RETRY_DELAY_MS, signal)
        continue
      }

      if (!response.data) {
        return {
          data: fallback,
          pending: false,
        }
      }

      return {
        data: response.data,
        pending: false,
      }
    }

    return {
      data: fallback,
      pending: true,
    }
  }
}

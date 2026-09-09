import pLimit from 'p-limit'
import { GitHubApiClient } from '../src/lib/githubApi.js'
import { GitHubApiError } from '../src/lib/githubError.js'
import { parseSearchTarget } from '../src/lib/search.js'
import type {
  ExplorationData,
  SharedExploration,
  LibraryStatus,
  TokenCheck,
} from '../src/types/api.js'
import type { ExplorationStore } from './store.js'

export class LibraryError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}
/**
 * Reads a visitor-supplied token from a request header.
 *
 * GitHub issues tokens made only of letters, digits and underscores, so
 * anything else is rejected before it can reach an Authorization header.
 */
export function readVisitorToken(
  raw: string | string[] | undefined,
): string | undefined {
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim()
  if (!value) return undefined
  if (!/^[A-Za-z0-9_]{20,255}$/.test(value))
    throw new LibraryError(
      'That does not look like a GitHub token. Copy the whole token and try again.',
      400,
    )
  return value
}

interface Options {
  token?: string
  ttlMs?: number
  refreshCooldownMs?: number
  now?: () => number
  client?: Pick<
    GitHubApiClient,
    | 'fetchRepositoryBundle'
    | 'fetchOrganizationRepositoriesAll'
    | 'fetchRateLimits'
  >
  /** Builds the client for a visitor-supplied token. Injected by the tests. */
  visitorClient?: (token: string) => NonNullable<Options['client']>
}

export class SharedLibrary {
  private client: NonNullable<Options['client']>
  private configured: boolean
  private ttl: number
  private cooldown: number
  private now: () => number
  private rates: LibraryStatus['rates'] = {}
  private inFlight = new Map<string, Promise<SharedExploration>>()
  private failures = new Map<string, { until: number; error: LibraryError }>()
  private limit = pLimit(2)
  private quota: Array<{ at: number; visitor: string }> = []
  private statusUpdatedAt = 0
  private statusRequest: Promise<void> | null = null

  private db: ExplorationStore
  private makeVisitorClient: NonNullable<Options['visitorClient']>
  constructor(db: ExplorationStore, options: Options = {}) {
    this.db = db
    this.makeVisitorClient =
      options.visitorClient ?? ((token) => new GitHubApiClient({ token }))
    this.now = options.now ?? Date.now
    this.ttl = options.ttlMs ?? 6 * 60 * 60 * 1000
    this.cooldown = options.refreshCooldownMs ?? 5 * 60 * 1000
    this.configured = Boolean(options.token || options.client)
    this.client =
      options.client ??
      new GitHubApiClient({
        token: options.token,
        onRateLimit: (snapshot) => {
          this.rates[snapshot.source] = snapshot
        },
      })
  }
  async status(): Promise<LibraryStatus> {
    if (this.configured && this.now() - this.statusUpdatedAt > 5 * 60 * 1000) {
      if (!this.statusRequest) {
        this.statusRequest = this.client
          .fetchRateLimits(AbortSignal.timeout(10000))
          .catch(() => {})
          .finally(() => {
            this.statusUpdatedAt = this.now()
            this.statusRequest = null
          })
      }
      await this.statusRequest
    }
    const summary = await this.db.summary()
    return {
      configured: this.configured,
      cachedExplorations: summary.count,
      recent: summary.recent,
      rates: this.rates,
    }
  }
  private result(
    data: ExplorationData,
    source: SharedExploration['source'],
    warning?: string,
  ): SharedExploration {
    return {
      data,
      source,
      expiresAt: new Date(Date.parse(data.fetchedAt) + this.ttl).toISOString(),
      refreshAfter: new Date(
        Date.parse(data.fetchedAt) + this.cooldown,
      ).toISOString(),
      warning,
    }
  }
  private checkBudget(visitor: string) {
    const now = this.now()
    this.quota = this.quota.filter((item) => now - item.at < 60 * 60 * 1000)
    if (
      this.quota.length >= 50 ||
      this.quota.filter((item) => item.visitor === visitor).length >= 10
    ) {
      throw new LibraryError(
        'The shared refresh budget is resting. Try again later; saved explorations remain available.',
        429,
      )
    }
    if (this.limit.pendingCount >= 6)
      throw new LibraryError(
        'Several explorations are being collected. Please try again shortly.',
        503,
      )
    this.quota.push({ at: now, visitor })
  }
  /** Fetches a target from GitHub and persists the shared representation. */
  private async collect(
    kind: 'repo' | 'org',
    target: string,
    key: string,
    client: NonNullable<Options['client']>,
  ): Promise<SharedExploration> {
    return this.limit(async () => {
      const signal = AbortSignal.timeout(5 * 60 * 1000)
      let data: ExplorationData
      if (kind === 'repo') {
        const [owner, repo] = target.split('/')
        const bundle = await client.fetchRepositoryBundle(owner, repo, {
          signal,
        })
        data = {
          id: key,
          kind,
          target,
          owner,
          repo,
          fetchedAt: bundle.fetchedAt,
          bundle,
        }
      } else {
        const repos = await client.fetchOrganizationRepositoriesAll(target, {
          signal,
        })
        data = {
          id: key,
          kind,
          target,
          org: target,
          fetchedAt: new Date(this.now()).toISOString(),
          repos,
        }
      }
      await this.db.upsert(data)
      // Read through the same persisted representation served to every visitor.
      return this.result((await this.db.get(kind, target))!, 'github')
    })
  }
  /** Turns an upstream failure into a safe message, forgetting targets that are gone. */
  private async normalizeFailure(
    error: unknown,
    kind: 'repo' | 'org',
    target: string,
  ): Promise<{ gone: boolean; safeError: LibraryError }> {
    const gone =
      error instanceof GitHubApiError &&
      (error.status === 404 ||
        (error.status === 403 &&
          error.message.includes('public repositories only')))
    if (gone) await this.db.remove(kind, target)
    const safeError =
      error instanceof LibraryError
        ? error
        : new LibraryError(
            gone
              ? 'This public repository or organization could not be found.'
              : 'GitHub could not complete this exploration. Please try again later.',
            gone ? 404 : 502,
          )
    return { gone, safeError }
  }
  /** Checks a visitor token against GitHub and reports the quota it carries. */
  async verifyToken(token: string): Promise<TokenCheck> {
    const rates: TokenCheck['rates'] = {}
    const client = new GitHubApiClient({
      token,
      onRateLimit: (snapshot) => {
        rates[snapshot.source] = snapshot
      },
    })
    try {
      await client.fetchRateLimits(AbortSignal.timeout(10000))
    } catch (error) {
      throw new LibraryError(
        error instanceof GitHubApiError && error.status === 401
          ? 'GitHub rejected this token. Check that you copied all of it and that it has not expired.'
          : 'GitHub could not check this token right now. Please try again shortly.',
        error instanceof GitHubApiError && error.status === 401 ? 401 : 502,
      )
    }
    return { ok: true, rates }
  }
  async explore(
    input: string,
    refresh = false,
    visitor = 'local',
    visitorToken?: string,
  ): Promise<SharedExploration> {
    const parsed = parseSearchTarget(input)
    if (!parsed || input.length > 200)
      throw new LibraryError('Enter an organization or owner/repository.', 400)
    const target = (
      parsed.type === 'repo'
        ? `${parsed.value.owner}/${parsed.value.repo}`
        : parsed.value.org
    ).toLowerCase()
    const kind = parsed.type
    const key = `${kind}:${target}`
    const cached = await this.db.get(kind, target)
    if (
      cached &&
      this.now() - Date.parse(cached.fetchedAt) <
        (refresh ? this.cooldown : this.ttl)
    ) {
      return this.result(
        cached,
        'database',
        refresh
          ? 'This exploration was fetched recently. Reusing it to conserve shared GitHub requests.'
          : undefined,
      )
    }
    // A visitor's own token spends their quota, so it takes precedence over the
    // shared connection and skips the shared budget and failure backoff.
    if (visitorToken)
      return this.exploreAsVisitor(kind, target, key, visitorToken, cached)
    const running = this.inFlight.get(key)
    if (running) return running
    const failure = this.failures.get(key)
    if (failure && failure.until > this.now()) {
      if (cached)
        return this.result(
          cached,
          'stale',
          'Live refresh is temporarily unavailable. Showing the last saved exploration and its original dates.',
        )
      throw failure.error
    }
    this.failures.delete(key)
    const perform = async () => {
      try {
        if (!this.configured)
          throw new LibraryError(
            'Live exploration is not available yet. Add your own GitHub token in settings, or try an existing exploration or the sample tour.',
            503,
          )
        this.checkBudget(visitor)
        return await this.collect(kind, target, key, this.client)
      } catch (error) {
        const { gone, safeError } = await this.normalizeFailure(
          error,
          kind,
          target,
        )
        // Back off on repeated failures rather than repeatedly spending upstream quota.
        if (this.failures.size > 1000) this.failures.clear()
        this.failures.set(key, { until: this.now() + 60000, error: safeError })
        if (cached && !gone)
          return this.result(
            cached,
            'stale',
            'Live refresh failed. Showing the last saved exploration and its original dates.',
          )
        throw safeError
      }
    }
    const request = perform().finally(() => this.inFlight.delete(key))
    this.inFlight.set(key, request)
    return request
  }
  private async exploreAsVisitor(
    kind: 'repo' | 'org',
    target: string,
    key: string,
    token: string,
    cached: ExplorationData | null,
  ): Promise<SharedExploration> {
    try {
      // The token is never stored, so each request builds its own client and
      // its rate limits stay out of the shared status.
      return await this.collect(kind, target, key, this.makeVisitorClient(token))
    } catch (error) {
      if (error instanceof GitHubApiError && error.status === 401)
        throw new LibraryError(
          'GitHub rejected your token. Check it in settings, or remove it to use the shared connection.',
          401,
        )
      if (
        error instanceof GitHubApiError &&
        (error.status === 429 ||
          (error.status === 403 && error.message.includes('rate limit')))
      )
        throw new LibraryError(
          'Your GitHub token has no requests left for now. Wait for its quota to reset, or remove it in settings to use the shared connection.',
          429,
        )
      const { gone, safeError } = await this.normalizeFailure(
        error,
        kind,
        target,
      )
      if (cached && !gone)
        return this.result(
          cached,
          'stale',
          'Your GitHub token could not complete this refresh. Showing the last saved exploration and its original dates.',
        )
      throw safeError
    }
  }
}

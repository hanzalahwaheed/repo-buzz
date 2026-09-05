import pLimit from 'p-limit'
import { GitHubApiClient } from '../src/lib/githubApi'
import { GitHubApiError } from '../src/lib/githubError'
import { parseSearchTarget } from '../src/lib/search'
import type {
  ExplorationData,
  SharedExploration,
  LibraryStatus,
} from '../src/types/api'
import { ExplorationDatabase } from './database'

export class LibraryError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
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

  private db: ExplorationDatabase
  constructor(db: ExplorationDatabase, options: Options = {}) {
    this.db = db
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
    const summary = this.db.summary()
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
  async explore(
    input: string,
    refresh = false,
    visitor = 'local',
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
    const cached = this.db.get(kind, target)
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
            'Live exploration is not available yet. The site owner needs to configure the shared GitHub connection. Try an existing exploration or the sample tour.',
            503,
          )
        this.checkBudget(visitor)
        return await this.limit(async () => {
          const signal = AbortSignal.timeout(5 * 60 * 1000)
          let data: ExplorationData
          if (kind === 'repo') {
            const [owner, repo] = target.split('/')
            const bundle = await this.client.fetchRepositoryBundle(
              owner,
              repo,
              { signal },
            )
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
            const repos = await this.client.fetchOrganizationRepositoriesAll(
              target,
              { signal },
            )
            data = {
              id: key,
              kind,
              target,
              org: target,
              fetchedAt: new Date(this.now()).toISOString(),
              repos,
            }
          }
          this.db.upsert(data)
          // Read through the same persisted representation served to every visitor.
          return this.result(this.db.get(kind, target)!, 'github')
        })
      } catch (error) {
        const gone =
          error instanceof GitHubApiError &&
          (error.status === 404 ||
            (error.status === 403 &&
              error.message.includes('public repositories only')))
        if (gone) this.db.remove(kind, target)
        const safeError =
          error instanceof LibraryError
            ? error
            : new LibraryError(
                gone
                  ? 'This public repository or organization could not be found.'
                  : 'GitHub could not complete this exploration. Please try again later.',
                gone ? 404 : 502,
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
}

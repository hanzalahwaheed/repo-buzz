import assert from 'node:assert/strict'
import { after, afterEach, test } from 'node:test'
import { createServer } from 'vite'

const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
})
const { computeRepoAnalytics } = await vite.ssrLoadModule('/src/lib/metrics.ts')
const { createDemoBundle } = await vite.ssrLoadModule('/src/lib/demo.ts')
const { parseSearchTarget } = await vite.ssrLoadModule('/src/lib/search.ts')
const storage = await vite.ssrLoadModule('/src/lib/localStore.ts')
const { GitHubApiClient } = await vite.ssrLoadModule('/src/lib/githubApi.ts')
const options = { includeBots: false, excludeMaintainers: false }
const originalFetch = globalThis.fetch
const originalWindow = globalThis.window
function memoryStorage() {
  const values = new Map()
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
  }
  return values
}
afterEach(() => {
  globalThis.fetch = originalFetch
  globalThis.window = originalWindow
})
after(() => vite.close())

test('merge rate uses PRs resolved in the window, not repository totals', () => {
  const bundle = createDemoBundle()
  const template = bundle.snapshot.pullRequests[1]
  bundle.snapshot.pullRequests = [
    {
      ...template,
      id: 'merged',
      createdAt: '2025-01-01T00:00:00Z',
      mergedAt: '2026-08-01T00:00:00Z',
      closedAt: '2026-08-01T00:00:00Z',
    },
    {
      ...template,
      id: 'closed',
      state: 'CLOSED',
      mergedAt: null,
      closedAt: '2026-08-02T00:00:00Z',
    },
    {
      ...template,
      id: 'old',
      mergedAt: '2026-01-01T00:00:00Z',
      closedAt: '2026-01-01T00:00:00Z',
    },
    {
      ...template,
      id: 'future',
      mergedAt: '2026-10-01T00:00:00Z',
      closedAt: '2026-10-01T00:00:00Z',
    },
  ]
  const result = computeRepoAnalytics(bundle, options)
  assert.equal(result.prMetrics.mergeRate, 0.5)
  assert.equal(result.prMetrics.rejectionRate, 0.5)
  assert.equal(result.prMetrics.mergedCount, 1)
  assert.equal(result.prMetrics.resolvedCount, 2)
  assert.ok(result.prMetrics.medianTimeToMergeDays > 365)
  bundle.snapshot.pullRequests = []
  assert.equal(computeRepoAnalytics(bundle, options).prMetrics.mergeRate, null)
})

test('saved analytics are stable when the current date changes', () => {
  const bundle = createDemoBundle()
  const first = computeRepoAnalytics(bundle, options)
  const originalNow = Date.now
  try {
    Date.now = () => new Date('2030-01-01').getTime()
    assert.deepEqual(computeRepoAnalytics(bundle, options), first)
  } finally {
    Date.now = originalNow
  }
})

test('bot filtering changes period metrics consistently', () => {
  const bundle = createDemoBundle()
  bundle.snapshot.pullRequests.forEach((pr) => {
    pr.author = { login: 'automation[bot]', type: 'Bot' }
  })
  const hidden = computeRepoAnalytics(bundle, options)
  const shown = computeRepoAnalytics(bundle, { ...options, includeBots: true })
  assert.equal(hidden.prMetrics.medianTimeToMergeDays, null)
  assert.equal(shown.prMetrics.medianTimeToMergeDays, 3)
  assert.equal(hidden.prMetrics.mergeRate, null)
  assert.equal(shown.prMetrics.mergeRate, 1)
})

test('accepts GitHub URLs and rejects token-shaped searches and other hosts', () => {
  assert.deepEqual(
    parseSearchTarget('https://github.com/withastro/astro.git'),
    { type: 'repo', value: { owner: 'withastro', repo: 'astro' } },
  )
  assert.equal(parseSearchTarget('github_pat_' + 'x'.repeat(30)), null)
  assert.equal(parseSearchTarget('https://example.com/withastro/astro'), null)
  assert.equal(
    parseSearchTarget('https://github.com/withastro/astro/issues/1'),
    null,
  )
  assert.equal(parseSearchTarget(''), null)
})

test('snapshots round-trip and lookups are case insensitive', () => {
  memoryStorage()
  const bundle = createDemoBundle()
  const saved = storage.saveRepoVersion({
    owner: 'FieldNotes',
    repo: 'Garden',
    authenticated: true,
    bundle,
  })
  assert.ok(saved)
  assert.deepEqual(
    storage.getLatestRepoVersion('fieldnotes', 'garden').bundle,
    bundle,
  )
  storage.clearAllPersistedData()
  assert.equal(storage.getLatestRepoVersion('fieldnotes', 'garden'), null)
})

test('blocked storage and malformed records do not crash exploration', () => {
  globalThis.window = {
    get localStorage() {
      throw new Error('Storage blocked')
    },
  }
  assert.deepEqual(storage.listSearchHistory(), [])
  assert.equal(
    storage.saveRepoVersion({
      owner: 'a',
      repo: 'b',
      authenticated: false,
      bundle: createDemoBundle(),
    }),
    null,
  )
  const values = memoryStorage()
  values.set('repobuzz.repoVersions.v1', '[null,{}]')
  values.set('repobuzz.searchHistory.v1', 'invalid json')
  assert.equal(storage.getLatestRepoVersion('a', 'b'), null)
  assert.deepEqual(storage.listSearchHistory(), [])
})

test('quota failures return a save failure without deleting existing data', () => {
  memoryStorage()
  globalThis.window.localStorage.setItem = () => {
    throw new Error('Quota exceeded')
  }
  assert.equal(
    storage.saveRepoVersion({
      owner: 'a',
      repo: 'b',
      authenticated: false,
      bundle: createDemoBundle(),
    }),
    null,
  )
})

test('organization lookup selects the correct account branch and follows pagination', async () => {
  const variables = []
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/users/example'))
      return Response.json({ type: 'Organization' })
    const body = JSON.parse(init.body)
    variables.push(body.variables)
    assert.match(body.query, /privacy: PUBLIC/)
    assert.match(body.query, /@include\(if: \$isOrg\)/)
    return Response.json({
      data: {
        organization: {
          repositories: {
            totalCount: 0,
            nodes: [],
            pageInfo: {
              hasNextPage: variables.length === 1,
              endCursor: variables.length === 1 ? 'next-page' : null,
            },
          },
        },
        user: null,
        rateLimit: {
          limit: 5000,
          remaining: 4999,
          resetAt: '2026-09-02T00:00:00Z',
          cost: 1,
        },
      },
    })
  }
  assert.deepEqual(
    await new GitHubApiClient({
      token: 'test-placeholder',
    }).fetchOrganizationRepositoriesAll('example'),
    [],
  )
  assert.equal(variables.length, 2)
  assert.equal(variables[0].isOrg, true)
  assert.equal(variables[1].cursor, 'next-page')
})

test('empty GraphQL errors produce a handled API error', async () => {
  globalThis.fetch = async (url) =>
    String(url).endsWith('/users/example')
      ? Response.json({ type: 'User' })
      : new Response('', { status: 502 })
  await assert.rejects(
    new GitHubApiClient({}).fetchOrganizationRepositoriesAll('example'),
    /status 502/,
  )
})

test('private repositories are rejected before fetching statistics', async () => {
  let requests = 0
  globalThis.fetch = async () => {
    requests++
    return Response.json({
      data: {
        repository: { isPrivate: true },
        rateLimit: {
          limit: 5000,
          remaining: 4999,
          resetAt: '2026-09-02T00:00:00Z',
          cost: 1,
        },
      },
    })
  }
  await assert.rejects(
    new GitHubApiClient({ token: 'test-placeholder' }).fetchRepositoryBundle(
      'private',
      'project',
    ),
    /public repositories only/,
  )
  assert.equal(requests, 1)
})

const { threeMonthWindow } = await vite.ssrLoadModule(
  '/src/lib/analysisWindow.ts',
)
test('three-month window clamps calendar boundaries and preserves UTC time', () => {
  assert.equal(
    threeMonthWindow('2026-05-31T12:34:56Z').start,
    '2026-02-28T12:34:56.000Z',
  )
  assert.equal(
    threeMonthWindow('2024-05-31T12:34:56Z').start,
    '2024-02-29T12:34:56.000Z',
  )
})

test('events outside the exact window are excluded, but old items resolved inside count', () => {
  const bundle = createDemoBundle()
  const issue = bundle.snapshot.issues[0]
  bundle.snapshot.issues = [
    {
      ...issue,
      id: 'old-closed',
      createdAt: '2025-01-01T00:00:00Z',
      closedAt: '2026-06-01T12:00:00Z',
    },
    {
      ...issue,
      id: 'before-boundary',
      createdAt: '2026-06-01T11:59:59Z',
      closedAt: null,
    },
    {
      ...issue,
      id: 'at-end',
      createdAt: bundle.analysisWindow.end,
      closedAt: null,
    },
    {
      ...issue,
      id: 'future',
      createdAt: '2026-09-01T12:00:01Z',
      closedAt: null,
    },
  ]
  bundle.snapshot.pullRequests = []
  const result = computeRepoAnalytics(bundle, options)
  assert.equal(result.issueMetrics.openedCount, 1)
  assert.equal(result.issueMetrics.closedCount, 1)
  assert.equal(
    result.issueMetrics.weeklyTrend.reduce((n, week) => n + week.closed, 0),
    1,
  )
  assert.equal(result.contributorMetrics.topContributors[0].issuesOpened, 1)
})

function activityFixture() {
  const recent = new Date(Date.now() - 86400000).toISOString()
  const old = '2020-01-01T00:00:00Z'
  const demo = createDemoBundle()
  const node = (index, pr = false) => ({
    ...(pr ? demo.snapshot.pullRequests[1] : demo.snapshot.issues[1]),
    id: `${pr ? 'pr' : 'issue'}-${index}`,
    createdAt: index === 149 ? old : recent,
    closedAt: recent,
    mergedAt: pr ? recent : undefined,
    updatedAt: recent,
    author: { login: 'person', __typename: 'User' },
    labels: { nodes: [] },
    reviews: { totalCount: 2 },
  })
  const connection = (pr) => ({
    nodes: Array.from({ length: 100 }, (_, i) => node(i, pr)),
    pageInfo: { hasNextPage: true, endCursor: 'page2' },
  })
  const repository = {
    ...demo.snapshot.metadata,
    isPrivate: false,
    owner: { login: 'fieldnotes' },
    primaryLanguage: { name: 'TypeScript' },
    licenseInfo: { spdxId: 'MIT' },
    issues: connection(false),
    pullRequests: connection(true),
  }
  for (const key of [
    'issuesOpen',
    'issuesClosed',
    'pullRequestsOpen',
    'pullRequestsClosed',
    'pullRequestsMerged',
    'goodFirstIssues',
    'helpWantedIssues',
  ])
    repository[key] = { totalCount: 150 }
  const rateLimit = { limit: 5000, remaining: 4900, resetAt: recent }
  return { repository, rateLimit, node, old }
}

test('paginates beyond 100 items for both connections, deduplicates, and stops at the date boundary', async () => {
  const { repository, rateLimit, node, old } = activityFixture()
  const pages = []
  globalThis.fetch = async (url, init) => {
    if (!String(url).endsWith('/graphql'))
      return Response.json(
        String(url).endsWith('/participation') ? { all: [], owner: [] } : [],
      )
    const body = JSON.parse(init.body)
    assert.match(body.query, /UPDATED_AT/)
    if (body.query.includes('query RepositorySnapshot'))
      return Response.json({ data: { repository, rateLimit } })
    const pr = body.query.includes('pullRequests(first:')
    pages.push(pr ? 'pr' : 'issue')
    assert.equal(body.variables.cursor, 'page2')
    const nodes = [
      node(99, pr),
      ...Array.from({ length: 50 }, (_, i) => node(100 + i, pr)),
      { ...node(150, pr), updatedAt: old },
    ]
    return Response.json({
      data: {
        repository: {
          [pr ? 'pullRequests' : 'issues']: {
            nodes,
            pageInfo: { hasNextPage: true, endCursor: 'older-page' },
          },
        },
        rateLimit,
      },
    })
  }
  const bundle = await new GitHubApiClient({
    token: 'test-placeholder',
  }).fetchRepositoryBundle('fieldnotes', 'garden')
  assert.equal(bundle.snapshot.issues.length, 150)
  assert.equal(bundle.snapshot.pullRequests.length, 150)
  assert.deepEqual(pages.sort(), ['issue', 'pr'])
  assert.equal(bundle.analysisWindow.version, 2)
  const analysis = computeRepoAnalytics(bundle, options)
  assert.equal(analysis.prMetrics.mergedCount, 150)
  assert.equal(analysis.prMetrics.openedCount, 149)
})

test('a failed continuation rejects the bundle instead of returning a complete-looking sample', async () => {
  const { repository, rateLimit } = activityFixture()
  globalThis.fetch = async (_url, init) => {
    if (JSON.parse(init.body).query.includes('query RepositorySnapshot'))
      return Response.json({ data: { repository, rateLimit } })
    return Response.json(
      { errors: [{ message: 'Rate limit exceeded' }] },
      { status: 403 },
    )
  }
  await assert.rejects(
    new GitHubApiClient({ token: 'test-placeholder' }).fetchRepositoryBundle(
      'fieldnotes',
      'garden',
    ),
    /Rate limit exceeded/,
  )
})

test('commit chart retains boundary weeks and excludes days outside the period', () => {
  const bundle = createDemoBundle()
  bundle.stats.commitActivity = [
    {
      week: Date.parse('2026-05-31T00:00:00Z') / 1000,
      total: 71,
      days: [50, 1, 2, 3, 4, 5, 6],
    },
    {
      week: Date.parse('2026-08-30T00:00:00Z') / 1000,
      total: 28,
      days: [1, 2, 3, 4, 5, 6, 7],
    },
  ]
  assert.deepEqual(
    computeRepoAnalytics(bundle, options).commitMetrics.weeklyTrend.map(
      (week) => week.commits,
    ),
    [21, 6],
  )
})

import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer as createViteServer } from 'vite'

const vite = await createViteServer({
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom',
})
const { ExplorationDatabase } = await vite.ssrLoadModule('/server/database.ts')
const { SharedLibrary } = await vite.ssrLoadModule('/server/library.ts')
const { createHandler } = await vite.ssrLoadModule('/server/http.ts')
const { GitHubApiError } = await vite.ssrLoadModule('/src/lib/githubError.ts')
const { createDemoBundle } = await vite.ssrLoadModule('/src/lib/demo.ts')
after(() => vite.close())

function fixture() {
  let now = Date.parse('2026-09-01T12:00:00Z')
  let requests = 0
  const client = {
    fetchRateLimits: async () => {},
    fetchRepositoryBundle: async () => {
      requests++
      const bundle = createDemoBundle()
      bundle.fetchedAt = new Date(now).toISOString()
      bundle.analysisWindow.end = bundle.fetchedAt
      return bundle
    },
    fetchOrganizationRepositoriesAll: async () => {
      requests++
      return []
    },
  }
  const db = new ExplorationDatabase(':memory:')
  const library = new SharedLibrary(db, { client, now: () => now })
  return {
    db,
    library,
    client,
    requests: () => requests,
    advance: (ms) => {
      now += ms
    },
    now: () => now,
  }
}

test('shared cache serves a second visitor without spending another GitHub request', async () => {
  const f = fixture()
  try {
    const first = await f.library.explore(
      'Fieldnotes/Garden',
      false,
      'visitor-a',
    )
    const second = await f.library.explore(
      'fieldnotes/garden',
      false,
      'visitor-b',
    )
    assert.equal(first.source, 'github')
    assert.equal(second.source, 'database')
    assert.deepEqual(first.data, second.data)
    assert.equal(f.requests(), 1)
    const noToken = new SharedLibrary(f.db, { now: f.now })
    assert.equal(
      (await noToken.explore('fieldnotes/garden')).source,
      'database',
    )
  } finally {
    await f.db.close()
  }
})

test('organizations and repositories have separate rows; refresh updates rather than duplicates', async () => {
  const f = fixture()
  try {
    await f.library.explore('fieldnotes')
    const original = await f.library.explore('fieldnotes/garden')
    f.advance(7 * 60 * 60 * 1000)
    const updated = await f.library.explore('FIELDNOTES/GARDEN')
    assert.equal(updated.source, 'github')
    assert.notEqual(updated.data.fetchedAt, original.data.fetchedAt)
    assert.equal((await f.db.summary()).count, 2)
    assert.equal((await f.db.get('org', 'FIELDNOTES')).kind, 'org')
    assert.equal(f.requests(), 3)
  } finally {
    await f.db.close()
  }
})

test('simultaneous requests for one target share the in-flight fetch', async () => {
  const f = fixture()
  try {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        f.library.explore('fieldnotes/garden', false, `visitor-${index}`),
      ),
    )
    assert.equal(f.requests(), 1)
    assert.ok(results.every((result) => result.data.id === results[0].data.id))
  } finally {
    await f.db.close()
  }
})

test('manual refresh respects the shared cooldown and refreshes once it expires', async () => {
  const f = fixture()
  try {
    await f.library.explore('fieldnotes/garden')
    assert.equal(
      (await f.library.explore('fieldnotes/garden', true)).source,
      'database',
    )
    assert.equal(f.requests(), 1)
    f.advance(6 * 60 * 1000)
    assert.equal(
      (await f.library.explore('fieldnotes/garden', true)).source,
      'github',
    )
    assert.equal(f.requests(), 2)
  } finally {
    await f.db.close()
  }
})

test('failed refresh preserves the old row and explicitly marks it stale', async () => {
  const f = fixture()
  try {
    const first = await f.library.explore('fieldnotes/garden')
    f.advance(7 * 60 * 60 * 1000)
    f.client.fetchRepositoryBundle = async () => {
      throw new Error('upstream detail includes a-secret-value')
    }
    const result = await f.library.explore('fieldnotes/garden')
    assert.equal(result.source, 'stale')
    assert.equal(result.data.fetchedAt, first.data.fetchedAt)
    assert.doesNotMatch(JSON.stringify(result), /a-secret-value/)
    assert.equal((await f.db.summary()).count, 1)
  } finally {
    await f.db.close()
  }
})

test('private or removed repositories are evicted on revalidation instead of served stale', async () => {
  const f = fixture()
  try {
    await f.library.explore('fieldnotes/garden')
    f.advance(7 * 60 * 60 * 1000)
    f.client.fetchRepositoryBundle = async () => {
      throw new GitHubApiError({
        status: 403,
        source: 'graphql',
        message: 'repoBuzz explores public repositories only.',
      })
    }
    await assert.rejects(
      f.library.explore('fieldnotes/garden'),
      (error) => error.status === 404,
    )
    assert.equal(await f.db.get('repo', 'fieldnotes/garden'), null)
  } finally {
    await f.db.close()
  }
})

test('a visitor token is preferred over the shared connection', async () => {
  const f = fixture()
  let visitorRequests = 0
  let seenToken = ''
  const library = new SharedLibrary(f.db, {
    client: f.client,
    now: f.now,
    visitorClient: (token) => {
      seenToken = token
      return {
        fetchRateLimits: async () => {},
        fetchRepositoryBundle: async () => {
          visitorRequests++
          return createDemoBundle()
        },
        fetchOrganizationRepositoriesAll: async () => {
          visitorRequests++
          return []
        },
      }
    },
  })
  try {
    const result = await library.explore(
      'fieldnotes/garden',
      false,
      'visitor-a',
      'ghp_visitor_token_0123456789',
    )
    assert.equal(result.source, 'github')
    assert.equal(seenToken, 'ghp_visitor_token_0123456789')
    assert.equal(visitorRequests, 1)
    // The shared connection stayed untouched.
    assert.equal(f.requests(), 0)
  } finally {
    await f.db.close()
  }
})

test('a visitor token explores even when the shared connection is missing', async () => {
  const db = new ExplorationDatabase(':memory:')
  try {
    const library = new SharedLibrary(db, {
      visitorClient: () => ({
        fetchRateLimits: async () => {},
        fetchRepositoryBundle: async () => createDemoBundle(),
        fetchOrganizationRepositoriesAll: async () => [],
      }),
    })
    assert.equal((await library.status()).configured, false)
    const result = await library.explore(
      'fieldnotes/garden',
      false,
      'visitor-a',
      'ghp_visitor_token_0123456789',
    )
    assert.equal(result.source, 'github')
    assert.equal((await db.summary()).count, 1)
  } finally {
    await db.close()
  }
})

test('a visitor token does not spend the shared refresh budget', async () => {
  const f = fixture()
  const library = new SharedLibrary(f.db, {
    client: f.client,
    now: f.now,
    visitorClient: () => ({
      fetchRateLimits: async () => {},
      fetchRepositoryBundle: async () => createDemoBundle(),
      fetchOrganizationRepositoriesAll: async () => [],
    }),
  })
  try {
    // Exhaust this visitor's share of the shared budget.
    for (let attempt = 0; attempt < 10; attempt++) {
      await library.explore(`fieldnotes/repo-${attempt}`, false, 'visitor-a')
    }
    await assert.rejects(
      library.explore('fieldnotes/blocked', false, 'visitor-a'),
      /budget is resting/,
    )
    const own = await library.explore(
      'fieldnotes/blocked',
      false,
      'visitor-a',
      'ghp_visitor_token_0123456789',
    )
    assert.equal(own.source, 'github')
  } finally {
    await f.db.close()
  }
})

test('missing owner token gives a useful error and does not insert a false snapshot', async () => {
  const db = new ExplorationDatabase(':memory:')
  try {
    const library = new SharedLibrary(db)
    await assert.rejects(
      library.explore('fieldnotes/garden'),
      /not available yet/,
    )
    assert.equal((await db.summary()).count, 0)
    assert.equal((await library.status()).configured, false)
  } finally {
    await db.close()
  }
})

test('SQLite rows survive closing and reopening the database', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'repobuzz-db-test-'))
  const path = join(directory, 'library.sqlite')
  let db = new ExplorationDatabase(path)
  try {
    const f = fixture()
    const result = await f.library.explore('fieldnotes/garden')
    await f.db.close()
    await db.upsert(result.data)
    await db.close()
    db = new ExplorationDatabase(path)
    assert.equal(
      (await db.get('repo', 'FIELDNOTES/GARDEN')).bundle.analysisWindow.version,
      2,
    )
    assert.equal((await db.summary()).count, 1)
  } finally {
    await db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('upstream miss budget limits spending while cached requests still work', async () => {
  const f = fixture()
  try {
    for (let i = 0; i < 10; i++)
      await f.library.explore(`project-${i}`, false, 'visitor')
    await assert.rejects(
      f.library.explore('project-extra', false, 'visitor'),
      (error) => error.status === 429,
    )
    assert.equal(
      (await f.library.explore('project-0', false, 'visitor')).source,
      'database',
    )
  } finally {
    await f.db.close()
  }
})

test('HTTP API exposes only public data, protects refreshes, and never serves the database file', async () => {
  const f = fixture()
  const server = createServer(
    createHandler(f.library, join(tmpdir(), 'no-static-directory')),
  )
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const first = await fetch(
      `${base}/api/explorations?target=fieldnotes/garden`,
    ).then((response) => response.json())
    assert.equal(first.source, 'github')
    const second = await fetch(
      `${base}/api/explorations?target=fieldnotes/garden`,
    ).then((response) => response.json())
    assert.equal(second.source, 'database')
    assert.equal(f.requests(), 1)
    const status = await fetch(`${base}/api/status`).then((response) =>
      response.json(),
    )
    assert.equal(status.cachedExplorations, 1)
    assert.equal('token' in status, false)
    assert.equal(
      (
        await fetch(`${base}/api/explorations?target=fieldnotes/garden`, {
          method: 'POST',
        })
      ).status,
      415,
    )
    assert.equal(
      (
        await fetch(`${base}/api/explorations?target=fieldnotes/garden`, {
          headers: { 'sec-fetch-site': 'cross-site' },
        })
      ).status,
      403,
    )
    assert.equal((await fetch(`${base}/data/repobuzz.sqlite`)).status, 404)
    assert.equal(
      (
        await fetch(
          `${base}/api/explorations?target=${encodeURIComponent('ghp_' + 'x'.repeat(30))}`,
        )
      ).status,
      400,
    )
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await f.db.close()
  }
})

import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { GitHubApiClient } from './lib/githubApi'
import { toUserMessage } from './lib/githubError'
import { parseSearchTarget, GITHUB_TOKEN_REGEX } from './lib/search'
import {
  getLatestRepoVersion,
  getLatestOrgVersion,
  saveRepoVersion,
  saveOrgVersion,
  listSearchHistory,
  appendSearchHistory,
  clearAllPersistedData,
} from './lib/localStore'
import { TokenInput } from './components/TokenInput'
import { OrgView } from './components/OrgView'
import { RateLimitIndicator } from './components/RateLimitIndicator'
import type { RateLimitSnapshot } from './types/github'
const RepositoryPage = lazy(() => import('./components/RepositoryPage'))

function routeTarget() {
  try {
    return decodeURIComponent(window.location.hash.slice(1)).replace(/^\//, '')
  } catch {
    return 'invalid/route/value'
  }
}
function go(target: string) {
  window.location.hash = `/${target}`
}

export default function App() {
  const [route, setRoute] = useState(routeTarget)
  const [token, setToken] = useState('')
  const [settings, setSettings] = useState(false)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [rates, setRates] = useState<{
    rest?: RateLimitSnapshot
    graphql?: RateLimitSnapshot
  }>({})
  const queryClient = useQueryClient()
  useEffect(() => {
    const update = () => {
      setRoute(routeTarget())
      setError('')
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  const client = useMemo(
    () =>
      new GitHubApiClient({
        token: token || undefined,
        onRateLimit: (snapshot) =>
          setRates((current) => ({ ...current, [snapshot.source]: snapshot })),
      }),
    [token],
  )
  const changeToken = (next: string) => {
    void queryClient.cancelQueries()
    queryClient.clear()
    setRates({})
    setToken(next)
  }
  const submit = (value: string) => {
    if (GITHUB_TOKEN_REGEX.test(value.trim())) {
      setSearch('')
      setError('That looks like a token. Add it in GitHub connection.')
      setSettings(true)
      return
    }
    const parsed = parseSearchTarget(value)
    if (!parsed) {
      setError('Enter a GitHub organization, owner/repository, or GitHub URL.')
      return
    }
    setError('')
    go(
      parsed.type === 'repo'
        ? `${parsed.value.owner}/${parsed.value.repo}`
        : parsed.value.org,
    )
  }
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault()
          document.getElementById('main-content')?.focus()
        }}
      >
        Skip to content
      </a>
      <header className="topbar">
        <a className="brand" href="#/" aria-label="repoBuzz home">
          <span className="brand-mark">
            b<span>↗</span>
          </span>
          repo<span>Buzz</span>
          <small>THE OPEN-SOURCE FIELD GUIDE</small>
        </a>
        <nav aria-label="Main navigation">
          <a className={!route ? 'nav-active' : ''} href="#/">
            Explore
          </a>
          <a className={route === 'saved' ? 'nav-active' : ''} href="#/saved">
            Saved explorations
          </a>
          <button
            className="connection ghost"
            onClick={() => setSettings((v) => !v)}
            aria-expanded={settings}
          >
            <i className={token ? 'connected' : ''} />
            {token ? 'Token added' : 'Connect GitHub'}
          </button>
        </nav>
      </header>
      {settings && (
        <section className="settings-layout">
          <TokenInput
            token={token}
            onTokenChange={changeToken}
            onClearToken={() => changeToken('')}
          />
          <RateLimitIndicator
            restRateLimit={rates.rest}
            graphRateLimit={rates.graphql}
            isAuthenticated={!!token}
          />
          <button
            className="ghost close-settings"
            onClick={() => setSettings(false)}
          >
            Close settings ×
          </button>
        </section>
      )}
      <main id="main-content" tabIndex={-1}>
        {!route ? (
          <>
            <section className="hero">
              <div className="hero-copy">
                <p className="eyebrow">
                  <span /> YOUR NEXT CONTRIBUTION STARTS HERE
                </p>
                <h1>
                  Find your people.
                  <br />
                  Make your <em>first pull request.</em>
                </h1>
                <p className="hero-description">
                  Explore the communities behind the code. Find active projects,
                  understand how they work, and discover a place to learn and
                  grow.
                </p>
                <form
                  className="discovery-search"
                  onSubmit={(event) => {
                    event.preventDefault()
                    submit(search)
                  }}
                >
                  <label htmlFor="search">
                    Where are you curious to contribute?
                  </label>
                  <div>
                    <span aria-hidden="true">⌕</span>
                    <input
                      id="search"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Organization, owner/repo, or GitHub URL"
                      autoComplete="off"
                      spellCheck={false}
                      required
                    />
                    <button>
                      Find the buzz <span aria-hidden="true">↗</span>
                    </button>
                  </div>
                </form>
                <p className="search-note">
                  Public repositories · Saved on this device · Your token stays
                  in memory
                </p>
              </div>
              <aside className="field-note">
                <span className="note-number">FIELD NOTE / 001</span>
                <div className="orbit" aria-hidden="true">
                  <span>+</span>
                  <span>↗</span>
                  <span>⌘</span>
                  <b>✳</b>
                </div>
                <h2>
                  Big impact.
                  <br />
                  Small beginnings.
                </h2>
                <p>
                  A useful bug report, a clearer sentence, a first fix. Every
                  contribution counts.
                </p>
                <a href="#/demo">
                  Take a sample tour <span>↗</span>
                </a>
              </aside>
            </section>
            {error && (
              <p className="notice" role="alert">
                {error}
              </p>
            )}
            <section className="discovery-section">
              <header className="section-heading">
                <div>
                  <p className="eyebrow">FOLLOW YOUR CURIOSITY</p>
                  <h2>A few places to start</h2>
                </div>
                <p>Pick an ecosystem. Explore its community.</p>
              </header>
              <div className="ecosystem-grid">
                {[
                  [
                    '01',
                    'withastro',
                    'Build for the web',
                    'Frameworks, documentation, and the tools behind better websites.',
                    'ASTRO / WEB DEVELOPMENT',
                    '↗',
                  ],
                  [
                    '02',
                    'pallets',
                    'Make Python useful',
                    'Small, focused libraries powering a world of Python applications.',
                    'PALLETS / PYTHON',
                    '⌘',
                  ],
                  [
                    '03',
                    'cli',
                    'Craft developer tools',
                    'Explore the command line and the tools developers use every day.',
                    'GITHUB CLI / TOOLING',
                    '>_',
                  ],
                ].map(([n, org, title, description, tag, icon]) => (
                  <a className="ecosystem-card" key={org} href={`#/${org}`}>
                    <div className="ecosystem-top">
                      <span>{n}</span>
                      <span>{icon}</span>
                    </div>
                    <p className="eyebrow">{tag}</p>
                    <h3>{title}</h3>
                    <p>{description}</p>
                    <span className="text-link">
                      Explore {org} <b>↗</b>
                    </span>
                  </a>
                ))}
              </div>
              <p className="subtle">
                Starting points, not endorsements. Fetch current activity to
                decide what fits you.
              </p>
            </section>
            <section className="reading-guide">
              <p className="eyebrow">LOOK BEYOND THE STAR COUNT</p>
              <div>
                <article>
                  <span>01 / MOMENTUM</span>
                  <h3>Is the project moving?</h3>
                  <p>
                    Look for consistent activity and recent merged pull
                    requests.
                  </p>
                </article>
                <article>
                  <span>02 / OPPORTUNITY</span>
                  <h3>Where can you help?</h3>
                  <p>
                    Start with good first issues and read the contribution
                    guidelines.
                  </p>
                </article>
                <article>
                  <span>03 / COMMUNITY</span>
                  <h3>Who will you learn with?</h3>
                  <p>
                    Explore contributors, then read conversations to understand
                    the culture.
                  </p>
                </article>
              </div>
            </section>
          </>
        ) : route === 'saved' ? (
          <SavedPage />
        ) : (
          <ExplorePage
            key={route + String(!!token)}
            route={route}
            client={client}
            onConnect={() => setSettings(true)}
          />
        )}
      </main>
      <footer>
        <a className="brand" href="#/">
          repo<span>Buzz</span>
        </a>
        <p>Find a community. Start small. Keep showing up.</p>
        <a href="#/demo">How to read the signals ↗</a>
      </footer>
    </div>
  )
}

function SavedPage() {
  const [history, setHistory] = useState(listSearchHistory)
  const queryClient = useQueryClient()
  const seen = new Set<string>()
  const unique = history.filter((entry) => {
    if (seen.has(entry.target)) return false
    seen.add(entry.target)
    return true
  })
  return (
    <section className="page-section">
      <p className="eyebrow">YOUR FIELD NOTES</p>
      <div className="section-heading">
        <h1>Saved explorations</h1>
        <button
          className="ghost"
          disabled={!history.length}
          onClick={() => {
            clearAllPersistedData()
            queryClient.clear()
            setHistory([])
          }}
        >
          Clear saved data
        </button>
      </div>
      <p className="subtle">
        Snapshots live in this browser. Open one without making another GitHub
        request.
      </p>
      {unique.length ? (
        <div className="saved-list">
          {unique.map((entry) => (
            <a key={entry.target} href={`#/${entry.target}`}>
              <span>
                <small>
                  {entry.kind === 'repo' ? 'REPOSITORY' : 'ORGANIZATION'}
                </small>
                <strong>{entry.target}</strong>
              </span>
              <time>{new Date(entry.fetchedAt).toLocaleString()}</time>
              <span>Open exploration ↗</span>
            </a>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <span>⌑</span>
          <h2>Your next discovery belongs here.</h2>
          <p>
            Explore a repository or organization to save your first snapshot.
          </p>
          <a className="button-link" href="#/">
            Explore communities ↗
          </a>
        </div>
      )}
    </section>
  )
}

function ExplorePage({
  route,
  client,
  onConnect,
}: {
  route: string
  client: GitHubApiClient
  onConnect: () => void
}) {
  const target = parseSearchTarget(route)
  const isRepo = target?.type === 'repo'
  const isDemo = route === 'demo'
  const [showForks, setShowForks] = useState(false)
  const [storageWarning, setStorageWarning] = useState('')
  const [saved] = useState(() =>
    isRepo
      ? getLatestRepoVersion(target.value.owner, target.value.repo)
      : getLatestOrgVersion(route),
  )
  const query = useQuery({
    queryKey: ['exploration', route, client.isAuthenticated],
    enabled: !isDemo && !!target && client.isAuthenticated && !saved,
    initialData: saved,
    staleTime: Infinity,
    queryFn: async ({ signal }) => {
      const authenticated = client.isAuthenticated
      let data
      if (isRepo) {
        const bundle = await client.fetchRepositoryBundle(
          target.value.owner,
          target.value.repo,
          { signal },
        )
        const persisted = saveRepoVersion({
          owner: target.value.owner,
          repo: target.value.repo,
          authenticated,
          bundle,
        })
        data = persisted ?? {
          id: '',
          kind: 'repo' as const,
          owner: target.value.owner,
          repo: target.value.repo,
          target: route,
          fetchedAt: bundle.fetchedAt,
          authenticated,
          bundle,
        }
      } else {
        const repos = await client.fetchOrganizationRepositoriesAll(route, {
          signal,
        })
        const persisted = saveOrgVersion({ org: route, authenticated, repos })
        data = persisted ?? {
          id: '',
          kind: 'org' as const,
          org: route,
          target: route,
          fetchedAt: new Date().toISOString(),
          authenticated,
          repos,
        }
      }
      setStorageWarning(
        data.id
          ? ''
          : 'Activity loaded, but this browser could not save it. Free local storage to keep it for later.',
      )
      if (data.id)
        appendSearchHistory({
          kind: data.kind,
          target: data.target,
          snapshotId: data.id,
          fetchedAt: data.fetchedAt,
          searchedAt: data.fetchedAt,
          source: 'network',
        })
      return data
    },
  })
  if (!target && !isDemo)
    return (
      <div className="empty-state">
        <h1>That exploration could not be found.</h1>
        <a href="#/">Return to explore</a>
      </div>
    )
  return (
    <section className="page-section">
      <div className="breadcrumb">
        <a href="#/">Explore</a>
        <span>/</span>
        <span>{isDemo ? 'Sample exploration' : route}</span>
      </div>
      <div className="page-toolbar">
        <span className="eyebrow">
          {isDemo
            ? 'ILLUSTRATIVE DATA · NOT A LIVE REPOSITORY'
            : isRepo
              ? 'REPOSITORY FIELD NOTES'
              : 'ORGANIZATION FIELD NOTES'}
        </span>
        {!isDemo && (
          <button
            className="ghost"
            disabled={query.isFetching}
            onClick={() =>
              client.isAuthenticated ? void query.refetch() : onConnect()
            }
          >
            {query.isFetching ? 'Fetching activity…' : 'Refresh from GitHub ↻'}
          </button>
        )}
      </div>
      {!isDemo && query.data && (
        <p className="freshness">
          {query.data.id ? 'Saved on this device' : 'Not saved'} · Fetched{' '}
          {new Date(query.data.fetchedAt).toLocaleString()} · Refresh when you
          need current activity.
        </p>
      )}
      {storageWarning && <p className="notice">{storageWarning}</p>}
      {query.error && (
        <p className="notice" role="alert">
          {toUserMessage(query.error, { target: route })}
        </p>
      )}
      {!isDemo && !query.data && !client.isAuthenticated && (
        <div className="empty-state">
          <span>↗</span>
          <h1>Get to know {route}.</h1>
          <p>
            Connect GitHub to fetch community activity. A read-only token is
            required for GitHub’s GraphQL API.
          </p>
          <button onClick={onConnect}>Connect GitHub</button>
          <a href="#/demo">Or explore the sample first →</a>
        </div>
      )}
      {query.isFetching && !query.data && (
        <div className="empty-state" role="status">
          <div className="loading-bar" />
          <h2>Listening for the buzz…</h2>
          <p>
            Collecting all issue and PR pages for the past three months. Busy
            projects can take longer. GitHub may take a moment to prepare
            statistics.
          </p>
        </div>
      )}
      {(isRepo || isDemo) && (query.data?.kind === 'repo' || isDemo) && (
        <Suspense fallback={<p role="status">Opening field notes…</p>}>
          <RepositoryPage
            bundle={query.data?.kind === 'repo' ? query.data.bundle : undefined}
          />
        </Suspense>
      )}
      {!isRepo && !isDemo && query.data?.kind === 'org' && (
        <OrgView
          orgName={route}
          repos={
            showForks
              ? query.data.repos
              : query.data.repos.filter((repo) => !repo.isFork)
          }
          loading={false}
          fetching={query.isFetching}
          progress={null}
          showForks={showForks}
          onToggleForks={setShowForks}
          selectedRepo={null}
          onSelectRepo={(repo) => go(repo.nameWithOwner)}
        />
      )}
    </section>
  )
}

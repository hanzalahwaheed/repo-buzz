import { useCallback, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { OrgView } from './components/OrgView'
import { RateLimitIndicator } from './components/RateLimitIndicator'
import { RepoDetailView } from './components/RepoDetailView'
import { SearchBar } from './components/SearchBar'
import { SearchHistory } from './components/SearchHistory'
import { TokenInput } from './components/TokenInput'
import {
  parseSearchTarget,
  useOrgRepositoriesQuery,
  useRepositoryBundleQuery,
  type RepoTarget,
  type SearchTarget,
} from './hooks/useRepoBuzzQueries'
import { clearRepoBundleCache } from './lib/cache'
import { toUserMessage } from './lib/githubError'
import { GitHubApiClient } from './lib/githubApi'
import {
  appendSearchHistory,
  clearAllPersistedData,
  clearHistory,
  getLatestOrgVersion,
  getLatestRepoVersion,
  getOrgVersionById,
  getRepoVersionById,
  listSearchHistory,
  removeHistoryEntry,
  saveOrgVersion,
  saveRepoVersion,
} from './lib/localStore'
import { computeRepoAnalytics } from './lib/metrics'
import type {
  OrganizationRepoSummary,
  RateLimitSnapshot,
  RepositoryBundle,
} from './types/github'
import type {
  PersistedOrgVersion,
  PersistedRepoVersion,
  PersistedSearchHistoryEntry,
  SnapshotKind,
} from './types/storage'

interface RateLimitState {
  rest?: RateLimitSnapshot
  graphql?: RateLimitSnapshot
}

type DataViewMode = 'network' | 'storage'

interface InitialAppState {
  searchInput: string
  activeTarget: SearchTarget | null
  selectedRepo: RepoTarget | null
  storedOrgVersion: PersistedOrgVersion | null
  storedRepoVersion: PersistedRepoVersion | null
  dataViewMode: DataViewMode
  message: string | null
}

function trimTrailingSlash(pathname: string): string {
  if (pathname === '/') {
    return pathname
  }

  return pathname.replace(/\/+$/, '')
}

function isSnapshotPath(pathname: string): boolean {
  return /\/snapshot\/?$/.test(pathname)
}

function getDashboardPath(pathname: string): string {
  const trimmed = trimTrailingSlash(pathname)
  if (isSnapshotPath(trimmed)) {
    const withoutSnapshot = trimmed.replace(/\/snapshot$/, '')
    return withoutSnapshot === '' ? '/' : withoutSnapshot
  }

  return trimmed === '' ? '/' : trimmed
}

function getSnapshotPath(pathname: string): string {
  const dashboardPath = getDashboardPath(pathname)
  return dashboardPath === '/'
    ? '/snapshot'
    : `${dashboardPath}/snapshot`
}

function resolveRepoTarget(
  target: SearchTarget | null,
  selectedRepo: RepoTarget | null,
): RepoTarget | null {
  if (target?.type === 'repo') {
    return target.value
  }

  return selectedRepo
}

function formatLocalDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function defaultInitialState(): InitialAppState {
  return {
    searchInput: '',
    activeTarget: null,
    selectedRepo: null,
    storedOrgVersion: null,
    storedRepoVersion: null,
    dataViewMode: 'network',
    message: null,
  }
}

function getInitialStateFromUrl(isSnapshotRoute: boolean): InitialAppState {
  const initialState = defaultInitialState()

  if (typeof window === 'undefined') {
    return initialState
  }

  if (!isSnapshotRoute) {
    return initialState
  }

  const params = new URLSearchParams(window.location.search)
  const snapshotKind = params.get('snapshotKind')
  const snapshotId = params.get('snapshotId')

  if (!snapshotKind || !snapshotId) {
    return initialState
  }

  if (snapshotKind === 'repo') {
    const repoVersion = getRepoVersionById(snapshotId)
    if (!repoVersion) {
      return {
        ...initialState,
        message: 'Snapshot URL is stale. Saved repo version was not found in local storage.',
      }
    }

    return {
      searchInput: repoVersion.target,
      activeTarget: {
        type: 'repo',
        value: {
          owner: repoVersion.owner,
          repo: repoVersion.repo,
        },
      },
      selectedRepo: {
        owner: repoVersion.owner,
        repo: repoVersion.repo,
      },
      storedOrgVersion: null,
      storedRepoVersion: repoVersion,
      dataViewMode: 'storage',
      message: `Loaded snapshot for ${repoVersion.target} from ${formatLocalDate(repoVersion.fetchedAt)}.`,
    }
  }

  if (snapshotKind === 'org') {
    const orgVersion = getOrgVersionById(snapshotId)
    if (!orgVersion) {
      return {
        ...initialState,
        message: 'Snapshot URL is stale. Saved org version was not found in local storage.',
      }
    }

    return {
      searchInput: orgVersion.org,
      activeTarget: {
        type: 'org',
        value: {
          org: orgVersion.org,
        },
      },
      selectedRepo: null,
      storedOrgVersion: orgVersion,
      storedRepoVersion: null,
      dataViewMode: 'storage',
      message: `Loaded snapshot for ${orgVersion.org} from ${formatLocalDate(orgVersion.fetchedAt)}.`,
    }
  }

  return {
    ...initialState,
    message: 'Snapshot URL is invalid. Open a snapshot again from search history.',
  }
}

function clearSnapshotUrlParams(): void {
  if (typeof window === 'undefined') {
    return
  }

  const url = new URL(window.location.href)
  const currentPath = trimTrailingSlash(url.pathname)
  const dashboardPath = getDashboardPath(currentPath)
  const hadSnapshotParams =
    url.searchParams.has('snapshotKind') || url.searchParams.has('snapshotId')
  const isOnSnapshotPath = isSnapshotPath(currentPath)

  if (!hadSnapshotParams && !isOnSnapshotPath) {
    return
  }

  url.searchParams.delete('snapshotKind')
  url.searchParams.delete('snapshotId')
  if (isOnSnapshotPath) {
    url.pathname = dashboardPath
  }
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
}

function buildSnapshotUrl(entry: PersistedSearchHistoryEntry): string {
  if (typeof window === 'undefined') {
    return ''
  }

  const url = new URL(window.location.href)
  url.pathname = getSnapshotPath(url.pathname)
  url.search = ''
  url.searchParams.set('snapshotKind', entry.kind)
  url.searchParams.set('snapshotId', entry.snapshotId)
  return url.toString()
}

function replaceSnapshotUrlParams(kind: SnapshotKind, snapshotId: string): void {
  if (typeof window === 'undefined') {
    return
  }

  const url = new URL(window.location.href)
  url.pathname = getSnapshotPath(url.pathname)
  url.searchParams.set('snapshotKind', kind)
  url.searchParams.set('snapshotId', snapshotId)
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
}

export default function App() {
  const isSnapshotRoute = useMemo(
    () =>
      typeof window !== 'undefined' && isSnapshotPath(window.location.pathname),
    [],
  )
  const dashboardPath = useMemo(
    () =>
      typeof window !== 'undefined'
        ? getDashboardPath(window.location.pathname)
        : '/',
    [],
  )
  const initialState = useMemo(
    () => getInitialStateFromUrl(isSnapshotRoute),
    [isSnapshotRoute],
  )

  const [token, setToken] = useState('')
  const [searchInput, setSearchInput] = useState(initialState.searchInput)
  const [activeTarget, setActiveTarget] = useState<SearchTarget | null>(
    initialState.activeTarget,
  )
  const [selectedRepo, setSelectedRepo] = useState<RepoTarget | null>(
    initialState.selectedRepo,
  )
  const [showForks, setShowForks] = useState(false)
  const [includeBots, setIncludeBots] = useState(false)
  const [excludeMaintainers, setExcludeMaintainers] = useState(false)
  const [message, setMessage] = useState<string | null>(initialState.message)
  const [rateLimits, setRateLimits] = useState<RateLimitState>({})
  const [history, setHistory] = useState<PersistedSearchHistoryEntry[]>(() =>
    listSearchHistory(),
  )
  const [storedOrgVersion, setStoredOrgVersion] = useState<PersistedOrgVersion | null>(
    initialState.storedOrgVersion,
  )
  const [storedRepoVersion, setStoredRepoVersion] = useState<PersistedRepoVersion | null>(
    initialState.storedRepoVersion,
  )
  const [dataViewMode, setDataViewMode] = useState<DataViewMode>(
    initialState.dataViewMode,
  )
  const [isSnapshotSheetOpen, setIsSnapshotSheetOpen] = useState(false)
  const queryClient = useQueryClient()

  const handleRateLimitUpdate = useCallback((snapshot: RateLimitSnapshot) => {
    setRateLimits((current) => ({
      ...current,
      [snapshot.source]: snapshot,
    }))
  }, [])

  const apiClient = useMemo(
    () =>
      new GitHubApiClient({
        token: token.trim() || undefined,
        onRateLimit: handleRateLimitUpdate,
      }),
    [handleRateLimitUpdate, token],
  )

  const orgName = activeTarget?.type === 'org' ? activeTarget.value.org : null
  const repoTarget = resolveRepoTarget(activeTarget, selectedRepo)

  const handleOrgFetchedFromNetwork = useCallback(
    (repos: OrganizationRepoSummary[]) => {
      if (!orgName) {
        return
      }

      const saved = saveOrgVersion({
        org: orgName,
        authenticated: apiClient.isAuthenticated,
        repos,
      })

      if (!saved) {
        return
      }

      setHistory(
        appendSearchHistory({
          kind: 'org',
          target: saved.target,
          searchedAt: saved.fetchedAt,
          fetchedAt: saved.fetchedAt,
          source: 'network',
          snapshotId: saved.id,
        }),
      )

      if (isSnapshotRoute) {
        setStoredOrgVersion(saved)
        setStoredRepoVersion(null)
        setSelectedRepo(null)
        setDataViewMode('storage')
        setMessage(`Snapshot refreshed for ${saved.org} at ${formatLocalDate(saved.fetchedAt)}.`)
        replaceSnapshotUrlParams('org', saved.id)
      }
    },
    [apiClient.isAuthenticated, isSnapshotRoute, orgName],
  )

  const handleRepoFetchedFromNetwork = useCallback(
    (bundle: RepositoryBundle) => {
      if (!repoTarget) {
        return
      }

      const saved = saveRepoVersion({
        owner: repoTarget.owner,
        repo: repoTarget.repo,
        authenticated: apiClient.isAuthenticated,
        bundle,
      })

      if (!saved) {
        return
      }

      setHistory(
        appendSearchHistory({
          kind: 'repo',
          target: saved.target,
          searchedAt: saved.fetchedAt,
          fetchedAt: saved.fetchedAt,
          source: 'network',
          snapshotId: saved.id,
        }),
      )

      if (isSnapshotRoute) {
        setStoredRepoVersion(saved)
        if (activeTarget?.type === 'repo') {
          setStoredOrgVersion(null)
        }
        setDataViewMode('storage')
        setMessage(`Snapshot refreshed for ${saved.target} at ${formatLocalDate(saved.fetchedAt)}.`)
        replaceSnapshotUrlParams('repo', saved.id)
      }
    },
    [activeTarget, apiClient.isAuthenticated, isSnapshotRoute, repoTarget],
  )

  const orgQuery = useOrgRepositoriesQuery({
    apiClient,
    orgName,
    enabled: Boolean(orgName) && dataViewMode === 'network',
    onFetchedFromNetwork: handleOrgFetchedFromNetwork,
  })

  const repoQuery = useRepositoryBundleQuery({
    apiClient,
    owner: repoTarget?.owner ?? null,
    repo: repoTarget?.repo ?? null,
    enabled: Boolean(repoTarget) && dataViewMode === 'network',
    onFetchedFromNetwork: handleRepoFetchedFromNetwork,
  })

  const usingStoredOrg =
    dataViewMode === 'storage' &&
    storedOrgVersion !== null &&
    orgName === storedOrgVersion.org

  const usingStoredRepo =
    dataViewMode === 'storage' &&
    storedRepoVersion !== null &&
    repoTarget !== null &&
    `${repoTarget.owner}/${repoTarget.repo}` === storedRepoVersion.target

  const activeOrgData = usingStoredOrg ? storedOrgVersion.repos : orgQuery.data
  const activeRepoBundle = usingStoredRepo ? storedRepoVersion.bundle : repoQuery.data

  const analytics = useMemo(
    () =>
      activeRepoBundle
        ? computeRepoAnalytics(activeRepoBundle, {
            includeBots,
            excludeMaintainers,
          })
        : null,
    [activeRepoBundle, excludeMaintainers, includeBots],
  )

  const orgRepos = useMemo(() => {
    const source = activeOrgData ?? []

    const filtered = showForks
      ? source
      : source.filter((repository) => !repository.isFork)

    return filtered.sort((left, right) => {
      const leftScore = new Date(left.pushedAt).getTime()
      const rightScore = new Date(right.pushedAt).getTime()
      return rightScore - leftScore
    })
  }, [activeOrgData, showForks])

  const orgErrorMessage =
    !usingStoredOrg && orgQuery.error
      ? toUserMessage(orgQuery.error, {
          target: orgName ?? undefined,
          token,
        })
      : null

  const repoErrorMessage =
    !usingStoredRepo && repoQuery.error
      ? toUserMessage(repoQuery.error, {
          target: repoTarget ? `${repoTarget.owner}/${repoTarget.repo}` : undefined,
          token,
        })
      : null
  const isNetworkFetching = orgQuery.isFetching || repoQuery.isFetching

  const handleSearchSubmit = (value: string) => {
    const target = parseSearchTarget(value)

    if (!target) {
      setMessage('Enter either an org name or owner/repo.')
      return
    }

    setMessage(null)
    clearSnapshotUrlParams()
    setDataViewMode('network')
    setStoredOrgVersion(null)
    setStoredRepoVersion(null)
    setActiveTarget(target)

    if (target.type === 'repo') {
      setSelectedRepo(target.value)
    } else {
      setSelectedRepo(null)
    }
  }

  const handleLoadSaved = (value: string) => {
    const target = parseSearchTarget(value)

    if (!target) {
      setMessage('Enter either an org name or owner/repo.')
      return
    }

    if (target.type === 'repo') {
      const saved = getLatestRepoVersion(target.value.owner, target.value.repo)
      if (!saved) {
        setMessage(`No saved snapshot found for ${target.value.owner}/${target.value.repo}.`)
        return
      }

      setDataViewMode('storage')
      setStoredRepoVersion(saved)
      setStoredOrgVersion(null)
      setActiveTarget(target)
      setSelectedRepo(target.value)
      setMessage(`Loaded saved snapshot for ${saved.target} from ${formatLocalDate(saved.fetchedAt)}.`)
      setHistory(
        appendSearchHistory({
          kind: 'repo',
          target: saved.target,
          searchedAt: new Date().toISOString(),
          fetchedAt: saved.fetchedAt,
          source: 'storage',
          snapshotId: saved.id,
        }),
      )
      return
    }

    const saved = getLatestOrgVersion(target.value.org)
    if (!saved) {
      setMessage(`No saved snapshot found for ${target.value.org}.`)
      return
    }

    setDataViewMode('storage')
    setStoredOrgVersion(saved)
    setStoredRepoVersion(null)
    setActiveTarget(target)
    setSelectedRepo(null)
    setMessage(`Loaded saved snapshot for ${saved.org} from ${formatLocalDate(saved.fetchedAt)}.`)
    setHistory(
      appendSearchHistory({
        kind: 'org',
        target: saved.target,
        searchedAt: new Date().toISOString(),
        fetchedAt: saved.fetchedAt,
        source: 'storage',
        snapshotId: saved.id,
      }),
    )
  }

  const handleOpenHistory = (entry: PersistedSearchHistoryEntry) => {
    if (typeof window === 'undefined') {
      return
    }

    const snapshotUrl = buildSnapshotUrl(entry)
    const opened = window.open(snapshotUrl, '_blank', 'noopener,noreferrer')
    if (!opened) {
      setMessage('Popup blocked. Allow popups to open snapshots in a new tab.')
    }
  }

  const handleTokenDetected = (detectedToken: string) => {
    setToken(detectedToken)
    setSearchInput('')
    setMessage('Token detected in search input and moved into authentication field.')
  }

  const handleRefreshSnapshot = useCallback(() => {
    if (!isSnapshotRoute) {
      return
    }

    if (!activeTarget) {
      setMessage('Load a snapshot first from history, then refresh it.')
      return
    }

    const targetLabel =
      activeTarget.type === 'repo'
        ? `${activeTarget.value.owner}/${activeTarget.value.repo}`
        : activeTarget.value.org

    setMessage(`Refreshing ${targetLabel} from GitHub...`)
    clearRepoBundleCache()

    if (activeTarget.type === 'repo') {
      queryClient.removeQueries({
        queryKey: ['repository-bundle', activeTarget.value.owner, activeTarget.value.repo],
      })
    } else {
      queryClient.removeQueries({
        queryKey: ['org-repositories', activeTarget.value.org],
      })
      setSelectedRepo(null)
    }

    setStoredOrgVersion(null)
    setStoredRepoVersion(null)
    setDataViewMode('network')
  }, [activeTarget, isSnapshotRoute, queryClient])

  const activeTargetLabel = useMemo(() => {
    if (!activeTarget) {
      return null
    }

    if (activeTarget.type === 'repo') {
      return `${activeTarget.value.owner}/${activeTarget.value.repo}`
    }

    return activeTarget.value.org
  }, [activeTarget])

  const appContent = (
    <>
      {message ? (
        <section className="panel">
          <p className="warning">{message}</p>
        </section>
      ) : null}

      {dataViewMode === 'storage' ? (
        <section className="panel">
          <p className="subtle">
            {isSnapshotRoute
              ? 'Viewing saved local snapshot. Use Snapshot tools to refresh from GitHub.'
              : 'Viewing saved local snapshot. Use "Fetch activity" to refresh from GitHub.'}
          </p>
          {isSnapshotRoute ? (
            <p className="subtle">
              <a href={dashboardPath}>Open dashboard</a> for live fetches and history tools.
            </p>
          ) : null}
        </section>
      ) : null}

      {orgErrorMessage ? (
        <section className="panel">
          <p className="warning">{orgErrorMessage}</p>
        </section>
      ) : null}

      {repoErrorMessage ? (
        <section className="panel">
          <p className="warning">{repoErrorMessage}</p>
        </section>
      ) : null}

      {orgName ? (
        <OrgView
          orgName={orgName}
          repos={orgRepos}
          loading={usingStoredOrg ? false : orgQuery.isLoading}
          fetching={usingStoredOrg ? false : orgQuery.isFetching}
          progress={usingStoredOrg ? null : orgQuery.progress}
          showForks={showForks}
          onToggleForks={setShowForks}
          selectedRepo={repoTarget ? `${repoTarget.owner}/${repoTarget.repo}` : null}
          onSelectRepo={(repository) => {
            if (isSnapshotRoute) {
              const savedRepo = getLatestRepoVersion(repository.owner, repository.name)
              if (!savedRepo) {
                setMessage(
                  `No saved repo snapshot for ${repository.owner}/${repository.name}. Open dashboard to fetch it.`,
                )
                return
              }

              setDataViewMode('storage')
              setStoredRepoVersion(savedRepo)
              setSelectedRepo({
                owner: repository.owner,
                repo: repository.name,
              })
              setIncludeBots(false)
              setExcludeMaintainers(false)
              return
            }

            setDataViewMode('network')
            setStoredRepoVersion(null)
            setSelectedRepo({
              owner: repository.owner,
              repo: repository.name,
            })
            setIncludeBots(false)
            setExcludeMaintainers(false)
          }}
        />
      ) : null}

      {repoTarget ? (
        <RepoDetailView
          repoFullName={`${repoTarget.owner}/${repoTarget.repo}`}
          analytics={analytics}
          loading={usingStoredRepo ? false : repoQuery.isLoading}
          fetching={usingStoredRepo ? false : repoQuery.isFetching}
          error={usingStoredRepo ? null : repoErrorMessage}
          includeBots={includeBots}
          onIncludeBotsChange={setIncludeBots}
          excludeMaintainers={excludeMaintainers}
          onExcludeMaintainersChange={setExcludeMaintainers}
          onBackToOrg={
            activeTarget?.type === 'org'
              ? () => {
                  setSelectedRepo(null)
                }
              : undefined
          }
          fetchedAt={activeRepoBundle?.fetchedAt}
        />
      ) : null}

      {!activeTarget ? (
        <section className="panel intro">
          {isSnapshotRoute ? (
            <>
              <h2>Snapshot URL required</h2>
              <p>
                Open this route via <code>Open in new tab</code> from search history.
              </p>
              <p>
                <a href={dashboardPath}>Return to dashboard</a> to fetch data and manage history.
              </p>
            </>
          ) : (
            <>
              <h2>Start with a GitHub org or repo</h2>
              <p>
                Try <code>tensorflow</code> for org mode or <code>facebook/react</code> for a repo deep dive.
              </p>
              <p>
                Deep metrics include issue/PR flow, commit velocity, contributor concentration, and a transparent 0-100 health score.
              </p>
            </>
          )}
        </section>
      ) : null}
    </>
  )

  return (
    <main className="app-shell">
      <header className="hero">
        <p className="eyebrow">GitHub OSS Activity Tracker</p>
        <h1>repoBuzz</h1>
        {isSnapshotRoute ? (
          <p>Snapshot route for saved local versions.</p>
        ) : (
          <p>
            Track org-level momentum and drill into repo health with hybrid REST + GraphQL metrics.
          </p>
        )}
      </header>

      {isSnapshotRoute ? (
        <section className="snapshot-utility-bar">
          <button type="button" className="ghost" onClick={() => setIsSnapshotSheetOpen(true)}>
            Snapshot tools
          </button>
        </section>
      ) : null}

      {!isSnapshotRoute ? (
        <>
          <section className="control-grid">
            <TokenInput
              token={token}
              onTokenChange={setToken}
              onClearToken={() => setToken('')}
            />

            <SearchBar
              value={searchInput}
              onChange={setSearchInput}
              onSubmit={handleSearchSubmit}
              onLoadSaved={handleLoadSaved}
              onTokenDetected={handleTokenDetected}
              loading={isNetworkFetching}
            />

            <RateLimitIndicator
              restRateLimit={rateLimits.rest}
              graphRateLimit={rateLimits.graphql}
              isAuthenticated={apiClient.isAuthenticated}
            />
          </section>

          <SearchHistory
            history={history}
            onOpen={handleOpenHistory}
            onRemove={(entryId) => setHistory(removeHistoryEntry(entryId))}
            onClear={() => setHistory(clearHistory())}
            onClearAllPersistedData={() => {
              clearAllPersistedData()
              setHistory([])
              setStoredOrgVersion(null)
              setStoredRepoVersion(null)
              setDataViewMode('network')
              setMessage('Cleared all saved snapshots and history.')
            }}
          />
        </>
      ) : null}
      {appContent}

      {isSnapshotRoute && isSnapshotSheetOpen ? (
        <div
          className="snapshot-sheet-backdrop"
          onClick={() => setIsSnapshotSheetOpen(false)}
          role="presentation"
        >
          <aside
            className="snapshot-sheet"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Snapshot tools"
          >
            <header className="snapshot-sheet-head">
              <h2>Snapshot tools</h2>
              <button type="button" className="ghost" onClick={() => setIsSnapshotSheetOpen(false)}>
                Close
              </button>
            </header>

            <TokenInput
              token={token}
              onTokenChange={setToken}
              onClearToken={() => setToken('')}
            />

            <section className="panel">
              <p className="subtle snapshot-target">
                {activeTargetLabel ? `Current target: ${activeTargetLabel}` : 'No target loaded.'}
              </p>
              <div className="snapshot-refresh-actions">
                <button
                  type="button"
                  onClick={handleRefreshSnapshot}
                  disabled={!activeTarget || isNetworkFetching}
                >
                  {isNetworkFetching ? 'Refreshing...' : 'Refresh from GitHub'}
                </button>
              </div>
              <p className="subtle">
                Refreshing saves a new timestamped snapshot and updates this URL.
              </p>
            </section>
          </aside>
        </div>
      ) : null}
    </main>
  )
}

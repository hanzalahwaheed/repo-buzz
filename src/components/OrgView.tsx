import { useState } from 'react'
import { RepoCard } from './RepoCard'
import type { OrgFetchProgress, OrganizationRepoSummary } from '../types/github'

interface OrgViewProps {
  orgName: string
  repos: OrganizationRepoSummary[]
  loading: boolean
  fetching: boolean
  progress: OrgFetchProgress | null
  showForks: boolean
  onToggleForks: (show: boolean) => void
  selectedRepo: string | null
  onSelectRepo: (repo: OrganizationRepoSummary) => void
}

function RepoCardSkeleton() {
  return (
    <article className="repo-card skeleton-card" aria-hidden>
      <div className="skeleton-line wide" />
      <div className="skeleton-line" />
      <div className="skeleton-line" />
      <div className="skeleton-grid">
        <span className="skeleton-box" />
        <span className="skeleton-box" />
        <span className="skeleton-box" />
        <span className="skeleton-box" />
      </div>
      <div className="skeleton-line short" />
    </article>
  )
}

export function OrgView({
  orgName,
  repos,
  loading,
  fetching,
  progress,
  showForks,
  onToggleForks,
  selectedRepo,
  onSelectRepo,
}: OrgViewProps) {
  const [filter, setFilter] = useState('')
  const [language, setLanguage] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const languages = [
    ...new Set(
      repos.flatMap((repo) =>
        repo.primaryLanguage ? [repo.primaryLanguage] : [],
      ),
    ),
  ].sort()
  const sortedRepos = repos
    .filter(
      (repo) =>
        (showArchived || !repo.isArchived) &&
        (!language || repo.primaryLanguage === language) &&
        `${repo.nameWithOwner} ${repo.description ?? ''}`
          .toLowerCase()
          .includes(filter.toLowerCase()),
    )
    .sort(
      (left, right) =>
        new Date(right.pushedAt).getTime() - new Date(left.pushedAt).getTime(),
    )

  return (
    <section className="panel">
      <header className="panel-header stacked">
        <h2>{orgName} repositories</h2>
        <label className="switch-row">
          <input
            type="checkbox"
            checked={showForks}
            onChange={(event) => onToggleForks(event.target.checked)}
          />
          Show forks
        </label>
      </header>

      <div className="org-filters">
        <label>
          Find a project
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter repositories…"
          />
        </label>
        <label>
          Language
          <select
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
          >
            <option value="">All languages</option>
            {languages.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="switch-row">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => setShowArchived(event.target.checked)}
          />{' '}
          Include archived
        </label>
      </div>
      <p className="subtle">
        {sortedRepos.length} repositories · Sorted by latest push · Push
        activity does not measure response time.
      </p>

      {progress?.total && progress.total > 100 ? (
        <p className="subtle">
          Loading {progress.fetched.toLocaleString()} /{' '}
          {progress.total.toLocaleString()} repositories...
        </p>
      ) : null}

      {loading ? (
        <div className="repo-grid">
          {Array.from({ length: 6 }).map((_, index) => (
            <RepoCardSkeleton key={index} />
          ))}
        </div>
      ) : null}

      {!loading && sortedRepos.length === 0 ? (
        <p className="subtle">
          No repositories match these filters. Try another name, language, or
          include archived projects.
        </p>
      ) : null}

      {!loading && sortedRepos.length > 0 ? (
        <>
          {fetching ? <p className="subtle">Refreshing list...</p> : null}
          <div className="repo-grid">
            {sortedRepos.map((repo) => (
              <RepoCard
                key={repo.id}
                repo={repo}
                selected={selectedRepo === repo.nameWithOwner}
                onSelect={onSelectRepo}
              />
            ))}
          </div>
        </>
      ) : null}
    </section>
  )
}

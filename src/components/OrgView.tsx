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
  const sortedRepos = [...repos].sort(
    (left, right) => new Date(right.pushedAt).getTime() - new Date(left.pushedAt).getTime(),
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

      {progress?.total && progress.total > 100 ? (
        <p className="subtle">
          Loading {progress.fetched.toLocaleString()} / {progress.total.toLocaleString()} repositories...
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
          No repositories found{showForks ? '.' : ' after filtering forks.'}
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

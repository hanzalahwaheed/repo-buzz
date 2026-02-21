import type { OrganizationRepoSummary } from '../types/github'

interface RepoCardProps {
  repo: OrganizationRepoSummary
  selected: boolean
  onSelect: (repo: OrganizationRepoSummary) => void
}

function daysSince(date: string): number {
  const timestamp = new Date(date).getTime()
  if (!Number.isFinite(timestamp)) {
    return 999
  }

  return Math.max(0, Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24)))
}

function activityLabel(days: number): string {
  if (days <= 2) {
    return 'Active this week'
  }
  if (days <= 7) {
    return 'Active this month'
  }
  if (days <= 30) {
    return 'Cooling down'
  }

  return 'Mostly quiet'
}

export function RepoCard({ repo, selected, onSelect }: RepoCardProps) {
  const days = daysSince(repo.pushedAt)

  return (
    <article className={`repo-card ${selected ? 'selected' : ''}`}>
      <div className="repo-card-head">
        <h3>{repo.nameWithOwner}</h3>
        <span className="pill">{activityLabel(days)}</span>
      </div>

      <p className="repo-description">
        {repo.description ?? 'No description provided.'}
      </p>

      <div className="badge-row">
        {repo.isFork ? <span className="tag">Fork</span> : null}
        {repo.isArchived ? <span className="tag">Archived</span> : null}
        {repo.primaryLanguage ? <span className="tag">{repo.primaryLanguage}</span> : null}
      </div>

      <dl className="stat-grid">
        <div>
          <dt>Stars</dt>
          <dd>{repo.stargazerCount.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Forks</dt>
          <dd>{repo.forkCount.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Open issues</dt>
          <dd>{repo.openIssueCount.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Open PRs</dt>
          <dd>{repo.openPullRequestCount.toLocaleString()}</dd>
        </div>
      </dl>

      <button type="button" onClick={() => onSelect(repo)}>
        Deep dive
      </button>
    </article>
  )
}

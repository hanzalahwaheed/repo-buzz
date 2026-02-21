import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { MetricCard } from './MetricCard'
import type { RepoAnalytics } from '../types/github'

interface RepoDetailViewProps {
  repoFullName: string
  analytics: RepoAnalytics | null
  loading: boolean
  fetching: boolean
  error: string | null
  includeBots: boolean
  onIncludeBotsChange: (include: boolean) => void
  onBackToOrg?: () => void
  fetchedAt?: string
}

function formatPercent(value: number | null): string {
  if (value === null) {
    return 'N/A'
  }

  return `${(value * 100).toFixed(1)}%`
}

function formatDays(value: number | null): string {
  if (value === null) {
    return 'N/A'
  }

  return `${value.toFixed(1)}d`
}

function formatFixed(value: number | null): string {
  if (value === null) {
    return 'N/A'
  }

  return value.toFixed(2)
}

function HealthTone({ score }: { score: number | null }) {
  if (score === null) {
    return <span className="pill muted">Insufficient data</span>
  }

  if (score >= 70) {
    return <span className="pill good">Healthy</span>
  }

  if (score >= 45) {
    return <span className="pill warn">Moderate</span>
  }

  return <span className="pill bad">At risk</span>
}

function DetailSkeleton() {
  return (
    <section className="panel">
      <div className="skeleton-line wide" />
      <div className="skeleton-line" />
      <div className="metric-grid">
        {Array.from({ length: 8 }).map((_, index) => (
          <article className="metric-card skeleton-card" key={index}>
            <div className="skeleton-line" />
            <div className="skeleton-line short" />
          </article>
        ))}
      </div>
    </section>
  )
}

export function RepoDetailView({
  repoFullName,
  analytics,
  loading,
  fetching,
  error,
  includeBots,
  onIncludeBotsChange,
  onBackToOrg,
  fetchedAt,
}: RepoDetailViewProps) {
  if (loading) {
    return <DetailSkeleton />
  }

  if (error) {
    return (
      <section className="panel">
        <header className="panel-header">
          <h2>{repoFullName}</h2>
        </header>
        <p className="warning">{error}</p>
      </section>
    )
  }

  if (!analytics) {
    return (
      <section className="panel">
        <p className="subtle">Select a repository to view detailed metrics.</p>
      </section>
    )
  }

  return (
    <section className="panel">
      <header className="panel-header stacked">
        <div>
          <h2>{analytics.metadata.nameWithOwner}</h2>
          <p className="subtle">{analytics.metadata.description ?? 'No description available.'}</p>
        </div>
        <div className="header-actions">
          {onBackToOrg ? (
            <button type="button" className="ghost" onClick={onBackToOrg}>
              Back to org list
            </button>
          ) : null}
          <a href={analytics.metadata.url} target="_blank" rel="noreferrer">
            Open on GitHub
          </a>
        </div>
      </header>

      <div className="badge-row">
        <HealthTone score={analytics.healthScore.score} />
        {analytics.metadata.isFork ? <span className="tag">Fork</span> : null}
        {analytics.metadata.isArchived ? <span className="tag">Archived</span> : null}
        {analytics.metadata.primaryLanguage ? (
          <span className="tag">{analytics.metadata.primaryLanguage}</span>
        ) : null}
        {analytics.metadata.license ? <span className="tag">{analytics.metadata.license}</span> : null}
      </div>

      <div className="switch-row">
        <label>
          <input
            type="checkbox"
            checked={includeBots}
            onChange={(event) => onIncludeBotsChange(event.target.checked)}
          />
          Include bot accounts
        </label>
      </div>

      {fetching ? <p className="subtle">Refreshing repository data...</p> : null}
      {fetchedAt ? (
        <p className="subtle">Last fetched: {new Date(fetchedAt).toLocaleString()}</p>
      ) : null}

      {analytics.warnings.map((warning) => (
        <p className="warning" key={warning}>
          {warning}
        </p>
      ))}

      <div className="metric-grid">
        <MetricCard
          title="Health score"
          value={analytics.healthScore.score === null ? 'N/A' : `${analytics.healthScore.score}/100`}
          hint="Weighted composite metric"
        />
        <MetricCard
          title="PR merge rate"
          value={formatPercent(analytics.prMetrics.mergeRate)}
          hint="Merged / (merged + closed unmerged)"
        />
        <MetricCard
          title="Issue close rate"
          value={formatPercent(analytics.issueMetrics.closeRate)}
          hint="Closed / total issues"
        />
        <MetricCard
          title="Median time to merge"
          value={formatDays(analytics.prMetrics.medianTimeToMergeDays)}
        />
        <MetricCard
          title="Median time to close"
          value={formatDays(analytics.issueMetrics.medianTimeToCloseDays)}
        />
        <MetricCard
          title="Reviews per PR"
          value={formatFixed(analytics.prMetrics.averageReviewsPerPr)}
        />
        <MetricCard
          title="Contributors (30d)"
          value={analytics.contributorMetrics.uniqueContributors30d.toLocaleString()}
          hint={`7d: ${analytics.contributorMetrics.uniqueContributors7d} / 90d: ${analytics.contributorMetrics.uniqueContributors90d}`}
        />
        <MetricCard
          title="Community ratio"
          value={formatPercent(analytics.contributorMetrics.communityCommitRatio)}
          hint="(All - owner) / all commits"
        />
        <MetricCard
          title="Good first + help wanted"
          value={`${analytics.issueMetrics.goodFirstIssueCount + analytics.issueMetrics.helpWantedCount}`}
          hint={`Good first: ${analytics.issueMetrics.goodFirstIssueCount}, Help wanted: ${analytics.issueMetrics.helpWantedCount}`}
        />
        <MetricCard
          title="Stale issues"
          value={analytics.issueMetrics.staleCount.toLocaleString()}
          hint="Open > 90 days with no updates"
        />
      </div>

      <div className="chart-grid">
        <article className="chart-card">
          <h3>Issues opened vs closed (12 weeks)</h3>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={analytics.issueMetrics.weeklyTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
              <XAxis dataKey="weekStart" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Area type="monotone" dataKey="opened" stroke="#4ecdc4" fill="#4ecdc444" />
              <Area type="monotone" dataKey="closed" stroke="#ff6b6b" fill="#ff6b6b33" />
            </AreaChart>
          </ResponsiveContainer>
        </article>

        <article className="chart-card">
          <h3>PR flow (12 weeks)</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={analytics.prMetrics.weeklyTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
              <XAxis dataKey="weekStart" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="opened" stroke="#ffd166" dot={false} />
              <Line type="monotone" dataKey="merged" stroke="#06d6a0" dot={false} />
              <Line type="monotone" dataKey="rejected" stroke="#ef476f" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </article>

        <article className="chart-card">
          <h3>New contributors by month</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={analytics.contributorMetrics.newContributorsMonthly}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
              <XAxis dataKey="month" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="newContributors" fill="#9b5de5" />
            </BarChart>
          </ResponsiveContainer>
        </article>

        <article className="chart-card">
          <h3>Weekly commit activity</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={analytics.commitMetrics.weeklyTrend.slice(-26)}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
              <XAxis dataKey="weekStart" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Line type="monotone" dataKey="commits" stroke="#00bbf9" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </article>

        <article className="chart-card">
          <h3>Code churn</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={analytics.codeMetrics.weeklyChurn.slice(-26)}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
              <XAxis dataKey="weekStart" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Bar dataKey="additions" fill="#80ed99" />
              <Bar dataKey="deletions" fill="#ff8fab" />
            </BarChart>
          </ResponsiveContainer>
        </article>

        <article className="chart-card">
          <h3>Health score formula</h3>
          <ul className="breakdown-list">
            {analytics.healthScore.components.map((component) => (
              <li key={component.key}>
                <strong>{component.label}</strong>: {component.value === null ? 'N/A' : component.value.toFixed(2)}
                {' '}| weight {component.weight}%
                {component.insufficientData ? (
                  <span className="subtle"> (insufficient data{component.reason ? `: ${component.reason}` : ''})</span>
                ) : null}
              </li>
            ))}
          </ul>
        </article>
      </div>
    </section>
  )
}

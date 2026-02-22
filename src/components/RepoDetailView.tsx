import { useMemo, useState } from 'react'
import {
  Area,
  Bar,
  Brush,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
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

type ChartWindow = 12 | 26 | 52

const CHART_WINDOW_OPTIONS: Array<{ value: ChartWindow; label: string }> = [
  { value: 12, label: '12w' },
  { value: 26, label: '26w' },
  { value: 52, label: '52w' },
]

const CONTRIBUTOR_MONTH_WINDOW: Record<ChartWindow, number> = {
  12: 4,
  26: 7,
  52: 13,
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

function formatWeekTick(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

function formatMonthTick(value: string): string {
  const date = new Date(`${value}-01T00:00:00Z`)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleDateString(undefined, {
    month: 'short',
    year: '2-digit',
  })
}

function rollingAverage(values: number[], index: number, window: number): number | null {
  const start = Math.max(0, index - window + 1)
  const sample = values.slice(start, index + 1)
  if (sample.length === 0) {
    return null
  }

  const total = sample.reduce((acc, value) => acc + value, 0)
  return total / sample.length
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
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
  const [chartWindow, setChartWindow] = useState<ChartWindow>(26)

  const issueTrend = analytics?.issueMetrics.weeklyTrend
  const prTrend = analytics?.prMetrics.weeklyTrend
  const contributorMonthlyTrend =
    analytics?.contributorMetrics.newContributorsMonthly
  const commitTrend = analytics?.commitMetrics.weeklyTrend
  const codeChurnTrend = analytics?.codeMetrics.weeklyChurn

  const issuesChartData = useMemo(() => {
    const base = (issueTrend ?? []).slice(-chartWindow)
    const openedSeries = base.map((entry) => entry.opened)
    const closedSeries = base.map((entry) => entry.closed)

    return base.map((entry, index) => ({
      ...entry,
      netBacklogDelta: entry.opened - entry.closed,
      openedAvg4: rollingAverage(openedSeries, index, 4),
      closedAvg4: rollingAverage(closedSeries, index, 4),
    }))
  }, [issueTrend, chartWindow])

  const prChartData = useMemo(() => {
    const base = (prTrend ?? []).slice(-chartWindow)
    const mergeSeries = base.map((entry) => entry.merged)

    return base.map((entry, index) => ({
      ...entry,
      mergeRatePct: entry.opened > 0 ? (entry.merged / entry.opened) * 100 : null,
      mergedAvg4: rollingAverage(mergeSeries, index, 4),
    }))
  }, [prTrend, chartWindow])

  const contributorChartData = useMemo(() => {
    const monthWindow = CONTRIBUTOR_MONTH_WINDOW[chartWindow]
    const base = (contributorMonthlyTrend ?? []).slice(-monthWindow)
    const contributorSeries = base.map((entry) => entry.newContributors)

    return base.map((entry, index) => ({
      ...entry,
      newContributorsAvg3: rollingAverage(contributorSeries, index, 3),
    }))
  }, [contributorMonthlyTrend, chartWindow])

  const commitChartData = useMemo(() => {
    const base = (commitTrend ?? []).slice(-chartWindow)
    const commitSeries = base.map((entry) => entry.commits)
    const cumulativeSeries = base.map((_, index) =>
      base
        .slice(0, index + 1)
        .reduce((total, item) => total + item.commits, 0),
    )

    return base.map((entry, index) => ({
      ...entry,
      commitsAvg4: rollingAverage(commitSeries, index, 4),
      cumulativeCommits: cumulativeSeries[index],
    }))
  }, [commitTrend, chartWindow])

  const codeChurnChartData = useMemo(() => {
    return (codeChurnTrend ?? []).slice(-chartWindow).map((entry) => ({
      ...entry,
      netChurn: entry.additions - entry.deletions,
      totalChange: entry.additions + entry.deletions,
    }))
  }, [codeChurnTrend, chartWindow])

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

      <div className="chart-toolbar">
        <p className="chart-subtle">Detailed view window (UTC):</p>
        <div className="window-control" role="group" aria-label="Chart time window">
          {CHART_WINDOW_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`window-button ${chartWindow === option.value ? 'active' : ''}`}
              onClick={() => setChartWindow(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="chart-grid">
        <article className="chart-card">
          <h3>Issues opened vs closed</h3>
          <p className="chart-subtle">Opened/closed areas + net backlog delta and 4-week averages.</p>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={issuesChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
              <XAxis dataKey="weekStart" tickFormatter={formatWeekTick} minTickGap={18} />
              <YAxis yAxisId="count" allowDecimals={false} />
              <YAxis yAxisId="delta" orientation="right" allowDecimals={false} />
              <Tooltip
                labelFormatter={(label) => `Week of ${formatWeekTick(String(label))}`}
                formatter={(value: unknown, name?: string) => {
                  const metric = name ?? 'value'
                  const labels: Record<string, string> = {
                    opened: 'Opened',
                    closed: 'Closed',
                    netBacklogDelta: 'Net backlog delta',
                    openedAvg4: 'Opened avg (4w)',
                    closedAvg4: 'Closed avg (4w)',
                  }

                  const numeric = asNumber(value)
                  if (numeric === null) {
                    return ['N/A', labels[metric] ?? metric]
                  }

                  return [numeric.toFixed(metric.includes('Avg') ? 2 : 0), labels[metric] ?? metric]
                }}
              />
              <Legend />
              <ReferenceLine yAxisId="delta" y={0} stroke="rgba(255,255,255,0.32)" />
              <Area
                yAxisId="count"
                type="monotone"
                dataKey="opened"
                stroke="#4ecdc4"
                fill="#4ecdc444"
              />
              <Area
                yAxisId="count"
                type="monotone"
                dataKey="closed"
                stroke="#ff6b6b"
                fill="#ff6b6b33"
              />
              <Line yAxisId="delta" type="monotone" dataKey="netBacklogDelta" stroke="#ffd166" dot={false} strokeWidth={2} />
              <Line yAxisId="count" type="monotone" dataKey="openedAvg4" stroke="#86efe7" dot={false} strokeDasharray="6 3" />
              <Line yAxisId="count" type="monotone" dataKey="closedAvg4" stroke="#ff9d9d" dot={false} strokeDasharray="6 3" />
            </ComposedChart>
          </ResponsiveContainer>
        </article>

        <article className="chart-card">
          <h3>PR flow and quality</h3>
          <p className="chart-subtle">Opened/merged/rejected bars + weekly merge-rate overlay.</p>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={prChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
              <XAxis dataKey="weekStart" tickFormatter={formatWeekTick} minTickGap={18} />
              <YAxis yAxisId="count" allowDecimals={false} />
              <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} tickFormatter={(value) => `${value}%`} />
              <Tooltip
                labelFormatter={(label) => `Week of ${formatWeekTick(String(label))}`}
                formatter={(value: unknown, name?: string) => {
                  const metric = name ?? 'value'
                  const labels: Record<string, string> = {
                    opened: 'Opened',
                    merged: 'Merged',
                    rejected: 'Rejected',
                    mergeRatePct: 'Merge rate',
                    mergedAvg4: 'Merged avg (4w)',
                  }

                  const numeric = asNumber(value)
                  if (numeric === null) {
                    return ['N/A', labels[metric] ?? metric]
                  }

                  if (metric === 'mergeRatePct') {
                    return [`${numeric.toFixed(1)}%`, labels[metric] ?? metric]
                  }

                  return [numeric.toFixed(metric.includes('Avg') ? 2 : 0), labels[metric] ?? metric]
                }}
              />
              <Legend />
              <Bar yAxisId="count" dataKey="opened" fill="#ffd166" />
              <Bar yAxisId="count" dataKey="merged" fill="#06d6a0" />
              <Bar yAxisId="count" dataKey="rejected" fill="#ef476f" />
              <Line yAxisId="pct" type="monotone" dataKey="mergeRatePct" stroke="#8ecae6" dot={false} strokeWidth={2} />
              <Line yAxisId="count" type="monotone" dataKey="mergedAvg4" stroke="#9cf4db" dot={false} strokeDasharray="6 3" />
            </ComposedChart>
          </ResponsiveContainer>
        </article>

        <article className="chart-card">
          <h3>New contributors by month</h3>
          <p className="chart-subtle">Monthly new contributors with 3-month rolling average.</p>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={contributorChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
              <XAxis dataKey="month" tickFormatter={formatMonthTick} />
              <YAxis allowDecimals={false} />
              <Tooltip
                labelFormatter={(label) => `Month ${formatMonthTick(String(label))}`}
                formatter={(value: unknown, name?: string) => {
                  const metric = name ?? 'value'
                  const labels: Record<string, string> = {
                    newContributors: 'New contributors',
                    newContributorsAvg3: 'Rolling avg (3m)',
                  }

                  const numeric = asNumber(value)
                  if (numeric === null) {
                    return ['N/A', labels[metric] ?? metric]
                  }

                  return [numeric.toFixed(metric.includes('Avg') ? 2 : 0), labels[metric] ?? metric]
                }}
              />
              <Legend />
              <Bar dataKey="newContributors" fill="#9b5de5" />
              <Line type="monotone" dataKey="newContributorsAvg3" stroke="#d7b7ff" dot={false} strokeWidth={2} />
            </ComposedChart>
          </ResponsiveContainer>
        </article>

        <article className="chart-card">
          <h3>Weekly commit activity</h3>
          <p className="chart-subtle">Commits, 4-week moving average, and cumulative total.</p>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={commitChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
              <XAxis dataKey="weekStart" tickFormatter={formatWeekTick} minTickGap={18} />
              <YAxis yAxisId="count" allowDecimals={false} />
              <YAxis yAxisId="cumulative" orientation="right" allowDecimals={false} />
              <Tooltip
                labelFormatter={(label) => `Week of ${formatWeekTick(String(label))}`}
                formatter={(value: unknown, name?: string) => {
                  const metric = name ?? 'value'
                  const labels: Record<string, string> = {
                    commits: 'Commits',
                    commitsAvg4: 'Commits avg (4w)',
                    cumulativeCommits: 'Cumulative commits',
                  }

                  const numeric = asNumber(value)
                  if (numeric === null) {
                    return ['N/A', labels[metric] ?? metric]
                  }

                  return [numeric.toFixed(metric.includes('Avg') ? 2 : 0), labels[metric] ?? metric]
                }}
              />
              <Legend />
              <Bar yAxisId="count" dataKey="commits" fill="#00bbf9" />
              <Line yAxisId="count" type="monotone" dataKey="commitsAvg4" stroke="#90e1ff" dot={false} strokeWidth={2} />
              <Line yAxisId="cumulative" type="monotone" dataKey="cumulativeCommits" stroke="#ffd166" dot={false} strokeDasharray="5 3" />
              {commitChartData.length > 14 ? (
                <Brush dataKey="weekStart" height={18} stroke="#6f8ac6" travellerWidth={10} />
              ) : null}
            </ComposedChart>
          </ResponsiveContainer>
        </article>

        <article className="chart-card">
          <h3>Code churn</h3>
          <p className="chart-subtle">Additions/deletions bars with net and total-change overlays.</p>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={codeChurnChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
              <XAxis dataKey="weekStart" tickFormatter={formatWeekTick} minTickGap={18} />
              <YAxis yAxisId="delta" allowDecimals={false} />
              <YAxis yAxisId="total" orientation="right" allowDecimals={false} />
              <Tooltip
                labelFormatter={(label) => `Week of ${formatWeekTick(String(label))}`}
                formatter={(value: unknown, name?: string) => {
                  const metric = name ?? 'value'
                  const labels: Record<string, string> = {
                    additions: 'Additions',
                    deletions: 'Deletions',
                    netChurn: 'Net churn',
                    totalChange: 'Total change',
                  }

                  const numeric = asNumber(value)
                  if (numeric === null) {
                    return ['N/A', labels[metric] ?? metric]
                  }

                  return [numeric.toLocaleString(), labels[metric] ?? metric]
                }}
              />
              <Legend />
              <ReferenceLine yAxisId="delta" y={0} stroke="rgba(255,255,255,0.32)" />
              <Bar yAxisId="delta" dataKey="additions" fill="#80ed99" />
              <Bar yAxisId="delta" dataKey="deletions" fill="#ff8fab" />
              <Line yAxisId="delta" type="monotone" dataKey="netChurn" stroke="#f8f272" dot={false} strokeWidth={2} />
              <Line yAxisId="total" type="monotone" dataKey="totalChange" stroke="#d6e6ff" dot={false} strokeDasharray="5 3" />
              {codeChurnChartData.length > 14 ? (
                <Brush dataKey="weekStart" height={18} stroke="#6f8ac6" travellerWidth={10} />
              ) : null}
            </ComposedChart>
          </ResponsiveContainer>
        </article>

        <article className="chart-card">
          <h3>Top contributors (last 3 weeks)</h3>
          <p className="chart-subtle">Ranked by issues opened + PRs opened + PRs merged in the last 21 days.</p>
          {analytics.contributorMetrics.topContributorsLast3Weeks.length === 0 ? (
            <p className="subtle">No recent contributor or issue-opening activity found.</p>
          ) : (
            <div className="contrib-table-wrap">
              <table className="contrib-table">
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Contributor</th>
                    <th scope="col">Issues Opened (3w)</th>
                    <th scope="col">PRs Opened (3w)</th>
                    <th scope="col">PRs Merged (3w)</th>
                    <th scope="col">Combined</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.contributorMetrics.topContributorsLast3Weeks.map(
                    (entry, index) => (
                      <tr key={entry.login}>
                        <td>{index + 1}</td>
                        <td>
                          <a href={entry.activityUrl} target="_blank" rel="noreferrer">
                            {entry.login}
                          </a>
                        </td>
                        <td>
                          {entry.issuesOpenedLast3Weeks > 0 ? (
                            <a href={entry.issuesUrl} target="_blank" rel="noreferrer">
                              {entry.issuesOpenedLast3Weeks}
                            </a>
                          ) : (
                            0
                          )}
                        </td>
                        <td>
                          {entry.prsOpenedLast3Weeks > 0 ? (
                            <a href={entry.prsOpenedUrl} target="_blank" rel="noreferrer">
                              {entry.prsOpenedLast3Weeks}
                            </a>
                          ) : (
                            0
                          )}
                        </td>
                        <td>
                          {entry.prsMergedLast3Weeks > 0 ? (
                            <a href={entry.prsMergedUrl} target="_blank" rel="noreferrer">
                              {entry.prsMergedLast3Weeks}
                            </a>
                          ) : (
                            0
                          )}
                        </td>
                        <td>{entry.combinedActivity}</td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          )}
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

import { useMemo, useState } from 'react'
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { computeRepoAnalytics } from '../lib/metrics'
import { createDemoBundle } from '../lib/demo'
import type { RepositoryBundle } from '../types/github'

const COLORS = ['#26705b', '#b69a63', '#8995ab']
const percent = (value: number | null) =>
  value === null ? 'Unavailable' : `${Math.round(value * 100)}%`
const tick = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
function ActivityChart({
  title,
  note,
  data,
  series,
  area = false,
}: {
  title: string
  note: string
  data: Array<Record<string, string | number>>
  series: Array<[string, string]>
  area?: boolean
}) {
  const [table, setTable] = useState(false)
  return (
    <article className="chart-card">
      <div className="chart-heading">
        <h3>{title}</h3>
        <button
          className="ghost"
          onClick={() => setTable((v) => !v)}
          aria-pressed={table}
        >
          {table ? 'Show chart' : 'View data'}
        </button>
      </div>
      <p className="chart-subtle">{note}</p>
      {!data.length ? (
        <div className="chart-empty">
          No statistics available for this period.
        </div>
      ) : table ? (
        <div className="contrib-table-wrap">
          <table className="contrib-table">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                <th scope="col">Week of (UTC)</th>
                {series.map(([key, name]) => (
                  <th scope="col" key={key}>
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.weekStart}>
                  <td>{row.weekStart}</td>
                  {series.map(([key]) => (
                    <td key={key}>{row[key]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={270}>
          <ComposedChart
            data={data}
            margin={{ top: 24, right: 12, left: -24, bottom: 0 }}
            accessibilityLayer
          >
            <CartesianGrid
              vertical={false}
              stroke="#e7e8e1"
              strokeDasharray="3 4"
            />
            <XAxis
              dataKey="weekStart"
              tickFormatter={tick}
              axisLine={false}
              tickLine={false}
              minTickGap={32}
              tick={{ fontSize: 11, fill: '#72776e' }}
              dy={8}
            />
            <YAxis
              allowDecimals={false}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: '#72776e' }}
            />
            <Tooltip
              labelFormatter={(label) => `Week of ${tick(String(label))}`}
              contentStyle={{
                background: '#fffef9',
                border: '1px solid #d7dcd1',
                borderRadius: 10,
                fontSize: 12,
                boxShadow: '0 8px 24px #1b332514',
              }}
              cursor={{ fill: '#edf0e8' }}
            />
            <Legend
              iconType="circle"
              iconSize={7}
              wrapperStyle={{ paddingTop: 20, fontSize: 12 }}
            />
            {series.map(([key, name], i) =>
              area ? (
                <Area
                  key={key}
                  type="monotone"
                  dataKey={key}
                  name={name}
                  stroke={COLORS[i]}
                  fill={COLORS[i]}
                  fillOpacity={0.09}
                  strokeWidth={2.5}
                  activeDot={{ r: 5 }}
                />
              ) : (
                <Bar
                  key={key}
                  dataKey={key}
                  name={name}
                  fill={COLORS[i]}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={18}
                />
              ),
            )}
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </article>
  )
}
export default function RepositoryPage({
  bundle: provided,
}: {
  bundle?: RepositoryBundle
}) {
  const bundle = useMemo(() => provided ?? createDemoBundle(), [provided])
  const [includeBots, setIncludeBots] = useState(false)
  const analytics = useMemo(
    () =>
      computeRepoAnalytics(bundle, { includeBots, excludeMaintainers: false }),
    [bundle, includeBots],
  )
  const meta = analytics.metadata
  if (!bundle.analysisWindow || bundle.analysisWindow.version !== 2)
    return (
      <div className="notice">
        <h2>This saved exploration uses the old 100-item sample.</h2>
        <p>
          Refresh from GitHub above to fetch the past three months. The old
          sample is not used for period analysis.
        </p>
      </div>
    )
  const period = `${bundle.analysisWindow.start.slice(0, 10)} – ${bundle.analysisWindow.end.slice(0, 10)} UTC`
  return (
    <>
      <header className="repository-header">
        <div>
          <h1>
            {meta.nameWithOwner.split('/')[0]}
            <span> / </span>
            <strong>{meta.name}</strong>
          </h1>
          <p>{meta.description}</p>
          <div className="badge-row">
            {meta.primaryLanguage && (
              <span className="tag">● {meta.primaryLanguage}</span>
            )}
            {meta.license && <span className="tag">{meta.license}</span>}
            <span className="tag">
              ☆ {meta.stargazerCount.toLocaleString()} stars
            </span>
            {meta.isArchived && <span className="tag">Archived</span>}
          </div>
        </div>
        {provided && (
          <a
            className="button-link ghost"
            href={meta.url}
            target="_blank"
            rel="noreferrer"
          >
            View on GitHub ↗
          </a>
        )}
      </header>
      <section className="opportunity-panel">
        <div>
          <p className="eyebrow">YOUR WAY IN</p>
          <h2>
            {meta.isArchived
              ? 'This project is archived.'
              : meta.goodFirstIssueCount
                ? 'Small steps, real contributions.'
                : 'Start with a conversation.'}
          </h2>
          <p>
            {meta.isArchived
              ? 'Look for an actively maintained successor before investing your time.'
              : 'Read the contribution guide, explore an issue, and ask before starting a large change.'}
          </p>
        </div>
        <div className="opportunity-links">
          {provided ? (
            <>
              <a
                href={`${meta.url}/issues?q=${encodeURIComponent('is:issue is:open label:"good first issue"')}`}
                target="_blank"
                rel="noreferrer"
              >
                <strong>{meta.goodFirstIssueCount}</strong> good first issues{' '}
                <span>↗</span>
              </a>
              <a
                href={`${meta.url}/issues?q=${encodeURIComponent('is:issue is:open label:"help wanted"')}`}
                target="_blank"
                rel="noreferrer"
              >
                <strong>{meta.helpWantedCount}</strong> help wanted{' '}
                <span>↗</span>
              </a>
              <a
                href={`${meta.url}/community`}
                target="_blank"
                rel="noreferrer"
              >
                Contribution guidelines <span>↗</span>
              </a>
            </>
          ) : (
            <>
              <p>
                <strong>8</strong> good first issues
              </p>
              <p>
                <strong>14</strong> help wanted
              </p>
              <small>Sample counts · labels can overlap</small>
            </>
          )}
        </div>
      </section>
      <div className="metric-grid">
        {[
          [
            'PR merge rate',
            percent(analytics.prMetrics.mergeRate),
            `${analytics.prMetrics.mergedCount} merged / ${analytics.prMetrics.resolvedCount} resolved · 3 months`,
          ],
          [
            'Time to merge',
            analytics.prMetrics.medianTimeToMergeDays === null
              ? 'Unavailable'
              : `${analytics.prMetrics.medianTimeToMergeDays.toFixed(1)} days`,
            'Median · PRs merged in these 3 months',
          ],
          [
            'Issues opened',
            analytics.issueMetrics.openedCount.toLocaleString(),
            'Created in these 3 months',
          ],
          [
            'Issues closed',
            analytics.issueMetrics.closedCount.toLocaleString(),
            'Latest closure in these 3 months',
          ],
        ].map(([title, value, hint]) => (
          <article className="metric-card" key={title}>
            <h3>{title}</h3>
            <p className="metric-value">{value}</p>
            <p className="subtle">{hint}</p>
          </article>
        ))}
      </div>
      <div className="section-heading activity-heading">
        <div>
          <p className="eyebrow">READ THE RHYTHM</p>
          <h2>Community activity</h2>
        </div>
        <div className="chart-controls">
          <label>
            <input
              type="checkbox"
              checked={includeBots}
              onChange={(e) => setIncludeBots(e.target.checked)}
            />{' '}
            Include bots in issue / PR analysis
          </label>
          <span className="tag">Past 3 months</span>
        </div>
      </div>
      <p className="coverage-note">
        <strong>{period}</strong>
        <br />
        {provided
          ? 'Fetched all pages of issues and PRs updated since the period began'
          : 'Illustrative three-month dataset; no GitHub requests were made'}{' '}
        ({bundle.snapshot.issues.length.toLocaleString()} issues,{' '}
        {bundle.snapshot.pullRequests.length.toLocaleString()} PRs, before bot
        filtering). Charts count openings, latest closures, and merges within
        these dates, including older items resolved during the period. Stars and
        currently available issues remain current repository totals.
      </p>
      {analytics.prMetrics.resolvedCount < 10 && (
        <p className="notice">
          {analytics.prMetrics.resolvedCount} resolved PRs in this period.{' '}
          {analytics.prMetrics.resolvedCount
            ? 'Small numbers can produce a misleading percentage; treat this as limited evidence.'
            : 'There is no merge-rate evidence for this period.'}
        </p>
      )}
      {bundle.stats.fallbackMessages?.map((message) => (
        <p className="notice" key={message}>
          {message}
        </p>
      ))}
      <div className="chart-grid">
        <ActivityChart
          title="Are changes getting through?"
          note="Pull requests opened and merged in these 3 months · weekly"
          data={analytics.prMetrics.weeklyTrend.map((row) => ({
            ...row,
          }))}
          series={[
            ['opened', 'Opened'],
            ['merged', 'Merged'],
          ]}
        />
        <ActivityChart
          title="Is the conversation moving?"
          note="Issues opened and closed in these 3 months · weekly"
          data={analytics.issueMetrics.weeklyTrend.map((row) => ({
            ...row,
          }))}
          series={[
            ['opened', 'Opened'],
            ['closed', 'Closed'],
          ]}
        />
        <ActivityChart
          title="A pulse on the codebase"
          note="Default-branch commits · GitHub weekly statistics include bots"
          data={analytics.commitMetrics.weeklyTrend.map((row) => ({
            ...row,
          }))}
          series={[['commits', 'Commits']]}
          area
        />
        <article className="chart-card community-note">
          <p className="eyebrow">NUMBERS ONLY TELL PART OF THE STORY</p>
          <h3>
            Activity is a signal.
            <br />
            <em>People make the community.</em>
          </h3>
          <p>
            Before choosing a project, read a few recent issue threads. Look for
            thoughtful feedback, clear contribution guidelines, and questions
            that get an answer.
          </p>
          <p>
            A busy repository isn’t automatically the best place to begin. Find
            a pace and a purpose that fit you.
          </p>
          {provided && (
            <a href={`${meta.url}/issues`} target="_blank" rel="noreferrer">
              Read the conversations ↗
            </a>
          )}
        </article>
      </div>
      <section className="people-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">MEET THE COMMUNITY</p>
            <h2>People contributing in these 3 months</h2>
          </div>
          <p>
            Issues and PRs · {includeBots ? 'Includes bots' : 'Bots hidden'}
          </p>
        </div>
        <p className="subtle">
          Counts cover issues opened and PRs opened or merged during this
          period. Reviewers and commenters are not counted. A PR can count as
          both opened and merged.
        </p>
        <div className="people-grid">
          {analytics.contributorMetrics.topContributors
            .slice(0, 8)
            .map((person) => (
              <article key={person.login}>
                <span className="person-avatar" aria-hidden="true">
                  {person.login.slice(0, 2).toUpperCase()}
                </span>
                <div>
                  <h3>
                    {provided ? (
                      <a
                        href={person.activityUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {person.login} ↗
                      </a>
                    ) : (
                      person.login
                    )}
                  </h3>
                  <p>
                    {person.issuesOpened} issues · {person.prsOpened} PRs opened
                    · {person.totalMergedPrs} merged
                  </p>
                </div>
              </article>
            ))}
        </div>
        {analytics.contributorMetrics.topContributors.length === 0 && (
          <p className="subtle">
            No identifiable issue or PR authors with counted activity in this
            period.
          </p>
        )}
      </section>
      <details className="methodology">
        <summary>
          About this data & its limitations <span>+</span>
        </summary>
        <p>
          GitHub returns up to 100 items per page. We follow every page ordered
          by update date until reaching the three-month cutoff. The period uses
          three calendar months ending when the fetch starts. Only creation,
          latest closure, and merge timestamps inside that period count. Merge
          rate is merged PRs divided by all PRs resolved during the period, with
          the selected bot filter. Median merge time is creation to merge, not
          first response. Label counts are current and may overlap.
        </p>
        <p>
          Commit statistics describe the default branch and exclude merge
          commits. GitHub can delay or withhold statistics; empty charts mean
          unavailable data. The current week may be incomplete.
        </p>
        {analytics.warnings.map((warning) => (
          <p key={warning}>{warning}</p>
        ))}
        <a
          href="https://docs.github.com/en/rest/metrics/statistics"
          target="_blank"
          rel="noreferrer"
        >
          GitHub statistics documentation ↗
        </a>
      </details>
    </>
  )
}

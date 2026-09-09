import { inWindow, threeMonthWindow } from './analysisWindow.js'
import type { RepoAnalytics, RepositoryBundle } from '../types/github.js'

const DAY = 86400000
const WEEK = 7 * DAY
function weekStart(value: string | number): number {
  const date = new Date(value)
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCDate(date.getUTCDate() - date.getUTCDay())
  return date.getTime()
}
function median(values: number[]): number | null {
  if (!values.length) return null
  values.sort((a, b) => a - b)
  const middle = Math.floor(values.length / 2)
  return values.length % 2
    ? values[middle]
    : (values[middle - 1] + values[middle]) / 2
}
function isBot(actor: { login: string; type: string } | null): boolean {
  return actor?.type === 'Bot' || !!actor?.login.toLowerCase().endsWith('[bot]')
}

export function computeRepoAnalytics(
  bundle: RepositoryBundle,
  options: { includeBots: boolean; excludeMaintainers: boolean },
): RepoAnalytics {
  const window = bundle.analysisWindow ?? threeMonthWindow(bundle.fetchedAt)
  const inside = (date: string | null) => inWindow(date, window)
  const issues = bundle.snapshot.issues.filter(
    (item) => options.includeBots || !isBot(item.author),
  )
  const prs = bundle.snapshot.pullRequests.filter(
    (item) => options.includeBots || !isBot(item.author),
  )
  const openedIssues = issues.filter((item) => inside(item.createdAt))
  const closedIssues = issues.filter((item) => inside(item.closedAt))
  const openedPrs = prs.filter((item) => inside(item.createdAt))
  const mergedPrs = prs.filter((item) => inside(item.mergedAt))
  const rejectedPrs = prs.filter(
    (item) => !item.mergedAt && inside(item.closedAt),
  )
  const resolved = mergedPrs.length + rejectedPrs.length
  const weeks: number[] = []
  for (
    let time = weekStart(window.start);
    time <= weekStart(window.end);
    time += WEEK
  )
    weeks.push(time)
  const count = (dates: Array<string | null>, week: number) =>
    dates.filter((date) => date && inside(date) && weekStart(date) === week)
      .length
  const mergeDurations = mergedPrs
    .map((pr) => (Date.parse(pr.mergedAt!) - Date.parse(pr.createdAt)) / DAY)
    .filter((days) => days >= 0 && Number.isFinite(days))
  const participants = new Map<
    string,
    {
      issuesOpened: number
      prsOpened: number
      totalMergedPrs: number
      isMaintainer: boolean
    }
  >()
  const add = (
    item: (typeof issues)[number] | (typeof prs)[number],
    metric: 'issuesOpened' | 'prsOpened' | 'totalMergedPrs',
  ) => {
    if (!item.author) return
    const login = item.author.login
    const entry = participants.get(login) ?? {
      issuesOpened: 0,
      prsOpened: 0,
      totalMergedPrs: 0,
      isMaintainer: false,
    }
    entry[metric]++
    entry.isMaintainer ||= ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(
      item.authorAssociation ?? '',
    )
    participants.set(login, entry)
  }
  openedIssues.forEach((item) => add(item, 'issuesOpened'))
  openedPrs.forEach((item) => add(item, 'prsOpened'))
  mergedPrs.forEach((item) => add(item, 'totalMergedPrs'))
  const topContributors = [...participants]
    .map(([login, counts]) => ({
      login,
      ...counts,
      activityUrl: `${bundle.snapshot.metadata.url}/issues?q=${encodeURIComponent(`author:${login} updated:>=${window.start.slice(0, 10)}`)}`,
    }))
    .filter((person) => !options.excludeMaintainers || !person.isMaintainer)
    .sort(
      (a, b) =>
        b.issuesOpened +
          b.prsOpened +
          b.totalMergedPrs -
          (a.issuesOpened + a.prsOpened + a.totalMergedPrs) ||
        a.login.localeCompare(b.login),
    )
    .slice(0, 10)

  // GitHub daily counts let us clip the first/last week instead of dropping it.
  const weeklyTrend = bundle.stats.commitActivity
    .filter(
      (week) =>
        week.week * 1000 + WEEK > Date.parse(window.start) &&
        week.week * 1000 <= Date.parse(window.end),
    )
    .map((week) => ({
      weekStart: new Date(week.week * 1000).toISOString().slice(0, 10),
      commits: week.days.reduce((total, commits, index) => {
        const day = week.week * 1000 + index * DAY
        return (
          total +
          (day + DAY > Date.parse(window.start) && day <= Date.parse(window.end)
            ? commits
            : 0)
        )
      }, 0),
    }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
  const warnings = [
    'Counts use each item’s current creation, latest closure, and merge timestamps. Repeated close/reopen cycles are not a complete event log. GitHub data can change while pages are fetched.',
    'Merge time measures creation to merge for PRs merged in this period, including older PRs. It is not first-response time. Participants are authors of issues opened and PRs opened or merged, not all reviewers or commenters.',
    'Commit counts use daily buckets on the default branch. Boundary days may be partial; commit statistics retain bots regardless of the issue/PR filter.',
    ...(bundle.stats.fallbackMessages ?? []),
  ]
  if (resolved > 0 && resolved < 10)
    warnings.push(
      `Only ${resolved} resolved PRs in this period. Treat the merge rate as limited evidence, not a community rating.`,
    )
  if (bundle.stats.pendingEndpoints.length)
    warnings.push(
      `GitHub is still computing: ${bundle.stats.pendingEndpoints.join(', ')}. Commit statistics may be incomplete.`,
    )
  if (bundle.stats.unavailableEndpoints?.length)
    warnings.push(
      `Unavailable GitHub statistics: ${bundle.stats.unavailableEndpoints.join(', ')}.`,
    )
  if (!bundle.analysisWindow)
    warnings.push(
      'Legacy 100-item snapshot. Refresh to fetch the three-month analysis.',
    )
  if (bundle.snapshot.metadata.isArchived)
    warnings.push('This repository is archived.')
  return {
    metadata: bundle.snapshot.metadata,
    issueMetrics: {
      openedCount: openedIssues.length,
      closedCount: closedIssues.length,
      weeklyTrend: weeks.map((week) => ({
        weekStart: new Date(week).toISOString().slice(0, 10),
        opened: count(
          issues.map((item) => item.createdAt),
          week,
        ),
        closed: count(
          issues.map((item) => item.closedAt),
          week,
        ),
      })),
    },
    prMetrics: {
      openedCount: openedPrs.length,
      mergedCount: mergedPrs.length,
      resolvedCount: resolved,
      mergeRate: resolved ? mergedPrs.length / resolved : null,
      rejectionRate: resolved ? rejectedPrs.length / resolved : null,
      medianTimeToMergeDays: median(mergeDurations),
      weeklyTrend: weeks.map((week) => ({
        weekStart: new Date(week).toISOString().slice(0, 10),
        opened: count(
          prs.map((item) => item.createdAt),
          week,
        ),
        merged: count(
          prs.map((item) => item.mergedAt),
          week,
        ),
        rejected: count(
          rejectedPrs.map((item) => item.closedAt),
          week,
        ),
      })),
    },
    contributorMetrics: { topContributors },
    commitMetrics: { weeklyTrend },
    warnings,
  }
}

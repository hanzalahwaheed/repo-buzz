import type {
  GitHubIssueNode,
  GitHubPullRequestNode,
  HealthComponent,
  MonthlyContributorTrend,
  RecentContributorActivity,
  RepoAnalytics,
  RepositoryBundle,
} from '../types/github'

const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS

interface AnalyticsOptions {
  includeBots: boolean
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null
  }

  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2
  }

  return sorted[middle]
}

function toUtcWeekStart(dateInput: Date | string | number): number {
  const date = new Date(dateInput)
  const normalized = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  )
  const day = normalized.getUTCDay()
  normalized.setUTCDate(normalized.getUTCDate() - day)
  normalized.setUTCHours(0, 0, 0, 0)
  return normalized.getTime()
}

function toIsoDate(input: number): string {
  return new Date(input).toISOString().slice(0, 10)
}

function isBotActor(login: string | undefined, type: string | undefined): boolean {
  if (type === 'Bot') {
    return true
  }

  return Boolean(login?.toLowerCase().endsWith('[bot]'))
}

function filterIssues(issues: GitHubIssueNode[], includeBots: boolean): GitHubIssueNode[] {
  if (includeBots) {
    return issues
  }

  return issues.filter((issue) => !isBotActor(issue.author?.login, issue.author?.type))
}

function filterPullRequests(
  pullRequests: GitHubPullRequestNode[],
  includeBots: boolean,
): GitHubPullRequestNode[] {
  if (includeBots) {
    return pullRequests
  }

  return pullRequests.filter(
    (pullRequest) =>
      !isBotActor(pullRequest.author?.login, pullRequest.author?.type),
  )
}

function buildWeeklyWindow(weekCount: number): number[] {
  const currentWeekStart = toUtcWeekStart(Date.now())
  const weeks: number[] = []

  for (let index = weekCount - 1; index >= 0; index -= 1) {
    weeks.push(currentWeekStart - index * WEEK_MS)
  }

  return weeks
}

function daysBetween(start: string, end: string): number {
  return (new Date(end).getTime() - new Date(start).getTime()) / DAY_MS
}

function normalizeGrowth(current: number, previous: number): number | null {
  if (current <= 0 && previous <= 0) {
    return null
  }

  if (previous <= 0) {
    return current > 0 ? 1 : 0
  }

  const ratio = current / previous
  return clamp(ratio / 2, 0, 1)
}

function normalizeGoodFirstIssueCount(count: number): number {
  return clamp(count / 20, 0, 1)
}

function countEventsPerWeek(
  dates: Array<string | null>,
  weekStarts: number[],
): Record<number, number> {
  const counts = new Map<number, number>()
  for (const week of weekStarts) {
    counts.set(week, 0)
  }

  for (const date of dates) {
    if (!date) {
      continue
    }

    const week = toUtcWeekStart(date)
    if (!counts.has(week)) {
      continue
    }

    counts.set(week, (counts.get(week) ?? 0) + 1)
  }

  return Object.fromEntries(counts)
}

function buildNewContributorMonthlyTrend(
  pullRequests: GitHubPullRequestNode[],
): MonthlyContributorTrend[] {
  const firstTimeAssociations = new Set([
    'FIRST_TIMER',
    'FIRST_TIME_CONTRIBUTOR',
  ])

  const earliestByAuthor = new Map<string, string>()

  for (const pullRequest of pullRequests) {
    if (!pullRequest.author?.login) {
      continue
    }

    if (!firstTimeAssociations.has(pullRequest.authorAssociation ?? '')) {
      continue
    }

    const existing = earliestByAuthor.get(pullRequest.author.login)
    if (!existing || new Date(pullRequest.createdAt) < new Date(existing)) {
      earliestByAuthor.set(pullRequest.author.login, pullRequest.createdAt)
    }
  }

  const monthlyCounts = new Map<string, number>()

  for (const createdAt of earliestByAuthor.values()) {
    const month = createdAt.slice(0, 7)
    monthlyCounts.set(month, (monthlyCounts.get(month) ?? 0) + 1)
  }

  return [...monthlyCounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, count]) => ({
      month,
      newContributors: count,
    }))
}

function buildHealthScore(components: HealthComponent[]): {
  score: number | null
  components: HealthComponent[]
} {
  const available = components.filter((component) => component.normalized !== null)

  if (available.length === 0) {
    return {
      score: null,
      components,
    }
  }

  const totalWeight = sum(available.map((component) => component.weight))
  const weightedScore =
    sum(
      available.map(
        (component) =>
          (component.normalized ?? 0) * component.weight,
      ),
    ) / totalWeight

  return {
    score: Math.round(weightedScore * 100),
    components,
  }
}

function buildTopContributorsLast3Weeks(
  owner: string,
  repo: string,
  issues: GitHubIssueNode[],
  pullRequests: GitHubPullRequestNode[],
): RecentContributorActivity[] {
  const cutoff21d = Date.now() - 21 * DAY_MS
  const statsByAuthor = new Map<
    string,
    {
      issuesOpenedLast3Weeks: number
      prsOpenedLast3Weeks: number
      prsMergedLast3Weeks: number
    }
  >()

  const ensure = (login: string) => {
    const existing = statsByAuthor.get(login)
    if (existing) {
      return existing
    }

    const created = {
      issuesOpenedLast3Weeks: 0,
      prsOpenedLast3Weeks: 0,
      prsMergedLast3Weeks: 0,
    }
    statsByAuthor.set(login, created)
    return created
  }

  for (const issue of issues) {
    if (!issue.author?.login) {
      continue
    }

    if (new Date(issue.createdAt).getTime() < cutoff21d) {
      continue
    }

    ensure(issue.author.login).issuesOpenedLast3Weeks += 1
  }

  for (const pullRequest of pullRequests) {
    if (!pullRequest.author?.login) {
      continue
    }

    const stats = ensure(pullRequest.author.login)

    if (new Date(pullRequest.createdAt).getTime() >= cutoff21d) {
      stats.prsOpenedLast3Weeks += 1
    }

    if (
      pullRequest.mergedAt &&
      new Date(pullRequest.mergedAt).getTime() >= cutoff21d
    ) {
      stats.prsMergedLast3Weeks += 1
    }
  }

  const encodedOwnerRepo = `${owner}/${repo}`

  return [...statsByAuthor.entries()]
    .map(([login, stats]) => {
      const issuesQuery = `is:issue author:${login}`
      const prsOpenedQuery = `is:pr author:${login}`
      const prsMergedQuery = `is:pr is:merged author:${login}`
      return {
        login,
        activityUrl: `https://github.com/${encodedOwnerRepo}/issues?q=${encodeURIComponent(`author:${login}`)}`,
        issuesUrl: `https://github.com/${encodedOwnerRepo}/issues?q=${encodeURIComponent(issuesQuery)}`,
        prsOpenedUrl: `https://github.com/${encodedOwnerRepo}/issues?q=${encodeURIComponent(prsOpenedQuery)}`,
        prsMergedUrl: `https://github.com/${encodedOwnerRepo}/issues?q=${encodeURIComponent(prsMergedQuery)}`,
        issuesOpenedLast3Weeks: stats.issuesOpenedLast3Weeks,
        prsOpenedLast3Weeks: stats.prsOpenedLast3Weeks,
        prsMergedLast3Weeks: stats.prsMergedLast3Weeks,
        combinedActivity:
          stats.issuesOpenedLast3Weeks +
          stats.prsOpenedLast3Weeks +
          stats.prsMergedLast3Weeks,
      }
    })
    .filter((entry) => entry.combinedActivity > 0)
    .sort((left, right) => {
      if (right.combinedActivity !== left.combinedActivity) {
        return right.combinedActivity - left.combinedActivity
      }

      if (right.prsMergedLast3Weeks !== left.prsMergedLast3Weeks) {
        return right.prsMergedLast3Weeks - left.prsMergedLast3Weeks
      }

      if (right.prsOpenedLast3Weeks !== left.prsOpenedLast3Weeks) {
        return right.prsOpenedLast3Weeks - left.prsOpenedLast3Weeks
      }

      if (right.issuesOpenedLast3Weeks !== left.issuesOpenedLast3Weeks) {
        return right.issuesOpenedLast3Weeks - left.issuesOpenedLast3Weeks
      }

      return left.login.localeCompare(right.login)
    })
    .slice(0, 10)
}

export function computeRepoAnalytics(
  bundle: RepositoryBundle,
  options: AnalyticsOptions,
): RepoAnalytics {
  const issues = filterIssues(bundle.snapshot.issues, options.includeBots)
  const pullRequests = filterPullRequests(
    bundle.snapshot.pullRequests,
    options.includeBots,
  )

  const weekStarts = buildWeeklyWindow(52)

  const issueOpenedByWeek = countEventsPerWeek(
    issues.map((issue) => issue.createdAt),
    weekStarts,
  )
  const issueClosedByWeek = countEventsPerWeek(
    issues.map((issue) => issue.closedAt),
    weekStarts,
  )

  const prOpenedByWeek = countEventsPerWeek(
    pullRequests.map((pr) => pr.createdAt),
    weekStarts,
  )
  const prMergedByWeek = countEventsPerWeek(
    pullRequests.map((pr) => pr.mergedAt),
    weekStarts,
  )
  const prRejectedByWeek = countEventsPerWeek(
    pullRequests
      .filter((pr) => pr.state === 'CLOSED' && !pr.mergedAt)
      .map((pr) => pr.closedAt),
    weekStarts,
  )

  const issueCloseDurations = issues
    .filter((issue) => issue.closedAt)
    .map((issue) => daysBetween(issue.createdAt, issue.closedAt ?? issue.createdAt))
    .filter((value) => Number.isFinite(value) && value >= 0)

  const prMergeDurations = pullRequests
    .filter((pr) => pr.mergedAt)
    .map((pr) => daysBetween(pr.createdAt, pr.mergedAt ?? pr.createdAt))
    .filter((value) => Number.isFinite(value) && value >= 0)

  const totalIssues =
    bundle.snapshot.metadata.openIssueCount + bundle.snapshot.metadata.closedIssueCount
  const totalMergedAndClosedPrs =
    bundle.snapshot.metadata.mergedPullRequestCount +
    Math.max(
      bundle.snapshot.metadata.closedPullRequestCount -
        bundle.snapshot.metadata.mergedPullRequestCount,
      0,
    )

  const issueCloseRate =
    totalIssues > 0 ? bundle.snapshot.metadata.closedIssueCount / totalIssues : null

  const closedWithoutMerge = Math.max(
    bundle.snapshot.metadata.closedPullRequestCount -
      bundle.snapshot.metadata.mergedPullRequestCount,
    0,
  )

  const prMergeRate =
    totalMergedAndClosedPrs > 0
      ? bundle.snapshot.metadata.mergedPullRequestCount / totalMergedAndClosedPrs
      : null

  const prRejectionRate =
    totalMergedAndClosedPrs > 0
      ? closedWithoutMerge / totalMergedAndClosedPrs
      : null

  const averageReviewsPerPr =
    pullRequests.length > 0
      ? sum(pullRequests.map((pr) => pr.reviews)) / pullRequests.length
      : null

  const staleCutoff = Date.now() - 90 * DAY_MS
  const staleIssueCount = issues.filter((issue) => {
    if (issue.state !== 'OPEN') {
      return false
    }

    return new Date(issue.updatedAt).getTime() < staleCutoff
  }).length

  const commitTrend = bundle.stats.commitActivity
    .map((week) => ({
      weekStart: toIsoDate(week.week * 1000),
      commits: week.total,
      timestamp: week.week * 1000,
    }))
    .sort((left, right) => left.timestamp - right.timestamp)

  const codeChurn = bundle.stats.codeFrequency
    .map(([week, additions, deletions]) => ({
      weekStart: toIsoDate(week * 1000),
      additions,
      deletions: Math.abs(deletions),
      timestamp: week * 1000,
    }))
    .sort((left, right) => left.timestamp - right.timestamp)

  const contributors = options.includeBots
    ? bundle.stats.contributors
    : bundle.stats.contributors.filter(
        (contributor) =>
          !isBotActor(contributor.author?.login, contributor.author?.type),
      )

  const topContributorsLast3Weeks = buildTopContributorsLast3Weeks(
    bundle.snapshot.metadata.owner,
    bundle.snapshot.metadata.name,
    issues,
    pullRequests,
  )

  const now = Date.now()
  const cutoff7d = now - 7 * DAY_MS
  const cutoff30d = now - 30 * DAY_MS
  const cutoff90d = now - 90 * DAY_MS

  const uniqueContributors7d = contributors.filter((contributor) =>
    contributor.weeks.some((week) => week.c > 0 && week.w * 1000 >= cutoff7d),
  ).length
  const uniqueContributors30d = contributors.filter((contributor) =>
    contributor.weeks.some((week) => week.c > 0 && week.w * 1000 >= cutoff30d),
  ).length
  const uniqueContributors90d = contributors.filter((contributor) =>
    contributor.weeks.some((week) => week.c > 0 && week.w * 1000 >= cutoff90d),
  ).length

  const contributorTotals = contributors
    .map((contributor) => contributor.total)
    .sort((left, right) => right - left)

  const top3Total = sum(contributorTotals.slice(0, 3))
  const allContributorCommits = sum(contributorTotals)
  const concentrationTop3Pct =
    allContributorCommits > 0 ? top3Total / allContributorCommits : null

  const allParticipationLast12 = sum(bundle.stats.participation.all.slice(-12))
  const ownerParticipationLast12 = sum(bundle.stats.participation.owner.slice(-12))
  const communityParticipationLast12 = Math.max(
    allParticipationLast12 - ownerParticipationLast12,
    0,
  )

  const communityCommitRatio =
    allParticipationLast12 > 0
      ? communityParticipationLast12 / allParticipationLast12
      : null

  const newContributorsMonthly = buildNewContributorMonthlyTrend(pullRequests)

  const firstTimeSeries = newContributorsMonthly.map((entry) => ({
    month: new Date(`${entry.month}-01T00:00:00Z`).getTime(),
    count: entry.newContributors,
  }))

  const firstTimeRecent = sum(
    firstTimeSeries
      .filter((entry) => entry.month >= cutoff90d)
      .map((entry) => entry.count),
  )
  const firstTimePrevious = sum(
    firstTimeSeries
      .filter((entry) => entry.month < cutoff90d && entry.month >= now - 180 * DAY_MS)
      .map((entry) => entry.count),
  )

  const commitsLast30d = sum(
    commitTrend
      .filter((entry) => entry.timestamp >= cutoff30d)
      .map((entry) => entry.commits),
  )
  const commitsPrevious30d = sum(
    commitTrend
      .filter(
        (entry) => entry.timestamp >= now - 60 * DAY_MS && entry.timestamp < cutoff30d,
      )
      .map((entry) => entry.commits),
  )

  const hasEnoughIssueData = totalIssues >= 10
  const totalPrVolume =
    bundle.snapshot.metadata.openPullRequestCount + totalMergedAndClosedPrs
  const hasEnoughPrData = totalPrVolume >= 10
  const activeCommitWeeks = commitTrend.filter((entry) => entry.commits > 0).length
  const hasEnoughCommitData = activeCommitWeeks >= 4

  const healthComponents: HealthComponent[] = [
    {
      key: 'commitMomentum',
      label: 'Commit momentum',
      weight: 20,
      value:
        commitsPrevious30d > 0
          ? commitsLast30d / commitsPrevious30d
          : commitsLast30d,
      normalized: hasEnoughCommitData
        ? normalizeGrowth(commitsLast30d, commitsPrevious30d)
        : null,
      insufficientData: !hasEnoughCommitData,
      reason: hasEnoughCommitData
        ? undefined
        : 'Needs at least 4 active commit weeks.',
    },
    {
      key: 'prMergeRate',
      label: 'PR merge rate',
      weight: 15,
      value: prMergeRate,
      normalized: hasEnoughPrData ? prMergeRate : null,
      insufficientData: !hasEnoughPrData,
      reason: hasEnoughPrData ? undefined : 'Needs at least 10 PRs.',
    },
    {
      key: 'issueCloseRate',
      label: 'Issue close rate',
      weight: 15,
      value: issueCloseRate,
      normalized: hasEnoughIssueData ? issueCloseRate : null,
      insufficientData: !hasEnoughIssueData,
      reason: hasEnoughIssueData ? undefined : 'Needs at least 10 issues.',
    },
    {
      key: 'newContributorGrowth',
      label: 'New contributor growth',
      weight: 20,
      value:
        firstTimePrevious > 0
          ? firstTimeRecent / firstTimePrevious
          : firstTimeRecent,
      normalized: hasEnoughPrData
        ? normalizeGrowth(firstTimeRecent, firstTimePrevious)
        : null,
      insufficientData: !hasEnoughPrData,
      reason: hasEnoughPrData ? undefined : 'Needs at least 10 PRs.',
    },
    {
      key: 'communityRatio',
      label: 'Community commit ratio',
      weight: 15,
      value: communityCommitRatio,
      normalized: communityCommitRatio,
      insufficientData: communityCommitRatio === null,
      reason:
        communityCommitRatio === null
          ? 'No participation data from GitHub stats endpoints.'
          : undefined,
    },
    {
      key: 'goodFirstIssueAvailability',
      label: 'Good first issue availability',
      weight: 15,
      value:
        bundle.snapshot.metadata.goodFirstIssueCount +
        bundle.snapshot.metadata.helpWantedCount,
      normalized: normalizeGoodFirstIssueCount(
        bundle.snapshot.metadata.goodFirstIssueCount +
          bundle.snapshot.metadata.helpWantedCount,
      ),
      insufficientData: false,
    },
  ]

  const healthScore = buildHealthScore(healthComponents)

  const warnings: string[] = []
  if (bundle.stats.pendingEndpoints.length > 0) {
    warnings.push(
      `GitHub is still computing stats for: ${bundle.stats.pendingEndpoints.join(', ')}. Showing partial data.`,
    )
  }

  const unavailableEndpoints = bundle.stats.unavailableEndpoints ?? []
  if (unavailableEndpoints.length > 0) {
    warnings.push(
      `Some GitHub stats endpoints are unavailable for this repository: ${unavailableEndpoints.join(', ')}.`,
    )
  }

  const fallbackMessages = bundle.stats.fallbackMessages ?? []
  for (const message of fallbackMessages) {
    warnings.push(message)
  }

  if (bundle.snapshot.metadata.isArchived) {
    warnings.push('This repository is archived. Low recent activity is expected.')
  }

  return {
    metadata: bundle.snapshot.metadata,
    issueMetrics: {
      openCount: bundle.snapshot.metadata.openIssueCount,
      closeRate: issueCloseRate,
      medianTimeToCloseDays: median(issueCloseDurations),
      staleCount: staleIssueCount,
      goodFirstIssueCount: bundle.snapshot.metadata.goodFirstIssueCount,
      helpWantedCount: bundle.snapshot.metadata.helpWantedCount,
      weeklyTrend: weekStarts.map((weekStart) => ({
        weekStart: toIsoDate(weekStart),
        opened: issueOpenedByWeek[weekStart] ?? 0,
        closed: issueClosedByWeek[weekStart] ?? 0,
      })),
    },
    prMetrics: {
      mergeRate: prMergeRate,
      rejectionRate: prRejectionRate,
      medianTimeToMergeDays: median(prMergeDurations),
      averageReviewsPerPr,
      weeklyTrend: weekStarts.map((weekStart) => ({
        weekStart: toIsoDate(weekStart),
        opened: prOpenedByWeek[weekStart] ?? 0,
        merged: prMergedByWeek[weekStart] ?? 0,
        rejected: prRejectedByWeek[weekStart] ?? 0,
      })),
    },
    contributorMetrics: {
      uniqueContributors7d,
      uniqueContributors30d,
      uniqueContributors90d,
      newContributorsMonthly,
      concentrationTop3Pct,
      communityCommitRatio,
      topContributorsLast3Weeks,
    },
    commitMetrics: {
      weeklyTrend: commitTrend.map((entry) => ({
        weekStart: entry.weekStart,
        commits: entry.commits,
      })),
      commitsLast30d,
      commitsPrevious30d,
    },
    codeMetrics: {
      weeklyChurn: codeChurn.map((entry) => ({
        weekStart: entry.weekStart,
        additions: entry.additions,
        deletions: entry.deletions,
      })),
    },
    healthScore,
    warnings,
  }
}

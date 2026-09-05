import { threeMonthWindow } from './analysisWindow'
import type { RepositoryBundle } from '../types/github'
// A deterministic fictional dataset, clearly marked in the UI. Never persisted.
export function createDemoBundle(): RepositoryBundle {
  const now = new Date('2026-09-01T12:00:00Z').getTime()
  const day = 86400000
  const date = (days: number) => new Date(now - days * day).toISOString()
  return {
    fetchedAt: date(0),
    analysisWindow: threeMonthWindow(date(0)),
    snapshot: {
      metadata: {
        name: 'garden',
        nameWithOwner: 'fieldnotes/garden',
        owner: 'fieldnotes',
        description:
          'A fictional community-built toolkit for a greener, more accessible web. Explore this sample to learn how to read the signals.',
        stargazerCount: 1248,
        forkCount: 142,
        primaryLanguage: 'TypeScript',
        license: 'MIT',
        updatedAt: date(0),
        pushedAt: date(1),
        url: 'https://github.com',
        isFork: false,
        isArchived: false,
        openIssueCount: 25,
        closedIssueCount: 175,
        openPullRequestCount: 12,
        closedPullRequestCount: 18,
        mergedPullRequestCount: 142,
        goodFirstIssueCount: 8,
        helpWantedCount: 14,
      },
      issues: Array.from({ length: 100 }, (_, i) => ({
        id: `issue-${i}`,
        createdAt: date(i * 0.8 + 5),
        closedAt: i % 4 ? date(i * 0.8 + 1) : null,
        updatedAt: date(i * 0.8),
        state: i % 4 ? 'CLOSED' : 'OPEN',
        authorAssociation: 'CONTRIBUTOR',
        labels: [],
        author: { login: `contributor-${i % 15}`, type: 'User' },
      })),
      pullRequests: Array.from({ length: 100 }, (_, i) => ({
        id: `pr-${i}`,
        createdAt: date(i * 0.7 + 4),
        mergedAt: i % 5 ? date(i * 0.7 + 1) : null,
        closedAt: i % 5 ? date(i * 0.7 + 1) : null,
        updatedAt: date(i * 0.7),
        state: i % 5 ? 'MERGED' : 'OPEN',
        additions: 40,
        deletions: 10,
        reviews: 2,
        authorAssociation: i % 3 ? 'CONTRIBUTOR' : 'FIRST_TIME_CONTRIBUTOR',
        author: { login: `contributor-${i % 15}`, type: 'User' },
      })),
    },
    stats: {
      participation: {
        all: [18, 24, 19, 32, 27, 35, 22, 38, 31, 42, 34, 39],
        owner: [4, 6, 4, 8, 5, 7, 5, 8, 7, 9, 7, 8],
      },
      commitActivity: [18, 24, 19, 32, 27, 35, 22, 38, 31, 42, 34, 39].map(
        (total, i) => ({
          week:
            Math.floor(new Date('2026-06-14T00:00:00Z').getTime() / 1000) +
            i * 604800,
          total,
          days: [2, 4, 3, 5, 2, 1, total - 17],
        }),
      ),
      contributors: Array.from({ length: 15 }, (_, i) => ({
        author: { login: `contributor-${i}`, type: 'User' },
        weeks: [{ w: Math.floor(now / 1000) - 604800, a: 100, d: 30, c: 3 }],
      })),
      codeFrequency: [],
      pendingEndpoints: [],
    },
  }
}

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { getRepoBundleFromCache, setRepoBundleCache } from '../lib/cache'
import { GitHubApiClient } from '../lib/githubApi'
import type {
  OrgFetchProgress,
  OrganizationRepoSummary,
  RepositoryBundle,
} from '../types/github'

const FIVE_MINUTES_MS = 5 * 60 * 1000

export interface RepoTarget {
  owner: string
  repo: string
}

export interface OrgTarget {
  org: string
}

export type SearchTarget =
  | {
      type: 'repo'
      value: RepoTarget
    }
  | {
      type: 'org'
      value: OrgTarget
    }

const OWNER_REPO_REGEX = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/
const ORG_REGEX = /^[a-zA-Z0-9_.-]+$/

export const GITHUB_TOKEN_REGEX =
  /^(gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})$/

export function parseSearchTarget(value: string): SearchTarget | null {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  if (OWNER_REPO_REGEX.test(trimmed)) {
    const [owner, repo] = trimmed.split('/')
    return {
      type: 'repo',
      value: {
        owner,
        repo,
      },
    }
  }

  if (ORG_REGEX.test(trimmed)) {
    return {
      type: 'org',
      value: {
        org: trimmed,
      },
    }
  }

  return null
}

interface UseOrgRepositoriesQueryParams {
  apiClient: GitHubApiClient
  orgName: string | null
  enabled: boolean
  onFetchedFromNetwork?: (repos: OrganizationRepoSummary[]) => void
}

interface UseRepoBundleQueryParams {
  apiClient: GitHubApiClient
  owner: string | null
  repo: string | null
  enabled: boolean
  onFetchedFromNetwork?: (bundle: RepositoryBundle) => void
}

export function useOrgRepositoriesQuery({
  apiClient,
  orgName,
  enabled,
  onFetchedFromNetwork,
}: UseOrgRepositoriesQueryParams): {
  data: OrganizationRepoSummary[] | undefined
  isLoading: boolean
  isFetching: boolean
  dataUpdatedAt: number
  error: unknown
  progress: OrgFetchProgress | null
} {
  const [progress, setProgress] = useState<OrgFetchProgress | null>(null)

  const query = useQuery<OrganizationRepoSummary[]>({
    queryKey: [
      'org-repositories',
      orgName,
      apiClient.isAuthenticated ? 'authenticated' : 'anonymous',
    ],
    enabled: enabled && Boolean(orgName),
    staleTime: FIVE_MINUTES_MS,
    gcTime: 30 * 60 * 1000,
    queryFn: async ({ signal }) => {
      if (!orgName) {
        return []
      }

      setProgress({
        fetched: 0,
        total: null,
      })

      const data = await apiClient.fetchOrganizationRepositoriesAll(orgName, {
        signal,
        onProgress: (nextProgress) => setProgress(nextProgress),
      })
      onFetchedFromNetwork?.(data)
      return data
    },
  })

  return {
    data: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    dataUpdatedAt: query.dataUpdatedAt,
    error: query.error,
    progress: enabled ? progress : null,
  }
}

export function useRepositoryBundleQuery({
  apiClient,
  owner,
  repo,
  enabled,
  onFetchedFromNetwork,
}: UseRepoBundleQueryParams): {
  data: RepositoryBundle | undefined
  isLoading: boolean
  isFetching: boolean
  dataUpdatedAt: number
  error: unknown
} {
  const query = useQuery<RepositoryBundle>({
    queryKey: [
      'repository-bundle',
      owner,
      repo,
      apiClient.isAuthenticated ? 'authenticated' : 'anonymous',
    ],
    enabled: enabled && Boolean(owner) && Boolean(repo),
    staleTime: FIVE_MINUTES_MS,
    gcTime: 30 * 60 * 1000,
    queryFn: async ({ signal }) => {
      if (!owner || !repo) {
        throw new Error('Owner/repo is required.')
      }

      const cacheKey = `${
        apiClient.isAuthenticated ? 'authenticated' : 'anonymous'
      }/${owner}/${repo}`

      const cached = getRepoBundleFromCache(cacheKey)
      if (cached) {
        return cached
      }

      const data = await apiClient.fetchRepositoryBundle(owner, repo, {
        signal,
      })
      setRepoBundleCache(cacheKey, data)
      onFetchedFromNetwork?.(data)
      return data
    },
  })

  return {
    data: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    dataUpdatedAt: query.dataUpdatedAt,
    error: query.error,
  }
}

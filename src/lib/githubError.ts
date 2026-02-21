import type { RateLimitSnapshot, RateLimitSource } from '../types/github'

interface GitHubErrorOptions {
  message: string
  status: number
  source: RateLimitSource
  rateLimit?: RateLimitSnapshot
  documentationUrl?: string
  errors?: string[]
  retryAfterSeconds?: number
}

export class GitHubApiError extends Error {
  status: number
  source: RateLimitSource
  rateLimit?: RateLimitSnapshot
  documentationUrl?: string
  details: string[]
  retryAfterSeconds?: number

  constructor(options: GitHubErrorOptions) {
    super(options.message)
    this.name = 'GitHubApiError'
    this.status = options.status
    this.source = options.source
    this.rateLimit = options.rateLimit
    this.documentationUrl = options.documentationUrl
    this.details = options.errors ?? []
    this.retryAfterSeconds = options.retryAfterSeconds
  }
}

interface UserMessageOptions {
  target?: string
  token?: string
}

function formatResetTime(resetAt?: string): string {
  if (!resetAt) {
    return 'soon'
  }

  const date = new Date(resetAt)
  return Number.isNaN(date.getTime())
    ? resetAt
    : date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
}

export function toUserMessage(error: unknown, options: UserMessageOptions = {}): string {
  if (error instanceof GitHubApiError) {
    if (error.status === 401) {
      return 'Token invalid or expired. Please re-enter your token.'
    }

    if (error.status === 403 && error.rateLimit?.remaining === 0) {
      return `Rate limit reached. Requests will reset at ${formatResetTime(error.rateLimit.resetAt)}.`
    }

    if (error.status === 403 && error.retryAfterSeconds) {
      return `GitHub secondary rate limit triggered. Retry after ${error.retryAfterSeconds} seconds.`
    }

    if (error.status === 403) {
      return 'Your token may lack required scopes or repository permissions. Check token permissions and try again.'
    }

    if (error.status === 404) {
      if (options.token?.startsWith('github_pat_')) {
        return 'Repo not found or token lacks fine-grained repository access. Verify repo permissions on your fine-grained token.'
      }

      if (options.target) {
        return `Could not find "${options.target}". Check spelling, or confirm token access for private repos.`
      }

      return 'Repo not found or private. Check name and token permissions.'
    }

    if (error.status === 202) {
      return 'GitHub is still computing repository statistics. Please retry in a few seconds.'
    }

    const detailMessages = error.details.filter((entry) => entry !== error.message)
    const detail = detailMessages.length > 0 ? ` (${detailMessages.join('; ')})` : ''
    return `${error.message}${detail}`
  }

  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'Request canceled.'
  }

  if (error instanceof Error) {
    return error.message.includes('Failed to fetch')
      ? 'Network error. Check your connection and try again.'
      : error.message
  }

  return 'Unexpected error. Please retry.'
}

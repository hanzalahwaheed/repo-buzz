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
  let trimmed = value.trim()
  if (GITHUB_TOKEN_REGEX.test(trimmed)) return null
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      if (url.hostname !== 'github.com' || url.username || url.password)
        return null
      trimmed = url.pathname.replace(/^\/|\/$/g, '').replace(/\.git$/, '')
    } catch {
      return null
    }
  }
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

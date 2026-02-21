import type { RepositoryBundle } from '../types/github'

const FIVE_MINUTES_MS = 5 * 60 * 1000

const repoBundleCache = new Map<string, { data: RepositoryBundle; fetchedAt: number }>()

export function getRepoBundleFromCache(key: string): RepositoryBundle | null {
  const cached = repoBundleCache.get(key)
  if (!cached) {
    return null
  }

  if (Date.now() - cached.fetchedAt > FIVE_MINUTES_MS) {
    repoBundleCache.delete(key)
    return null
  }

  return cached.data
}

export function setRepoBundleCache(key: string, data: RepositoryBundle): void {
  repoBundleCache.set(key, { data, fetchedAt: Date.now() })
}

export function clearRepoBundleCache(): void {
  repoBundleCache.clear()
}

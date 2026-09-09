import type {
  LibraryStatus,
  SharedExploration,
  TokenCheck,
} from '../types/api.js'
import { readPersonalToken } from './personalToken.js'

interface RequestOptions {
  signal?: AbortSignal
  refresh?: boolean
  /** Sends the visitor's own GitHub token, which the server prefers over the shared one. */
  token?: string
}

async function request<T>(
  path: string,
  { signal, refresh = false, token }: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {}
  if (refresh) headers['Content-Type'] = 'application/json'
  // A header keeps the token out of the URL, out of history and out of logs.
  if (token) headers['X-GitHub-Token'] = token
  const response = await fetch(path, {
    signal,
    method: refresh ? 'POST' : 'GET',
    ...(Object.keys(headers).length ? { headers } : {}),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload)
    throw new Error(
      payload?.error ??
        'The shared library is unavailable. Please try again shortly.',
    )
  return payload as T
}

/** Reports the shared connection, so it never carries a visitor token. */
export const fetchLibraryStatus = (signal?: AbortSignal) =>
  request<LibraryStatus>('/api/status', { signal })

export const fetchExploration = (
  target: string,
  signal?: AbortSignal,
  refresh = false,
) =>
  request<SharedExploration>(
    `/api/explorations?target=${encodeURIComponent(target)}`,
    { signal, refresh, token: readPersonalToken() },
  )

export const checkPersonalToken = (token: string, signal?: AbortSignal) =>
  request<TokenCheck>('/api/token-check', { signal, refresh: true, token })

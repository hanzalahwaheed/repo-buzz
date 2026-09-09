import type { LibraryStatus, SharedExploration } from '../types/api.js'

async function request<T>(
  path: string,
  signal?: AbortSignal,
  refresh = false,
): Promise<T> {
  const response = await fetch(path, {
    signal,
    method: refresh ? 'POST' : 'GET',
    ...(refresh ? { headers: { 'Content-Type': 'application/json' } } : {}),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload)
    throw new Error(
      payload?.error ??
        'The shared library is unavailable. Please try again shortly.',
    )
  return payload as T
}
export const fetchLibraryStatus = (signal?: AbortSignal) =>
  request<LibraryStatus>('/api/status', signal)
export const fetchExploration = (
  target: string,
  signal?: AbortSignal,
  refresh = false,
) =>
  request<SharedExploration>(
    `/api/explorations?target=${encodeURIComponent(target)}`,
    signal,
    refresh,
  )

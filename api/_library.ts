import type { VercelRequest, VercelResponse } from '@vercel/node'
import { PostgresExplorationDatabase } from '../server/postgresDatabase.js'
import { connectionStringFromEnv } from '../server/store.js'
import { LibraryError, SharedLibrary } from '../server/library.js'

function positive(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${name} must be a positive number.`)
  return value
}

// Held at module scope so warm invocations reuse the library and its caches.
let library: SharedLibrary | null = null

export function getLibrary(): SharedLibrary {
  if (!library) {
    const url = connectionStringFromEnv()
    if (!url)
      throw new LibraryError(
        'The shared library is not configured. DATABASE_URL is missing.',
        503,
      )
    library = new SharedLibrary(new PostgresExplorationDatabase(url), {
      token: process.env.GITHUB_TOKEN,
      ttlMs: positive('CACHE_TTL_HOURS', 6) * 60 * 60 * 1000,
      refreshCooldownMs: positive('REFRESH_COOLDOWN_MINUTES', 5) * 60 * 1000,
    })
  }
  return library
}

export function json(response: VercelResponse, status: number, data: unknown) {
  response
    .status(status)
    .setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.send(JSON.stringify(data))
}

/** The visitor key for the shared refresh budget. */
export function visitorOf(request: VercelRequest): string {
  const forwarded = request.headers['x-forwarded-for']
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded
  return (
    first?.split(',')[0].trim() || request.socket.remoteAddress || 'unknown'
  )
}

/** Applies the same cross-site guard the standalone server uses. */
export function guard(request: VercelRequest) {
  if (request.headers['sec-fetch-site'] === 'cross-site')
    throw new LibraryError('Cross-site requests are not supported.', 403)
}

export function fail(response: VercelResponse, error: unknown) {
  json(response, error instanceof LibraryError ? error.status : 500, {
    error:
      error instanceof LibraryError
        ? error.message
        : 'The shared library is temporarily unavailable.',
  })
}

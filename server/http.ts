import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, sep, extname } from 'node:path'
import { LibraryError, readVisitorToken, SharedLibrary } from './library.js'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
}
function json(response: ServerResponse, status: number, data: unknown) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(JSON.stringify(data))
}
export function createHandler(
  library: SharedLibrary,
  staticDirectory = resolve('dist'),
) {
  return async (request: IncomingMessage, response: ServerResponse) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost')
      if (url.pathname.startsWith('/api/')) {
        if (request.headers['sec-fetch-site'] === 'cross-site')
          throw new LibraryError('Cross-site requests are not supported.', 403)
        // The header keeps a visitor token out of the URL and out of any log line.
        const visitorToken = readVisitorToken(request.headers['x-github-token'])
        if (url.pathname === '/api/status' && request.method === 'GET')
          return json(response, 200, await library.status())
        if (url.pathname === '/api/token-check' && request.method === 'POST') {
          if (!visitorToken)
            throw new LibraryError('Send a token to check.', 400)
          return json(response, 200, await library.verifyToken(visitorToken))
        }
        if (
          url.pathname === '/api/explorations' &&
          ['GET', 'POST'].includes(request.method ?? '')
        ) {
          if (
            request.method === 'POST' &&
            request.headers['content-type'] !== 'application/json'
          )
            throw new LibraryError('Refresh requires a JSON request.', 415)
          const result = await library.explore(
            url.searchParams.get('target') ?? '',
            request.method === 'POST',
            request.socket.remoteAddress ?? 'unknown',
            visitorToken,
          )
          return json(response, 200, result)
        }
        throw new LibraryError('API endpoint not found.', 404)
      }
      if (request.method !== 'GET' && request.method !== 'HEAD')
        throw new LibraryError('Method not allowed.', 405)
      const file = resolve(
        staticDirectory,
        '.' +
          decodeURIComponent(
            url.pathname === '/' ? '/index.html' : url.pathname,
          ),
      )
      if (!file.startsWith(resolve(staticDirectory) + sep))
        throw new LibraryError('Not found.', 404)
      let content
      try {
        content = await readFile(file)
      } catch {
        throw new LibraryError(
          'Not found. Run npm run build before starting the production server.',
          404,
        )
      }
      response.writeHead(200, {
        'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Cache-Control': file.includes(`${sep}assets${sep}`)
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
      })
      response.end(request.method === 'HEAD' ? undefined : content)
    } catch (error) {
      if (!response.headersSent)
        json(response, error instanceof LibraryError ? error.status : 500, {
          error:
            error instanceof LibraryError
              ? error.message
              : 'The shared library is temporarily unavailable.',
          ...(error instanceof LibraryError && error.ownTokenHelps
            ? { ownTokenHelps: true }
            : {}),
        })
    }
  }
}

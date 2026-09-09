import type { VercelRequest, VercelResponse } from '@vercel/node'
import { LibraryError } from '../server/library.js'
import { fail, getLibrary, guard, json, visitorOf } from './_library.js'

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
) {
  try {
    guard(request)
    if (request.method !== 'GET' && request.method !== 'POST')
      throw new LibraryError('API endpoint not found.', 404)
    if (
      request.method === 'POST' &&
      request.headers['content-type'] !== 'application/json'
    )
      throw new LibraryError('Refresh requires a JSON request.', 415)
    const target = request.query.target
    const result = await getLibrary().explore(
      (Array.isArray(target) ? target[0] : target) ?? '',
      request.method === 'POST',
      visitorOf(request),
    )
    json(response, 200, result)
  } catch (error) {
    fail(response, error)
  }
}

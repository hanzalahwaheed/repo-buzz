import type { VercelRequest, VercelResponse } from '@vercel/node'
import { LibraryError, readVisitorToken } from '../server/library.js'
import { fail, getLibrary, guard, json } from './_library.js'

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
) {
  try {
    guard(request)
    if (request.method !== 'POST')
      throw new LibraryError('API endpoint not found.', 404)
    const token = readVisitorToken(request.headers['x-github-token'])
    if (!token) throw new LibraryError('Send a token to check.', 400)
    json(response, 200, await getLibrary().verifyToken(token))
  } catch (error) {
    fail(response, error)
  }
}

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { LibraryError } from '../server/library.js'
import { fail, getLibrary, guard, json } from './_library.js'

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
) {
  try {
    guard(request)
    if (request.method !== 'GET')
      throw new LibraryError('API endpoint not found.', 404)
    json(response, 200, await getLibrary().status())
  } catch (error) {
    fail(response, error)
  }
}

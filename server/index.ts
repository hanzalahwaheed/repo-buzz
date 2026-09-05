import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { ExplorationDatabase } from './database'
import { SharedLibrary } from './library'
import { createHandler } from './http'

try {
  process.loadEnvFile('.env')
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
}
function positive(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${name} must be a positive number.`)
  return value
}
const db = new ExplorationDatabase(
  process.env.DATABASE_PATH ?? resolve('data/repobuzz.sqlite'),
)
const library = new SharedLibrary(db, {
  token: process.env.GITHUB_TOKEN,
  ttlMs: positive('CACHE_TTL_HOURS', 6) * 60 * 60 * 1000,
  refreshCooldownMs: positive('REFRESH_COOLDOWN_MINUTES', 5) * 60 * 1000,
})
const server = createServer(createHandler(library))
server.listen(positive('PORT', 3001), process.env.HOST ?? '127.0.0.1', () => {
  console.log(
    `repoBuzz shared library listening on port ${positive('PORT', 3001)}. GitHub connection: ${process.env.GITHUB_TOKEN ? 'configured' : 'not configured'}.`,
  )
})
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    server.close(() => {
      db.close()
      process.exit(0)
    })
  })

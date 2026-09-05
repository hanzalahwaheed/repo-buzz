import { spawn } from 'node:child_process'
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const children = ['dev:api', 'dev:web'].map((script) =>
  spawn(npm, ['run', script, '--', ...process.argv.slice(2)], {
    stdio: 'inherit',
    detached: process.platform !== 'win32',
  }),
)
let stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) {
    if (!child.pid) continue
    try {
      if (process.platform === 'win32') child.kill('SIGTERM')
      else process.kill(-child.pid, 'SIGTERM')
    } catch {
      /* The process may already have exited. */
    }
  }
  process.exitCode = code
}
for (const child of children) child.on('exit', (code) => stop(code ?? 0))
process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())

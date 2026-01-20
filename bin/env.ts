import { existsSync, readFileSync } from 'fs'
import { join, resolve } from 'path'

// Auto-load .env from workspace root
// Walks up looking for a directory with both pnpm-workspace.yaml AND .env
// Runs immediately on import - must be imported before any module that reads process.env
let dir = process.cwd()
while (dir !== '/') {
  const envPath = join(dir, '.env')
  if (existsSync(join(dir, 'pnpm-workspace.yaml')) && existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
      const trimmed = line.trim()
      if (trimmed && !trimmed.startsWith('#')) {
        const eqIndex = trimmed.indexOf('=')
        if (eqIndex > 0) {
          const key = trimmed.slice(0, eqIndex)
          const value = trimmed.slice(eqIndex + 1)
          if (!process.env[key]) {
            process.env[key] = value
          }
        }
      }
    }
    break
  }
  dir = resolve(dir, '..')
}

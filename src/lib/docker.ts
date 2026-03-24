import { writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import { DATA_DIR, COMPOSE_PATH } from './paths'

type ComposeOptions = {
  falkorPort?: number
  dataDir?: string
}

export async function writeComposeFile(
  composePath: string = COMPOSE_PATH,
  opts?: ComposeOptions,
): Promise<void> {
  const port = opts?.falkorPort ?? 6379
  const dataDir = opts?.dataDir ?? DATA_DIR

  const content = `services:
  falkordb:
    image: falkordb/falkordb:latest
    ports:
      - '${port}:6379'
    volumes:
      - '${dataDir}:/data'
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 5s
      timeout: 3s
      retries: 5
    restart: unless-stopped
`

  await mkdir(dirname(composePath), { recursive: true })
  await writeFile(composePath, content)
}

export async function startFalkor(composePath: string = COMPOSE_PATH): Promise<void> {
  await run(['docker', 'compose', '-f', composePath, 'up', '-d'])
  await waitHealthy(composePath)
}

export async function stopFalkor(composePath: string = COMPOSE_PATH): Promise<void> {
  await run(['docker', 'compose', '-f', composePath, 'down'])
}

export async function isFalkorRunning(composePath: string = COMPOSE_PATH): Promise<boolean> {
  try {
    const output = await run(['docker', 'compose', '-f', composePath, 'ps', '--format', 'json'])
    if (!output.trim()) return false
    // docker compose ps --format json outputs one JSON object per line
    const lines = output.trim().split('\n')
    return lines.some((line) => {
      try {
        const container = JSON.parse(line)
        return container.State === 'running'
      } catch {
        return false
      }
    })
  } catch {
    return false
  }
}

async function waitHealthy(composePath: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await isFalkorRunning(composePath)) return
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('FalkorDB failed to become healthy within timeout')
}

async function run(cmd: string[]): Promise<string> {
  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' })
  const exitCode = await proc.exited
  const stdout = await new Response(proc.stdout).text()
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`Command failed: ${cmd.join(' ')}\n${stderr}`)
  }
  return stdout
}

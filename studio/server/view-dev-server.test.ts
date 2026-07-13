import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { invalidateClientPackage } from './client-package'
import { ViewDevServerManager } from './view-dev-server'

const roots: string[] = []
const managers: ViewDevServerManager[] = []

function domainFixture(name: string, packageDir = 'client'): string {
  const root = mkdtempSync(join(tmpdir(), `studio-view-server-${name}-`))
  const client = join(root, packageDir)
  roots.push(root)
  mkdirSync(client, { recursive: true })
  writeFileSync(
    join(client, 'package.json'),
    JSON.stringify({ private: true, scripts: { 'dev:hmr': 'bun server.ts' } }),
  )
  writeFileSync(
    join(client, 'server.ts'),
    `const args = process.argv.slice(2)
const port = Number(args[args.indexOf('--port') + 1])
const server = Bun.serve({ hostname: '127.0.0.1', port, fetch: () => new Response(${JSON.stringify(name)}) })
const stop = () => { server.stop(true); process.exit(0) }
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
`,
  )
  if (packageDir !== 'client') {
    writeFileSync(
      join(root, 'astrale.config.ts'),
      `const adapter = {
  name: 'fixture',
  params: () => ({ dir: ${JSON.stringify(packageDir)} }),
  clientPackage: (params: { dir: string }, ctx: { projectDir: string }) => ({ dir: ctx.projectDir + '/' + params.dir }),
}
export default { adapter }
`,
    )
  }
  return root
}

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.shutdown()))
  for (const root of roots.splice(0)) {
    invalidateClientPackage(root)
    rmSync(root, { recursive: true, force: true })
  }
})

describe('view dev server lifecycle', () => {
  test('runs domains lazily on distinct OS-assigned ports, reuses them, and tears them down', async () => {
    const manager = new ViewDevServerManager({
      idleTimeoutMs: 250,
      startTimeoutMs: 5_000,
      failureRetryMs: 50,
    })
    managers.push(manager)
    const alpha = domainFixture('alpha')
    const beta = domainFixture('beta')

    expect(manager.status(alpha)).toBeNull()
    const [alphaServer, sameAlphaServer, betaServer] = await Promise.all([
      manager.ensure(alpha),
      manager.ensure(alpha),
      manager.ensure(beta),
    ])
    expect(alphaServer.status).toBe('running')
    expect(betaServer.status).toBe('running')
    if (alphaServer.status !== 'running' || betaServer.status !== 'running') return
    expect(sameAlphaServer.status === 'running' ? sameAlphaServer.port : null).toBe(
      alphaServer.port,
    )
    expect(alphaServer.port).not.toBe(betaServer.port)
    expect(await fetch(alphaServer.url).then((response) => response.text())).toBe('alpha')
    expect(await fetch(betaServer.url).then((response) => response.text())).toBe('beta')

    const reused = await manager.ensure(alpha)
    expect(reused.status === 'running' ? reused.port : null).toBe(alphaServer.port)

    await Bun.sleep(600)
    expect(manager.status(alpha)).toBeNull()
    expect(manager.status(beta)).toBeNull()

    const restarted = await manager.ensure(alpha)
    expect(restarted.status).toBe('running')
    if (restarted.status === 'running') {
      expect(await fetch(restarted.url).then((response) => response.text())).toBe('alpha')
    }
    await manager.shutdown()
    expect(manager.status(alpha)).toBeNull()
  }, 15_000)

  test('returns a useful unavailable state when the domain has no HMR script', async () => {
    const manager = new ViewDevServerManager({ idleTimeoutMs: 250 })
    managers.push(manager)
    const root = domainFixture('missing-script')
    writeFileSync(join(root, 'client', 'package.json'), JSON.stringify({ scripts: {} }))

    expect(await manager.ensure(root)).toEqual({
      status: 'unavailable',
      reason: 'The domain client does not define a dev:hmr script.',
    })
  })

  test('starts the client package selected by the adapter', async () => {
    const manager = new ViewDevServerManager({ idleTimeoutMs: 250, startTimeoutMs: 5_000 })
    managers.push(manager)
    const root = domainFixture('configured-frontend', 'frontend')

    const server = await manager.ensure(root)

    expect(server.status).toBe('running')
    if (server.status === 'running') {
      expect(await fetch(server.url).then((response) => response.text())).toBe(
        'configured-frontend',
      )
    }
  }, 10_000)
})

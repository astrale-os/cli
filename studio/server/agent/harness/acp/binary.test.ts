import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  agentBinary,
  describeAgentBinary,
  ensureAgentBinary,
  installAgentArtifact,
  isAgentBinaryInstalled,
  pruneAgentBinaries,
  versionWarning,
  type AgentBinary,
  type PinnedArtifact,
} from './binary'
import { PINNED_AGENT_BINARIES } from './pinned-binaries'

const roots: string[] = []
function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

const environment = {
  claude: process.env.DOMAIN_STUDIO_CLAUDE_BIN,
  codex: process.env.DOMAIN_STUDIO_CODEX_BIN,
}
afterEach(() => {
  for (const [variable, value] of [
    ['DOMAIN_STUDIO_CLAUDE_BIN', environment.claude],
    ['DOMAIN_STUDIO_CODEX_BIN', environment.codex],
  ] as const) {
    if (value === undefined) delete process.env[variable]
    else process.env[variable] = value
  }
})

/** A published-package lookalike: `package/bin/agent` printing its version. */
function packTarball(version = '9.9.9'): { bytes: Buffer; integrity: string } {
  const root = temporaryRoot('studio-agent-pack-')
  mkdirSync(join(root, 'package', 'bin'), { recursive: true })
  writeFileSync(join(root, 'package', 'bin', 'agent'), `#!/bin/sh\necho "agent ${version}"\n`)
  chmodSync(join(root, 'package', 'bin', 'agent'), 0o644)
  const archive = join(root, 'agent.tgz')
  execFileSync('tar', ['-czf', archive, '-C', root, 'package'])
  const bytes = readFileSync(archive)
  return { bytes, integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` }
}

const requests: string[] = []
const served = new Map<string, Buffer>()
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname
    requests.push(path)
    const body = served.get(path)
    // slow enough that concurrent installers overlap
    await Bun.sleep(50)
    return body
      ? new Response(new Uint8Array(body), { headers: { 'content-length': String(body.length) } })
      : new Response('missing', { status: 404 })
  },
})
afterAll(() => {
  server.stop(true)
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

function serve(path: string, bytes: Buffer): string {
  served.set(path, bytes)
  return `http://127.0.0.1:${server.port}${path}`
}

/** A pinned artifact served at `path`, whose bytes are `version`'s tarball. */
function artifactAt(path: string, version = '9.9.9', integrity?: string): PinnedArtifact {
  const packed = packTarball(version)
  return {
    tarball: serve(path, packed.bytes),
    integrity: integrity ?? packed.integrity,
    entry: 'package/bin/agent',
  }
}

function managedBinary(root: string, artifact: PinnedArtifact, version = '9.9.9'): AgentBinary {
  const directory = join(root, 'codex', version, 'linux-x64')
  return {
    provider: 'codex',
    label: 'Codex',
    path: join(directory, ...artifact.entry.split('/')),
    source: 'managed',
    pinnedVersion: version,
    artifact,
    directory,
    reason: 'pinned by Studio',
  }
}

describe('agent binary resolution', () => {
  test('runs the pinned build from the cache by default', () => {
    delete process.env.DOMAIN_STUDIO_CLAUDE_BIN
    delete process.env.DOMAIN_STUDIO_CODEX_BIN
    const claude = agentBinary('claude', undefined, ['darwin-arm64'], '/cache/agents')
    expect(claude).toMatchObject({
      source: 'managed',
      pinnedVersion: PINNED_AGENT_BINARIES.claude.version,
      path: `/cache/agents/claude/${PINNED_AGENT_BINARIES.claude.version}/darwin-arm64/package/claude`,
    })
    // Codex publishes no musl variant: its Linux build is static.
    const codex = agentBinary('codex', undefined, ['linux-x64-musl', 'linux-x64'], '/cache')
    expect(codex.source).toBe('managed')
    expect(codex.path).toContain('/linux-x64/package/vendor/x86_64-unknown-linux-musl/bin/codex')
  })

  test('an explicit path, the environment or an unshipped platform runs a local executable', () => {
    process.env.DOMAIN_STUDIO_CODEX_BIN = '/usr/local/bin/codex'
    expect(agentBinary('codex', undefined, ['linux-x64'])).toMatchObject({
      source: 'custom',
      path: '/usr/local/bin/codex',
      reason: 'set by DOMAIN_STUDIO_CODEX_BIN',
    })
    expect(agentBinary('codex', '/opt/codex', ['linux-x64'])).toMatchObject({
      source: 'custom',
      path: '/opt/codex',
    })
    delete process.env.DOMAIN_STUDIO_CLAUDE_BIN
    expect(agentBinary('claude', undefined, ['freebsd-x64'])).toMatchObject({
      source: 'custom',
      path: 'claude',
      reason: 'Studio ships no Claude Code build for freebsd-x64',
    })
  })

  test('reports a local executable by the version it prints, and warns when it strays', async () => {
    // Claude may run newer than the pin; Codex must match its minor
    expect(versionWarning('claude', '2.1.300', '2.1.232')).toBeUndefined()
    expect(versionWarning('codex', '0.148.9', '0.148.0')).toBeUndefined()
    expect(versionWarning('codex', '0.159.3', '0.148.0')).toContain('differs from 0.148.0')
    const root = temporaryRoot('studio-agent-local-')
    const script = join(root, 'claude')
    writeFileSync(script, '#!/bin/sh\necho "1.0.0 (Claude Code)"\n')
    chmodSync(script, 0o755)
    expect(await describeAgentBinary(agentBinary('claude', script))).toEqual({
      source: 'custom',
      installed: true,
      reason: 'set by the harness',
      version: '1.0.0',
      warning: `Claude Code 1.0.0 is older than ${PINNED_AGENT_BINARIES.claude.version}, the version Studio is built for.`,
    })
  })
})

describe('agent binary installation', () => {
  test('downloads, verifies and unpacks the pinned tarball', async () => {
    const binary = managedBinary(temporaryRoot('studio-agent-install-'), artifactAt('/ok.tgz'))
    const progress: string[] = []

    expect(await isAgentBinaryInstalled(binary)).toBe(false)
    await ensureAgentBinary(binary, { onProgress: (text) => progress.push(text) })

    expect(await isAgentBinaryInstalled(binary)).toBe(true)
    expect(execFileSync(binary.path, { encoding: 'utf8' }).trim()).toBe('agent 9.9.9')
    expect(statSync(binary.path).mode & 0o111).not.toBe(0)
    expect(existsSync(join(binary.directory!, 'package.tgz'))).toBe(false)
    expect(progress.at(-1)).toBe('Codex 9.9.9 installed')
    // this process now holds it, so no other Studio prunes it from under a turn
    expect(existsSync(join(binary.directory!, '.leases', String(process.pid)))).toBe(true)
  })

  test('concurrent callers share one download, and a canceled one only stops waiting', async () => {
    const binary = managedBinary(temporaryRoot('studio-agent-shared-'), artifactAt('/shared.tgz'))
    const before = requests.filter((path) => path === '/shared.tgz').length
    const controller = new AbortController()

    const waiting = ensureAgentBinary(binary, { signal: controller.signal })
    const others = Promise.all([ensureAgentBinary(binary), ensureAgentBinary(binary)])
    controller.abort()
    await expect(waiting).rejects.toThrow('canceled')
    await others
    await ensureAgentBinary(binary)

    expect(await isAgentBinaryInstalled(binary)).toBe(true)
    expect(requests.filter((path) => path === '/shared.tgz').length - before).toBe(1)
  })

  test('refuses a tarball that does not match the lockfile integrity', async () => {
    const artifact = artifactAt('/tampered.tgz', '6.6.6', packTarball('1.0.0').integrity)
    const binary = managedBinary(temporaryRoot('studio-agent-tampered-'), artifact)

    await expect(ensureAgentBinary(binary)).rejects.toThrow(
      /could not install Codex 9\.9\.9: integrity mismatch.*DOMAIN_STUDIO_CODEX_BIN/,
    )
    expect(existsSync(binary.directory!)).toBe(false)
  })

  test('drops every other build no live process holds as soon as a new one lands', async () => {
    const root = temporaryRoot('studio-agent-prune-')
    const sleeper = spawn('sleep', ['30'])
    const dead = spawnSync('true').pid
    const build = (version: string, holders: number[]) => {
      const directory = join(root, 'codex', version, 'linux-x64')
      mkdirSync(join(directory, '.leases'), { recursive: true })
      writeFileSync(join(directory, '.complete'), 'sha512-old\n')
      for (const pid of holders) writeFileSync(join(directory, '.leases', String(pid)), '')
      return directory
    }
    try {
      const unheld = build('0.1.0', [])
      const heldByTheDead = build('0.2.0', [dead])
      const heldByALiveStudio = build('0.3.0', [sleeper.pid!])
      const abandonedStaging = join(root, 'codex', '0.6.0', `linux-x64.staging-${dead}-x`)
      mkdirSync(abandonedStaging, { recursive: true })

      await installAgentArtifact(
        artifactAt('/prune.tgz'),
        join(root, 'codex', '9.9.9', 'linux-x64'),
        {
          label: 'Codex 9.9.9',
        },
      )

      expect(existsSync(unheld)).toBe(false)
      expect(existsSync(heldByTheDead)).toBe(false)
      expect(existsSync(abandonedStaging)).toBe(false)
      // emptied version directories go with their last build
      expect(existsSync(join(root, 'codex', '0.1.0'))).toBe(false)
      expect(existsSync(join(root, 'codex', '0.6.0'))).toBe(false)
      expect(existsSync(heldByALiveStudio)).toBe(true)
      expect(existsSync(join(root, 'codex', '9.9.9', 'linux-x64', '.complete'))).toBe(true)
    } finally {
      sleeper.kill()
    }
  })

  test('a process releases its lease when it exits', async () => {
    const root = temporaryRoot('studio-agent-release-')
    const artifact = artifactAt('/release.tgz')
    const directory = join(root, 'codex', '9.9.9', 'linux-x64')
    const script = `
      const { installAgentArtifact } = await import(${JSON.stringify(join(import.meta.dir, 'binary.ts'))})
      await installAgentArtifact(${JSON.stringify(artifact)}, ${JSON.stringify(directory)}, { label: 'Codex' })
      console.log(process.pid)
    `
    const child = Bun.spawn([process.execPath, '-e', script], { stdout: 'pipe' })
    const pid = (await new Response(child.stdout).text()).trim()
    expect(await child.exited).toBe(0)

    expect(pid).toMatch(/^\d+$/)
    expect(existsSync(join(directory, '.leases'))).toBe(true)
    expect(existsSync(join(directory, '.leases', pid))).toBe(false)
  })

  test('a starting Studio keeps its own pinned build even before anything holds it', async () => {
    const root = temporaryRoot('studio-agent-startup-prune-')
    const pinned = PINNED_AGENT_BINARIES.claude.version
    for (const version of [pinned, '0.0.1']) {
      const directory = join(root, 'claude', version, 'darwin-arm64')
      mkdirSync(join(directory, '.leases'), { recursive: true })
      writeFileSync(join(directory, '.complete'), 'sha512-x\n')
    }

    await pruneAgentBinaries('claude', root, ['darwin-arm64'])

    expect(existsSync(join(root, 'claude', pinned, 'darwin-arm64'))).toBe(true)
    expect(existsSync(join(root, 'claude', '0.0.1'))).toBe(false)
  })
})

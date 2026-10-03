import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
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
  platformKeys,
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
  test('prefers the musl build on musl Linux and falls back to the glibc one', () => {
    expect(platformKeys('linux', 'x64', true)).toEqual(['linux-x64-musl', 'linux-x64'])
    expect(platformKeys('linux', 'arm64', false)).toEqual(['linux-arm64'])
    expect(platformKeys('darwin', 'arm64', false)).toEqual(['darwin-arm64'])
  })

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

  test('an explicit path or the environment opts back into a local executable', () => {
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
  })

  test('a platform Studio ships no build for runs the CLI on PATH', () => {
    delete process.env.DOMAIN_STUDIO_CLAUDE_BIN
    expect(agentBinary('claude', undefined, ['freebsd-x64'])).toMatchObject({
      source: 'custom',
      path: 'claude',
      reason: 'Studio ships no Claude Code build for freebsd-x64',
    })
  })

  test('warns when a local executable strays from the pinned build', () => {
    expect(versionWarning('claude', '2.1.300', '2.1.232')).toBeUndefined()
    expect(versionWarning('claude', '2.1.232', '2.1.232')).toBeUndefined()
    expect(versionWarning('claude', '2.1.100', '2.1.232')).toContain('older than 2.1.232')
    expect(versionWarning('codex', '0.148.9', '0.148.0')).toBeUndefined()
    expect(versionWarning('codex', '0.159.3', '0.148.0')).toContain('differs from 0.148.0')
    expect(versionWarning('codex', undefined, '0.148.0')).toContain('Could not read its version')
  })

  test('reports a local executable by the version it prints', async () => {
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
    const root = temporaryRoot('studio-agent-install-')
    const { bytes, integrity } = packTarball()
    const artifact = { tarball: serve('/ok.tgz', bytes), integrity, entry: 'package/bin/agent' }
    const binary = managedBinary(root, artifact)
    const progress: string[] = []

    expect(await isAgentBinaryInstalled(binary)).toBe(false)
    await ensureAgentBinary(binary, { onProgress: (text) => progress.push(text) })

    expect(await isAgentBinaryInstalled(binary)).toBe(true)
    expect(execFileSync(binary.path, { encoding: 'utf8' }).trim()).toBe('agent 9.9.9')
    expect(statSync(binary.path).mode & 0o111).not.toBe(0)
    expect(existsSync(join(binary.directory!, 'package.tgz'))).toBe(false)
    expect(progress[0]).toMatch(/^Installing Codex 9\.9\.9/)
    expect(progress.at(-1)).toBe('Codex 9.9.9 installed')
  })

  test('concurrent callers share one download', async () => {
    const root = temporaryRoot('studio-agent-shared-')
    const { bytes, integrity } = packTarball()
    const artifact = { tarball: serve('/shared.tgz', bytes), integrity, entry: 'package/bin/agent' }
    const binary = managedBinary(root, artifact)
    const before = requests.filter((path) => path === '/shared.tgz').length

    await Promise.all([ensureAgentBinary(binary), ensureAgentBinary(binary)])
    await ensureAgentBinary(binary)

    expect(requests.filter((path) => path === '/shared.tgz').length - before).toBe(1)
  })

  test('refuses a tarball that does not match the lockfile integrity', async () => {
    const root = temporaryRoot('studio-agent-tampered-')
    const { integrity } = packTarball('1.0.0')
    const { bytes } = packTarball('6.6.6')
    const artifact = {
      tarball: serve('/tampered.tgz', bytes),
      integrity,
      entry: 'package/bin/agent',
    }
    const binary = managedBinary(root, artifact)

    await expect(ensureAgentBinary(binary)).rejects.toThrow(
      /could not install Codex 9\.9\.9: integrity mismatch.*DOMAIN_STUDIO_CODEX_BIN/,
    )
    expect(existsSync(binary.directory!)).toBe(false)
    expect(await isAgentBinaryInstalled(binary)).toBe(false)
  })

  test('reports an unreachable package', async () => {
    const root = temporaryRoot('studio-agent-missing-')
    const artifact = {
      tarball: `http://127.0.0.1:${server.port}/missing.tgz`,
      integrity: 'sha512-AAAA',
      entry: 'package/bin/agent',
    }
    await expect(ensureAgentBinary(managedBinary(root, artifact))).rejects.toThrow(/HTTP 404/)
  })

  test('a canceled caller stops waiting without failing the install', async () => {
    const root = temporaryRoot('studio-agent-cancel-')
    const { bytes, integrity } = packTarball()
    const artifact = { tarball: serve('/cancel.tgz', bytes), integrity, entry: 'package/bin/agent' }
    const binary = managedBinary(root, artifact)
    const controller = new AbortController()

    const waiting = ensureAgentBinary(binary, { signal: controller.signal })
    const other = ensureAgentBinary(binary)
    controller.abort()

    await expect(waiting).rejects.toThrow('canceled')
    await other
    expect(await isAgentBinaryInstalled(binary)).toBe(true)
  })

  test('drops versions no Studio has used for two weeks', async () => {
    const root = temporaryRoot('studio-agent-prune-')
    const stale = join(root, 'codex', '0.1.0', 'linux-x64')
    const recent = join(root, 'codex', '0.2.0', 'linux-x64')
    for (const directory of [stale, recent]) {
      mkdirSync(directory, { recursive: true })
      writeFileSync(join(directory, '.complete'), 'sha512-old\n')
    }
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60_000)
    utimesSync(join(stale, '.complete'), monthAgo, monthAgo)

    const { bytes, integrity } = packTarball()
    const artifact = { tarball: serve('/prune.tgz', bytes), integrity, entry: 'package/bin/agent' }
    await installAgentArtifact(artifact, join(root, 'codex', '9.9.9', 'linux-x64'), {
      label: 'Codex 9.9.9',
    })

    expect(existsSync(join(root, 'codex', '0.1.0'))).toBe(false)
    expect(existsSync(recent)).toBe(true)
    expect(existsSync(join(root, 'codex', '9.9.9', 'linux-x64', '.complete'))).toBe(true)
  })
})

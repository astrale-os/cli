#!/usr/bin/env bun
/**
 * Pin the Claude Code and Codex executables Studio runs to the exact builds its
 * bundled ACP adapters were written against.
 *
 * The adapters are dependencies, so pnpm-lock.yaml already names the agent
 * package each one resolved and, for every platform, the published tarball and
 * its integrity. This script copies that answer into
 * `studio/server/agent/harness/acp/pinned-binaries.ts`, which Studio uses to
 * download and verify the executable on first use. Bumping an adapter therefore
 * bumps the agent with it: `--check` (run by `pnpm test`) fails until this is
 * re-run.
 */
import { randomUUID } from 'node:crypto'
import { readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const OUTPUT = join(ROOT, 'studio', 'server', 'agent', 'harness', 'acp', 'pinned-binaries.ts')

const CLAUDE_ADAPTER = '@agentclientprotocol/claude-agent-acp'
const CLAUDE_SDK = '@anthropic-ai/claude-agent-sdk'
const CODEX_ADAPTER = '@agentclientprotocol/codex-acp'
const CODEX = '@openai/codex'

/** Codex publishes one Rust target per platform package; its launcher maps them so. */
const CODEX_TARGETS: Record<string, string> = {
  'linux-x64': 'x86_64-unknown-linux-musl',
  'linux-arm64': 'aarch64-unknown-linux-musl',
  'darwin-x64': 'x86_64-apple-darwin',
  'darwin-arm64': 'aarch64-apple-darwin',
  'win32-x64': 'x86_64-pc-windows-msvc',
  'win32-arm64': 'aarch64-pc-windows-msvc',
}

interface LockPackage {
  resolution?: { integrity?: string; tarball?: string }
}

interface LockSnapshot {
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

interface Lockfile {
  importers?: Record<string, unknown>
  packages: Record<string, LockPackage>
  snapshots: Record<string, LockSnapshot>
}

interface PinnedArtifact {
  tarball: string
  integrity: string
  /** the executable's path inside the extracted tarball */
  entry: string
}

/** `0.3.232(@anthropic-ai/sdk@…)` → `0.3.232`: pnpm suffixes resolved peers. */
function bareVersion(reference: string): string {
  return reference.replace(/\(.*$/, '')
}

function snapshot(lock: Lockfile, name: string, version: string): LockSnapshot {
  const key = Object.keys(lock.snapshots).find(
    (candidate) =>
      candidate === `${name}@${version}` || candidate.startsWith(`${name}@${version}(`),
  )
  if (!key) throw new Error(`pnpm-lock.yaml has no snapshot for ${name}@${version}`)
  return lock.snapshots[key]
}

function dependencyVersion(lock: Lockfile, name: string, version: string, dependency: string) {
  const reference = snapshot(lock, name, version).dependencies?.[dependency]
  if (!reference) throw new Error(`${name}@${version} does not depend on ${dependency}`)
  return bareVersion(reference)
}

function artifact(lock: Lockfile, id: string, entry: string): PinnedArtifact {
  const resolution = lock.packages[id]?.resolution
  if (!resolution?.integrity || !resolution.tarball)
    throw new Error(`pnpm-lock.yaml has no tarball and integrity for ${id}`)
  return { tarball: resolution.tarball, integrity: resolution.integrity, entry }
}

async function studioDependency(name: string): Promise<string> {
  const manifest = JSON.parse(await readFile(join(ROOT, 'studio', 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
  }
  const version = manifest.dependencies?.[name]
  if (!version || !/^\d+\.\d+\.\d+$/.test(version))
    throw new Error(`studio/package.json must pin ${name} to an exact version`)
  return version
}

/** The Claude Code release the SDK drives, which only the installed SDK records. */
async function claudeCodeVersion(sdkVersion: string): Promise<string> {
  const adapter = await realpath(join(ROOT, 'studio', 'node_modules', CLAUDE_ADAPTER))
  const manifest = JSON.parse(
    await readFile(join(adapter, '..', '..', CLAUDE_SDK, 'package.json'), 'utf8'),
  ) as { version?: string; claudeCodeVersion?: string }
  if (manifest.version !== sdkVersion || !manifest.claudeCodeVersion)
    throw new Error(`installed ${CLAUDE_SDK} is not ${sdkVersion}; run pnpm install`)
  return manifest.claudeCodeVersion
}

// pnpm 10 prefixes the lockfile with a document of its own for config dependencies.
const documents = [Bun.YAML.parse(await readFile(join(ROOT, 'pnpm-lock.yaml'), 'utf8'))].flat()
const lock = (documents as Lockfile[]).find((document) => document?.importers?.studio)
if (!lock) throw new Error('pnpm-lock.yaml has no importer for studio')

const claudeAdapter = await studioDependency(CLAUDE_ADAPTER)
const sdkVersion = dependencyVersion(lock, CLAUDE_ADAPTER, claudeAdapter, CLAUDE_SDK)
const claudePlatforms: Record<string, PinnedArtifact> = {}
for (const [name, reference] of Object.entries(
  snapshot(lock, CLAUDE_SDK, sdkVersion).optionalDependencies ?? {},
)) {
  const platform = name.slice(`${CLAUDE_SDK}-`.length)
  if (!name.startsWith(`${CLAUDE_SDK}-`) || !platform) continue
  const executable = platform.startsWith('win32-') ? 'claude.exe' : 'claude'
  claudePlatforms[platform] = artifact(
    lock,
    `${name}@${bareVersion(reference)}`,
    `package/${executable}`,
  )
}

const codexAdapter = await studioDependency(CODEX_ADAPTER)
const codexVersion = dependencyVersion(lock, CODEX_ADAPTER, codexAdapter, CODEX)
const codexPlatforms: Record<string, PinnedArtifact> = {}
for (const [alias, reference] of Object.entries(
  snapshot(lock, CODEX, codexVersion).optionalDependencies ?? {},
)) {
  const platform = alias.slice(`${CODEX}-`.length)
  const target = CODEX_TARGETS[platform]
  if (!target) continue
  const executable = platform.startsWith('win32-') ? 'codex.exe' : 'codex'
  codexPlatforms[platform] = artifact(lock, reference, `package/vendor/${target}/bin/${executable}`)
}

if (!Object.keys(claudePlatforms).length || !Object.keys(codexPlatforms).length)
  throw new Error('pnpm-lock.yaml lists no platform package for one of the agents')

const sorted = (record: Record<string, PinnedArtifact>) =>
  Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)))

const pinned = {
  claude: {
    label: 'Claude Code',
    version: await claudeCodeVersion(sdkVersion),
    source: `${CLAUDE_SDK}@${sdkVersion}`,
    platforms: sorted(claudePlatforms),
  },
  codex: {
    label: 'Codex',
    version: codexVersion,
    source: `${CODEX}@${codexVersion}`,
    platforms: sorted(codexPlatforms),
  },
}

const unformatted =
  `// Generated by scripts/pin-agent-binaries.ts from pnpm-lock.yaml. Do not edit.\n` +
  `export const PINNED_AGENT_BINARIES = ${JSON.stringify(pinned, null, 2)} as const\n`

const formatter = join(ROOT, 'node_modules', '.bin', 'oxfmt')
const temporary = `${OUTPUT}.${process.pid}.${randomUUID()}.ts`
try {
  await writeFile(temporary, unformatted)
  const formatted = Bun.spawnSync([formatter, '--write', temporary], {
    stdout: 'ignore',
    stderr: 'pipe',
  })
  if (formatted.exitCode !== 0)
    throw new Error(`could not format pinned binaries: ${formatted.stderr.toString().trim()}`)

  const source = await readFile(temporary, 'utf8')
  if (process.argv.includes('--check')) {
    const current = await readFile(OUTPUT, 'utf8').catch(() => '')
    if (current !== source) {
      console.error('pinned agent binaries are stale — run: pnpm run agents:pin')
      process.exitCode = 1
    }
  } else {
    await rename(temporary, OUTPUT)
    console.log(
      `pinned Claude Code ${pinned.claude.version} and Codex ${pinned.codex.version} ` +
        `(${Object.keys(claudePlatforms).length} + ${Object.keys(codexPlatforms).length} platforms)`,
    )
  }
} finally {
  await rm(temporary, { force: true }).catch(() => undefined)
}

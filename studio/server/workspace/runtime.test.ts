import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import pkg from '../../../package.json'
import { STUDIO_CLI_DESCRIPTOR_ENV } from '../cli'
import { initWorkspaceState, workspaceRoot } from '../workspace-state'
import { getStudioRuntime, initStudioRuntime } from './runtime'

const before = {
  descriptor: process.env[STUDIO_CLI_DESCRIPTOR_ENV],
  dev: process.env.DOMAIN_STUDIO_DEV,
  harness: process.env.DOMAIN_STUDIO_HARNESS,
  telemetry: process.env.ASTRALE_TELEMETRY_NO_TRIGGER,
  workspace: workspaceRoot(),
}
const roots: string[] = []

afterEach(() => {
  for (const [key, value] of Object.entries({
    [STUDIO_CLI_DESCRIPTOR_ENV]: before.descriptor,
    DOMAIN_STUDIO_DEV: before.dev,
    DOMAIN_STUDIO_HARNESS: before.harness,
    ASTRALE_TELEMETRY_NO_TRIGGER: before.telemetry,
  })) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  initWorkspaceState(before.workspace)
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

function launchPath(): string {
  const root = mkdtempSync(join(tmpdir(), 'studio-running-version-'))
  roots.push(root)
  const entry = join(root, 'cli.ts')
  initWorkspaceState(root)
  initStudioRuntime(join(root, 'astrale.config.ts'), 4399)
  process.env[STUDIO_CLI_DESCRIPTOR_ENV] = JSON.stringify({
    version: 1,
    executable: process.execPath,
    args: [entry],
  })
  delete process.env.DOMAIN_STUDIO_DEV
  delete process.env.DOMAIN_STUDIO_HARNESS
  return entry
}

function replaceCli(entry: string, version: string, exitCode = 0): void {
  writeFileSync(
    `${entry}.next`,
    `if (JSON.stringify(process.argv.slice(2)) !== '["--version"]') process.exit(91);\nif (process.env.ASTRALE_TELEMETRY_NO_TRIGGER !== '1') process.exit(92);\nconsole.log(${JSON.stringify(version)}); process.exit(${exitCode})\n`,
  )
  renameSync(`${entry}.next`, entry)
}

test('atomic CLI replacement changes the installed version, never the running Studio version', async () => {
  const entry = launchPath()
  replaceCli(entry, pkg.version)
  const first = await getStudioRuntime()
  expect(first.runningVersion).toBe(pkg.version)
  expect(first.installedVersion).toBe(pkg.version)

  replaceCli(entry, '99.0.0-beta.1')
  const next = await getStudioRuntime()
  expect(next.runningVersion).toBe(first.runningVersion)
  expect(next.installedVersion).toBe('99.0.0-beta.1')
  expect(next.restartCommand).toEqual([
    process.execPath,
    entry,
    'studio',
    join(workspaceRoot(), 'astrale.config.ts'),
    '--port',
    '4399',
  ])
})

test('version metadata probes suppress telemetry triggers only in their child process', async () => {
  const entry = launchPath()
  replaceCli(entry, pkg.version)
  process.env.ASTRALE_TELEMETRY_NO_TRIGGER = '0'
  expect((await getStudioRuntime()).installedVersion).toBe(pkg.version)
  expect(process.env.ASTRALE_TELEMETRY_NO_TRIGGER).toBe('0')
})

test('the restart command keeps the exact launcher and Studio mode', async () => {
  const entry = launchPath()
  replaceCli(entry, pkg.version)
  process.env.DOMAIN_STUDIO_DEV = '1'
  process.env.DOMAIN_STUDIO_HARNESS = 'codex'
  expect((await getStudioRuntime()).restartCommand).toEqual([
    process.execPath,
    entry,
    'studio',
    join(workspaceRoot(), 'astrale.config.ts'),
    '--port',
    '4399',
    '--dev',
    '--harness',
    'codex',
  ])
})

test('an unreadable or malformed installation cannot claim that Studio is current', async () => {
  const entry = launchPath()
  for (const [text, code] of [
    ['99.0.0', 1],
    ['not a version', 0],
    ['', 0],
  ] as const) {
    replaceCli(entry, text, code)
    await expect(getStudioRuntime()).rejects.toThrow()
  }
})

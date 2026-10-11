import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import pkg from '../../../package.json' with { type: 'json' }

async function update(cwd: string, ...args: string[]) {
  const proc = Bun.spawn(
    [process.execPath, join(import.meta.dir, '../../../bin/astrale.ts'), ...args],
    {
      cwd,
      env: { ...process.env, NO_COLOR: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { stdout, stderr, exitCode }
}

test('a source runtime warns that it cannot replace itself, continues, and leaves the project untouched', async () => {
  const project = mkdtempSync(join(tmpdir(), 'astrale-update-project-'))
  const config = "import { deploy } from '@astrale-os/sdk/deployment'\nexport default deploy({})\n"
  try {
    writeFileSync(join(project, 'package.json'), JSON.stringify({ dependencies: {} }))
    writeFileSync(join(project, 'astrale.config.ts'), config)
    const { stdout, stderr, exitCode } = await update(
      project,
      'update',
      '--yes',
      '--no-skills',
      '--no-deps',
    )

    expect(exitCode, `${stdout}\n${stderr}`).toBe(0)
    expect(stderr).toContain('UPDATE_PACKAGE_MANAGED')
    expect(stdout).toContain('Astrale skills skipped')
    expect(readFileSync(join(project, 'astrale.config.ts'), 'utf8')).toBe(config)
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

test('update --check --json prints one staleness report and exits 0 when nothing is stale', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'astrale-update-check-'))
  try {
    const { stdout, stderr, exitCode } = await update(
      directory,
      'update',
      '--check',
      '--json',
      '--no-skills',
    )

    expect(exitCode, stderr).toBe(0)
    expect(JSON.parse(stdout)).toEqual({
      stale: false,
      cli: { stale: false, managed: true, current: pkg.version },
      skills: { status: 'skipped' },
      sdk: { stale: false, inProject: false, outdated: [] },
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

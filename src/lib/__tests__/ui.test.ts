import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { WorkspaceNotFoundError } from '../../errors'
import { workspaceRoot } from '../ui'

describe('workspaceRoot', () => {
  let tmp: string
  let originalCwd: string
  const originalOverride = process.env.ASTRALE_WORKSPACE

  beforeEach(() => {
    // realpath: on macOS /var → /private/var, and process.cwd() returns the
    // realpath form. Compare on the same axis.
    tmp = realpathSync(mkdtempSync(join(tmpdir(), 'astrale-ws-')))
    originalCwd = process.cwd()
    delete process.env.ASTRALE_WORKSPACE
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(tmp, { recursive: true, force: true })
    if (originalOverride === undefined) delete process.env.ASTRALE_WORKSPACE
    else process.env.ASTRALE_WORKSPACE = originalOverride
  })

  test('walks up from cwd until pnpm-workspace.yaml is found', () => {
    writeFileSync(join(tmp, 'pnpm-workspace.yaml'), 'packages: []\n')
    const nested = join(tmp, 'a', 'b', 'c')
    mkdirSync(nested, { recursive: true })
    process.chdir(nested)
    expect(workspaceRoot()).toBe(tmp)
  })

  test('returns cwd itself when pnpm-workspace.yaml lives there', () => {
    writeFileSync(join(tmp, 'pnpm-workspace.yaml'), 'packages: []\n')
    process.chdir(tmp)
    expect(workspaceRoot()).toBe(tmp)
  })

  test('honors ASTRALE_WORKSPACE override (absolute, valid)', () => {
    writeFileSync(join(tmp, 'pnpm-workspace.yaml'), 'packages: []\n')
    process.env.ASTRALE_WORKSPACE = tmp
    // cwd is irrelevant under override — point it elsewhere to prove it.
    process.chdir(tmpdir())
    expect(workspaceRoot()).toBe(tmp)
  })

  test('rejects relative ASTRALE_WORKSPACE', () => {
    process.env.ASTRALE_WORKSPACE = 'relative/path'
    expect(() => workspaceRoot()).toThrow(WorkspaceNotFoundError)
  })

  test('rejects ASTRALE_WORKSPACE pointing at a non-workspace dir', () => {
    process.env.ASTRALE_WORKSPACE = tmp // tmp has no pnpm-workspace.yaml
    expect(() => workspaceRoot()).toThrow(WorkspaceNotFoundError)
  })

  test('throws when no workspace is found above cwd', () => {
    process.chdir(tmp)
    expect(() => workspaceRoot()).toThrow(WorkspaceNotFoundError)
  })
})

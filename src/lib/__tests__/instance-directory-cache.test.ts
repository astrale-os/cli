import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { InstanceDirectory } from '../admin/directory'

import { AstraleError } from '../../errors'
import {
  DIRECTORY_FRESH_MS,
  DIRECTORY_STALE_MAX_MS,
  forgetInstanceDirectory,
  readCachedInstanceDirectory,
  type CachedDirectoryDependencies,
} from '../admin/directory-cache'

const TOKEN = 'header.payload.signature-never-stored'
const PACE = {
  organizationId: 'org_01PACE',
  name: 'Pace Logistique',
  url: 'https://pace.eu.astrale.ai',
  slug: 'pace',
  region: 'eu',
}
const LISTING: InstanceDirectory = { instances: [PACE], truncated: false }
const IDENTITY = { name: 'person-example.com', subject: 'user_01PERSON' }
const T0 = Date.parse('2026-11-06T12:00:00Z')

// A temporary state directory: the user's own `~/.astrale` is never read or written.
let home: string
const cachePath = (name: string) => join(home, 'cache', 'instance-directory', `${name}.json`)
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'astrale-directory-cache-'))
})
afterEach(() => rmSync(home, { recursive: true, force: true }))

function deps(
  read: () => Promise<InstanceDirectory>,
  now: number,
  identity: { name: string; subject: string } | null = IDENTITY,
): CachedDirectoryDependencies & { calls: () => number } {
  let calls = 0
  return {
    identity: async () => identity ?? undefined,
    read: async () => (calls++, read()),
    token: async () => TOKEN,
    now: () => now,
    cachePath,
    calls: () => calls,
  }
}

const failing = (code: string) => async (): Promise<never> => {
  throw new AstraleError(code, `failure ${code}`)
}

describe('instance directory cache', () => {
  test('keeps the listing private and without any token, and serves it fresh without a request', async () => {
    expect(
      await readCachedInstanceDirectory(
        {},
        'refresh',
        deps(async () => LISTING, T0),
      ),
    ).toEqual({ directory: LISTING })
    const file = cachePath(IDENTITY.name)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    const stored = readFileSync(file, 'utf8')
    expect(stored).not.toContain(TOKEN)
    expect(JSON.parse(stored)).toMatchObject({ subject: IDENTITY.subject, instances: [PACE] })

    const recent = deps(failing('DIRECTORY_UNAVAILABLE'), T0 + DIRECTORY_FRESH_MS - 1)
    expect(await readCachedInstanceDirectory({}, 'prefer-fresh', recent)).toEqual({
      directory: LISTING,
      cached: true,
    })
    expect(recent.calls()).toBe(0)
    // Past five minutes a lookup asks the directory again.
    const old = deps(async () => LISTING, T0 + DIRECTORY_FRESH_MS + 1)
    await readCachedInstanceDirectory({}, 'prefer-fresh', old)
    expect(old.calls()).toBe(1)
  })

  test.each(['DIRECTORY_UNAVAILABLE', 'DIRECTORY_RATE_LIMITED'])(
    'stands in for the directory on %s',
    async (code) => {
      await readCachedInstanceDirectory(
        {},
        'refresh',
        deps(async () => LISTING, T0),
      )
      const read = await readCachedInstanceDirectory(
        {},
        'refresh',
        deps(failing(code), T0 + 60 * 60_000),
      )
      expect(read.directory).toEqual(LISTING)
      expect(read.stale).toMatchObject({ code, listedAt: '2026-11-06T12:00:00.000Z' })
    },
  )

  test('never stands in for a refused or ended sign-in, nor past seven days', async () => {
    await readCachedInstanceDirectory(
      {},
      'refresh',
      deps(async () => LISTING, T0),
    )
    for (const code of [
      'DIRECTORY_IDENTITY_REJECTED',
      'DIRECTORY_SIGN_IN_REQUIRED',
      'DIRECTORY_IDENTITY_UNSUPPORTED',
    ]) {
      await expect(
        readCachedInstanceDirectory({}, 'refresh', deps(failing(code), T0 + 1)),
      ).rejects.toMatchObject({ code })
    }
    await expect(
      readCachedInstanceDirectory(
        {},
        'refresh',
        deps(failing('DIRECTORY_UNAVAILABLE'), T0 + DIRECTORY_STALE_MAX_MS + 1),
      ),
    ).rejects.toMatchObject({ code: 'DIRECTORY_UNAVAILABLE' })
  })

  test("ignores another account's listing under the same identity name", async () => {
    await readCachedInstanceDirectory(
      {},
      'refresh',
      deps(async () => LISTING, T0),
    )
    const other = { ...IDENTITY, subject: 'user_02OTHER' }
    await expect(
      readCachedInstanceDirectory({}, 'refresh', deps(failing('DIRECTORY_UNAVAILABLE'), T0, other)),
    ).rejects.toMatchObject({ code: 'DIRECTORY_UNAVAILABLE' })
    const lookup = deps(async () => LISTING, T0, other)
    await readCachedInstanceDirectory({}, 'prefer-fresh', lookup)
    expect(lookup.calls()).toBe(1)
  })

  test('a key identity keeps no listing, and forgetting one removes it', async () => {
    await readCachedInstanceDirectory(
      {},
      'refresh',
      deps(async () => LISTING, T0, null),
    )
    expect(() => statSync(cachePath(IDENTITY.name))).toThrow()

    await readCachedInstanceDirectory(
      {},
      'refresh',
      deps(async () => LISTING, T0),
    )
    await forgetInstanceDirectory(IDENTITY.name, cachePath)
    expect(() => statSync(cachePath(IDENTITY.name))).toThrow()
    // A name that is not one file name is never turned into a path.
    let asked = false
    await forgetInstanceDirectory('../identities', (name) => ((asked = true), cachePath(name)))
    expect(asked).toBe(false)
  })
})

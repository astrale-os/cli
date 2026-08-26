import { afterEach, describe, expect, test } from 'bun:test'
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  checkAstraleSkills,
  computeSkillTreeHash,
  syncAstraleSkills,
  type AstraleSkillSourceSnapshot,
} from '../skills'
import { withFileLock } from '../skills/lock'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

async function makeSource(
  names = ['astrale-cli', 'astrale-domain', 'astrale-frontend-design', 'astrale-services'],
  revision = 'new',
): Promise<{ root: string; snapshot: AstraleSkillSourceSnapshot }> {
  const root = await mkdtemp(join(tmpdir(), 'astrale-skills-source-'))
  temporaryRoots.push(root)
  const skills = []
  for (const name of names) {
    const directory = join(root, name)
    await mkdir(join(directory, 'references'), { recursive: true })
    await writeFile(join(directory, 'SKILL.md'), `---\nname: ${name}\n---\n\n${revision}\n`)
    await writeFile(join(directory, 'references', 'guide.md'), `${name}:${revision}\n`)
    skills.push({
      name,
      path: `skills/${name}/SKILL.md`,
      tree: await computeSkillTreeHash(directory),
    })
  }
  return { root, snapshot: { ref: 'main', revision: `commit-${revision}`, skills } }
}

async function makeHome() {
  const root = await mkdtemp(join(tmpdir(), 'astrale-skills-home-'))
  temporaryRoots.push(root)
  return {
    root,
    home: join(root, 'home'),
    lockPath: join(root, 'state', 'skills', '.skill-lock.json'),
  }
}

async function readLock(lockPath: string) {
  return JSON.parse(await readFile(lockPath, 'utf8')) as {
    version: number
    skills: Record<string, Record<string, unknown>>
    lastSelectedAgents?: string[]
  }
}

async function filesystemSnapshot(root: string): Promise<string> {
  async function visit(path: string, relative = ''): Promise<Array<[string, string]>> {
    const metadata = await lstat(path).catch(() => null)
    if (!metadata) return []
    if (metadata.isSymbolicLink()) return [[relative, `link:${await readlink(path)}`]]
    if (metadata.isFile()) return [[relative, `file:${await readFile(path, 'utf8')}`]]
    const children = await readdir(path)
    const descendants = await Promise.all(
      children.sort().map((name) => visit(join(path, name), join(relative, name))),
    )
    return [[relative, 'directory'], ...descendants.flat()]
  }

  return JSON.stringify(await visit(root))
}

function requestedSkills(args: string[]): string[] {
  const marker = args.indexOf('--skill')
  if (marker === -1) return []
  const values = args.slice(marker + 1)
  const nextFlag = values.findIndex((arg) => arg.startsWith('-'))
  return nextFlag === -1 ? values : values.slice(0, nextFlag)
}

function installer(
  sourceRoot: string,
  snapshot: AstraleSkillSourceSnapshot,
  home: string,
  lockPath: string,
  calls: string[][],
) {
  return async (_file: string, args: string[] = []) => {
    calls.push(args)
    if (args.includes('remove')) return { code: 0, stdout: '', stderr: '' }
    const selected = requestedSkills(args)
    const skills = selected.length
      ? snapshot.skills.filter((skill) => selected.includes(skill.name))
      : snapshot.skills
    const previous: Awaited<ReturnType<typeof readLock>> = await readLock(lockPath).catch(() => ({
      version: 3,
      skills: {},
    }))
    await mkdir(join(home, '.agents', 'skills'), { recursive: true })
    for (const skill of skills) {
      const target = join(home, '.agents', 'skills', skill.name)
      await rm(target, { recursive: true, force: true })
      await cp(join(sourceRoot, skill.name), target, { recursive: true })
      previous.skills[skill.name] = {
        source: 'astrale-os/cli',
        sourceType: 'github',
        sourceUrl: 'https://github.com/astrale-os/cli.git',
        ref: snapshot.ref,
        skillPath: skill.path,
        skillFolderHash: skill.tree,
      }
      if (previous.lastSelectedAgents?.includes('claude-code')) {
        const link = join(home, '.claude', 'skills', skill.name)
        await mkdir(join(home, '.claude', 'skills'), { recursive: true })
        await rm(link, { recursive: true, force: true })
        await symlink(`../../.agents/skills/${skill.name}`, link)
      }
    }
    await mkdir(join(lockPath, '..'), { recursive: true })
    await writeFile(lockPath, `${JSON.stringify(previous, null, 2)}\n`)
    return { code: 0, stdout: '', stderr: '' }
  }
}

async function installFixture(
  sourceRoot: string,
  snapshot: AstraleSkillSourceSnapshot,
  home: string,
  lockPath: string,
) {
  const calls: string[][] = []
  await installer(sourceRoot, snapshot, home, lockPath, calls)('npx', [])
  const lock = await readLock(lockPath)
  for (const skill of snapshot.skills) {
    lock.skills[skill.name].astraleSourceRevision = snapshot.revision
    lock.skills[skill.name].astraleSourceTree = skill.tree
  }
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`)
}

describe('Astrale skill reconciliation', () => {
  test('fresh install is followed by a true no-effect run', async () => {
    const source = await makeSource()
    const target = await makeHome()
    const calls: string[][] = []
    const dependencies = {
      home: target.home,
      lockPath: target.lockPath,
      resolveSource: async () => source.snapshot,
      run: installer(source.root, source.snapshot, target.home, target.lockPath, calls),
    }

    expect(await syncAstraleSkills(dependencies)).toEqual({ status: 'installed' })
    expect(await syncAstraleSkills(dependencies)).toEqual({ status: 'unchanged' })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain(`astrale-os/cli#${source.snapshot.ref}`)
    expect(requestedSkills(calls[0])).toEqual(source.snapshot.skills.map((skill) => skill.name))
    const installedLock = await readLock(target.lockPath)
    expect(Object.keys(installedLock.skills).sort()).toEqual(
      source.snapshot.skills.map((skill) => skill.name).sort(),
    )
    for (const skill of source.snapshot.skills) {
      expect(installedLock.skills[skill.name]).toMatchObject({
        ref: 'main',
        astraleSourceRevision: source.snapshot.revision,
        astraleSourceTree: skill.tree,
      })
    }
  })

  test('a coherent older cohort updates every current source skill', async () => {
    const oldSource = await makeSource(undefined, 'old')
    const latest = await makeSource(undefined, 'latest')
    const target = await makeHome()
    await installFixture(oldSource.root, oldSource.snapshot, target.home, target.lockPath)
    const calls: string[][] = []

    expect(
      await syncAstraleSkills({
        home: target.home,
        lockPath: target.lockPath,
        resolveSource: async () => latest.snapshot,
        run: installer(latest.root, latest.snapshot, target.home, target.lockPath, calls),
      }),
    ).toEqual({ status: 'updated' })
    expect(requestedSkills(calls[0])).toEqual(latest.snapshot.skills.map((skill) => skill.name))
    for (const skill of latest.snapshot.skills) {
      expect(
        await readFile(join(target.home, '.agents/skills', skill.name, 'SKILL.md'), 'utf8'),
      ).toContain('latest')
    }
  })

  test('tampered material is repaired automatically', async () => {
    const source = await makeSource()
    const target = await makeHome()
    await installFixture(source.root, source.snapshot, target.home, target.lockPath)
    await writeFile(join(target.home, '.agents/skills/astrale-domain/SKILL.md'), 'tampered\n')
    const calls: string[][] = []

    expect(
      await syncAstraleSkills({
        home: target.home,
        lockPath: target.lockPath,
        resolveSource: async () => source.snapshot,
        run: installer(source.root, source.snapshot, target.home, target.lockPath, calls),
      }),
    ).toEqual({ status: 'repaired' })
    expect(
      await readFile(join(target.home, '.agents/skills/astrale-domain/SKILL.md'), 'utf8'),
    ).toContain('new')
  })

  test('a partial cohort is repaired automatically', async () => {
    const source = await makeSource()
    const target = await makeHome()
    await installFixture(source.root, source.snapshot, target.home, target.lockPath)
    await rm(join(target.home, '.agents/skills/astrale-services'), { recursive: true, force: true })
    const calls: string[][] = []

    expect(
      await syncAstraleSkills({
        home: target.home,
        lockPath: target.lockPath,
        resolveSource: async () => source.snapshot,
        run: installer(source.root, source.snapshot, target.home, target.lockPath, calls),
      }),
    ).toEqual({ status: 'repaired' })
    expect(requestedSkills(calls[0])).toEqual(source.snapshot.skills.map((skill) => skill.name))
    for (const skill of source.snapshot.skills) {
      expect(
        await readFile(join(target.home, '.agents/skills', skill.name, 'SKILL.md'), 'utf8'),
      ).toContain('new')
    }
  })

  test('failed refresh and clean retry restore the previous healthy cohort', async () => {
    const oldSource = await makeSource(undefined, 'old')
    const latest = await makeSource(undefined, 'latest')
    const target = await makeHome()
    await installFixture(oldSource.root, oldSource.snapshot, target.home, target.lockPath)
    const beforeSkills = await Promise.all(
      oldSource.snapshot.skills.map((skill) =>
        readFile(join(target.home, '.agents/skills', skill.name, 'SKILL.md'), 'utf8'),
      ),
    )
    const beforeLock = await readFile(target.lockPath, 'utf8')
    let attempts = 0

    await expect(
      syncAstraleSkills({
        home: target.home,
        lockPath: target.lockPath,
        resolveSource: async () => latest.snapshot,
        run: async () => {
          attempts += 1
          return { code: 0, stdout: '', stderr: '' }
        },
      }),
    ).rejects.toMatchObject({ code: 'SKILL_UPDATE_FAILED' })
    expect(attempts).toBe(2)
    expect(
      await Promise.all(
        oldSource.snapshot.skills.map((skill) =>
          readFile(join(target.home, '.agents/skills', skill.name, 'SKILL.md'), 'utf8'),
        ),
      ),
    ).toEqual(beforeSkills)
    expect(await readFile(target.lockPath, 'utf8')).toBe(beforeLock)
  })

  test('failed repair removes an unhealthy cohort instead of leaving it active', async () => {
    const source = await makeSource()
    const target = await makeHome()
    await installFixture(source.root, source.snapshot, target.home, target.lockPath)
    await writeFile(join(target.home, '.agents/skills/astrale-domain/SKILL.md'), 'broken\n')
    await mkdir(join(target.home, '.claude/skills'), { recursive: true })
    await symlink(
      '../../.agents/skills/astrale-domain',
      join(target.home, '.claude/skills/astrale-domain'),
    )

    await expect(
      syncAstraleSkills({
        home: target.home,
        lockPath: target.lockPath,
        resolveSource: async () => source.snapshot,
        run: async () => ({ code: 1, stdout: '', stderr: 'offline' }),
      }),
    ).rejects.toMatchObject({ code: 'SKILL_UPDATE_FAILED' })
    await expect(
      readFile(join(target.home, '.agents/skills/astrale-domain/SKILL.md')),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(lstat(join(target.home, '.claude/skills/astrale-domain'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    expect(
      Object.values((await readLock(target.lockPath)).skills).some(
        (entry) => entry.source === 'astrale-os/cli',
      ),
    ).toBe(false)
  })

  test('concurrent reconcilers serialize and perform one installation', async () => {
    const source = await makeSource()
    const target = await makeHome()
    const calls: string[][] = []
    const install = installer(source.root, source.snapshot, target.home, target.lockPath, calls)
    const dependencies = {
      home: target.home,
      lockPath: target.lockPath,
      resolveSource: async () => source.snapshot,
      run: async (file: string, args: string[] = []) => {
        await new Promise((resolve) => setTimeout(resolve, 30))
        return await install(file, args)
      },
    }

    const results = await Promise.all([
      syncAstraleSkills(dependencies),
      syncAstraleSkills(dependencies),
    ])
    expect(results.map((result) => result.status).sort()).toEqual(['installed', 'unchanged'])
    expect(calls).toHaveLength(1)
  })

  test('a live lock is not stolen across processes after its stale threshold', async () => {
    const target = await makeHome()
    const lockPath = join(target.root, 'transition.lock')
    const marker = join(target.root, 'child-acquired')
    const lockModule = new URL('../skills/lock.ts', import.meta.url).pathname
    const child = Bun.spawn([
      process.execPath,
      '-e',
      `import { writeFile } from 'node:fs/promises'; import { withFileLock } from ${JSON.stringify(lockModule)}; await withFileLock(${JSON.stringify(lockPath)}, async () => { await writeFile(${JSON.stringify(marker)}, 'acquired'); await new Promise(resolve => setTimeout(resolve, 120)); }, { staleAfterMs: 10, pollIntervalMs: 2, timeoutMs: 500 });`,
    ])
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await lstat(marker).catch(() => null)) break
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(await lstat(marker).catch(() => null)).not.toBeNull()
    const started = Date.now()
    await withFileLock(lockPath, async () => undefined, {
      staleAfterMs: 10,
      pollIntervalMs: 2,
      timeoutMs: 500,
    })
    expect(Date.now() - started).toBeGreaterThanOrEqual(70)
    expect(await child.exited).toBe(0)
  })

  test('a missing selected-agent link is repaired', async () => {
    const source = await makeSource()
    const target = await makeHome()
    await installFixture(source.root, source.snapshot, target.home, target.lockPath)
    const lock = await readLock(target.lockPath)
    lock.lastSelectedAgents = ['codex', 'claude-code']
    await writeFile(target.lockPath, `${JSON.stringify(lock, null, 2)}\n`)
    for (const skill of source.snapshot.skills) {
      const link = join(target.home, '.claude', 'skills', skill.name)
      await mkdir(join(target.home, '.claude', 'skills'), { recursive: true })
      await symlink(`../../.agents/skills/${skill.name}`, link)
    }
    await rm(join(target.home, '.claude', 'skills', 'astrale-domain'))

    expect(
      await syncAstraleSkills({
        home: target.home,
        lockPath: target.lockPath,
        resolveSource: async () => source.snapshot,
        run: installer(source.root, source.snapshot, target.home, target.lockPath, []),
      }),
    ).toEqual({ status: 'repaired' })
    expect(await readlink(join(target.home, '.claude', 'skills', 'astrale-domain'))).toBe(
      '../../.agents/skills/astrale-domain',
    )
  })

  test('check distinguishes current, update, repair, and unavailable without writing', async () => {
    const source = await makeSource()
    const target = await makeHome()
    const beforeAbsentCheck = await filesystemSnapshot(target.root)
    expect(
      await checkAstraleSkills({
        home: target.home,
        lockPath: target.lockPath,
        resolveSource: async () => source.snapshot,
      }),
    ).toEqual({ status: 'update-available' })
    expect(await filesystemSnapshot(target.root)).toBe(beforeAbsentCheck)

    await installFixture(source.root, source.snapshot, target.home, target.lockPath)
    const beforeCurrentCheck = await filesystemSnapshot(target.root)
    expect(
      await checkAstraleSkills({
        home: target.home,
        lockPath: target.lockPath,
        resolveSource: async () => source.snapshot,
      }),
    ).toEqual({
      status: 'current',
      source: {
        repository: 'astrale-os/cli',
        revision: source.snapshot.revision,
        skills: source.snapshot.skills.map(({ name, tree, path }) => ({
          name,
          tree,
          entrypoint: path,
        })),
      },
    })
    expect(await filesystemSnapshot(target.root)).toBe(beforeCurrentCheck)

    await rm(join(target.home, '.agents/skills/astrale-cli'), { recursive: true, force: true })
    const beforeRepairCheck = await filesystemSnapshot(target.root)
    expect(
      await checkAstraleSkills({
        home: target.home,
        lockPath: target.lockPath,
        resolveSource: async () => source.snapshot,
      }),
    ).toEqual({ status: 'repair-needed' })
    expect(await filesystemSnapshot(target.root)).toBe(beforeRepairCheck)

    const beforeUnavailableCheck = await filesystemSnapshot(target.root)
    expect(
      await checkAstraleSkills({
        home: target.home,
        lockPath: target.lockPath,
        resolveSource: async () => {
          throw new Error('offline')
        },
      }),
    ).toEqual({ status: 'unavailable', error: 'offline' })
    expect(await filesystemSnapshot(target.root)).toBe(beforeUnavailableCheck)
  })

  test('unrelated global skills and lock entries survive repair', async () => {
    const source = await makeSource()
    const target = await makeHome()
    await installFixture(source.root, source.snapshot, target.home, target.lockPath)
    await mkdir(join(target.home, '.agents/skills/third-party'), { recursive: true })
    await writeFile(join(target.home, '.agents/skills/third-party/SKILL.md'), 'third party\n')
    const lock = await readLock(target.lockPath)
    lock.skills['third-party'] = {
      source: 'someone/else',
      skillPath: 'skills/third-party/SKILL.md',
    }
    const thirdPartyLock = structuredClone(lock.skills['third-party'])
    await writeFile(target.lockPath, `${JSON.stringify(lock, null, 2)}\n`)
    await writeFile(join(target.home, '.agents/skills/astrale-cli/SKILL.md'), 'broken\n')

    await syncAstraleSkills({
      home: target.home,
      lockPath: target.lockPath,
      resolveSource: async () => source.snapshot,
      run: installer(source.root, source.snapshot, target.home, target.lockPath, []),
    })

    expect(await readFile(join(target.home, '.agents/skills/third-party/SKILL.md'), 'utf8')).toBe(
      'third party\n',
    )
    expect((await readLock(target.lockPath)).skills['third-party']).toEqual(thirdPartyLock)
  })

  test('failed repair preserves a foreign same-named agent link', async () => {
    const source = await makeSource()
    const target = await makeHome()
    await installFixture(source.root, source.snapshot, target.home, target.lockPath)
    await writeFile(join(target.home, '.agents/skills/astrale-domain/SKILL.md'), 'broken\n')
    const link = join(target.home, '.claude', 'skills', 'astrale-domain')
    await mkdir(dirname(link), { recursive: true })
    await symlink('/opt/team/skills/astrale-domain', link)

    await expect(
      syncAstraleSkills({
        home: target.home,
        lockPath: target.lockPath,
        resolveSource: async () => source.snapshot,
        run: async () => {
          await rm(link, { force: true })
          await symlink('../../.agents/skills/astrale-domain', link)
          return { code: 1, stdout: '', stderr: 'offline' }
        },
      }),
    ).rejects.toMatchObject({ code: 'SKILL_UPDATE_FAILED' })
    expect(await readlink(link)).toBe('/opt/team/skills/astrale-domain')
  })

  test('an interrupted transition restores its healthy backup before retrying', async () => {
    const oldSource = await makeSource(undefined, 'old')
    const latest = await makeSource(undefined, 'latest')
    const target = await makeHome()
    await installFixture(oldSource.root, oldSource.snapshot, target.home, target.lockPath)
    const oldLock = await readFile(target.lockPath, 'utf8')
    const backupRoot = await mkdtemp(join(target.home, '.agents', '.astrale-skill-backup-'))
    for (const skill of oldSource.snapshot.skills) {
      await cp(join(target.home, '.agents', 'skills', skill.name), join(backupRoot, skill.name), {
        recursive: true,
      })
    }
    await writeFile(
      join(backupRoot, '.manifest.json'),
      JSON.stringify({
        root: backupRoot,
        names: oldSource.snapshot.skills.map((skill) => skill.name),
        copied: oldSource.snapshot.skills.map((skill) => skill.name),
        links: [],
        lockRaw: oldLock,
        createdAt: new Date().toISOString(),
        phase: 'prepared',
      }),
    )
    await rm(join(target.home, '.agents', 'skills'), { recursive: true, force: true })
    await writeFile(target.lockPath, '{"version":3,"skills":{}}\n')

    await expect(
      syncAstraleSkills({
        home: target.home,
        lockPath: target.lockPath,
        resolveSource: async () => latest.snapshot,
        run: async () => ({ code: 1, stdout: '', stderr: 'offline' }),
      }),
    ).rejects.toMatchObject({ code: 'SKILL_UPDATE_FAILED' })
    for (const skill of oldSource.snapshot.skills) {
      expect(
        await readFile(join(target.home, '.agents', 'skills', skill.name, 'SKILL.md'), 'utf8'),
      ).toContain('old')
    }
    expect(await readFile(target.lockPath, 'utf8')).toBe(oldLock)
  })

  test('a verified transition backup is discarded without rolling live state back', async () => {
    const oldSource = await makeSource(undefined, 'old')
    const latest = await makeSource(undefined, 'latest')
    const target = await makeHome()
    await installFixture(oldSource.root, oldSource.snapshot, target.home, target.lockPath)
    const oldLock = await readFile(target.lockPath, 'utf8')
    const backupRoot = await mkdtemp(join(target.home, '.agents', '.astrale-skill-backup-'))
    for (const skill of oldSource.snapshot.skills) {
      await cp(join(target.home, '.agents', 'skills', skill.name), join(backupRoot, skill.name), {
        recursive: true,
      })
    }
    await writeFile(
      join(backupRoot, '.manifest.json'),
      JSON.stringify({
        root: backupRoot,
        names: oldSource.snapshot.skills.map((skill) => skill.name),
        copied: oldSource.snapshot.skills.map((skill) => skill.name),
        links: [],
        lockRaw: oldLock,
        createdAt: new Date().toISOString(),
        phase: 'verified',
      }),
    )
    await installFixture(latest.root, latest.snapshot, target.home, target.lockPath)

    expect(
      await syncAstraleSkills({
        home: target.home,
        lockPath: target.lockPath,
        resolveSource: async () => latest.snapshot,
        run: async () => {
          throw new Error('installer must not run')
        },
      }),
    ).toEqual({ status: 'unchanged' })
    await expect(lstat(backupRoot)).rejects.toMatchObject({ code: 'ENOENT' })
    for (const skill of latest.snapshot.skills) {
      expect(
        await readFile(join(target.home, '.agents', 'skills', skill.name, 'SKILL.md'), 'utf8'),
      ).toContain('latest')
    }
  })

  test('a retired source skill is removed without touching unrelated skills', async () => {
    const oldSource = await makeSource(
      [
        'astrale-cli',
        'astrale-domain',
        'astrale-frontend-design',
        'astrale-services',
        'astrale-retired',
      ],
      'old',
    )
    const latest = await makeSource(undefined, 'latest')
    const target = await makeHome()
    await installFixture(oldSource.root, oldSource.snapshot, target.home, target.lockPath)
    await mkdir(join(target.home, '.agents', 'skills', 'third-party'), { recursive: true })
    await writeFile(join(target.home, '.agents', 'skills', 'third-party', 'SKILL.md'), 'keep\n')
    const lock = await readLock(target.lockPath)
    lock.lastSelectedAgents = ['claude-code']
    lock.skills['third-party'] = { source: 'someone/else' }
    await writeFile(target.lockPath, `${JSON.stringify(lock, null, 2)}\n`)
    await mkdir(join(target.home, '.claude', 'skills'), { recursive: true })
    for (const skill of oldSource.snapshot.skills) {
      await symlink(
        `../../.agents/skills/${skill.name}`,
        join(target.home, '.claude', 'skills', skill.name),
      )
    }

    const calls: string[][] = []
    const install = installer(latest.root, latest.snapshot, target.home, target.lockPath, calls)
    let removeAttempts = 0
    expect(
      await syncAstraleSkills({
        home: target.home,
        lockPath: target.lockPath,
        resolveSource: async () => latest.snapshot,
        run: async (file, args = []) => {
          if (args.includes('remove')) {
            removeAttempts += 1
            if (removeAttempts === 1) return { code: 1, stdout: '', stderr: 'try again' }
          }
          return await install(file, args)
        },
      }),
    ).toEqual({ status: 'updated' })
    expect(removeAttempts).toBe(2)
    await expect(
      lstat(join(target.home, '.agents', 'skills', 'astrale-retired')),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(
      lstat(join(target.home, '.claude', 'skills', 'astrale-retired')),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await readLock(target.lockPath)).skills['astrale-retired']).toBeUndefined()
    expect(
      await readFile(join(target.home, '.agents', 'skills', 'third-party', 'SKILL.md'), 'utf8'),
    ).toBe('keep\n')
  })

  test('an unreadable lock fails safely without deleting a healthy cohort', async () => {
    const source = await makeSource()
    const target = await makeHome()
    await installFixture(source.root, source.snapshot, target.home, target.lockPath)
    const before = await filesystemSnapshot(join(target.home, '.agents', 'skills'))
    await rm(target.lockPath)
    await mkdir(target.lockPath)

    await expect(
      syncAstraleSkills({
        home: target.home,
        lockPath: target.lockPath,
        resolveSource: async () => source.snapshot,
        run: async () => ({ code: 1, stdout: '', stderr: 'must not run' }),
      }),
    ).rejects.toMatchObject({ code: 'SKILL_UPDATE_FAILED' })
    expect(await filesystemSnapshot(join(target.home, '.agents', 'skills'))).toBe(before)
  })

  test('a moving main branch converges on the second source snapshot', async () => {
    const old = await makeSource(undefined, 'old')
    const first = await makeSource(undefined, 'first')
    const second = await makeSource(['astrale-cli', 'astrale-domain'], 'second')
    const target = await makeHome()
    await installFixture(old.root, old.snapshot, target.home, target.lockPath)
    const lock = await readLock(target.lockPath)
    lock.lastSelectedAgents = ['claude-code']
    await writeFile(target.lockPath, `${JSON.stringify(lock, null, 2)}\n`)
    await mkdir(join(target.home, '.claude', 'skills'), { recursive: true })
    for (const skill of old.snapshot.skills) {
      await symlink(
        `../../.agents/skills/${skill.name}`,
        join(target.home, '.claude', 'skills', skill.name),
      )
    }
    const resolved = [first.snapshot, second.snapshot, second.snapshot, second.snapshot]
    let resolutions = 0
    let installs = 0
    const calls: string[][] = []

    expect(
      await syncAstraleSkills({
        home: target.home,
        lockPath: target.lockPath,
        resolveSource: async () => resolved[resolutions++] ?? second.snapshot,
        run: async (file, args = []) => {
          if (args.includes('remove')) {
            return await installer(
              second.root,
              second.snapshot,
              target.home,
              target.lockPath,
              calls,
            )(file, args)
          }
          const source = installs++ === 0 ? first : second
          return await installer(
            source.root,
            source.snapshot,
            target.home,
            target.lockPath,
            calls,
          )(file, args)
        },
      }),
    ).toEqual({ status: 'updated' })
    expect(installs).toBe(2)
    for (const skill of second.snapshot.skills) {
      expect(
        await readFile(join(target.home, '.agents', 'skills', skill.name, 'SKILL.md'), 'utf8'),
      ).toContain('second')
    }
    await expect(
      lstat(join(target.home, '.claude', 'skills', 'astrale-services')),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('continued source churn fails without leaving a partial fresh install', async () => {
    const sources = await Promise.all(
      ['one', 'two', 'three', 'four'].map(
        async (revision) => await makeSource(undefined, revision),
      ),
    )
    const target = await makeHome()
    let resolutions = 0
    let installs = 0

    await expect(
      syncAstraleSkills({
        home: target.home,
        lockPath: target.lockPath,
        resolveSource: async () => sources[resolutions++].snapshot,
        run: async (file, args = []) => {
          const source = installs++ === 0 ? sources[0] : sources[2]
          return await installer(
            source.root,
            source.snapshot,
            target.home,
            target.lockPath,
            [],
          )(file, args)
        },
      }),
    ).rejects.toMatchObject({ code: 'SKILL_UPDATE_FAILED' })
    for (const skill of sources[0].snapshot.skills) {
      await expect(lstat(join(target.home, '.agents', 'skills', skill.name))).rejects.toMatchObject(
        {
          code: 'ENOENT',
        },
      )
    }
    expect(
      Object.values((await readLock(target.lockPath)).skills).some(
        (entry) => entry.source === 'astrale-os/cli',
      ),
    ).toBe(false)
  })

  test('rollback removes a skill introduced only by a moving-source retry', async () => {
    const old = await makeSource(['astrale-cli', 'astrale-domain'], 'old')
    const first = await makeSource(['astrale-cli', 'astrale-domain'], 'first')
    const second = await makeSource(undefined, 'second')
    const churn = await makeSource(undefined, 'churn')
    const target = await makeHome()
    await installFixture(old.root, old.snapshot, target.home, target.lockPath)
    const lock = await readLock(target.lockPath)
    lock.lastSelectedAgents = ['claude-code']
    await writeFile(target.lockPath, `${JSON.stringify(lock, null, 2)}\n`)
    await mkdir(join(target.home, '.claude', 'skills'), { recursive: true })
    for (const skill of old.snapshot.skills) {
      await symlink(
        `../../.agents/skills/${skill.name}`,
        join(target.home, '.claude', 'skills', skill.name),
      )
    }
    const beforeLock = await readFile(target.lockPath, 'utf8')
    const resolved = [first.snapshot, second.snapshot, second.snapshot, churn.snapshot]
    let resolutions = 0
    let installs = 0

    await expect(
      syncAstraleSkills({
        home: target.home,
        lockPath: target.lockPath,
        resolveSource: async () => resolved[resolutions++],
        run: async (file, args = []) => {
          const source = installs++ === 0 ? first : second
          return await installer(
            source.root,
            source.snapshot,
            target.home,
            target.lockPath,
            [],
          )(file, args)
        },
      }),
    ).rejects.toMatchObject({ code: 'SKILL_UPDATE_FAILED' })
    for (const skill of old.snapshot.skills) {
      expect(
        await readFile(join(target.home, '.agents', 'skills', skill.name, 'SKILL.md'), 'utf8'),
      ).toContain('old')
    }
    await expect(
      lstat(join(target.home, '.agents', 'skills', 'astrale-services')),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(
      lstat(join(target.home, '.claude', 'skills', 'astrale-services')),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(target.lockPath, 'utf8')).toBe(beforeLock)
  })

  test('source discovery failure is unavailable and does not touch installed state', async () => {
    const target = await makeHome()
    const before = await filesystemSnapshot(target.root)

    expect(
      await checkAstraleSkills({
        home: target.home,
        lockPath: target.lockPath,
        run: async () => ({ code: 1, stdout: '', stderr: 'source unavailable' }),
      }),
    ).toEqual({ status: 'unavailable', error: 'source unavailable' })
    expect(await filesystemSnapshot(target.root)).toBe(before)
  })
})

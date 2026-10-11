import { afterEach, describe, expect, test } from 'bun:test'
import {
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
  astraleSkillAgents,
  checkAstraleSkills,
  computeSkillTreeHash,
  syncAstraleSkills,
  type AstraleSkillSource,
  type SkillSyncOptions,
} from '../skills/sync'

const NAMES = ['astrale-cli', 'astrale-domain', 'astrale-services']
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function temporary(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

async function makeSource(names = NAMES, revision = 'new'): Promise<AstraleSkillSource> {
  const root = await temporary('astrale-skills-source-')
  const skills = []
  for (const name of names) {
    await mkdir(join(root, name, 'references'), { recursive: true })
    await writeFile(join(root, name, 'SKILL.md'), `---\nname: ${name}\n---\n\n${revision}\n`)
    await writeFile(join(root, name, 'references', 'guide.md'), `${name}:${revision}\n`)
    skills.push({ name, tree: await computeSkillTreeHash(join(root, name)) })
  }
  return { revision: `commit-${revision}`, skills, sourceRoot: root }
}

async function makeHome() {
  const root = await temporary('astrale-skills-home-')
  const home = join(root, 'home')
  const lockPath = join(root, 'state', 'skills', '.skill-lock.json')
  return {
    home,
    lockPath,
    skill: (name: string) => join(home, '.agents', 'skills', name),
    claudeLink: (name: string) => join(home, '.claude', 'skills', name),
    options: (source: AstraleSkillSource, extra: SkillSyncOptions = {}): SkillSyncOptions => ({
      home,
      lockPath,
      resolveSource: async () => source,
      ...extra,
    }),
  }
}

type Home = Awaited<ReturnType<typeof makeHome>>

async function readLock(home: Home) {
  return JSON.parse(await readFile(home.lockPath, 'utf8')) as {
    version: number
    skills: Record<string, Record<string, unknown>>
    lastSelectedAgents?: string[]
  }
}

async function editLock(home: Home, edit: (lock: Awaited<ReturnType<typeof readLock>>) => void) {
  const lock = await readLock(home).catch(() => ({ version: 3, skills: {} }))
  edit(lock)
  await mkdir(dirname(home.lockPath), { recursive: true })
  await writeFile(home.lockPath, `${JSON.stringify(lock, null, 2)}\n`)
}

async function tree(root: string): Promise<string> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch(() => [])
  const described = await Promise.all(
    entries.map(async (entry) => {
      const path = join(entry.parentPath, entry.name)
      if (entry.isSymbolicLink()) return `${path} -> ${await readlink(path)}`
      return entry.isFile() ? `${path}: ${await readFile(path, 'utf8')}` : path
    }),
  )
  return described.sort().join('\n')
}

async function absent(path: string): Promise<boolean> {
  return (await lstat(path).catch(() => null)) === null
}

describe('Astrale skill reconciliation', () => {
  test('installs the cohort into the shared skills lock, links selected agents, then is a no-op', async () => {
    const source = await makeSource()
    const home = await makeHome()
    const options = home.options(source, { agents: ['claude-code'], replaceAgentSelection: true })

    expect(await syncAstraleSkills(options)).toEqual({ status: 'installed' })

    const lock = await readLock(home)
    expect(lock.version).toBe(3)
    expect(lock.lastSelectedAgents).toEqual(['claude-code'])
    expect(lock.skills['astrale-cli']).toMatchObject({
      source: 'astrale-os/cli',
      sourceType: 'github',
      sourceUrl: 'https://github.com/astrale-os/cli.git',
      ref: 'main',
      skillPath: 'skills/astrale-cli/SKILL.md',
      skillFolderHash: source.skills[0]?.tree,
      astraleSourceRevision: source.revision,
      astraleSourceTree: source.skills[0]?.tree,
    })
    expect(await readlink(home.claudeLink('astrale-cli'))).toBe('../../.agents/skills/astrale-cli')

    const before = await tree(dirname(home.home))
    expect(await syncAstraleSkills(home.options(source))).toEqual({ status: 'unchanged' })
    expect(await tree(dirname(home.home))).toBe(before)
  })

  test('replaces an agent copy of a skill with the canonical link', async () => {
    const source = await makeSource(['astrale-cli'])
    const home = await makeHome()
    const options = home.options(source, { agents: ['claude-code'] })
    await syncAstraleSkills(options)
    await rm(home.claudeLink('astrale-cli'))
    await mkdir(join(home.claudeLink('astrale-cli'), 'references'), { recursive: true })
    await writeFile(join(home.claudeLink('astrale-cli'), 'references', 'local.md'), 'local\n')

    expect(await syncAstraleSkills(options)).toEqual({ status: 'repaired' })
    expect(await readlink(home.claudeLink('astrale-cli'))).toBe('../../.agents/skills/astrale-cli')
    expect(await absent(join(home.skill('astrale-cli'), 'references', 'local.md'))).toBe(true)
  })

  test('keeps an agent skills directory that already links to the canonical directory', async () => {
    const source = await makeSource(['astrale-cli'])
    const home = await makeHome()
    await mkdir(join(home.home, '.agents', 'skills'), { recursive: true })
    await mkdir(join(home.home, '.claude'), { recursive: true })
    await symlink('../.agents/skills', join(home.home, '.claude', 'skills'))

    await syncAstraleSkills(home.options(source, { agents: ['claude-code'] }))

    expect((await lstat(home.skill('astrale-cli'))).isDirectory()).toBe(true)
    expect(await readFile(join(home.claudeLink('astrale-cli'), 'SKILL.md'), 'utf8')).toContain(
      'new',
    )
  })

  test('a new agent selection unlinks only Astrale links of deselected agents', async () => {
    const source = await makeSource()
    const home = await makeHome()
    await syncAstraleSkills(
      home.options(source, { agents: ['claude-code'], replaceAgentSelection: true }),
    )
    const foreign = join(home.home, '.claude', 'skills', 'third-party')
    await mkdir(foreign, { recursive: true })

    await syncAstraleSkills(
      home.options(source, { agents: ['cursor'], replaceAgentSelection: true }),
    )

    expect((await readLock(home)).lastSelectedAgents).toEqual(['cursor'])
    expect(await readlink(join(home.home, '.cursor', 'skills', 'astrale-cli'))).toBe(
      '../../.agents/skills/astrale-cli',
    )
    expect(await absent(home.claudeLink('astrale-cli'))).toBe(true)
    expect(await absent(foreign)).toBe(false)
  })

  test('existing links mark their agent as configured even without a lock', async () => {
    const source = await makeSource()
    const home = await makeHome()
    await syncAstraleSkills(home.options(source, { agents: ['claude-code'] }))
    await rm(home.lockPath)

    const agents = await astraleSkillAgents({ home: home.home, lockPath: home.lockPath })
    expect(agents.find((agent) => agent.name === 'claude-code')?.configured).toBe(true)
  })

  test('refuses to overwrite a same-named skill owned by another source', async () => {
    const source = await makeSource()
    const home = await makeHome()
    await mkdir(home.skill('astrale-cli'), { recursive: true })
    await writeFile(join(home.skill('astrale-cli'), 'SKILL.md'), 'foreign\n')

    await expect(syncAstraleSkills(home.options(source))).rejects.toMatchObject({
      code: 'SKILL_UPDATE_FAILED',
    })
    await editLock(home, (lock) => {
      lock.skills['astrale-cli'] = {
        source: 'someone/else',
        skillPath: 'skills/astrale-cli/SKILL.md',
      }
    })
    const before = await tree(dirname(home.home))
    await expect(syncAstraleSkills(home.options(source))).rejects.toMatchObject({
      code: 'SKILL_UPDATE_FAILED',
    })
    expect(await tree(dirname(home.home))).toBe(before)
  })

  test('a hostile lock skillPath cannot make reconciliation delete outside the canonical directory', async () => {
    const source = await makeSource()
    const home = await makeHome()
    const sentinel = join(home.home, '.agents', 'sentinel', 'keep')
    await mkdir(dirname(sentinel), { recursive: true })
    await writeFile(sentinel, 'safe\n')
    await editLock(home, (lock) => {
      lock.skills.hostile = { source: 'astrale-os/cli', skillPath: 'skills/../SKILL.md' }
    })

    await syncAstraleSkills(home.options(source))
    expect(await readFile(sentinel, 'utf8')).toBe('safe\n')
  })

  test('updates an older cohort and repairs a tampered or partial one', async () => {
    const latest = await makeSource(NAMES, 'latest')
    for (const [damage, status] of [
      ['older', 'updated'],
      ['tampered', 'repaired'],
      ['partial', 'repaired'],
    ] as const) {
      const home = await makeHome()
      await syncAstraleSkills(
        home.options(damage === 'older' ? await makeSource(NAMES, 'old') : latest),
      )
      if (damage === 'tampered')
        await writeFile(join(home.skill('astrale-domain'), 'SKILL.md'), 'x\n')
      if (damage === 'partial') await rm(home.skill('astrale-services'), { recursive: true })

      expect(await syncAstraleSkills(home.options(latest))).toEqual({ status })
      for (const name of NAMES) {
        expect(await readFile(join(home.skill(name), 'SKILL.md'), 'utf8')).toContain('latest')
      }
    }
  })

  test('a failed update restores the previous healthy cohort exactly', async () => {
    const home = await makeHome()
    await syncAstraleSkills(
      home.options(await makeSource(NAMES, 'old'), { agents: ['claude-code'] }),
    )
    const before = await tree(dirname(home.home))
    const broken = await makeSource(NAMES, 'latest')
    await rm(join(broken.sourceRoot!, 'astrale-services'), { recursive: true })

    await expect(syncAstraleSkills(home.options(broken))).rejects.toMatchObject({
      code: 'SKILL_UPDATE_FAILED',
    })
    expect(await tree(dirname(home.home))).toBe(before)
  })

  test('a failed repair removes the unhealthy cohort but keeps a foreign agent link', async () => {
    const source = await makeSource()
    const home = await makeHome()
    await syncAstraleSkills(home.options(source, { agents: ['claude-code'] }))
    await writeFile(join(home.skill('astrale-domain'), 'SKILL.md'), 'broken\n')
    await rm(home.claudeLink('astrale-cli'))
    await symlink('/opt/team/skills/astrale-cli', home.claudeLink('astrale-cli'))
    await editLock(home, (lock) => {
      lock.skills['third-party'] = { source: 'someone/else' }
    })
    await rm(join(source.sourceRoot!, 'astrale-services'), { recursive: true })

    await expect(syncAstraleSkills(home.options(source))).rejects.toMatchObject({
      code: 'SKILL_UPDATE_FAILED',
    })
    expect(await absent(home.skill('astrale-domain'))).toBe(true)
    expect(await absent(home.claudeLink('astrale-domain'))).toBe(true)
    expect(await readlink(home.claudeLink('astrale-cli'))).toBe('/opt/team/skills/astrale-cli')
    expect(Object.keys((await readLock(home)).skills)).toEqual(['third-party'])
  })

  test('concurrent reconcilers serialize and install once', async () => {
    const source = await makeSource()
    const home = await makeHome()

    const results = await Promise.all([
      syncAstraleSkills(home.options(source)),
      syncAstraleSkills(home.options(source)),
    ])
    expect(results.map((result) => result.status).sort()).toEqual(['installed', 'unchanged'])
  })

  test('check reports absent, current, repair-needed, and unavailable without writing', async () => {
    const source = await makeSource()
    const home = await makeHome()
    const check = async (options = home.options(source)) => {
      const before = await tree(dirname(home.home))
      const result = await checkAstraleSkills(options)
      expect(await tree(dirname(home.home))).toBe(before)
      return result
    }

    expect(await check()).toEqual({ status: 'update-available', installed: false })
    await syncAstraleSkills(home.options(source, { agents: ['claude-code'] }))
    expect(await check()).toMatchObject({
      status: 'current',
      source: { repository: 'astrale-os/cli', revision: source.revision },
    })
    await rm(home.claudeLink('astrale-domain'))
    expect(await check()).toEqual({ status: 'repair-needed', installed: true })
    expect(
      await check({
        ...home.options(source),
        resolveSource: () => Promise.reject(new Error('offline')),
      }),
    ).toEqual({ status: 'unavailable', error: 'offline' })
  })

  test('removes a retired skill and keeps unrelated skills and lock entries', async () => {
    const home = await makeHome()
    await syncAstraleSkills(
      home.options(await makeSource([...NAMES, 'astrale-retired'], 'old'), {
        agents: ['claude-code'],
      }),
    )
    await mkdir(home.skill('third-party'), { recursive: true })
    await editLock(home, (lock) => {
      lock.skills['third-party'] = { source: 'someone/else' }
    })

    expect(await syncAstraleSkills(home.options(await makeSource(NAMES, 'latest')))).toEqual({
      status: 'updated',
    })
    expect(await absent(home.skill('astrale-retired'))).toBe(true)
    expect(await absent(home.claudeLink('astrale-retired'))).toBe(true)
    expect(await absent(home.skill('third-party'))).toBe(false)
    expect(Object.keys((await readLock(home)).skills).sort()).toEqual([...NAMES, 'third-party'])
  })

  test('an unreadable lock fails without touching the installed cohort', async () => {
    const source = await makeSource()
    const home = await makeHome()
    await syncAstraleSkills(home.options(source))
    const before = await tree(join(home.home, '.agents', 'skills'))
    await rm(home.lockPath)
    await mkdir(home.lockPath)

    await expect(syncAstraleSkills(home.options(source))).rejects.toMatchObject({
      code: 'SKILL_UPDATE_FAILED',
    })
    expect(await tree(join(home.home, '.agents', 'skills'))).toBe(before)
  })
})

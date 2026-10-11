import { createHash } from 'node:crypto'
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'

import { AstraleError } from '../../errors'
import { EMBEDDED_SKILLS } from '../../generated/embedded-assets'
import { paths } from '../../state'
import { withFileLock } from '../../state/files'
import { embeddedFiles } from '../embedded-assets'
import { skillAgents, type SkillAgent } from './agents'

declare const __ASTRALE_SOURCE_REVISION__: string | undefined

/**
 * Astrale-owned global skills: the cohort embedded in this binary, installed under
 * `~/.agents/skills`, recorded in the shared `skills` lock (version 3 format) and linked into
 * the global skill directories of the selected agents. Nothing shells out to Node or npx.
 */

const SOURCE_REPOSITORY = 'astrale-os/cli'
const SOURCE_REPOSITORY_URL = 'https://github.com/astrale-os/cli.git'
const SOURCE_REF = 'main'
const SAFE_NAME = /^[a-z0-9][a-z0-9._-]*$/iu

export const SKILL_INSTALL_HINT = 'astrale skills update'

export type SkillCheckResult = {
  status: 'current' | 'update-available' | 'repair-needed' | 'unavailable' | 'skipped'
  /** Derived from the canonical skill cohort on disk; never persisted separately. */
  installed?: boolean
  error?: string
  source?: {
    repository: typeof SOURCE_REPOSITORY
    revision: string
    skills: Array<{ name: string; tree: string; entrypoint: string }>
  }
}

export type SkillApplyResult = { status: 'unchanged' | 'installed' | 'updated' | 'repaired' }

export type AstraleSkillAgentStatus = SkillAgent & { configured: boolean }

type SourceSkill = {
  name: string
  /** Git tree hash of the skill directory. */
  tree: string
  files?: Array<{ path: string; mode: number; contents: string }>
}

export type AstraleSkillSource = {
  revision: string
  skills: SourceSkill[]
  /** Directory holding one folder per skill; production sources carry embedded bytes instead. */
  sourceRoot?: string
}

type SkillLockEntry = {
  source?: string
  sourceType?: string
  sourceUrl?: string
  ref?: string
  skillPath?: string
  skillFolderHash?: string
  installedAt?: string
  updatedAt?: string
  astraleSourceRevision?: string
  astraleSourceTree?: string
}

type SkillLock = {
  version: number
  skills: Record<string, SkillLockEntry>
  lastSelectedAgents?: string[]
}

type CohortState = 'absent' | 'current' | 'outdated' | 'unhealthy'

export type SkillSyncOptions = {
  home?: string
  lockPath?: string
  resolveSource?: () => Promise<AstraleSkillSource>
  agents?: string[]
  /** Unlink every agent outside `agents` instead of keeping previously configured ones. */
  replaceAgentSelection?: boolean
}

type Context = {
  home: string
  canonical: string
  lockPath: string
  options: SkillSyncOptions
}

function context(options: SkillSyncOptions = {}): Context {
  const home = options.home ?? (process.env.ASTRALE_SKILLS_HOME?.trim() || homedir())
  const xdgStateHome = options.home ? undefined : process.env.XDG_STATE_HOME
  return {
    home,
    canonical: join(home, '.agents', 'skills'),
    lockPath:
      options.lockPath ??
      (xdgStateHome
        ? join(xdgStateHome, 'skills', '.skill-lock.json')
        : join(home, '.agents', '.skill-lock.json')),
    options,
  }
}

function skillPath(name: string): string {
  return `skills/${name}/SKILL.md`
}

function isOwned(entry: SkillLockEntry): boolean {
  return (
    entry.source === SOURCE_REPOSITORY ||
    entry.sourceUrl === SOURCE_REPOSITORY_URL ||
    entry.sourceUrl === `https://github.com/${SOURCE_REPOSITORY}`
  )
}

/** The canonical folder an owned lock entry names, or null when it names an unsafe path. */
function ownedFolder(entry: SkillLockEntry): string | null {
  const name = entry.skillPath?.match(/^skills\/([^/]+)\/SKILL\.md$/u)?.[1]
  return name && SAFE_NAME.test(name) ? name : null
}

function ownedEntries(lock: SkillLock | null) {
  return Object.entries(lock?.skills ?? {}).flatMap(([key, entry]) =>
    isOwned(entry) ? [{ key, entry, folder: ownedFolder(entry) }] : [],
  )
}

async function embeddedSource(): Promise<AstraleSkillSource> {
  const files = embeddedFiles('skills')
  const skills = EMBEDDED_SKILLS.map((skill) => ({
    name: skill.name,
    tree: skill.tree,
    files: files
      .filter((file) => file.path.startsWith(`skills/${skill.name}/`))
      .map((file) => ({ ...file, path: file.path.slice(`skills/${skill.name}/`.length) })),
  }))
  const compiledRevision =
    typeof __ASTRALE_SOURCE_REVISION__ === 'string' ? __ASTRALE_SOURCE_REVISION__ : undefined
  if (compiledRevision !== undefined && !/^[0-9a-f]{40}$/u.test(compiledRevision)) {
    throw new Error('this Astrale binary has an invalid source revision')
  }
  return {
    revision: compiledRevision ?? `cli:${skills.map((skill) => skill.tree).join(':')}`,
    skills,
  }
}

async function readSource(ctx: Context): Promise<AstraleSkillSource> {
  const source = await (ctx.options.resolveSource ?? embeddedSource)()
  const names = source.skills.map((skill) => skill.name)
  if (!source.revision || names.length === 0 || new Set(names).size !== names.length) {
    throw new Error('invalid Astrale skill source')
  }
  for (const skill of source.skills) {
    if (!SAFE_NAME.test(skill.name) || !/^[0-9a-f]{40}$/u.test(skill.tree)) {
      throw new Error(`invalid Astrale skill source entry: ${skill.name}`)
    }
  }
  return source
}

async function readSkillLock(
  path: string,
): Promise<{ lock: SkillLock | null; raw: string | null }> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { lock: null, raw: null }
    throw error
  }
  try {
    const parsed = JSON.parse(raw) as Partial<SkillLock> | null
    const valid = parsed && typeof parsed.skills === 'object' && parsed.skills !== null
    return { lock: valid ? (parsed as SkillLock) : null, raw }
  } catch {
    return { lock: null, raw }
  }
}

async function writeSkillLock(path: string, contents: SkillLock | string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const next = `${path}.next`
  const text = typeof contents === 'string' ? contents : `${JSON.stringify(contents, null, 2)}\n`
  await writeFile(next, text, { mode: 0o600 })
  await rename(next, path)
}

function gitObjectHash(type: 'blob' | 'tree', body: Buffer): Buffer {
  return createHash('sha1')
    .update(Buffer.from(`${type} ${body.length}\0`))
    .update(body)
    .digest()
}

/** Git tree identity of the bytes actually installed on disk. */
export async function computeSkillTreeHash(root: string): Promise<string> {
  async function treeHash(directory: string): Promise<Buffer> {
    const entries = await Promise.all(
      (await readdir(directory)).map(async (name) => {
        const path = join(directory, name)
        const stat = await lstat(path)
        if (stat.isDirectory()) {
          return { name, sort: `${name}/`, mode: '40000', hash: await treeHash(path) }
        }
        const body = stat.isSymbolicLink()
          ? Buffer.from(await readlink(path))
          : await readFile(path)
        const mode = stat.isSymbolicLink() ? '120000' : stat.mode & 0o111 ? '100755' : '100644'
        return { name, sort: name, mode, hash: gitObjectHash('blob', body) }
      }),
    )
    entries.sort((a, b) => Buffer.compare(Buffer.from(a.sort), Buffer.from(b.sort)))
    return gitObjectHash(
      'tree',
      Buffer.concat(
        entries.flatMap((entry) => [Buffer.from(`${entry.mode} ${entry.name}\0`), entry.hash]),
      ),
    )
  }
  return (await treeHash(root)).toString('hex')
}

async function isDirectory(path: string): Promise<boolean> {
  return (await lstat(path).catch(() => null))?.isDirectory() ?? false
}

async function isLinkTo(path: string, target: string): Promise<boolean> {
  try {
    return (
      (await lstat(path)).isSymbolicLink() &&
      resolve(dirname(path), await readlink(path)) === target
    )
  } catch {
    return false
  }
}

/** Agent skill directories other than the canonical one, with the agents that read each. */
async function agentDirectories(ctx: Context): Promise<Map<string, SkillAgent[]>> {
  const canonical = await realpath(ctx.canonical).catch(() => ctx.canonical)
  const directories = new Map<string, SkillAgent[]>()
  for (const agent of skillAgents(ctx.home)) {
    const directory = agent.globalSkillsDir
    if (directory === ctx.canonical) continue
    // An agent directory may itself be a link to the canonical directory.
    if ((await realpath(directory).catch(() => directory)) === canonical) continue
    directories.set(directory, [...(directories.get(directory) ?? []), agent])
  }
  return directories
}

async function inspectCohort(
  ctx: Context,
  source: AstraleSkillSource,
): Promise<{ state: CohortState; folders: string[] }> {
  const { lock } = await readSkillLock(ctx.lockPath)
  const owned = ownedEntries(lock)
  const present = await Promise.all(
    source.skills.map((skill) => isDirectory(join(ctx.canonical, skill.name))),
  )
  if (owned.length === 0 && !present.includes(true)) return { state: 'absent', folders: [] }

  const folders = owned.flatMap(({ folder }) => (folder ? [folder] : []))
  let coherent = folders.length === owned.length && new Set(folders).size === folders.length
  const trees = new Map<string, string>()
  for (const { entry, folder } of owned) {
    if (!folder) continue
    const tree = await computeSkillTreeHash(join(ctx.canonical, folder)).catch(() => null)
    if (tree === null || entry.skillFolderHash !== tree) coherent = false
    else trees.set(folder, tree)
  }
  source.skills.forEach((skill, index) => {
    if (present[index] && !folders.includes(skill.name)) coherent = false
  })
  const selected = new Set(lock?.lastSelectedAgents ?? [])
  for (const [directory, agents] of await agentDirectories(ctx)) {
    const links = await Promise.all(
      source.skills.map((skill) =>
        isLinkTo(join(directory, skill.name), join(ctx.canonical, skill.name)),
      ),
    )
    const configured =
      links.includes(true) ||
      (agents.some((agent) => selected.has(agent.name)) &&
        (agents.some((agent) => agent.detected) || (await isDirectory(directory))))
    if (configured && links.includes(false)) coherent = false
  }
  const current =
    coherent &&
    owned.length === source.skills.length &&
    source.skills.every((skill) => {
      const entry = lock?.skills[skill.name]
      return (
        entry !== undefined &&
        isOwned(entry) &&
        entry.ref === SOURCE_REF &&
        trees.get(skill.name) === skill.tree &&
        entry.astraleSourceRevision === source.revision &&
        entry.astraleSourceTree === skill.tree
      )
    })
  return { state: current ? 'current' : coherent ? 'outdated' : 'unhealthy', folders }
}

async function assertNoForeignSkills(ctx: Context, source: AstraleSkillSource): Promise<void> {
  const { lock } = await readSkillLock(ctx.lockPath)
  const owned = new Set(ownedEntries(lock).flatMap(({ folder }) => (folder ? [folder] : [])))
  for (const skill of source.skills) {
    const entry = lock?.skills[skill.name]
    if (entry && !isOwned(entry)) {
      throw new Error(
        `the global skill lock already assigns ${skill.name} to another source; remove or rename that skill, then retry`,
      )
    }
    if (
      (await lstat(join(ctx.canonical, skill.name)).catch(() => null)) &&
      !owned.has(skill.name)
    ) {
      throw new Error(
        `~/.agents/skills/${skill.name} already exists and is not managed by Astrale; move it aside, then retry`,
      )
    }
  }
}

/** Agents whose directories receive skill links when the caller names none. */
async function configuredAgents(ctx: Context, names: readonly string[]): Promise<string[]> {
  const registry = skillAgents(ctx.home)
  const explicit = ctx.options.agents
  if (explicit) {
    const unknown = explicit.filter((name) => !registry.some((agent) => agent.name === name))
    if (unknown.length > 0) throw new Error(`unknown skill agent: ${unknown.join(', ')}`)
    return [...new Set(explicit)]
  }
  const { lock } = await readSkillLock(ctx.lockPath)
  const managed = new Set([
    ...names,
    ...ownedEntries(lock).flatMap(({ folder }) => (folder ? [folder] : [])),
  ])
  const configured = new Set<string>()
  for (const agent of registry) {
    if (agent.globalSkillsDir === ctx.canonical) continue
    for (const name of managed) {
      if (await isLinkTo(join(agent.globalSkillsDir, name), join(ctx.canonical, name))) {
        configured.add(agent.name)
        break
      }
    }
  }
  for (const name of lock?.lastSelectedAgents ?? []) {
    const agent = registry.find((candidate) => candidate.name === name)
    if (
      agent &&
      (agent.globalSkillsDir === ctx.canonical ||
        agent.detected ||
        (await isDirectory(agent.globalSkillsDir)))
    ) {
      configured.add(name)
    }
  }
  return [...configured]
}

/** Link `names` into every selected agent directory; returns whether anything changed. */
async function linkAgents(
  ctx: Context,
  names: readonly string[],
  selected: readonly string[],
): Promise<boolean> {
  let changed = false
  for (const [directory, agents] of await agentDirectories(ctx)) {
    const isSelected = agents.some((agent) => selected.includes(agent.name))
    if (!isSelected && !ctx.options.replaceAgentSelection) continue
    if (isSelected) await mkdir(directory, { recursive: true })
    for (const name of names) {
      const link = join(directory, name)
      const target = join(ctx.canonical, name)
      if ((await isLinkTo(link, target)) === isSelected) continue
      // Replace an agent's own copy of the skill, as `skills add` does; only unlink our links.
      await rm(link, { recursive: true, force: true })
      if (isSelected) await symlink(relative(directory, target), link)
      changed = true
    }
  }
  return changed
}

async function unlinkAgents(ctx: Context, names: readonly string[]): Promise<void> {
  for (const directory of (await agentDirectories(ctx)).keys()) {
    for (const name of names) {
      const link = join(directory, name)
      if (await isLinkTo(link, join(ctx.canonical, name))) await rm(link, { force: true })
    }
  }
}

async function install(
  ctx: Context,
  source: AstraleSkillSource,
  agents: string[],
  retired: string[],
): Promise<void> {
  await mkdir(ctx.canonical, { recursive: true })
  for (const skill of source.skills) {
    const target = join(ctx.canonical, skill.name)
    await rm(target, { recursive: true, force: true })
    if (source.sourceRoot) {
      await cp(join(source.sourceRoot, skill.name), target, { recursive: true })
      continue
    }
    if (!skill.files?.some((file) => file.path === 'SKILL.md')) {
      throw new Error(`embedded skill ${skill.name} has no SKILL.md`)
    }
    for (const file of skill.files) {
      if (file.path.split('/').some((part) => part === '' || part === '.' || part === '..')) {
        throw new Error(`unsafe skill path: ${file.path}`)
      }
      const destination = join(target, file.path)
      await mkdir(dirname(destination), { recursive: true })
      await writeFile(destination, Buffer.from(file.contents, 'base64'), { mode: file.mode })
    }
  }
  await unlinkAgents(ctx, retired)
  for (const name of retired) await rm(join(ctx.canonical, name), { recursive: true, force: true })

  const now = new Date().toISOString()
  const previous = (await readSkillLock(ctx.lockPath)).lock
  const skills = Object.fromEntries(
    Object.entries(previous?.skills ?? {}).filter(([, entry]) => !isOwned(entry)),
  )
  for (const skill of source.skills) {
    skills[skill.name] = {
      source: SOURCE_REPOSITORY,
      sourceType: 'github',
      sourceUrl: SOURCE_REPOSITORY_URL,
      ref: SOURCE_REF,
      skillPath: skillPath(skill.name),
      skillFolderHash: skill.tree,
      installedAt: previous?.skills[skill.name]?.installedAt ?? now,
      updatedAt: now,
      astraleSourceRevision: source.revision,
      astraleSourceTree: skill.tree,
    }
  }
  await writeSkillLock(ctx.lockPath, {
    ...previous,
    version: 3,
    skills,
    lastSelectedAgents: agents,
  })
  await linkAgents(
    ctx,
    source.skills.map((skill) => skill.name),
    agents,
  )
}

/** Exact prior state of the managed folders, the lock and the agent links to them. */
type Backup = {
  root: string
  folders: string[]
  copied: string[]
  lock: string | null
  links: Array<{ path: string; target: string }>
}

async function backup(ctx: Context, folders: string[]): Promise<Backup> {
  const root = await mkdtemp(join(tmpdir(), 'astrale-skill-backup-'))
  const copied: string[] = []
  for (const name of folders) {
    if (!(await lstat(join(ctx.canonical, name)).catch(() => null))) continue
    await cp(join(ctx.canonical, name), join(root, name), { recursive: true })
    copied.push(name)
  }
  const links: Backup['links'] = []
  for (const directory of (await agentDirectories(ctx)).keys()) {
    for (const name of folders) {
      const path = join(directory, name)
      if ((await lstat(path).catch(() => null))?.isSymbolicLink()) {
        links.push({ path, target: await readlink(path) })
      }
    }
  }
  return { root, folders, copied, lock: (await readSkillLock(ctx.lockPath)).raw, links }
}

async function restore(ctx: Context, saved: Backup, previous: CohortState): Promise<void> {
  await unlinkAgents(ctx, saved.folders)
  for (const name of saved.folders) {
    await rm(join(ctx.canonical, name), { recursive: true, force: true })
  }
  // An absent or unhealthy cohort is removed rather than reinstated; foreign links survive.
  const reinstate = previous === 'outdated' || previous === 'current'
  if (reinstate) {
    for (const name of saved.copied) {
      await cp(join(saved.root, name), join(ctx.canonical, name), { recursive: true })
    }
    if (saved.lock === null) await rm(ctx.lockPath, { force: true })
    else await writeSkillLock(ctx.lockPath, saved.lock)
  } else {
    const { lock } = await readSkillLock(ctx.lockPath)
    if (lock) {
      lock.skills = Object.fromEntries(
        Object.entries(lock.skills).filter(([, entry]) => !isOwned(entry)),
      )
      await writeSkillLock(ctx.lockPath, lock)
    }
  }
  for (const link of saved.links) {
    const ours =
      resolve(dirname(link.path), link.target) === join(ctx.canonical, basename(link.path))
    if (ours && !reinstate) continue
    await mkdir(dirname(link.path), { recursive: true })
    await rm(link.path, { recursive: true, force: true })
    await symlink(link.target, link.path)
  }
}

function skillFailure(error: unknown): AstraleError {
  const detail = error instanceof Error && error.message.trim() ? `: ${error.message}` : ''
  return new AstraleError(
    'SKILL_UPDATE_FAILED',
    `Astrale could not install and verify its agent skills${detail}`,
    `Retry with \`${SKILL_INSTALL_HINT}\`.`,
    error instanceof Error ? { cause: error } : undefined,
  )
}

/** Agent picker data. Installed/configured agents are preselected by callers. */
export async function astraleSkillAgents(
  options: Pick<SkillSyncOptions, 'home' | 'lockPath'> = {},
): Promise<AstraleSkillAgentStatus[]> {
  const ctx = context(options)
  const configured = new Set(
    await configuredAgents(
      ctx,
      EMBEDDED_SKILLS.map((skill) => skill.name),
    ),
  )
  return skillAgents(ctx.home).map((agent) => ({
    ...agent,
    configured: configured.has(agent.name),
  }))
}

/** Read-only source, freshness, and local integrity check. */
export async function checkAstraleSkills(
  options: SkillSyncOptions = {},
): Promise<SkillCheckResult> {
  const ctx = context(options)
  try {
    const source = await readSource(ctx)
    const { state } = await inspectCohort(ctx, source)
    if (state !== 'current') {
      return {
        status: state === 'unhealthy' ? 'repair-needed' : 'update-available',
        installed: state !== 'absent',
      }
    }
    return {
      status: 'current',
      installed: true,
      source: {
        repository: SOURCE_REPOSITORY,
        revision: source.revision,
        skills: source.skills.map(({ name, tree }) => ({
          name,
          tree,
          entrypoint: skillPath(name),
        })),
      },
    }
  } catch (error) {
    return { status: 'unavailable', error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Make the Astrale-owned cohort current and internally consistent. A failed installation
 * restores the prior healthy cohort (or removes an unhealthy one) and never reports success.
 */
export async function syncAstraleSkills(options: SkillSyncOptions = {}): Promise<SkillApplyResult> {
  const ctx = context(options)
  const astraleHome = options.home ? join(ctx.home, '.astrale') : paths.home
  try {
    const source = await readSource(ctx)
    return await withFileLock(join(astraleHome, 'locks', 'skills-update.lock'), async () => {
      await assertNoForeignSkills(ctx, source)
      const initial = await inspectCohort(ctx, source)
      const names = source.skills.map((skill) => skill.name)
      const agents = await configuredAgents(ctx, names)
      if (initial.state === 'current' && !options.replaceAgentSelection) {
        return { status: (await linkAgents(ctx, names, agents)) ? 'repaired' : 'unchanged' }
      }
      const retired = initial.folders.filter((name) => !names.includes(name))
      const saved = await backup(ctx, [...new Set([...names, ...initial.folders])])
      try {
        await install(ctx, source, agents, retired)
        if ((await inspectCohort(ctx, source)).state !== 'current') {
          throw new Error('installed Astrale skills did not pass verification')
        }
      } catch (error) {
        await restore(ctx, saved, initial.state)
        throw error
      } finally {
        await rm(saved.root, { recursive: true, force: true })
      }
      const status = {
        current: 'unchanged',
        absent: 'installed',
        outdated: 'updated',
        unhealthy: 'repaired',
      } as const
      return { status: status[initial.state] }
    })
  } catch (error) {
    throw error instanceof AstraleError ? error : skillFailure(error)
  }
}

import { createHash } from 'node:crypto'
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'

import { AstraleError } from '../../errors'
import { EMBEDDED_SKILLS } from '../../generated/embedded-assets'
import { embeddedFiles } from '../embedded-assets'
import { skillAgents } from './agents'
import { withFileLock } from './lock'

declare const __ASTRALE_SOURCE_REVISION__: string | undefined

/**
 * Astrale-owned global skill reconciliation. The standalone binary owns the
 * canonical skill cohort and the selected agent links; it does not shell out to
 * Node, npx, Git, or a package manager.
 */

/** Published source whose top-level skill directories Astrale owns as one cohort. */
export const ASTRALE_CLI_SKILL_SOURCE = 'astrale-os/cli'
export const ASTRALE_SKILL_REPAIR_COMMAND = 'astrale skills update'

/** Lock/agent compatibility target implemented by the native manager. */
export const SKILLS_INSTALLER_PACKAGE = 'skills@1.5.23'

/** Human-facing recovery stays on the Astrale-owned, verified path. */
export const SKILL_INSTALL_HINT = ASTRALE_SKILL_REPAIR_COMMAND

export type SkillCheckStatus =
  | 'current'
  | 'update-available'
  | 'repair-needed'
  | 'unavailable'
  | 'skipped'

export type SkillApplyStatus =
  | 'unchanged'
  | 'installed'
  | 'updated'
  | 'repaired'
  | 'failed'
  | 'skipped'

export type SkillCheckResult = {
  status: SkillCheckStatus
  /** Derived from the canonical skill cohort on disk; never persisted separately. */
  installed?: boolean
  error?: string
  source?: {
    repository: typeof ASTRALE_CLI_SKILL_SOURCE
    revision: string
    skills: Array<{ name: string; tree: string; entrypoint: string }>
  }
}

export type SkillApplyResult = {
  status: SkillApplyStatus
}

export type AstraleSkillAgentStatus = {
  name: string
  displayName: string
  globalSkillsDir: string
  detected: boolean
  configured: boolean
}

type SourceSkillFile = { path: string; mode: number; contents: string }
type SourceSkill = { name: string; path: string; tree: string; files?: SourceSkillFile[] }
export type AstraleSkillSourceSnapshot = {
  ref: 'main'
  revision: string
  skills: SourceSkill[]
  /** Test/dev source; production snapshots carry embedded file bytes. */
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
  dismissed?: Record<string, unknown>
}

type SkillState = 'absent' | 'current' | 'outdated' | 'unhealthy'

type SkillInspection = {
  state: SkillState
  sourceCurrent: boolean
  managedNames: string[]
  managedFolders: string[]
}

export type SkillSyncDependencies = {
  home?: string
  lockPath?: string
  resolveSource?: () => Promise<AstraleSkillSourceSnapshot>
  /** Test-only adapter for exercising transactional failure paths. */
  run?: (file: string, args?: string[]) => Promise<{ code: number; stdout: string; stderr: string }>
  agents?: string[]
  replaceAgentSelection?: boolean
}

const SOURCE_REPOSITORY_URL = 'https://github.com/astrale-os/cli.git'
const SAFE_NAME = /^[a-z0-9][a-z0-9._-]*$/iu

function resolvedDependencies(overrides: SkillSyncDependencies = {}) {
  const environmentHome = process.env.ASTRALE_SKILLS_HOME?.trim()
  const isolatedHome = overrides.home ?? (environmentHome || undefined)
  const home = isolatedHome ?? homedir()
  const xdgStateHome = overrides.home ? undefined : process.env.XDG_STATE_HOME
  return {
    home,
    lockPath:
      overrides.lockPath ??
      (xdgStateHome
        ? join(xdgStateHome, 'skills', '.skill-lock.json')
        : join(home, '.agents', '.skill-lock.json')),
    run: overrides.run,
    resolveSource: overrides.resolveSource,
    agents: overrides.agents,
    replaceAgentSelection: overrides.replaceAgentSelection ?? false,
  }
}

function sourceOwned(entry: SkillLockEntry): boolean {
  return (
    entry.source === ASTRALE_CLI_SKILL_SOURCE ||
    entry.sourceUrl === SOURCE_REPOSITORY_URL ||
    entry.sourceUrl === `https://github.com/${ASTRALE_CLI_SKILL_SOURCE}`
  )
}

function folderName(entry: SkillLockEntry): string | null {
  const match = entry.skillPath?.match(/^skills\/([^/]+)\/SKILL\.md$/u)
  const name = match?.[1]
  return name && SAFE_NAME.test(name) ? name : null
}

async function resolveAstraleSkillSource(): Promise<AstraleSkillSourceSnapshot> {
  const files = embeddedFiles('skills')
  const skills = EMBEDDED_SKILLS.map((skill) => ({
    ...skill,
    files: files
      .filter((file) => file.path.startsWith(`skills/${skill.name}/`))
      .map((file) => ({
        path: file.path.slice(`skills/${skill.name}/`.length),
        mode: file.mode,
        contents: file.contents,
      })),
  }))
  if (skills.length === 0) throw new Error('this Astrale binary embeds no agent skills')
  const compiledRevision =
    typeof __ASTRALE_SOURCE_REVISION__ === 'string' ? __ASTRALE_SOURCE_REVISION__ : undefined
  if (compiledRevision !== undefined && !/^[0-9a-f]{40}$/u.test(compiledRevision)) {
    throw new Error('this Astrale binary has an invalid source revision')
  }
  return {
    ref: 'main',
    revision: compiledRevision ?? `cli:${skills.map((skill) => skill.tree).join(':')}`,
    skills,
  }
}

async function readSkillLock(
  path: string,
): Promise<{ lock: SkillLock | null; raw: string | null }> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return { lock: null, raw: null }
    throw error
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      !('skills' in parsed) ||
      (parsed as { skills?: unknown }).skills === null ||
      typeof (parsed as { skills?: unknown }).skills !== 'object'
    ) {
      return { lock: null, raw }
    }
    return { lock: parsed as SkillLock, raw }
  } catch {
    return { lock: null, raw }
  }
}

async function writeSkillLock(path: string, lock: SkillLock): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const next = `${path}.next`
  await writeFile(next, `${JSON.stringify(lock, null, 2)}\n`, { mode: 0o600 })
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
        if (stat.isSymbolicLink()) {
          return {
            name,
            sort: name,
            mode: '120000',
            hash: gitObjectHash('blob', Buffer.from(await readlink(path))),
          }
        }
        return {
          name,
          sort: name,
          mode: stat.mode & 0o111 ? '100755' : '100644',
          hash: gitObjectHash('blob', await readFile(path)),
        }
      }),
    )
    entries.sort((a, b) => Buffer.compare(Buffer.from(a.sort), Buffer.from(b.sort)))
    const body = Buffer.concat(
      entries.flatMap((entry) => [Buffer.from(`${entry.mode} ${entry.name}\0`), entry.hash]),
    )
    return gitObjectHash('tree', body)
  }
  return (await treeHash(root)).toString('hex')
}

async function computeInstallerFolderHash(root: string): Promise<string> {
  const files: Array<{ path: string; content: Buffer }> = []
  async function collect(directory: string): Promise<void> {
    await Promise.all(
      (await readdir(directory, { withFileTypes: true })).map(async (entry) => {
        if (entry.name === '.git' || entry.name === 'node_modules') return
        const path = join(directory, entry.name)
        if (entry.isDirectory()) await collect(path)
        else if (entry.isFile()) {
          files.push({
            path: relative(root, path).split('\\').join('/'),
            content: await readFile(path),
          })
        }
      }),
    )
  }
  await collect(root)
  files.sort((a, b) => a.path.localeCompare(b.path))
  const hash = createHash('sha256')
  for (const file of files) hash.update(file.path).update(file.content)
  return hash.digest('hex')
}

async function inspectAstraleSkills(
  snapshot: AstraleSkillSourceSnapshot,
  home: string,
  lockPath: string,
): Promise<SkillInspection> {
  const { lock } = await readSkillLock(lockPath)
  const managed = Object.entries(lock?.skills ?? {}).filter(([, entry]) => sourceOwned(entry))
  const expected = new Map(snapshot.skills.map((skill) => [skill.name, skill]))
  const expectedPresence = await Promise.all(
    snapshot.skills.map(async (skill) => {
      try {
        return (await lstat(join(home, '.agents', 'skills', skill.name))).isDirectory()
      } catch {
        return false
      }
    }),
  )
  if (managed.length === 0 && expectedPresence.every((present) => !present)) {
    return { state: 'absent', sourceCurrent: false, managedNames: [], managedFolders: [] }
  }

  const folders = managed.flatMap(([name, entry]) => {
    const folder = folderName(entry)
    return folder ? [{ key: name, folder, entry }] : []
  })
  const uniqueFolders = new Set(folders.map((entry) => entry.folder))
  let coherent = folders.length === managed.length && uniqueFolders.size === folders.length
  const actualHashes = new Map<string, string>()
  for (const item of folders) {
    try {
      const root = join(home, '.agents', 'skills', item.folder)
      const actual = await computeSkillTreeHash(root)
      actualHashes.set(item.folder, actual)
      const receiptHash = item.entry.skillFolderHash
      if (
        !receiptHash ||
        (receiptHash.length === 40
          ? actual !== receiptHash
          : receiptHash.length === 64
            ? (await computeInstallerFolderHash(root)) !== receiptHash
            : true)
      ) {
        coherent = false
      }
      if (item.entry.skillPath !== `skills/${item.folder}/SKILL.md`) coherent = false
    } catch {
      coherent = false
    }
  }
  for (const [index, skill] of snapshot.skills.entries()) {
    if (expectedPresence[index] && !uniqueFolders.has(skill.name)) coherent = false
  }
  const canonical = join(home, '.agents', 'skills')
  const selected = new Set(lock?.lastSelectedAgents ?? [])
  const agentDirectories = new Map<string, ReturnType<typeof skillAgents>>()
  for (const agent of skillAgents(home)) {
    if (agent.globalSkillsDir === canonical) continue
    const group = agentDirectories.get(agent.globalSkillsDir) ?? []
    group.push(agent)
    agentDirectories.set(agent.globalSkillsDir, group)
  }
  for (const [directory, agents] of agentDirectories) {
    const links = await Promise.all(
      snapshot.skills.map((skill) =>
        isCanonicalLink(join(directory, skill.name), join(canonical, skill.name)),
      ),
    )
    const configured =
      links.some(Boolean) ||
      (agents.some((agent) => selected.has(agent.name)) &&
        (agents.some((agent) => agent.detected) || (await directoryExists(directory))))
    if (configured && !links.every(Boolean)) coherent = false
  }
  const sourceCurrent =
    coherent &&
    managed.length === snapshot.skills.length &&
    folders.every(({ key, folder, entry }) => {
      const skill = expected.get(folder)
      return (
        key === folder &&
        skill !== undefined &&
        entry.ref === snapshot.ref &&
        actualHashes.get(folder) === skill.tree
      )
    })
  const exactCurrent =
    sourceCurrent &&
    folders.every(({ folder, entry }) => {
      const skill = expected.get(folder)
      return (
        skill !== undefined &&
        entry.astraleSourceRevision === snapshot.revision &&
        entry.astraleSourceTree === skill.tree
      )
    })

  return {
    state: exactCurrent ? 'current' : coherent ? 'outdated' : 'unhealthy',
    sourceCurrent,
    managedNames: managed.map(([name]) => name),
    managedFolders: [...uniqueFolders],
  }
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory()
  } catch {
    return false
  }
}

async function assertNoForeignSkillConflicts(
  snapshot: AstraleSkillSourceSnapshot,
  home: string,
  lockPath: string,
): Promise<void> {
  const { lock } = await readSkillLock(lockPath)
  const ownedFolders = new Set(
    Object.values(lock?.skills ?? {}).flatMap((entry) => {
      const folder = folderName(entry)
      return sourceOwned(entry) && folder ? [folder] : []
    }),
  )
  for (const skill of snapshot.skills) {
    const namedEntry = lock?.skills[skill.name]
    if (namedEntry && !sourceOwned(namedEntry)) {
      throw new Error(
        `the global skill lock already assigns ${skill.name} to another source; remove or rename that skill, then retry`,
      )
    }
    try {
      await lstat(join(home, '.agents', 'skills', skill.name))
      if (!ownedFolders.has(skill.name)) {
        throw new Error(
          `~/.agents/skills/${skill.name} already exists and is not managed by Astrale; move it aside, then retry`,
        )
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}

async function sourceSnapshot(dependencies: ReturnType<typeof resolvedDependencies>) {
  const snapshot = dependencies.resolveSource
    ? await dependencies.resolveSource()
    : await resolveAstraleSkillSource()
  if (
    snapshot.ref !== 'main' ||
    !snapshot.revision ||
    snapshot.skills.length === 0 ||
    new Set(snapshot.skills.map((skill) => skill.name)).size !== snapshot.skills.length
  ) {
    throw new Error('invalid Astrale skill source snapshot')
  }
  for (const skill of snapshot.skills) {
    if (
      !SAFE_NAME.test(skill.name) ||
      skill.path !== `skills/${skill.name}/SKILL.md` ||
      !/^[0-9a-f]{40}$/u.test(skill.tree)
    ) {
      throw new Error(`invalid Astrale skill source entry: ${skill.name}`)
    }
  }
  return snapshot
}

/** Compatibility-shaped arguments used only by the injected failure-test adapter. */
function installerArgs(...args: string[]): string[] {
  return ['--yes', SKILLS_INSTALLER_PACKAGE, ...args]
}

async function installSnapshot(
  snapshot: AstraleSkillSourceSnapshot,
  dependencies: ReturnType<typeof resolvedDependencies>,
  selectedAgents: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  if (dependencies.run) {
    return dependencies.run(
      '__astrale_native_skills__',
      installerArgs(
        'add',
        `${ASTRALE_CLI_SKILL_SOURCE}#${snapshot.ref}`,
        '-g',
        '-y',
        '--skill',
        ...snapshot.skills.map((skill) => skill.name),
        ...(selectedAgents.length > 0 ? ['--agent', ...selectedAgents] : []),
      ),
    )
  }

  const canonicalRoot = join(dependencies.home, '.agents', 'skills')
  await mkdir(canonicalRoot, { recursive: true })
  for (const skill of snapshot.skills) {
    const target = join(canonicalRoot, skill.name)
    await rm(target, { recursive: true, force: true })
    if (snapshot.sourceRoot) {
      await cp(join(snapshot.sourceRoot, skill.name), target, {
        recursive: true,
        dereference: false,
      })
      continue
    }
    if (!skill.files?.some((file) => file.path === 'SKILL.md')) {
      throw new Error(`embedded skill ${skill.name} has no SKILL.md`)
    }
    for (const file of skill.files) {
      if (!safeRelativePath(file.path)) throw new Error(`unsafe skill path: ${file.path}`)
      const destination = join(target, file.path)
      await mkdir(dirname(destination), { recursive: true })
      await writeFile(destination, Buffer.from(file.contents, 'base64'), { mode: file.mode })
    }
  }

  const now = new Date().toISOString()
  const current = await readSkillLock(dependencies.lockPath)
  const lock: SkillLock = current.lock ?? { version: 3, skills: {} }
  lock.version = 3
  for (const [name, entry] of Object.entries(lock.skills)) {
    if (sourceOwned(entry)) delete lock.skills[name]
  }
  for (const skill of snapshot.skills) {
    const previous = current.lock?.skills[skill.name]
    lock.skills[skill.name] = {
      source: ASTRALE_CLI_SKILL_SOURCE,
      sourceType: 'github',
      sourceUrl: SOURCE_REPOSITORY_URL,
      ref: snapshot.ref,
      skillPath: skill.path,
      skillFolderHash: skill.tree,
      installedAt: previous?.installedAt ?? now,
      updatedAt: now,
    }
  }
  lock.lastSelectedAgents = selectedAgents
  await writeSkillLock(dependencies.lockPath, lock)
  await reconcileAgentLinks(
    dependencies.home,
    snapshot.skills.map((skill) => skill.name),
    selectedAgents,
    dependencies.replaceAgentSelection,
  )
  return { code: 0, stdout: '', stderr: '' }
}

function safeRelativePath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith('/') &&
    !path.split('/').some((part) => part === '' || part === '..' || part === '.')
  )
}

async function stampAstraleSource(
  snapshot: AstraleSkillSourceSnapshot,
  lockPath: string,
): Promise<void> {
  const { lock } = await readSkillLock(lockPath)
  if (!lock) throw new Error('skill installer receipt is unavailable after installation')
  for (const skill of snapshot.skills) {
    const entry = lock.skills[skill.name]
    if (
      !entry ||
      !sourceOwned(entry) ||
      entry.ref !== snapshot.ref ||
      entry.skillPath !== skill.path
    ) {
      throw new Error(`skill installer receipt is incomplete for ${skill.name}`)
    }
    entry.astraleSourceRevision = snapshot.revision
    entry.astraleSourceTree = skill.tree
  }
  await writeSkillLock(lockPath, lock)
}

async function selectedAgents(
  home: string,
  lockPath: string,
  explicit?: string[],
  expectedNames: readonly string[] = EMBEDDED_SKILLS.map((skill) => skill.name),
): Promise<string[]> {
  const registry = skillAgents(home)
  const known = new Set(registry.map((agent) => agent.name))
  if (explicit) {
    const invalid = explicit.filter((agent) => !known.has(agent))
    if (invalid.length > 0) throw new Error(`unknown skill agent: ${invalid.join(', ')}`)
    return [...new Set(explicit)]
  }
  const { lock } = await readSkillLock(lockPath)
  const canonical = join(home, '.agents', 'skills')
  const managedNames = new Set([
    ...expectedNames,
    ...Object.values(lock?.skills ?? {}).flatMap((entry) => {
      const name = folderName(entry)
      return sourceOwned(entry) && name ? [name] : []
    }),
  ])
  const configured = new Set<string>()
  for (const agent of registry) {
    if (agent.globalSkillsDir === canonical) continue
    for (const name of managedNames) {
      if (await isCanonicalLink(join(agent.globalSkillsDir, name), join(canonical, name))) {
        configured.add(agent.name)
        break
      }
    }
  }
  for (const name of lock?.lastSelectedAgents ?? []) {
    const agent = registry.find((candidate) => candidate.name === name)
    if (!agent) continue
    if (
      agent.globalSkillsDir === canonical ||
      agent.detected ||
      (await directoryExists(agent.globalSkillsDir))
    ) {
      configured.add(name)
    }
  }
  return [...configured]
}

async function cleanManagedState(names: string[], home: string, lockPath: string): Promise<void> {
  for (const name of names) {
    await rm(join(home, '.agents', 'skills', name), { recursive: true, force: true })
  }
  const { lock, raw } = await readSkillLock(lockPath)
  if (!lock) {
    if (raw !== null) await rm(lockPath, { force: true })
    return
  }
  for (const [name, entry] of Object.entries(lock.skills)) {
    if (sourceOwned(entry)) delete lock.skills[name]
  }
  await writeSkillLock(lockPath, lock)
}

async function removeKnownAgentLinks(names: string[], home: string): Promise<void> {
  const canonical = join(home, '.agents', 'skills')
  for (const agent of skillAgents(home)) {
    if (agent.globalSkillsDir === canonical) continue
    for (const name of names) {
      const link = join(agent.globalSkillsDir, name)
      if (await isCanonicalLink(link, join(canonical, name))) await rm(link, { force: true })
    }
  }
}

async function isCanonicalLink(path: string, canonical: string): Promise<boolean> {
  try {
    return (
      (await lstat(path)).isSymbolicLink() &&
      resolve(dirname(path), await readlink(path)) === canonical
    )
  } catch {
    return false
  }
}

async function reconcileAgentLinks(
  home: string,
  names: string[],
  selected: string[],
  replaceSelection: boolean,
): Promise<boolean> {
  const canonicalRoot = join(home, '.agents', 'skills')
  const selectedSet = new Set(selected)
  const directories = new Map<string, ReturnType<typeof skillAgents>>()
  for (const agent of skillAgents(home)) {
    if (agent.globalSkillsDir === canonicalRoot) continue
    const group = directories.get(agent.globalSkillsDir) ?? []
    group.push(agent)
    directories.set(agent.globalSkillsDir, group)
  }
  let changed = false
  for (const [directory, agents] of directories) {
    const selectedDirectory = agents.some((agent) => selectedSet.has(agent.name))
    if (replaceSelection && !selectedDirectory) {
      for (const name of names) {
        const target = join(directory, name)
        if (await isCanonicalLink(target, join(canonicalRoot, name))) {
          await rm(target, { force: true })
          changed = true
        }
      }
      continue
    }
    if (!selectedDirectory) continue
    await mkdir(directory, { recursive: true })
    for (const name of names) {
      const target = join(directory, name)
      const canonical = join(canonicalRoot, name)
      if (await isCanonicalLink(target, canonical)) continue
      try {
        await lstat(target)
        throw new Error(
          `${target} already exists and is not managed by Astrale; move it aside, then retry`,
        )
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      await symlink(relative(dirname(target), canonical), target)
      changed = true
    }
  }
  return changed
}

async function pruneObsoleteEntries(
  snapshot: AstraleSkillSourceSnapshot,
  home: string,
  lockPath: string,
  knownRetired: string[],
): Promise<void> {
  const expected = new Set(snapshot.skills.map((skill) => skill.name))
  const { lock } = await readSkillLock(lockPath)
  const retiredEntries = Object.entries(lock?.skills ?? {}).filter(([, entry]) => {
    const folder = folderName(entry)
    return sourceOwned(entry) && folder !== null && !expected.has(folder)
  })
  const retired = [
    ...new Set([
      ...knownRetired,
      ...retiredEntries.flatMap(([, entry]) => folderName(entry) ?? []),
    ]),
  ]
  const refreshed = await readSkillLock(lockPath)
  if (!refreshed.lock) return
  let changed = false
  for (const [name, entry] of Object.entries(refreshed.lock.skills)) {
    if (!sourceOwned(entry)) continue
    const folder = folderName(entry)
    if (folder === null || name !== folder || !expected.has(folder)) {
      delete refreshed.lock.skills[name]
      changed = true
    }
  }
  if (changed) await writeSkillLock(lockPath, refreshed.lock)

  await removeKnownAgentLinks(retired, home)
  for (const name of retired) {
    await rm(join(home, '.agents', 'skills', name), { recursive: true, force: true })
  }
}

type SkillBackup = {
  root: string
  names: string[]
  copied: string[]
  links: AgentLinkBackup[]
  lockRaw: string | null
  createdAt: string
  phase: 'prepared' | 'verified'
}

type AgentLinkBackup = { directory: string; name: string; target: string }

const BACKUP_PREFIX = '.astrale-skill-backup-'
const BACKUP_MANIFEST = '.manifest.json'

async function captureAgentLinks(home: string, names: string[]): Promise<AgentLinkBackup[]> {
  const links: AgentLinkBackup[] = []
  const canonical = join(home, '.agents', 'skills')
  const seen = new Set<string>()
  for (const agent of skillAgents(home)) {
    if (agent.globalSkillsDir === canonical || seen.has(agent.globalSkillsDir)) continue
    seen.add(agent.globalSkillsDir)
    for (const name of names) {
      const path = join(agent.globalSkillsDir, name)
      try {
        if ((await lstat(path)).isSymbolicLink()) {
          links.push({ directory: agent.globalSkillsDir, name, target: await readlink(path) })
        }
      } catch {
        // Only existing symlinks need transactional restoration.
      }
    }
  }
  return links
}

async function writeBackupManifest(backup: SkillBackup): Promise<void> {
  const next = join(backup.root, `${BACKUP_MANIFEST}.next`)
  await writeFile(next, JSON.stringify(backup), { mode: 0o600 })
  await rename(next, join(backup.root, BACKUP_MANIFEST))
}

async function captureBackup(home: string, lockPath: string, names: string[]) {
  const agentsRoot = join(home, '.agents')
  await mkdir(agentsRoot, { recursive: true })
  const root = await mkdtemp(join(agentsRoot, BACKUP_PREFIX))
  const copied: string[] = []
  for (const name of names) {
    const source = join(agentsRoot, 'skills', name)
    try {
      await cp(source, join(root, name), { recursive: true, dereference: false })
      copied.push(name)
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') throw error
    }
  }
  const lock = await readSkillLock(lockPath)
  const backup: SkillBackup = {
    root,
    names,
    copied,
    links: await captureAgentLinks(home, names),
    lockRaw: lock.raw,
    createdAt: new Date().toISOString(),
    phase: 'prepared',
  }
  await writeBackupManifest(backup)
  return backup
}

async function extendBackup(backup: SkillBackup, home: string, names: string[]): Promise<void> {
  const additions = names.filter((name) => !backup.names.includes(name))
  if (additions.length === 0) return
  for (const name of additions) {
    const source = join(home, '.agents', 'skills', name)
    try {
      await cp(source, join(backup.root, name), { recursive: true, dereference: false })
      backup.copied.push(name)
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') throw error
    }
  }
  backup.names.push(...additions)
  backup.links.push(...(await captureAgentLinks(home, additions)))
  await writeBackupManifest(backup)
}

async function restoreAgentLinks(
  backup: SkillBackup,
  home: string,
  onlyForeign = false,
): Promise<void> {
  for (const link of backup.links) {
    const path = join(link.directory, link.name)
    const canonical = join(home, '.agents', 'skills', link.name)
    if (onlyForeign && resolve(dirname(path), link.target) === canonical) continue
    await mkdir(dirname(path), { recursive: true })
    await rm(path, { recursive: true, force: true })
    await symlink(link.target, path)
  }
}

async function restoreBackup(
  backup: Awaited<ReturnType<typeof captureBackup>>,
  home: string,
  lockPath: string,
): Promise<void> {
  for (const name of backup.names) {
    await rm(join(home, '.agents', 'skills', name), { recursive: true, force: true })
  }
  await mkdir(join(home, '.agents', 'skills'), { recursive: true })
  for (const name of backup.copied) {
    await cp(join(backup.root, name), join(home, '.agents', 'skills', name), {
      recursive: true,
      dereference: false,
    })
  }
  if (backup.lockRaw === null) await rm(lockPath, { force: true })
  else {
    await mkdir(dirname(lockPath), { recursive: true })
    const next = `${lockPath}.restore`
    await writeFile(next, backup.lockRaw, { mode: 0o600 })
    await rename(next, lockPath)
  }
  await removeKnownAgentLinks(backup.names, home)
  await restoreAgentLinks(backup, home)
}

async function recoverInterruptedBackup(home: string, lockPath: string): Promise<void> {
  const agentsRoot = join(home, '.agents')
  const candidates = (await readdir(agentsRoot, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(BACKUP_PREFIX))
    .map((entry) => join(agentsRoot, entry.name))
  const backups: SkillBackup[] = []
  for (const root of candidates) {
    try {
      const parsed = JSON.parse(await readFile(join(root, BACKUP_MANIFEST), 'utf8')) as SkillBackup
      if (
        Array.isArray(parsed.names) &&
        parsed.names.every((name) => typeof name === 'string' && SAFE_NAME.test(name)) &&
        Array.isArray(parsed.copied) &&
        parsed.copied.every((name) => typeof name === 'string' && parsed.names.includes(name)) &&
        Array.isArray(parsed.links) &&
        (typeof parsed.lockRaw === 'string' || parsed.lockRaw === null) &&
        typeof parsed.createdAt === 'string' &&
        (parsed.phase === 'prepared' || parsed.phase === 'verified') &&
        parsed.links.every(
          (link) =>
            link !== null &&
            typeof link === 'object' &&
            typeof link.directory === 'string' &&
            skillAgents(home).some((agent) => agent.globalSkillsDir === link.directory) &&
            typeof link.name === 'string' &&
            parsed.names.includes(link.name) &&
            typeof link.target === 'string',
        )
      ) {
        const backup = { ...parsed, root }
        if (backup.phase === 'verified') await rm(root, { recursive: true, force: true })
        else backups.push(backup)
      } else {
        await rm(root, { recursive: true, force: true })
      }
    } catch {
      // The live cohort is untouched until the manifest is complete.
      await rm(root, { recursive: true, force: true })
    }
  }
  if (backups.length === 0) return
  backups.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  await restoreBackup(backups[0], home, lockPath)
  await Promise.all(candidates.map((root) => rm(root, { recursive: true, force: true })))
}

async function markBackupVerified(backup: SkillBackup): Promise<void> {
  backup.phase = 'verified'
  await writeBackupManifest(backup)
}

function skillFailure(error: unknown): AstraleError {
  const detail = error instanceof Error && error.message.trim() ? `: ${error.message}` : ''
  return new AstraleError(
    'SKILL_UPDATE_FAILED',
    `Astrale could not install and verify its agent skills${detail}`,
    `Retry with \`${ASTRALE_SKILL_REPAIR_COMMAND}\`.`,
    error instanceof Error ? { cause: error } : undefined,
  )
}

/** Agent picker data. Installed/configured agents are preselected by callers. */
export async function astraleSkillAgents(
  overrides: Pick<SkillSyncDependencies, 'home' | 'lockPath'> = {},
): Promise<AstraleSkillAgentStatus[]> {
  const dependencies = resolvedDependencies(overrides)
  const configured = new Set(
    await selectedAgents(dependencies.home, dependencies.lockPath, undefined),
  )
  return skillAgents(dependencies.home).map((agent) => ({
    ...agent,
    configured: configured.has(agent.name),
  }))
}

/** Read-only source, freshness, and local integrity check. */
export async function checkAstraleSkills(
  overrides: SkillSyncDependencies = {},
): Promise<SkillCheckResult> {
  const dependencies = resolvedDependencies(overrides)
  try {
    const snapshot = await sourceSnapshot(dependencies)
    const inspection = await inspectAstraleSkills(
      snapshot,
      dependencies.home,
      dependencies.lockPath,
    )
    const status =
      inspection.state === 'current'
        ? 'current'
        : inspection.state === 'unhealthy'
          ? 'repair-needed'
          : 'update-available'
    return {
      status,
      installed: inspection.state !== 'absent',
      ...(status === 'current'
        ? {
            source: {
              repository: ASTRALE_CLI_SKILL_SOURCE,
              revision: snapshot.revision,
              skills: snapshot.skills.map(({ name, tree, path }) => ({
                name,
                tree,
                entrypoint: path,
              })),
            },
          }
        : {}),
    }
  } catch (error) {
    return { status: 'unavailable', error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Ensure the complete Astrale-owned cohort is current and internally consistent.
 * A clean second attempt follows any failed ordinary refresh; a failed operation
 * restores the exact prior cohort and never reports success.
 */
export async function syncAstraleSkills(
  overrides: SkillSyncDependencies = {},
): Promise<SkillApplyResult> {
  const dependencies = resolvedDependencies(overrides)
  let snapshot: AstraleSkillSourceSnapshot
  try {
    snapshot = await sourceSnapshot(dependencies)
  } catch (error) {
    throw skillFailure(error)
  }
  const lockFile = join(
    overrides.home
      ? join(dependencies.home, '.astrale')
      : (process.env.ASTRALE_HOME ?? join(dependencies.home, '.astrale')),
    'locks',
    'skills-update.lock',
  )

  try {
    return await withFileLock(lockFile, async () => {
      await recoverInterruptedBackup(dependencies.home, dependencies.lockPath)
      await assertNoForeignSkillConflicts(snapshot, dependencies.home, dependencies.lockPath)
      const initial = await inspectAstraleSkills(snapshot, dependencies.home, dependencies.lockPath)
      let expectedNames = snapshot.skills.map((skill) => skill.name)
      let managedFolders = [...new Set([...expectedNames, ...initial.managedFolders])]
      let knownRetired = initial.managedFolders.filter((name) => !expectedNames.includes(name))
      const agents = await selectedAgents(
        dependencies.home,
        dependencies.lockPath,
        dependencies.agents,
        snapshot.skills.map((skill) => skill.name),
      )
      if (initial.state === 'current' && !dependencies.replaceAgentSelection) {
        const repaired = await reconcileAgentLinks(dependencies.home, expectedNames, agents, false)
        return { status: repaired ? 'repaired' : 'unchanged' }
      }
      const backup = await captureBackup(dependencies.home, dependencies.lockPath, managedFolders)
      let lastError: unknown
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            if (attempt === 1) {
              snapshot = await sourceSnapshot(dependencies)
              expectedNames = snapshot.skills.map((skill) => skill.name)
              managedFolders = [...new Set([...managedFolders, ...expectedNames])]
              await extendBackup(backup, dependencies.home, managedFolders)
              knownRetired = [
                ...new Set([
                  ...knownRetired,
                  ...managedFolders.filter((name) => !expectedNames.includes(name)),
                ]),
              ]
            }
            if (initial.state === 'unhealthy' || attempt === 1) {
              await cleanManagedState(managedFolders, dependencies.home, dependencies.lockPath)
            }
            const installed = await installSnapshot(snapshot, dependencies, agents)
            if (installed.code !== 0) {
              throw new Error(installed.stderr || installed.stdout || 'skill installer failed')
            }
            await pruneObsoleteEntries(
              snapshot,
              dependencies.home,
              dependencies.lockPath,
              knownRetired,
            )
            const installedInspection = await inspectAstraleSkills(
              snapshot,
              dependencies.home,
              dependencies.lockPath,
            )
            if (!installedInspection.sourceCurrent) {
              throw new Error('installed Astrale skills do not match the resolved source')
            }
            await stampAstraleSource(snapshot, dependencies.lockPath)
            const verified = await inspectAstraleSkills(
              snapshot,
              dependencies.home,
              dependencies.lockPath,
            )
            if (verified.state !== 'current') {
              throw new Error('installed Astrale skills did not pass verification')
            }
            const latest = await sourceSnapshot(dependencies)
            if (latest.revision !== snapshot.revision) {
              throw new Error('Astrale skill source changed during installation')
            }
            await markBackupVerified(backup)
            await rm(backup.root, { recursive: true, force: true })
            return {
              status:
                initial.state === 'current'
                  ? 'unchanged'
                  : initial.state === 'absent'
                    ? 'installed'
                    : initial.state === 'outdated'
                      ? 'updated'
                      : 'repaired',
            }
          } catch (error) {
            lastError = error
          }
        }
        throw lastError
      } catch (error) {
        if (initial.state === 'absent' || initial.state === 'unhealthy') {
          await cleanManagedState(managedFolders, dependencies.home, dependencies.lockPath)
          await removeKnownAgentLinks(managedFolders, dependencies.home)
          await restoreAgentLinks(backup, dependencies.home, true)
        } else {
          await restoreBackup(backup, dependencies.home, dependencies.lockPath)
        }
        await rm(backup.root, { recursive: true, force: true })
        throw skillFailure(error)
      }
    })
  } catch (error) {
    if (error instanceof AstraleError) throw error
    throw skillFailure(error)
  }
}

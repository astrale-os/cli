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
import { homedir, tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'

import { AstraleError } from '../../errors'
import { run, type RunResult } from '../proc'
import { withFileLock } from './lock'

/**
 * Astrale-owned agent skill reconciliation. The ecosystem installer owns agent links;
 * Astrale owns source freshness, local integrity, repair, rollback, and outcomes.
 */

/** Published source whose top-level skill directories Astrale owns as one cohort. */
export const ASTRALE_CLI_SKILL_SOURCE = 'astrale-os/cli'
export const ASTRALE_SKILL_REPAIR_COMMAND = 'astrale update --yes --no-deps'

/** Deliberately pinned: installer behavior is part of the verified update path. */
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
  error?: string
}

export type SkillApplyResult = {
  status: SkillApplyStatus
}

type SourceSkill = { name: string; path: string; tree: string }
export type AstraleSkillSourceSnapshot = { ref: 'main'; revision: string; skills: SourceSkill[] }

type SkillLockEntry = {
  source?: string
  sourceType?: string
  sourceUrl?: string
  ref?: string
  skillPath?: string
  skillFolderHash?: string
  installedAt?: string
  updatedAt?: string
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
  managedNames: string[]
  managedFolders: string[]
}

export type SkillSyncDependencies = {
  home?: string
  lockPath?: string
  resolveSource?: () => Promise<AstraleSkillSourceSnapshot>
  run?: (file: string, args?: string[]) => Promise<RunResult>
}

const SOURCE_REPOSITORY_URL = 'https://github.com/astrale-os/cli.git'
const SAFE_NAME = /^[a-z0-9][a-z0-9._-]*$/iu

function resolvedDependencies(overrides: SkillSyncDependencies = {}) {
  const home = overrides.home ?? homedir()
  const xdgStateHome = process.env.XDG_STATE_HOME
  return {
    home,
    lockPath:
      overrides.lockPath ??
      (xdgStateHome
        ? join(xdgStateHome, 'skills', '.skill-lock.json')
        : join(home, '.agents', '.skill-lock.json')),
    run: overrides.run ?? run,
    resolveSource: overrides.resolveSource,
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
  return match?.[1] ?? null
}

async function resolveAstraleSkillSource(
  execute: ReturnType<typeof resolvedDependencies>['run'],
): Promise<AstraleSkillSourceSnapshot> {
  const checkout = await mkdtemp(join(tmpdir(), 'astrale-skill-source-'))
  try {
    const cloned = await execute('git', [
      'clone',
      '--quiet',
      '--depth',
      '1',
      '--filter=blob:none',
      '--no-checkout',
      '--single-branch',
      '--branch',
      'main',
      SOURCE_REPOSITORY_URL,
      checkout,
    ])
    if (cloned.code !== 0) throw new Error(cloned.stderr || cloned.stdout || 'git clone failed')
    const revision = await execute('git', ['-C', checkout, 'rev-parse', 'HEAD'])
    if (revision.code !== 0) {
      throw new Error(revision.stderr || revision.stdout || 'git rev-parse failed')
    }
    const folders = await execute('git', ['-C', checkout, 'ls-tree', 'HEAD:skills'])
    const files = await execute('git', [
      '-C',
      checkout,
      'ls-tree',
      '-r',
      '--name-only',
      'HEAD:skills',
    ])
    if (folders.code !== 0 || files.code !== 0) {
      throw new Error(folders.stderr || files.stderr || 'git ls-tree failed')
    }
    const skillFiles = new Set(
      files.stdout
        .split('\n')
        .filter((path) => /^[^/]+\/SKILL\.md$/u.test(path))
        .map((path) => path.slice(0, -'/SKILL.md'.length)),
    )
    const skills = folders.stdout.split('\n').flatMap((line): SourceSkill[] => {
      const match = line.match(/^040000 tree ([0-9a-f]{40})\t([^/]+)$/u)
      if (!match || !SAFE_NAME.test(match[2]) || !skillFiles.has(match[2])) return []
      return [{ name: match[2], path: `skills/${match[2]}/SKILL.md`, tree: match[1] }]
    })
    skills.sort((a, b) => a.name.localeCompare(b.name))
    if (skills.length === 0) throw new Error('astrale-os/cli publishes no top-level skills')
    return { ref: 'main', revision: revision.stdout.trim(), skills }
  } finally {
    await rm(checkout, { recursive: true, force: true })
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
    return { state: 'absent', managedNames: [], managedFolders: [] }
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
  if (await directoryExists(join(home, '.claude'))) {
    for (const skill of snapshot.skills) {
      const link = join(home, '.claude', 'skills', skill.name)
      try {
        if (!(await lstat(link)).isSymbolicLink()) coherent = false
        else if (
          resolve(dirname(link), await readlink(link)) !==
          join(home, '.agents', 'skills', skill.name)
        ) {
          coherent = false
        }
      } catch {
        coherent = false
      }
    }
  }

  const exactCurrent =
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

  return {
    state: exactCurrent ? 'current' : coherent ? 'outdated' : 'unhealthy',
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

async function sourceSnapshot(dependencies: ReturnType<typeof resolvedDependencies>) {
  return dependencies.resolveSource
    ? await dependencies.resolveSource()
    : await resolveAstraleSkillSource(dependencies.run)
}

function installerArgs(...args: string[]): string[] {
  return ['--yes', SKILLS_INSTALLER_PACKAGE, ...args]
}

async function installSnapshot(
  snapshot: AstraleSkillSourceSnapshot,
  execute: ReturnType<typeof resolvedDependencies>['run'],
  selectedAgents: string[],
): Promise<RunResult> {
  return await execute(
    'npx',
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

async function selectedAgents(home: string, lockPath: string): Promise<string[]> {
  const { lock } = await readSkillLock(lockPath)
  const agents = new Set(
    (lock?.lastSelectedAgents ?? []).filter(
      (agent): agent is string => typeof agent === 'string' && SAFE_NAME.test(agent),
    ),
  )
  agents.add('codex')
  if (await directoryExists(join(home, '.claude'))) agents.add('claude-code')
  return [...agents]
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
  const roots = await readdir(home, { withFileTypes: true }).catch(() => [])
  for (const root of roots) {
    if (!root.isDirectory() || !root.name.startsWith('.') || root.name === '.agents') continue
    for (const name of names) {
      const link = join(home, root.name, 'skills', name)
      try {
        const stat = await lstat(link)
        if (!stat.isSymbolicLink()) continue
        const target = await readlink(link)
        if (resolve(dirname(link), target) === join(home, '.agents', 'skills', name)) {
          await rm(link, { force: true })
        }
      } catch {
        // Missing or foreign links are not part of the Astrale-owned repair.
      }
    }
  }
}

async function pruneObsoleteEntries(
  snapshot: AstraleSkillSourceSnapshot,
  home: string,
  lockPath: string,
  execute: ReturnType<typeof resolvedDependencies>['run'],
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
  if (retired.length > 0) {
    const result = await execute('npx', installerArgs('remove', ...retired, '-g', '-y'))
    if (result.code !== 0) throw new Error(result.stderr || result.stdout || 'skill removal failed')
  }
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

type AgentLinkBackup = { root: string; name: string; target: string }

const BACKUP_PREFIX = '.astrale-skill-backup-'
const BACKUP_MANIFEST = '.manifest.json'

async function captureAgentLinks(home: string, names: string[]): Promise<AgentLinkBackup[]> {
  const links: AgentLinkBackup[] = []
  const roots = await readdir(home, { withFileTypes: true }).catch(() => [])
  for (const root of roots) {
    if (!root.isDirectory() || !root.name.startsWith('.') || root.name === '.agents') continue
    for (const name of names) {
      const path = join(home, root.name, 'skills', name)
      try {
        if ((await lstat(path)).isSymbolicLink()) {
          links.push({ root: root.name, name, target: await readlink(path) })
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
    const path = join(home, link.root, 'skills', link.name)
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
            typeof link.root === 'string' &&
            /^\.[^/]+$/u.test(link.root) &&
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
    return {
      status:
        inspection.state === 'current'
          ? 'current'
          : inspection.state === 'unhealthy'
            ? 'repair-needed'
            : 'update-available',
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
    process.env.ASTRALE_HOME ?? join(dependencies.home, '.astrale'),
    'locks',
    'skills-update.lock',
  )

  try {
    return await withFileLock(lockFile, async () => {
      await recoverInterruptedBackup(dependencies.home, dependencies.lockPath)
      const initial = await inspectAstraleSkills(snapshot, dependencies.home, dependencies.lockPath)
      if (initial.state === 'current') return { status: 'unchanged' }

      let expectedNames = snapshot.skills.map((skill) => skill.name)
      let managedFolders = [...new Set([...expectedNames, ...initial.managedFolders])]
      let knownRetired = initial.managedFolders.filter((name) => !expectedNames.includes(name))
      const agents = await selectedAgents(dependencies.home, dependencies.lockPath)
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
            const installed = await installSnapshot(snapshot, dependencies.run, agents)
            if (installed.code !== 0) {
              throw new Error(installed.stderr || installed.stdout || 'skill installer failed')
            }
            await pruneObsoleteEntries(
              snapshot,
              dependencies.home,
              dependencies.lockPath,
              dependencies.run,
              knownRetired,
            )
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
                initial.state === 'absent'
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

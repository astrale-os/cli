import { afterEach, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { withEmbeddedAssetLock } from '../../../scripts/embedded-assets-cache'

const roots: string[] = []
const cacheModule = new URL('../../../scripts/embedded-assets-cache.ts', import.meta.url).pathname
const lockOf = (root: string) => join(root, 'node_modules/.cache/astrale-cli/embedded-assets.lock')

async function ownerPid(root: string): Promise<number> {
  const [owner] = await readdir(lockOf(root))
  expect(owner).toMatch(/^owner(?:\.|$)/)
  return Number(await readFile(join(lockOf(root), owner!), 'utf8'))
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'astrale-asset-lock-'))
  roots.push(root)
  return root
}

async function waitForReady(child: ReturnType<typeof Bun.spawn>): Promise<void> {
  const output = child.stdout as ReadableStream<Uint8Array>
  const reader = output.getReader()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const read = reader.read()
    const result = await Promise.race([
      read,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('lock fixture did not become ready')), 2_000)
      }),
    ])
    expect(result.done).toBe(false)
    expect(new TextDecoder().decode(result.value)).toBe('ready\n')
  } finally {
    clearTimeout(timer)
    reader.releaseLock()
  }
}

async function spawnOwner(root: string, source: string) {
  const entry = join(root, 'owner.ts')
  await writeFile(entry, source)
  return Bun.spawn([process.execPath, entry], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
}

test('a process killed before owner publication leaves no lock that blocks the next build', async () => {
  const root = await fixture()
  const child = await spawnOwner(
    root,
    `
    import { mock } from 'bun:test'
    const fs = await import('node:fs/promises')
    mock.module('node:fs/promises', () => ({
      ...fs,
      writeFile: async (...args) => {
        if (String(args[0]).split('/').at(-1)?.startsWith('owner')) {
          process.stdout.write('ready\\n')
          await new Promise(() => { setInterval(() => {}, 1000) })
        }
        return fs.writeFile(...args)
      },
    }))
    const { withEmbeddedAssetLock } = await import(${JSON.stringify(cacheModule)})
    await withEmbeddedAssetLock(${JSON.stringify(root)}, async () => {})
  `,
  )
  try {
    await waitForReady(child)
    expect(existsSync(lockOf(root))).toBe(false)
  } finally {
    child.kill('SIGKILL')
    await child.exited
  }
  let entered = false
  await withEmbeddedAssetLock(root, async () => {
    expect(await ownerPid(root)).toBe(process.pid)
    entered = true
  })
  expect(entered).toBe(true)
  expect(existsSync(lockOf(root))).toBe(false)
})

test('a killed published owner is recovered while a live owner excludes another build', async () => {
  const root = await fixture()
  const child = await spawnOwner(
    root,
    `
    const { withEmbeddedAssetLock } = await import(${JSON.stringify(cacheModule)})
    await withEmbeddedAssetLock(${JSON.stringify(root)}, async () => {
      process.stdout.write('ready\\n')
      await new Promise(() => { setInterval(() => {}, 1000) })
    })
  `,
  )
  let entered = false
  let pending: Promise<void> | undefined
  try {
    await waitForReady(child)
    expect(await ownerPid(root)).toBe(child.pid)
    pending = withEmbeddedAssetLock(root, async () => {
      entered = true
      expect(await ownerPid(root)).toBe(process.pid)
    })
    await Bun.sleep(150)
    expect(entered).toBe(false)
    child.kill('SIGKILL')
    await child.exited
    await pending
    expect(entered).toBe(true)
    expect(existsSync(lockOf(root))).toBe(false)
  } finally {
    child.kill('SIGKILL')
    await child.exited
    await pending
  }
})

test('simultaneous builders each enter with a complete owner and never overlap', async () => {
  const root = await fixture()
  let active = 0
  let completed = 0
  await Promise.all(
    Array.from({ length: 8 }, () =>
      withEmbeddedAssetLock(root, async () => {
        active++
        expect(active).toBe(1)
        expect(await ownerPid(root)).toBe(process.pid)
        await Bun.sleep(10)
        active--
        completed++
      }),
    ),
  )
  expect(completed).toBe(8)
  expect(existsSync(lockOf(root))).toBe(false)
})

test('an ownerless directory left by interrupted older preparation is replaceable', async () => {
  const root = await fixture()
  await mkdir(lockOf(root), { recursive: true })
  await withEmbeddedAssetLock(root, async () => {
    expect(await ownerPid(root)).toBe(process.pid)
  })
  expect(existsSync(lockOf(root))).toBe(false)
})

test('a stale recoverer cannot remove a new live owner after observing a dead owner', async () => {
  const root = await fixture()
  const lock = lockOf(root)
  const oldOwner = join(lock, 'owner')
  const resume = join(root, 'resume')
  const entered = join(root, 'entered')
  await mkdir(lock, { recursive: true })
  await writeFile(oldOwner, '99999999\n')
  const child = await spawnOwner(
    root,
    `
    import { mock } from 'bun:test'
    const fs = await import('node:fs/promises')
    const originalRm = fs.rm
    let paused = false
    mock.module('node:fs/promises', () => ({
      ...fs,
      rm: async (...args) => {
        if (!paused && [${JSON.stringify(oldOwner)}, ${JSON.stringify(lock)}].includes(String(args[0]))) {
          paused = true
          process.stdout.write('ready\\n')
          while (!await fs.stat(${JSON.stringify(resume)}).catch(() => undefined)) await Bun.sleep(5)
        }
        return originalRm(...args)
      },
    }))
    const { withEmbeddedAssetLock } = await import(${JSON.stringify(cacheModule)})
    await withEmbeddedAssetLock(${JSON.stringify(root)}, async () => {
      await fs.writeFile(${JSON.stringify(entered)}, 'entered')
    })
  `,
  )
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let ready!: () => void
  const acquired = new Promise<void>((resolve) => {
    ready = resolve
  })
  let successor: Promise<void> | undefined
  try {
    await waitForReady(child)
    // Another recoverer has already removed the exact dead owner and a new
    // builder has acquired the canonical path before our paused observer resumes.
    await rm(lock, { recursive: true })
    successor = withEmbeddedAssetLock(root, async () => {
      ready()
      await held
    })
    await acquired
    await writeFile(resume, 'resume')
    await Bun.sleep(150)
    expect(existsSync(entered)).toBe(false)
    expect(await ownerPid(root)).toBe(process.pid)
    release()
    await successor
    expect(await child.exited).toBe(0)
    expect(existsSync(entered)).toBe(true)
    expect(existsSync(lock)).toBe(false)
  } finally {
    release()
    await successor
    child.kill('SIGKILL')
    await child.exited
  }
})

import { describe, expect, test } from 'bun:test'
import { spawn, type ChildProcess } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const cliRoot = fileURLToPath(new URL('../../../', import.meta.url))
const studioModule = fileURLToPath(new URL('../studio.ts', import.meta.url))
const assetsModule = fileURLToPath(new URL('../../lib/embedded-assets.ts', import.meta.url))
const invocationModule = fileURLToPath(new URL('../../lib/self-invocation.ts', import.meta.url))

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  child.kill('SIGTERM')
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5_000)
  try {
    await exited
  } finally {
    clearTimeout(timeout)
  }
}

type Descriptor = { url: string; mode: string; workspace: string }

function waitForDescriptor(child: ChildProcess): Promise<Descriptor> {
  return new Promise((resolve, reject) => {
    let output = ''
    let failure = ''
    const deadline = setTimeout(
      () => reject(new Error(`Studio launcher did not become ready\n${failure || output}`)),
      10_000,
    )
    child.stdout!.setEncoding('utf8').on('data', (chunk: string) => {
      output += chunk
      const match = output.match(/\{\s*"url":[\s\S]*?\n\}/)
      if (match) {
        clearTimeout(deadline)
        resolve(JSON.parse(match[0]))
      }
    })
    child.stderr!.setEncoding('utf8').on('data', (chunk: string) => {
      failure += chunk
    })
    child.on('error', (error) => {
      clearTimeout(deadline)
      reject(error)
    })
    child.on('exit', (code) => {
      clearTimeout(deadline)
      reject(new Error(`Studio launcher exited with ${code}\n${failure || output}`))
    })
  })
}

describe('Studio launch targets', () => {
  /** @evidence TEST-CLI-STUDIO-CONFIG-TARGET-SPAWNS-FROM-DIRECTORY */
  test.each([
    { target: 'absolute-config', dev: false },
    { target: 'relative-config', dev: false },
    { target: 'directory', dev: false },
    { target: 'absolute-config', dev: true },
  ] as const)(
    'launches $target in dev=$dev without changing its target or CLI descriptor',
    async ({ target, dev }) => {
      const temporary = realpathSync(await mkdtemp(join(tmpdir(), 'astrale-studio-launch-')))
      const project = join(temporary, 'project')
      const config = join(project, 'astrale.config.ts')
      const studio = join(temporary, 'studio')
      const launcher = join(temporary, 'launch.ts')
      let child: ChildProcess | undefined
      try {
        await mkdir(project)
        await writeFile(config, 'export default {}\n')
        await mkdir(join(studio, 'server'), { recursive: true })
        await mkdir(join(studio, 'client', 'src'), { recursive: true })
        await mkdir(join(studio, 'node_modules', '.bin'), { recursive: true })
        await writeFile(join(studio, 'vite.config.ts'), 'export default {}\n')

        // Only the launched server/Vite programs are narrow doubles. The actual
        // Studio launcher must spawn them with a valid OS cwd, wait on real HTTP
        // readiness and pass the exact target and calling-CLI descriptor.
        const server = join(studio, 'server', 'index.ts')
        await writeFile(
          server,
          `
        const args = process.argv.slice(2)
        const target = args[0] === '__studio-server' ? args[1] : args[0]
        Bun.serve({ hostname: '127.0.0.1', port: Number(process.env.PORT), fetch(request) {
          if (new URL(request.url).pathname === '/api/ready') return new Response(null, { status: 204 })
          return Response.json({ cwd: process.cwd(), target, descriptor: JSON.parse(process.env.DOMAIN_STUDIO_CLI_DESCRIPTOR!) })
        } })
      `,
        )
        const vite = join(studio, 'node_modules', '.bin', 'vite')
        await writeFile(
          vite,
          `#!/usr/bin/env bun\nconst args = process.argv.slice(2); Bun.serve({ hostname: '127.0.0.1', port: Number(args[args.indexOf('--port') + 1]), fetch: () => new Response('Vite ready') })\n`,
        )
        await chmod(vite, 0o755)
        await writeFile(
          launcher,
          `
        import { mock } from 'bun:test'
        mock.module(${JSON.stringify(assetsModule)}, () => ({ materializeEmbeddedAssets: async () => ${JSON.stringify(join(studio, 'client'))} }))
        mock.module(${JSON.stringify(invocationModule)}, () => ({ selfInvocation: (args) => ({ file: process.execPath, args: [${JSON.stringify(server)}, ...args] }) }))
        const { default: command } = await import(${JSON.stringify(studioModule)})
        await command.action(process.argv[2], { json: true, dev: ${dev} })
      `,
        )
        const argument =
          target === 'relative-config'
            ? 'project/astrale.config.ts'
            : target === 'directory'
              ? project
              : config
        child = spawn(process.execPath, [launcher, argument], {
          cwd: temporary,
          env: {
            ...process.env,
            ASTRALE_HOME: join(temporary, 'home'),
            ASTRALE_STUDIO_DIR: studio,
            ASTRALE_TELEMETRY: '0',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        const descriptor = await waitForDescriptor(child)
        const expectedTarget = target === 'directory' ? project : config
        expect(descriptor.workspace).toBe(expectedTarget)
        expect(descriptor.mode).toBe(dev ? 'dev' : 'prod')
        const response = await fetch(`${descriptor.url.replace('localhost', '127.0.0.1')}/proof`)
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
          cwd: realpathSync(dev ? studio : project),
          target: expectedTarget,
          descriptor: { version: 1, executable: process.execPath, args: [realpathSync(launcher)] },
        })
      } finally {
        if (child) await stop(child)
        await rm(temporary, { recursive: true, force: true })
      }
    },
    20_000,
  )
})

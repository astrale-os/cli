import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { CommanderError } from 'commander'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { adminCallTarget, callCommand, parseParams } from '../call'

const cliRoot = join(import.meta.dir, '../../..')
const SET_SECRET = '@deployment-1::services.astrale.ai:class.CloudflareDeployment.method.setSecret'
const SECRET = Object.freeze({ name: 'API_TOKEN', value: 'c3-secret-value-never-in-argv' })
const SERVICES_ISSUER = 'https://services.admin.test'
const roots: string[] = []
let template: string

beforeAll(async () => {
  template = await temporaryRoot('astrale-call-admin-template-')
  const created = await runCli(template, ['identity', 'create', 'alice', '--json'])
  expect(created.exitCode, created.stderr).toBe(0)
})

afterAll(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('call --admin target selection', () => {
  test('selects the configured Admin kernel, an Admin bookmark, or an Admin URL', () => {
    expect(adminCallTarget({})).toBeUndefined()
    expect(adminCallTarget({ instance: 'staging' })).toBeUndefined()
    expect(adminCallTarget({ admin: true })).toEqual({})
    expect(adminCallTarget({ admin: 'ops-admin' })).toEqual({ admin: 'ops-admin' })
    expect(
      adminCallTarget({ adminUrl: 'https://admin.test/api', domainIssuer: 'https://admin.test' }),
    ).toEqual({ adminUrl: 'https://admin.test/api', domainIssuer: 'https://admin.test' })
  })

  /** @evidence TEST-CLI-CALL-ADMIN-REFUSES-INSTANCE-SELECTORS */
  test.each([
    [{ admin: true, instance: 'staging' }, '-i/--instance cannot be used with --admin'],
    [{ admin: 'ops-admin', url: 'https://kernel.test' }, '--url cannot be used with --admin'],
    [
      { adminUrl: 'https://admin.test/api', instance: 'staging', url: 'https://kernel.test' },
      '-i/--instance and --url cannot be used with --admin-url',
    ],
    [
      { admin: true, adminUrl: 'https://admin.test/api' },
      '--admin cannot be used with --admin-url',
    ],
    [{ domainIssuer: 'https://admin.test' }, '--domain-issuer requires --admin-url'],
    [
      { admin: 'ops-admin', domainIssuer: 'https://admin.test' },
      '--domain-issuer requires --admin-url',
    ],
    [{ admin: 'limit=10' }, '--admin took the param "limit=10" as its bookmark'],
    [{ admin: 'name=API_TOKEN' }, '--admin took the param "name=API_TOKEN" as its bookmark'],
  ] as const)('refuses %o as a usage error (exit 2)', (opts, message) => {
    let refusal: unknown
    try {
      adminCallTarget(opts)
    } catch (error) {
      refusal = error
    }
    expect(refusal).toBeInstanceOf(CommanderError)
    expect(refusal).toMatchObject({ exitCode: 2, code: 'commander.conflictingOption' })
    expect((refusal as Error).message.split('\n')[0]).toBe(`error: ${message}`)
  })

  test('keeps a bookmark that is not shaped like a key=value param', () => {
    for (const admin of ['ops-admin', 'ops admin=x', 'ops.admin=x', '1ops=x', '=ops']) {
      expect(adminCallTarget({ admin })).toEqual({ admin })
    }
  })

  test('refuses the selection before reading --data or opening a connection', async () => {
    let connections = 0
    await expect(
      callCommand(
        SET_SECRET,
        [],
        { admin: true, instance: 'staging', data: '@/no/such/secret.json', json: true },
        {
          async runKernelCommand() {
            connections += 1
          },
          output() {},
        },
      ),
    ).rejects.toMatchObject({ exitCode: 2 })
    expect(connections).toBe(0)
  })

  test('hands the Admin selection and the callable credential to the command lifecycle', async () => {
    const seen: unknown[] = []
    for (const opts of [
      { admin: true as const },
      { admin: 'ops-admin' },
      { adminUrl: 'https://admin.test/api', domainIssuer: 'https://admin.test' },
      {},
    ]) {
      await callCommand(
        SET_SECRET,
        [],
        { ...opts, data: JSON.stringify(SECRET), json: true },
        {
          async runKernelCommand(input) {
            seen.push({ admin: input.admin ?? null, credential: input.credential })
          },
          output() {},
        },
      )
    }
    const credential = { principal: 'callable' }
    expect(seen).toMatchObject([
      { admin: {}, credential },
      { admin: { admin: 'ops-admin' }, credential },
      {
        admin: { adminUrl: 'https://admin.test/api', domainIssuer: 'https://admin.test' },
        credential,
      },
      { admin: null, credential },
    ])
  })
})

describe('call --data sources', () => {
  const documents = [
    '{"name":"API_TOKEN","value":"s3cr3t"}',
    '{\n  "name": "API_TOKEN",\n  "value": "multi\\nline \\u00e9"\n}\n',
    '{"nested":{"list":[1,2,{"deep":true}]},"empty":""}',
    '  {"padded": null}  \n\n',
  ]

  /** @evidence TEST-CLI-CALL-DATA-FILE-PARSES-LIKE-INLINE */
  test.each(documents)('reads -d @<file> exactly like inline JSON: %j', async (document) => {
    const root = await temporaryRoot('astrale-call-data-file-')
    const file = join(root, 'input.json')
    await writeFile(file, document)
    expect(await parseParams([], `@${file}`)).toEqual(await parseParams([], document))
  })

  /** @evidence TEST-CLI-CALL-DATA-STDIN-PARSES-LIKE-INLINE */
  test.each(documents)('reads -d - from stdin exactly like inline JSON: %j', async (document) => {
    const child = Bun.spawn(
      [
        process.execPath,
        '-e',
        `const { parseParams } = await import(${JSON.stringify(join(import.meta.dir, '../call.ts'))})
         console.log(JSON.stringify(await parseParams(['ignored=1'], '-')))`,
      ],
      { cwd: cliRoot, stdin: new Blob([document]), stdout: 'pipe', stderr: 'pipe' },
    )
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(exitCode, stderr).toBe(0)
    expect(JSON.parse(stdout)).toEqual(await parseParams([], document))
    expect(stderr).toContain('--data provided, ignoring key=value params')
  })

  test('refuses -d - when stdin is a terminal instead of waiting for EOF', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true })
    try {
      await expect(parseParams([], '-')).rejects.toThrow(
        new TypeError('--data - reads JSON from piped stdin, but stdin is a terminal'),
      )
    } finally {
      if (descriptor === undefined) delete (process.stdin as { isTTY?: boolean }).isTTY
      else Object.defineProperty(process.stdin, 'isTTY', descriptor)
    }
  })

  test('names a file or stdin that holds no JSON without echoing its contents', async () => {
    const root = await temporaryRoot('astrale-call-data-invalid-')
    const file = join(root, 'secret.json')
    await writeFile(file, 'API_TOKEN=c3-secret-value-never-in-argv')
    await expect(parseParams([], `@${file}`)).rejects.toThrow(
      new TypeError(`Invalid JSON in --data file ${file}`),
    )
    await expect(parseParams([], `@${join(root, 'missing.json')}`)).rejects.toThrow(
      new TypeError(`Cannot read --data file ${join(root, 'missing.json')} (ENOENT)`),
    )
    await expect(parseParams([], '@')).rejects.toThrow(
      new TypeError('--data @<file> requires a file path'),
    )
  })
})

describe('call --admin against a fake Admin kernel', () => {
  /** @evidence TEST-CLI-CALL-ADMIN-USAGE-ERROR-EXIT-2 */
  test.each([
    [['--admin', '-i', 'staging'], '-i/--instance cannot be used with --admin'],
    [['--admin', 'ops-admin', '--url', 'OBSERVER'], '--url cannot be used with --admin'],
    [['--admin-url', 'OBSERVER', '-i', 'staging'], '-i/--instance cannot be used with --admin-url'],
    [['--domain-issuer', 'OBSERVER'], '--domain-issuer requires --admin-url'],
    [['--admin', 'limit=10'], '--admin took the param "limit=10" as its bookmark'],
  ])('astrale call %p exits 2 before any connection', async (flags, message) => {
    const root = await temporaryRoot('astrale-call-admin-usage-')
    const observer = await observeConnections()
    try {
      const result = await runCli(root, [
        'call',
        SET_SECRET,
        ...flags.map((flag) => (flag === 'OBSERVER' ? observer.url : flag)),
        '-d',
        '-',
        '--json',
      ])
      expect(result.exitCode).toBe(2)
      expect(result.stdout).toBe('')
      const refusal = JSON.parse(result.stderr) as Record<string, string>
      expect(refusal).toMatchObject({ error: 'USAGE_ERROR', message: `error: ${message}` })
      expect(refusal.detail).toContain('Usage:\n  astrale call <path> [params...]')
      expect(observer.count()).toBe(0)
    } finally {
      await observer.close()
    }
  })

  /** @evidence TEST-CLI-CALL-ADMIN-SET-SECRET */
  test.each([
    {
      selection: ['--admin'],
      kernel: 'https://admin.configured.test/api',
      input: 'file',
    },
    {
      selection: ['--admin', 'ops-admin'],
      kernel: 'https://admin.bookmark.test/api',
      input: 'stdin',
    },
    {
      selection: [
        '--admin-url',
        'https://admin.url.test/api',
        '--domain-issuer',
        'https://admin-domain.url.test',
      ],
      kernel: 'https://admin.url.test/api',
      input: 'file',
    },
  ] as const)(
    'rotates one secret through $selection with -d $input',
    async ({ selection, kernel, input }) => {
      const root = await adminHome()
      const secretFile = join(root, 'secret.json')
      await writeFile(secretFile, `${JSON.stringify(SECRET)}\n`)
      const observed = join(root, 'observed.ndjson')
      const argv = [
        'call',
        SET_SECRET,
        ...selection,
        '--as',
        'alice',
        '-d',
        input === 'file' ? `@${secretFile}` : '-',
        '--json',
      ]
      const child = Bun.spawn(['bun', join(import.meta.dir, 'fixtures/call-admin.ts'), ...argv], {
        cwd: cliRoot,
        env: {
          ...process.env,
          ASTRALE_HOME: root,
          NO_UPDATE_NOTIFIER: '1',
          CALL_ADMIN_OBSERVED: observed,
          CALL_ADMIN_SERVICES_ISSUER: SERVICES_ISSUER,
        },
        stdin: input === 'stdin' ? new Blob([JSON.stringify(SECRET)]) : 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])

      expect(exitCode, stderr).toBe(0)
      expect(JSON.parse(stdout)).toEqual({ name: SECRET.name })
      expect(argv.join(' ')).not.toContain(SECRET.value)
      expect(stdout + stderr).not.toContain(SECRET.value)
      const events = (await readFile(observed, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>)
      // The Admin kernel's installation names the issuer the caller is exchanged at, as for any
      // call; nothing is sent to an instance.
      expect(events).toEqual([
        { kind: 'inspect', kernel, origin: 'services.astrale.ai' },
        { kind: 'exchange', kernel, issuer: SERVICES_ISSUER },
        {
          kind: 'dispatch',
          kernel,
          target: SET_SECRET,
          input: SECRET,
          credentialIssuer: SERVICES_ISSUER,
        },
      ])
    },
  )
})

/**
 * An isolated CLI home holding identity alice, a configured Admin target, an Admin bookmark and an
 * active instance the Admin selection must not fall back to.
 */
async function adminHome(): Promise<string> {
  const root = await temporaryRoot('astrale-call-admin-')
  await cp(template, root, { recursive: true })
  await writeFile(
    join(root, 'config.json'),
    JSON.stringify({
      admin: {
        name: 'admin',
        url: 'https://admin.configured.test/api',
        kernelIssuer: 'https://admin.configured.test/api',
        domainIssuer: 'https://admin-domain.configured.test',
      },
    }),
  )
  await writeFile(
    join(root, 'instances.json'),
    JSON.stringify({
      version: 1,
      active: 'staging',
      instances: {
        staging: { url: 'https://staging.instance.test/api' },
        'ops-admin': {
          url: 'https://admin.bookmark.test/api',
          domainIssuer: 'https://admin-domain.bookmark.test',
        },
      },
    }),
  )
  return root
}

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

async function runCli(root: string, args: readonly string[]) {
  const child = Bun.spawn(['bun', join(cliRoot, 'bin/astrale.ts'), ...args], {
    env: { ...process.env, ASTRALE_HOME: root, NO_UPDATE_NOTIFIER: '1' },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { exitCode, stdout, stderr }
}

async function observeConnections() {
  let connections = 0
  const server = createServer((socket) => {
    connections += 1
    socket.destroy()
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected an observing TCP port')
  return {
    url: `http://127.0.0.1:${address.port}`,
    count: () => connections,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

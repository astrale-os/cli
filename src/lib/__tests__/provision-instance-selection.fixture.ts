import { calculateJwkThumbprint } from 'jose'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { resolveConnectionTarget } from '../../connection/target'
import { importIdentity, type IdentityExport } from '../../identity'
import { keypairPaths, persistKeypair } from '../../keys'
import { ensureOwnedInstance } from '../../setup/steps/instance'
import { DEFAULT_CONFIG } from '../config'
import { readInstances, setActive, upsertInstance } from '../instance'
import { importInstanceRootIdentity } from '../instance-root-identity'
import { provisionInstance } from '../provision-instance'

const scenario = process.argv[2]
const home = process.env.ASTRALE_HOME
if (!home) throw new Error('An isolated ASTRALE_HOME is required')

if (scenario === 'read-target') {
  process.stdout.write(JSON.stringify(await resolveConnectionTarget({}, DEFAULT_CONFIG)))
  process.exit(0)
}

if (scenario === 'select-staging' || scenario === 'select-collision') {
  const name = scenario === 'select-staging' ? 'staging' : 'prod'
  await upsertInstance(name, { url: 'https://staging.example.test/api' })
  await setActive(name)
  process.exit(0)
}

const empty = ['first-setup', 'concurrent-first-target', 'concurrent-collision'].includes(scenario!)
if (!empty) {
  await upsertInstance('dev', {
    url: 'https://dev.example.test/api',
    ...(scenario === 'alias-collision' ? { slug: 'prod', name: 'previous-name' } : {}),
  })
}
if (scenario === 'ready-replay') {
  await upsertInstance('prod', { url: 'https://prod.example.test/api' })
}
if (scenario === 'name-collision' || scenario === 'pending-access-collision') {
  await upsertInstance('prod', { url: 'https://dev.example.test/api' })
  await setActive('prod')
}
const rootMaterialPath = join(home, 'fixture-root-material.txt')
await writeFile(rootMaterialPath, 'existing-root-material')

// Prime the process-local snapshot before another process changes the catalogue.
const before = structuredClone(await readInstances())
const registryBefore = await readFile(join(home, 'instances.json'), 'utf8').catch(() => undefined)
const events: string[] = []
const receipt = {
  id: '@created-instance',
  slug: 'prod',
  url: 'https://prod.example.test/api',
  state: 'ready' as const,
  operationId: 'fixture.instance.create.retained',
  organizationId: 'org_fixture',
}
const hash = (bytes: string) => createHash('sha256').update(bytes).digest('hex')
let originalSubject: string | undefined
let registryHash: string | undefined
let keyHash: string | undefined
let incomingRoot: IdentityExport | undefined
if (scenario === 'identity-issuer-conflict') {
  const oldPair = await persistKeypair('old-fixture', { keysDir: join(home, 'old-source') })
  originalSubject = await calculateJwkThumbprint(oldPair.publicJwk)
  await importIdentity(
    {
      version: 1,
      subject: originalSubject,
      mode: 'local',
      issuer: 'https://dev.example.test/api',
      privateJwk: oldPair.privateJwk,
      publicJwk: oldPair.publicJwk,
    },
    { name: 'prod-root' },
  )
  const newPair = await persistKeypair('new-fixture', { keysDir: join(home, 'new-source') })
  incomingRoot = {
    version: 1,
    subject: await calculateJwkThumbprint(newPair.publicJwk),
    mode: 'local',
    issuer: receipt.url,
    privateJwk: newPair.privateJwk,
    publicJwk: newPair.publicJwk,
  }
  registryHash = hash(await readFile(join(home, 'identities.json'), 'utf8'))
  keyHash = hash(
    await readFile(keypairPaths(originalSubject, join(home, 'keys')).privatePath, 'utf8'),
  )
}

// Replace only remote provisioning/access/root boundaries. Bookmark persistence,
// target resolution and setup's first-instance journey use their production owners.
const provision = () =>
  provisionInstance(
    receipt.slug,
    { creds: 'fixture-admin', ci: true, operation: receipt.operationId },
    {
      createOwnedInstance: async (_opts, _slug, operation) => {
        if (operation !== receipt.operationId) throw new Error('The retained operation changed')
        events.push('receipt')
        return receipt
      },
      activateInstance: async () => {
        if (JSON.stringify(await readInstances()) !== JSON.stringify(before)) {
          throw new Error('The catalogue changed before owner access completed')
        }
        if (scenario === 'pending-access' || scenario === 'pending-access-collision') {
          throw new Error('Owner access is pending')
        }
        if (
          ['concurrent-selection', 'concurrent-first-target', 'concurrent-collision'].includes(
            scenario!,
          )
        ) {
          const child = Bun.spawn(
            [
              process.execPath,
              import.meta.path,
              scenario === 'concurrent-collision' ? 'select-collision' : 'select-staging',
            ],
            {
              env: process.env,
              stdout: 'pipe',
              stderr: 'pipe',
            },
          )
          const [code, stderr] = await Promise.all([
            child.exited,
            new Response(child.stderr).text(),
          ])
          if (code !== 0) throw new Error(`Concurrent selection failed: ${stderr}`)
        }
        events.push('access')
        return { status: 'completed', user: 'fixture-owner' }
      },
      importInstanceRootIdentity: async (connection, identifier, options) => {
        events.push('root')
        if (incomingRoot) {
          return importInstanceRootIdentity(connection, identifier, options, {
            retrieve: async () => ({
              instance: { ...receipt, issuer: receipt.url },
              transfer: {} as never,
            }),
            decode: async () => incomingRoot!,
            checkIssuer: async () => ({ issuer: receipt.url, keys: [incomingRoot!.publicJwk] }),
          })
        }
        await writeFile(rootMaterialPath, 'new-root-material')
        return { name: 'prod-root' } as never
      },
    },
  )

let result: Awaited<ReturnType<typeof provision>> | undefined
let setupOutcome: string | undefined
if (scenario === 'first-setup') {
  const originalLog = console.log
  console.log = () => {}
  try {
    setupOutcome = await ensureOwnedInstance(
      { interactive: false, machine: true, opts: {}, slug: receipt.slug },
      {
        fetchOwned: async () => ({ instances: [] }),
        adopt: async () => {
          throw new Error('Initial setup must create the first instance')
        },
        selectReady: async () => null,
        confirmCreate: async () => true,
        promptSlug: async () => receipt.slug,
        provision: async () => (result = await provision()),
      },
    )
  } finally {
    console.log = originalLog
  }
} else {
  result = await provision()
}

const registryAfter = await readFile(join(home, 'instances.json'), 'utf8')
const after = JSON.parse(registryAfter)
// The next CLI command owns a fresh registry snapshot, including when this
// creation returned a conflict after another process's catalogue mutation.
const reader = Bun.spawn([process.execPath, import.meta.path, 'read-target'], {
  env: process.env,
  stdout: 'pipe',
  stderr: 'pipe',
})
const [readerCode, targetJson, readerError] = await Promise.all([
  reader.exited,
  new Response(reader.stdout).text(),
  new Response(reader.stderr).text(),
])
if (readerCode !== 0) throw new Error(`Reading the next command's target failed: ${readerError}`)
const target = JSON.parse(targetJson)
const rootMaterial = await readFile(rootMaterialPath, 'utf8')
const identityProtection =
  originalSubject && incomingRoot
    ? {
        registryBeforeHash: registryHash,
        registryAfterHash: hash(await readFile(join(home, 'identities.json'), 'utf8')),
        keyBeforeHash: keyHash,
        keyAfterHash: await readFile(
          keypairPaths(originalSubject, join(home, 'keys')).privatePath,
          'utf8',
        )
          .then(hash)
          .catch(() => null),
        incomingKeyPresent: await readFile(
          keypairPaths(incomingRoot.subject, join(home, 'keys')).privatePath,
        )
          .then(() => true)
          .catch(() => false),
      }
    : undefined
process.stdout.write(
  JSON.stringify({
    before,
    after,
    target,
    result,
    setupOutcome,
    events,
    registryBefore,
    registryAfter,
    rootMaterial,
    identityProtection,
  }),
)

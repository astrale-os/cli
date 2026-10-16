import {
  createIdentity,
  deleteIdentity,
  exportIdentity,
  getIdentity,
  importIdentity,
  readIdentities,
  setDefault,
  setIdentityMode,
  setRegistration,
  upsertIdpIdentity,
} from '../../index'

async function failure(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
    return 'resolved'
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

const missing = {
  get: await failure(() => getIdentity('toString')),
  use: await failure(() => setDefault('toString')),
  remove: await failure(() => deleteIdentity('toString')),
  mode: await failure(() => setIdentityMode('toString', 'remote')),
  registration: await failure(() =>
    setRegistration('toString', 'production', {
      iss: 'https://kernel.example',
      sub: 'node',
      registeredAt: '2026-08-11T12:00:00.000Z',
    }),
  ),
  export: await failure(() => exportIdentity('toString')),
}

await createIdentity('constructor')
await upsertIdpIdentity('valueOf', {
  subject: 'user_123',
  idp: 'workos',
  issuer: 'https://idp.example',
  use: false,
})
await importIdentity(await exportIdentity('constructor'), { name: 'hasOwnProperty' })

const store = await readIdentities()
process.stdout.write(
  JSON.stringify({ missing, default: store.default, names: Object.keys(store.identities).sort() }),
)

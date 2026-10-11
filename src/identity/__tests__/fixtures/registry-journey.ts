import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { fileExists, keypairPaths } from '../../../keys/index'
import { saveIdpSession } from '../../../lib/idp/provider'
import { EXCHANGE_CREDENTIALS_PATH, KEYS_DIR, paths } from '../../../state/index'
import {
  createIdentity,
  exportIdentity,
  importIdentity,
  deleteIdentity,
  getDefault,
  readIdentities,
  setDefault,
  setIdentityMode,
  setRegistration,
  upsertIdpIdentity,
} from '../../index'

await createIdentity('alice')
await createIdentity('bob', { mode: 'remote' })
await importIdentity(await exportIdentity('alice'), { name: 'alice-alias' })
await setDefault('alice')
await setIdentityMode('bob', 'local')
await setRegistration('alice', 'production', {
  iss: 'https://kernel.example',
  sub: 'node-alice',
  registeredAt: '2026-08-11T12:00:00.000Z',
})

let selectedDeletion = ''
try {
  await deleteIdentity('alice')
} catch (error) {
  selectedDeletion = error instanceof Error ? error.message : String(error)
}
await mkdir(dirname(paths.sessionRoutes), { recursive: true })
await mkdir(dirname(EXCHANGE_CREDENTIALS_PATH), { recursive: true })
await writeFile(paths.sessionRoutes, '{"version":1,"entries":{"confidential":{}}}\n')
await writeFile(
  EXCHANGE_CREDENTIALS_PATH,
  '{"version":2,"entries":{"confidential":{"credential":"bearer"}}}\n',
)
await deleteIdentity('bob')
await deleteIdentity('alice-alias')
await upsertIdpIdentity('workos', {
  subject: 'user_123',
  idp: 'workos',
  issuer: 'https://idp.example',
  audience: 'https://kernel.example',
  use: false,
})

// An IdP login never replaces a key identity; deleting an IdP identity deletes its tokens.
let idpOverKey = ''
try {
  await upsertIdpIdentity('alice', {
    subject: 'user_9',
    idp: 'workos',
    issuer: 'https://idp.example',
  })
} catch (error) {
  idpOverKey = error instanceof Error ? error.message : String(error)
}
await upsertIdpIdentity('carol', {
  subject: 'user_456',
  idp: 'workos',
  issuer: 'https://idp.example',
  use: false,
})
await saveIdpSession({
  identity: 'carol',
  idp: 'workos',
  issuer: 'https://idp.example',
  subject: 'user_456',
  access_token: 'carol-access-token',
  refresh_token: 'carol-refresh-token',
  updatedAt: '2026-08-11T12:00:00.000Z',
})
await deleteIdentity('carol')

const store = await readIdentities()
const selected = await getDefault()
console.log(
  JSON.stringify({
    store,
    selected,
    selectedDeletion,
    aliceKey: await fileExists(keypairPaths('alice', KEYS_DIR).privatePath),
    bobKey: await fileExists(keypairPaths('bob', KEYS_DIR).privatePath),
    routeCache: await fileExists(paths.sessionRoutes),
    idpOverKey,
    carolSession: await fileExists(paths.idpSession('carol')),
    exchangeCache: JSON.parse(await readFile(EXCHANGE_CREDENTIALS_PATH, 'utf8')),
  }),
)

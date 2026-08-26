import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { fileExists, keypairPaths } from '../../../keys/index'
import { EXCHANGE_CREDENTIALS_PATH, KEYS_DIR, SESSION_ROUTES_PATH } from '../../../state/index'
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
await mkdir(dirname(SESSION_ROUTES_PATH), { recursive: true })
await mkdir(dirname(EXCHANGE_CREDENTIALS_PATH), { recursive: true })
await writeFile(SESSION_ROUTES_PATH, '{"version":1,"entries":{"confidential":{}}}\n')
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

const store = await readIdentities()
const selected = await getDefault()
console.log(
  JSON.stringify({
    store,
    selected,
    selectedDeletion,
    aliceKey: await fileExists(keypairPaths('alice', KEYS_DIR).privatePath),
    bobKey: await fileExists(keypairPaths('bob', KEYS_DIR).privatePath),
    routeCache: await fileExists(SESSION_ROUTES_PATH),
    exchangeCache: JSON.parse(await readFile(EXCHANGE_CREDENTIALS_PATH, 'utf8')),
  }),
)

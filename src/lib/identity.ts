import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import { IDENTITIES_PATH } from './paths'

export type Identity = { subject: string; createdAt: string }
export type IdentityStore = { default: string; identities: Record<string, Identity> }

const SEED: IdentityStore = {
  default: 'manager',
  identities: {
    manager: { subject: 'manager', createdAt: new Date().toISOString() },
  },
}

export async function readIdentities(): Promise<IdentityStore> {
  try {
    const raw = await readFile(IDENTITIES_PATH, 'utf-8')
    return { ...SEED, ...JSON.parse(raw) }
  } catch {
    return { ...SEED }
  }
}

export async function writeIdentities(store: IdentityStore): Promise<void> {
  await mkdir(dirname(IDENTITIES_PATH), { recursive: true })
  await writeFile(IDENTITIES_PATH, JSON.stringify(store, null, 2) + '\n')
}

export async function createIdentity(name: string, subject?: string): Promise<Identity> {
  const store = await readIdentities()
  if (store.identities[name]) {
    throw new Error(`Identity "${name}" already exists`)
  }
  const identity: Identity = {
    subject: subject ?? name,
    createdAt: new Date().toISOString(),
  }
  store.identities[name] = identity
  await writeIdentities(store)
  return identity
}

export async function deleteIdentity(name: string): Promise<void> {
  const store = await readIdentities()
  if (!store.identities[name]) {
    throw new Error(`Identity "${name}" not found`)
  }
  if (store.default === name) {
    throw new Error(
      `Cannot delete the default identity "${name}". Switch default first with: astrale identity use <other>`,
    )
  }
  delete store.identities[name]
  await writeIdentities(store)
}

export async function setDefault(name: string): Promise<void> {
  const store = await readIdentities()
  if (!store.identities[name]) {
    throw new Error(`Identity "${name}" not found`)
  }
  store.default = name
  await writeIdentities(store)
}

export async function getDefault(): Promise<Identity & { name: string }> {
  const store = await readIdentities()
  const identity = store.identities[store.default]
  if (!identity) {
    throw new Error(
      `Default identity "${store.default}" not found. Run: astrale identity create ${store.default}`,
    )
  }
  return { ...identity, name: store.default }
}

export async function getIdentity(name: string): Promise<Identity> {
  const store = await readIdentities()
  const identity = store.identities[name]
  if (!identity) {
    throw new Error(`Identity "${name}" not found. Run: astrale identity create ${name}`)
  }
  return identity
}

import { readFile } from 'node:fs/promises'
import { z } from 'zod'

export const ADMIN_KERNEL_INSTANCE = '/admin.astrale.ai/class.AdminKernelInstance'

export type UserAccountInput = {
  id: string
  email?: string
  firstName?: string
  lastName?: string
}

export type AdminKernelInstanceInfo = {
  id: string
  managerInstanceId: string
  hostId: string
  ownerUserId: string
  graphName: string
  issuer: string
  status: 'pending' | 'ready' | 'failed'
  privateKeyId: string
  distributionInstalled: boolean
  userSeeded: boolean
  createdAt: string
  error: string | null
}

export type AdminCreateInstanceInput = {
  id: string
  label?: string
  hostId?: string
  graphName?: string
  issuer?: string
  owner: UserAccountInput
  installDistribution?: boolean
  seedUser?: boolean
  trustPolicy?: unknown
  provisioningPolicy?: unknown
  enableDiscovery?: boolean
}

export type AdminCreateInstanceOpts = {
  label?: string
  hostId?: string
  graphName?: string
  issuer?: string
  ownerId?: string
  ownerEmail?: string
  ownerFirstName?: string
  ownerLastName?: string
  installDistribution?: boolean
  seedUser?: boolean
  trustPolicy?: string
  provisioningPolicy?: string
  disableDiscovery?: boolean
}

const jsonObjectSchema = z.record(z.string(), z.unknown())

export async function buildAdminCreateInstanceInput(
  id: string,
  opts: AdminCreateInstanceOpts,
): Promise<AdminCreateInstanceInput> {
  const fallbackOwner = opts.ownerId ?? id
  return {
    id,
    ...(opts.label ? { label: opts.label } : {}),
    ...(opts.hostId ? { hostId: opts.hostId } : {}),
    ...(opts.graphName ? { graphName: opts.graphName } : {}),
    ...(opts.issuer ? { issuer: opts.issuer } : {}),
    owner: {
      id: fallbackOwner,
      ...(opts.ownerEmail ? { email: opts.ownerEmail } : {}),
      ...(opts.ownerFirstName ? { firstName: opts.ownerFirstName } : {}),
      ...(opts.ownerLastName ? { lastName: opts.ownerLastName } : {}),
    },
    installDistribution: opts.installDistribution !== false,
    seedUser: opts.seedUser !== false,
    ...(opts.trustPolicy
      ? { trustPolicy: await readJsonObject(opts.trustPolicy, 'trust policy') }
      : {}),
    ...(opts.provisioningPolicy
      ? { provisioningPolicy: await readJsonObject(opts.provisioningPolicy, 'provisioning policy') }
      : {}),
    ...(opts.disableDiscovery ? { enableDiscovery: false } : {}),
  }
}

async function readJsonObject(path: string, label: string): Promise<Record<string, unknown>> {
  try {
    return jsonObjectSchema.parse(JSON.parse(await readFile(path, 'utf-8')))
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`Failed to read ${label} at ${path}: ${detail}`)
  }
}

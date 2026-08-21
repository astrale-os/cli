import type { SchemaRevision } from '../../shared/types'

import { isSchemaRevision } from '../../shared/types'

type AnyRecord = Record<string, unknown>

/**
 * Cross the installed-bundle JSON boundary through one exact SDK cohort, then
 * ask the DSL owner for the root revision. Invalid/unavailable bundles return
 * null so Studio reports unknown drift instead of inventing an identity.
 */
export function admittedBundleRevisionFromSdk(
  sdkModule: Record<string, unknown>,
  input: unknown,
): SchemaRevision | null {
  const bundleApi = asRecord(sdkModule.bundle)
  const schemaApi = asRecord(sdkModule.schema)
  if (typeof bundleApi?.accept !== 'function' || typeof schemaApi?.revision !== 'function') {
    return null
  }
  try {
    const accepted = asRecord(Reflect.apply(bundleApi.accept, bundleApi, [input]))
    if (!accepted || !Object.prototype.hasOwnProperty.call(accepted, 'root')) return null
    const revision = Reflect.apply(schemaApi.revision, schemaApi, [accepted.root])
    return isSchemaRevision(revision) ? revision : null
  } catch {
    return null
  }
}

export async function admittedBundleRevision(
  domainRoot: string,
  input: unknown,
): Promise<SchemaRevision | null> {
  try {
    const sdkModule: Record<string, unknown> = await import(
      Bun.resolveSync('@astrale-os/sdk/schema', domainRoot)
    )
    return admittedBundleRevisionFromSdk(sdkModule, input)
  } catch {
    return null
  }
}

function asRecord(value: unknown): AnyRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as AnyRecord)
    : null
}

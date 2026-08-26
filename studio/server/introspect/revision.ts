import type { SchemaRevision } from '../../shared/types'
import type { SchemaAdmissionSdk } from './canonical-schema'

import { isSchemaRevision } from '../../shared/types'

/**
 * Cross the installed-bundle JSON boundary through the Domain's installed SDK, then
 * ask the DSL owner for the root revision. Invalid/unavailable bundles return
 * null so Studio reports unknown drift instead of inventing an identity.
 */
export function admittedBundleRevisionFromSdk(
  sdk: SchemaAdmissionSdk,
  input: unknown,
): SchemaRevision | null {
  try {
    const accepted = sdk.bundle.accept(input)
    const domain = sdk.schema.resolve(accepted.root)
    return domain.source === accepted.root && isSchemaRevision(domain.revision)
      ? domain.revision
      : null
  } catch {
    return null
  }
}

export async function admittedBundleRevision(
  domainRoot: string,
  input: unknown,
): Promise<SchemaRevision | null> {
  try {
    const sdk = (await import(
      Bun.resolveSync('@astrale-os/sdk/schema', domainRoot)
    )) as unknown as SchemaAdmissionSdk
    return admittedBundleRevisionFromSdk(sdk, input)
  } catch {
    return null
  }
}

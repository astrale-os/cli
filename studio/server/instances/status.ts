import type { InstanceStatus, SchemaRevision } from '../../shared/types'
import type { DomainHandle } from '../domain'

import { admittedBundleRevision } from '../introspect/revision'
import { hasProdScript } from './deploy'
import { lastDeploy } from './deploy-record'
import { getInstalledDomain } from './probe'

export function schemaRevisionDrift(
  localRevision: SchemaRevision | null,
  installedRevision: SchemaRevision | null,
): InstanceStatus['drift'] {
  if (!localRevision || !installedRevision) return 'unknown'
  return localRevision === installedRevision ? 'in-sync' : 'drifted'
}

export async function instanceStatus(
  handle: DomainHandle,
  deployTarget: string | null,
  origin: string | null,
  localRevision: SchemaRevision | null,
): Promise<InstanceStatus> {
  const deployable = hasProdScript(handle.root)
  const last = lastDeploy(handle.root)
  let install: InstanceStatus['install'] = 'unknown'
  let installedRevision: SchemaRevision | null = null
  let drift: InstanceStatus['drift'] = 'unknown'

  if (origin && deployTarget) {
    const probe = await getInstalledDomain(origin, deployTarget)
    if (probe.state === 'installed') {
      install = 'installed'
      installedRevision = await admittedBundleRevision(handle.root, probe.bundle)
      drift = schemaRevisionDrift(localRevision, installedRevision)
    } else if (probe.state === 'not-installed') {
      install = 'not-installed'
    }
  }

  return {
    deployTarget,
    deployable,
    install,
    drift,
    localRevision,
    installedRevision,
    lastDeploy: last,
  }
}

import type { DeployRecord } from '../../shared/types'

import { asJsonRecord, asString } from '../json'
import { readJson, writeJson } from '../state/store'

const DEPLOY_RECORD_FILE = 'deploy.json'

function decodeDeployRecord(value: unknown): DeployRecord | undefined {
  const stored = asJsonRecord(value)
  const at = asString(stored?.at)
  if (!at || stored?.ok !== true) return undefined
  const renderFingerprint = asString(stored.renderFingerprint) ?? asString(stored.schemaHash) ?? ''
  const url = asString(stored.url)
  return {
    at,
    renderFingerprint,
    ok: true,
    ...(url === undefined ? {} : { url }),
  }
}

export function lastDeploy(root: string): DeployRecord | null {
  return readJson(root, DEPLOY_RECORD_FILE, decodeDeployRecord, null)
}

export function recordSuccessfulDeploy(
  root: string,
  renderFingerprint: string | null,
  url: string | null,
): void {
  writeJson(root, DEPLOY_RECORD_FILE, {
    at: new Date().toISOString(),
    renderFingerprint: renderFingerprint ?? '',
    ok: true,
    url: url ?? undefined,
  } satisfies DeployRecord)
}

import type { InstalledPin } from '@astrale-os/sdk/client/schema'

import {
  acceptDeploymentRecord,
  parseDeploymentLabel,
  type DeploymentRecordV1,
} from '@astrale-os/sdk/deployment/address'

import { cancel } from './domain-publication'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/** The reserved path a deployment's dispatcher answers with its record (CT38). */
export const DEPLOYMENT_RECORD_PATH = '/.well-known/astrale/deployment.json'
export const DEPLOYMENT_RECORD_MEDIA_TYPE = 'application/vnd.astrale.deployment-record+json;v=1'

/** A record is a few hundred bytes; anything above this is not one. */
const MAXIMUM_RECORD_BYTES = 16 * 1_024
/** One record read; a deployment that does not answer in time is listed without its record. */
export const DEPLOYMENT_RECORD_TIMEOUT_MS = 5_000

/** The installation a record is read for: its origin, deployment URL and release pin. */
export interface RecordedInstallation {
  readonly origin: string
  readonly url: string
  readonly pin: Extract<InstalledPin, { readonly kind: 'release' }>
}

/**
 * Read the public record of the deployment one installation pins (CT38), or `undefined` when there
 * is none to trust. The dispatcher of the deployment's routing domain answers
 * `/.well-known/astrale/deployment.json` itself, from what Services stored when the deployment
 * activated; the record is admitted exactly (`acceptDeploymentRecord`) and must describe this very
 * deployment: its provider script is the URL's deployment label, and its origin, release digest
 * and build digest are the installation's. Anything else (no answer, another status, another media
 * type, a redirect, an oversize or invalid body, a record of another deployment) is no record, so a
 * listing never fails over a name and never shows a name the pin does not back.
 */
export async function readDeploymentRecord(
  installation: RecordedInstallation,
  fetchImpl: FetchLike = globalThis.fetch,
  timeoutMs: number = DEPLOYMENT_RECORD_TIMEOUT_MS,
): Promise<DeploymentRecordV1 | undefined> {
  let deployment: URL
  try {
    deployment = new URL(installation.url)
  } catch {
    return undefined
  }
  const label = deploymentLabelOf(deployment)
  if (label === undefined) return undefined
  let response: Response
  try {
    response = await fetchImpl(new URL(DEPLOYMENT_RECORD_PATH, deployment.origin), {
      redirect: 'error',
      headers: { accept: DEPLOYMENT_RECORD_MEDIA_TYPE },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    return undefined
  }
  if (response.status !== 200 || !hasMediaType(response, DEPLOYMENT_RECORD_MEDIA_TYPE)) {
    await cancel(response.body)
    return undefined
  }
  let record: DeploymentRecordV1
  try {
    const bytes = await readRecordBytes(response)
    if (bytes === undefined) return undefined
    record = acceptDeploymentRecord(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown,
    )
  } catch {
    return undefined
  }
  const bound =
    record.providerScript === label &&
    record.origin === installation.origin &&
    record.releaseDigest === installation.pin.release &&
    record.buildDigest === installation.pin.build
  return bound ? record : undefined
}

/**
 * The deployment label a URL's host starts with, when it is one (`<line>-<content>`, CT16): a
 * record exists only for a deployment under a routing domain, never for a legacy Worker name.
 */
export function deploymentLabelOf(url: URL): string | undefined {
  const label = url.hostname.split('.')[0]
  if (label === undefined || url.hostname === label) return undefined
  try {
    parseDeploymentLabel(label)
  } catch {
    return undefined
  }
  return label
}

async function readRecordBytes(response: Response): Promise<Uint8Array | undefined> {
  const declared = response.headers.get('content-length')
  if (declared !== null && !(/^\d+$/u.test(declared) && Number(declared) <= MAXIMUM_RECORD_BYTES)) {
    await cancel(response.body)
    return undefined
  }
  if (response.body === null) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAXIMUM_RECORD_BYTES) {
      await reader.cancel().catch(() => undefined)
      return undefined
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

/** The media type comparison the Kernel uses: parameters kept, case and whitespace ignored. */
function hasMediaType(response: Response, expected: string): boolean {
  const actual = response.headers.get('content-type')
  const normalize = (input: string) =>
    input
      .split(';')
      .map((part) => part.trim().toLowerCase())
      .join(';')
  return actual !== null && normalize(actual) === normalize(expected)
}

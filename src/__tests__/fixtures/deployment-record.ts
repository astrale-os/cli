import {
  acceptDeploymentRecord,
  configurationDigest,
  deploymentContent,
  deploymentLabel,
  deploymentLine,
  frozenConfiguration,
  type DeploymentCommitV1,
  type DeploymentRecordV1,
} from '@astrale-os/sdk/deployment/address'

/** The routing domain the fixture deployments live under. */
export const ROUTING_DOMAIN = 'deployments.records-proof.test'

const REVISION = `sha256:${'5'.repeat(64)}` as const

/**
 * One deployment as a host makes it (CT16/CT18): its label derives from its line (origin and
 * environment, readable for platform lines, opaque for tenants) and from its build and frozen
 * configuration, and its record is the one Services admits and the dispatcher serves at
 * `/.well-known/astrale/deployment.json` (CT38).
 */
export function deploymentFixture(input: {
  readonly origin: string
  readonly environment: string
  readonly addressing?: 'readable' | 'opaque'
  readonly release: `sha256:${string}`
  readonly build: `sha256:${string}`
  readonly commit?: DeploymentCommitV1 | null
  /** A variable that makes another configuration, so another address, for the same build. */
  readonly variant?: string
}): { readonly url: string; readonly label: string; readonly record: DeploymentRecordV1 } {
  const configuration = frozenConfiguration({
    vars: input.variant === undefined ? {} : { VARIANT: input.variant },
    settings: { maximumRequestBytes: 1_048_576, invocationTimeoutMs: 30_000, tokenExchange: false },
    runtime: { compatibilityDate: '2026-09-01', compatibilityFlags: [] },
    bindings: { services: [], dispatchNamespaces: [], secrets: [] },
    router: false,
  })
  const line = deploymentLine({
    origin: input.origin,
    environment: input.environment,
    addressing: input.addressing ?? 'readable',
  })
  const label = deploymentLabel(line, deploymentContent(input.build, configuration))
  const record = acceptDeploymentRecord({
    format: 'astrale.deployment-record',
    version: 1,
    origin: input.origin,
    environment: input.environment,
    releaseDigest: input.release,
    buildDigest: input.build,
    schemaRevision: REVISION,
    configuration: configurationDigest(configuration),
    providerScript: label,
    commit: input.commit ?? null,
  })
  return { url: `https://${label}.${ROUTING_DOMAIN}`, label, record }
}

/** A fetch that answers each deployment's record endpoint like the SV1 dispatcher, and records every request. */
export function recordServer(
  records: readonly { readonly url: string; readonly record: unknown }[],
) {
  const requests: Array<{ readonly url: string; readonly headers: Headers }> = []
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    requests.push({ url: url.href, headers: new Headers(init?.headers) })
    const served = records.find((entry) => new URL(entry.url).origin === url.origin)
    if (served === undefined || url.pathname !== '/.well-known/astrale/deployment.json') {
      return new Response(
        '{"error":{"code":5001,"message":"This deployment is not active yet."}}',
        {
          status: 503,
          headers: { 'content-type': 'application/vnd.astrale+json', 'retry-after': '30' },
        },
      )
    }
    return new Response(JSON.stringify(served.record), {
      status: 200,
      headers: {
        'content-type': 'application/vnd.astrale.deployment-record+json;v=1',
        'cache-control': 'public, max-age=31536000, immutable',
      },
    })
  }
  return { fetchImpl, requests }
}

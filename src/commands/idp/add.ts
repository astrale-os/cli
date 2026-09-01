import { readFile } from 'node:fs/promises'

import type { CommandDefinition } from '../../program/index'

import {
  fetchOidcMetadata,
  fetchWorkosApplication,
  OidcMetadataSchema,
  type IdpClientConfig,
  upsertIdpConfig,
  workosAuthKitMetadata,
} from '../../lib/idp'
import { log, withSpinner } from '../../lib/log'
import { isMachine, output, RAW_OUTPUT_OPTIONS } from '../../lib/output'
import { validateName, validateUrl } from '../../lib/validation'

type AddOpts = {
  issuer?: string
  metadata?: string
  clientId?: string
  clientSecretEnv?: string
  redirectUri?: string
  scope?: string
  public?: boolean
  workosApiKeyEnv?: string
  workosApp?: string
  workosAuthkit?: boolean
  workosApiHostname?: string
  raw?: boolean
  json?: boolean
}

export default {
  name: 'add',
  description: 'Add or update an OpenID Connect identity provider',
  arguments: [{ name: 'name', description: 'Local IdP registry name' }],
  options: [
    { flags: '--issuer <url>', description: 'OIDC issuer URL' },
    { flags: '--metadata <path>', description: 'Read discovery metadata from a local JSON file' },
    { flags: '--client-id <id>', description: 'OAuth/OIDC client ID' },
    { flags: '--client-secret-env <name>', description: 'Env var containing the client secret' },
    { flags: '--redirect-uri <url>', description: 'Redirect URI for authorization-code login' },
    { flags: '--scope <scope>', description: 'Default OAuth scope string' },
    { flags: '--public', description: 'Mark the client as public/PKCE-capable' },
    {
      flags: '--workos-api-key-env <name>',
      description: 'Env var containing the WorkOS API key',
      default: 'WORKOS_API_KEY',
    },
    { flags: '--workos-app <id>', description: 'Fetch WorkOS Connect application metadata' },
    {
      flags: '--workos-authkit',
      description: 'Configure WorkOS AuthKit CLI Auth using client_id only',
    },
    {
      flags: '--workos-api-hostname <url>',
      description: 'WorkOS API host for AuthKit CLI Auth',
      default: 'https://api.workos.com',
    },
    ...RAW_OUTPUT_OPTIONS,
  ],
  afterHelpText: `
Examples:
  $ astrale idp add workos --workos-authkit --client-id client_...
  $ astrale idp add workos-connect --issuer https://example.authkit.app \\
      --client-id client_... --scope "openid profile email offline_access"
  $ astrale idp add workos-connect --issuer https://example.authkit.app \\
      --workos-app app_... --workos-api-key-env WORKOS_API_KEY

Security:
  Client secrets and WorkOS API keys are never stored by the CLI. Store only
  the env var name with --client-secret-env / --workos-api-key-env.
`,
  action: async (name: string, opts: AddOpts) => {
    validateName(name, 'IdP')
    const spin = !isMachine(opts)
    if (!opts.issuer && !opts.metadata && !opts.workosAuthkit) {
      throw new Error('Either --issuer, --metadata, or --workos-authkit is required')
    }

    let metadata = opts.workosAuthkit
      ? workosAuthKitMetadata(opts.workosApiHostname, opts.clientId)
      : opts.metadata
        ? OidcMetadataSchema.parse(JSON.parse(await readFile(opts.metadata, 'utf-8')))
        : await withSpinner(`Fetching discovery metadata from ${opts.issuer}`, spin, () =>
            fetchOidcMetadata(opts.issuer!),
          )

    if (opts.issuer) {
      validateUrl(opts.issuer)
      if (normalizeIssuer(metadata.issuer) !== normalizeIssuer(opts.issuer)) {
        throw new Error(
          `OIDC issuer mismatch: metadata has ${metadata.issuer}, expected ${opts.issuer}`,
        )
      }
    }

    let client: IdpClientConfig = {
      client_id: opts.clientId,
      client_secret_env: opts.clientSecretEnv,
      redirect_uris: opts.redirectUri ? [opts.redirectUri] : undefined,
      scope: opts.scope,
      public: opts.public,
      token_response: opts.workosAuthkit ? 'workos-authkit' : undefined,
      token_request_format: opts.workosAuthkit ? 'json' : undefined,
    }

    if (opts.workosApp) {
      const app = await withSpinner(`Fetching WorkOS application ${opts.workosApp}`, spin, () =>
        fetchWorkosApplication({
          app: opts.workosApp!,
          apiKeyEnv: opts.workosApiKeyEnv ?? 'WORKOS_API_KEY',
        }),
      )
      client = {
        ...client,
        client_id: client.client_id ?? app.client_id,
        redirect_uris:
          client.redirect_uris ?? app.redirect_uris?.map((uri) => uri.uri).filter(isString),
        scope: client.scope ?? app.scopes?.join(' '),
        public: client.public ?? app.uses_pkce,
        workos_application_id: app.id,
        workos_application_type: app.application_type,
      }
    }

    if (opts.workosAuthkit && client.client_id) {
      metadata = workosAuthKitMetadata(opts.workosApiHostname, client.client_id)
    }

    const idp = await upsertIdpConfig({ name, metadata, client })
    if (isMachine(opts)) {
      output(redact(idp), opts)
      return
    }

    log.success(`IdP "${name}" saved`)
    log.dim(`  issuer: ${idp.metadata.issuer}`)
    if (idp.client.client_id) log.dim(`  client_id: ${idp.client.client_id}`)
    if (idp.client.client_secret_env)
      log.dim(`  client_secret_env: ${idp.client.client_secret_env}`)
  },
} satisfies CommandDefinition

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function redact<T extends { client: IdpClientConfig }>(value: T): T {
  return value
}

function normalizeIssuer(value: string): string {
  return value.replace(/\/+$/, '')
}

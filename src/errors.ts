export class AstraleError extends Error {
  code: string
  hint?: string

  constructor(code: string, message: string, hint?: string) {
    super(message)
    this.name = 'AstraleError'
    this.code = code
    this.hint = hint
  }
}

export class ConfigError extends AstraleError {
  constructor(message: string, hint?: string) {
    super('CONFIG_ERROR', message, hint ?? 'Check ~/.astrale/config.json')
  }
}

export class AuthError extends AstraleError {
  constructor(message: string, hint?: string) {
    super('AUTH_ERROR', message, hint ?? 'Run `astrale init` to set up keys')
  }
}

// ── Typed errors (DESIGN.md §4.6, §4.7, §5.1, §10, §11, §12) ─────────

export class IssuerUnreachableError extends AstraleError {
  constructor(url: string, hint?: string) {
    super(
      'ISSUER_UNREACHABLE',
      `Issuer endpoint "${url}" not reachable`,
      hint ?? 'Check the tunnel / proxy is up, or re-run `astrale start`',
    )
  }
}

export class ReservedSlugError extends AstraleError {
  constructor(slug: string) {
    super(
      'RESERVED_SLUG',
      `Slug "${slug}" is reserved`,
      'Pick a different slug — "manager" is the machine-level manager',
    )
  }
}

export class IdentifierCollisionError extends AstraleError {
  constructor(identifier: string, existingEntity: string) {
    super(
      'IDENTIFIER_COLLISION',
      `Identifier "${identifier}" collides with existing ${existingEntity}`,
      'Slug and name share the same CLI namespace (§4.7). Pick a unique value.',
    )
  }
}

export class CannotDeleteManagerError extends AstraleError {
  constructor() {
    super(
      'CANNOT_DELETE_MANAGER',
      'The local manager cannot be deleted',
      'Use `astrale stop` to shut it down',
    )
  }
}

export class CapabilityMissingError extends AstraleError {
  constructor(capability: string, adapter: string) {
    super(
      'CAPABILITY_MISSING',
      `Adapter "${adapter}" does not support capability "${capability}"`,
      'Choose a different adapter or avoid commands that require this capability',
    )
  }
}

export class LockTimeoutError extends AstraleError {
  constructor(registry: string) {
    super(
      'LOCK_TIMEOUT',
      `Timed out acquiring lock on registry "${registry}"`,
      'Another CLI instance may be running — retry shortly',
    )
  }
}

export class CoupledMigrationRequiredError extends AstraleError {
  constructor(entity: string, coupled: string) {
    super(
      'COUPLED_MIGRATION_REQUIRED',
      `Cannot migrate "${entity}" alone — it is coupled to "${coupled}"`,
      'Rerun with `--cascade` to migrate both, or `--force-decouple` to break the link',
    )
  }
}

export class TunnelNotConfiguredError extends AstraleError {
  constructor() {
    super(
      'TUNNEL_NOT_CONFIGURED',
      'No tunnel adapter is configured',
      'Run `astrale tunnel setup` to configure a TunnelAdapter',
    )
  }
}

export class TunnelDnsUnresolvedError extends AstraleError {
  constructor(hostname: string) {
    super(
      'TUNNEL_DNS_UNRESOLVED',
      `Tunnel DNS did not resolve for "${hostname}"`,
      'Verify your tunnel provider DNS is live before re-running `astrale tunnel setup`',
    )
  }
}

export class TunnelRegistryInvalidError extends AstraleError {
  constructor(path: string, cause: string) {
    super(
      'TUNNEL_REGISTRY_INVALID',
      `Cannot parse tunnel registry at ${path}: ${cause}`,
      'Inspect the file, back it up, then delete it to start fresh. Re-register existing tunnels with `astrale tunnel adopt <name>`.',
    )
  }
}

export class TunnelNotFoundError extends AstraleError {
  constructor(nameOrId: string) {
    super(
      'TUNNEL_NOT_FOUND',
      `Tunnel "${nameOrId}" not found in registry`,
      'Run `astrale tunnel list` to see registered tunnels, or `astrale tunnel setup <name>` / `astrale tunnel adopt <name>` to add one.',
    )
  }
}

export class TunnelUnsupportedConfigError extends AstraleError {
  constructor(name: string, reasons: string[]) {
    super(
      'TUNNEL_UNSUPPORTED_CONFIG',
      `Tunnel "${name}" has routes astrale cannot manage:\n  - ${reasons.join('\n  - ')}`,
      'astrale only manages http(s) hostname→service routing. Run this tunnel directly with cloudflared, or remove the unsupported routes before adopting.',
    )
  }
}

export class BuiltinDomainNotFoundError extends AstraleError {
  constructor(name: string) {
    super(
      'BUILTIN_DOMAIN_NOT_FOUND',
      `Builtin domain "${name}" could not be resolved`,
      `Set ASTRALE_${name.toUpperCase()}_SPEC and ASTRALE_${name.toUpperCase()}_KEY, install @astrale-os/${name}-domain, or run from the monorepo.`,
    )
  }
}

export class IdentityKeyMissingError extends AstraleError {
  constructor(subject: string) {
    super(
      'IDENTITY_KEY_MISSING',
      `No private key on disk for identity "${subject}"`,
      `Run \`astrale identity create ${subject}\` to generate one, or \`astrale init\` to bootstrap.`,
    )
  }
}

export class NotImplementedError extends AstraleError {
  constructor(feature: string, hint?: string) {
    super(
      'NOT_IMPLEMENTED',
      `"${feature}" is not implemented in v1`,
      hint ?? 'Track the design implementation progress for updates',
    )
  }
}

export class LifecycleConfigInvalidError extends AstraleError {
  constructor(domain: string, overlap: readonly string[], lifecyclePath?: string) {
    super(
      'LIFECYCLE_CONFIG_INVALID',
      `Domain "${domain}": key(s) listed in both extraDevVars and forwardEnv/forwardEnvOptional: ${overlap.join(', ')}`,
      lifecyclePath
        ? `In ${lifecyclePath}, remove the key(s) from extraDevVars — they're already forwarded from process.env. The two maps must be mutually exclusive.`
        : `Remove the key(s) from extraDevVars — the two maps must be mutually exclusive.`,
    )
  }
}

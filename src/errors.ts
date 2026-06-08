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
    super('AUTH_ERROR', message, hint ?? 'Run `astrale identity create <name>` to set up keys')
  }
}

// ── Typed errors (DESIGN.md §4.6, §4.7, §5.1, §10, §11, §12) ─────────

export class IssuerUnreachableError extends AstraleError {
  constructor(url: string, hint?: string) {
    super(
      'ISSUER_UNREACHABLE',
      `Issuer endpoint "${url}" not reachable`,
      hint ?? 'Check the target URL and issuer configuration',
    )
  }
}

export class ReservedSlugError extends AstraleError {
  constructor(slug: string) {
    super('RESERVED_SLUG', `Slug "${slug}" is reserved`, 'Pick a different slug')
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

export class IdentityKeyMissingError extends AstraleError {
  constructor(subject: string) {
    super(
      'IDENTITY_KEY_MISSING',
      `No private key on disk for identity "${subject}"`,
      `Run \`astrale identity create ${subject}\` to generate one.`,
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

export class AstraleError extends Error {
  code: string
  hint?: string

  constructor(code: string, message: string, hint?: string, options?: ErrorOptions) {
    if (message.trim() === '') throw new TypeError('CLI error message must be non-blank.')
    super(message, options)
    this.name = 'AstraleError'
    this.code = code
    this.hint = hint
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

export class IdentityKeyMissingError extends AstraleError {
  constructor(subject: string) {
    super(
      'IDENTITY_KEY_MISSING',
      `No private key on disk for identity "${subject}"`,
      `Run \`astrale identity create ${subject}\` to generate one.`,
    )
  }
}

export class IdentityNotFoundError extends AstraleError {
  constructor(name: string) {
    super(
      'IDENTITY_NOT_FOUND',
      `Identity "${name}" does not exist locally.`,
      `Run \`astrale identity create ${name}\` before registering it.`,
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

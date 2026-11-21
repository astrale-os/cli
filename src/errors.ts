/**
 * The CLI writes a recovery hint in one of two registers, picked by where the
 * command sits in the sentence:
 *
 *   tail     `No identities. Run: astrale identity create <name>`
 *            the command ends the line — nothing follows it, so no delimiters
 *            and no final period.
 *   inline   ``Run `astrale instance list` to see your instances.``
 *            the command sits inside prose, so backticks delimit it and the
 *            sentence takes its period.
 *
 * Both forms are in use on purpose. Pick by position, not by taste.
 */
export class AstraleError extends Error {
  code: string
  hint?: string
  /** Machine-readable facts of the failure, printed beside the code in JSON output. */
  details?: Readonly<Record<string, unknown>>

  constructor(code: string, message: string, hint?: string, options?: ErrorOptions) {
    if (message.trim() === '') throw new TypeError('CLI error message must be non-blank.')
    super(message, options)
    this.name = 'AstraleError'
    this.code = code
    this.hint = hint
  }
}

/**
 * An assumption of the CLI's own code failed: nothing the caller wrote or holds explains it, and no
 * command can name a remedy. It is reported only as UNEXPECTED_ERROR, with its message and stack
 * under `--debug`. A failure the caller can act on is an {@link AstraleError} instead; the CLI never
 * constructs a bare `Error`.
 */
export class InternalError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'InternalError'
  }
}

export class AuthError extends AstraleError {
  constructor(message: string, hint?: string) {
    super('AUTH_ERROR', message, hint ?? 'Run `astrale identity create <name>` to set up keys.')
  }
}

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
      'Slug and name share the same CLI namespace. Pick a unique value.',
    )
  }
}

/** A name the local identity registry does not hold. */
export class IdentityNotFoundError extends AstraleError {
  constructor(name: string) {
    super('NO_IDENTITY', `Identity "${name}" not found.`, 'Run: astrale identity list')
  }
}

/** A name the local IdP registry does not hold, and not the built-in IdP. */
export class IdpNotFoundError extends AstraleError {
  constructor(name: string) {
    super('IDP_NOT_FOUND', `IdP "${name}" not found.`, 'Run: astrale idp list')
  }
}

/** `agent-browser`, the engine a browser-driving command runs on, is not installed. */
export class AgentBrowserMissingError extends AstraleError {
  constructor(command: string, repo: string, alternative?: string) {
    super(
      'AGENT_BROWSER_NOT_INSTALLED',
      `agent-browser is not installed — it is the engine \`astrale ${command}\` drives.`,
      `Install it: npm install -g agent-browser && agent-browser install, then its agent skill: npx skills add ${repo}${alternative === undefined ? '' : `, or ${alternative}`}`,
    )
    this.details = { repo }
  }
}

const SOURCE_LABEL = { key: 'key-backed', idp: 'IdP-backed' } as const

/** A name the local identity registry already holds, which the CLI never silently reuses. */
export class IdentityExistsError extends AstraleError {
  constructor(
    name: string,
    options: { readonly source?: 'key' | 'idp'; readonly hint?: string } = {},
  ) {
    const backing = options.source === undefined ? '' : ` and is ${SOURCE_LABEL[options.source]}`
    super(
      'IDENTITY_EXISTS',
      `Identity "${name}" already exists${backing}.`,
      options.hint ?? 'Pick a different identity name.',
    )
  }
}

export class IdentityKeyMissingError extends AstraleError {
  constructor(subject: string) {
    super(
      'IDENTITY_KEY_MISSING',
      `No private key on disk for identity "${subject}"`,
      'Restore or import its keypair, or create a different local identity.',
    )
  }
}

export class IdentityKeypairIncompleteError extends AstraleError {
  constructor(subject: string, missing: readonly ('private' | 'public')[]) {
    super(
      'IDENTITY_KEYPAIR_INCOMPLETE',
      `Identity "${subject}" has an incomplete keypair (missing ${missing.join(' and ')} key).`,
      'Restore or import its complete keypair, or create a different local identity.',
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

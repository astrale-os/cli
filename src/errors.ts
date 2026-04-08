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

export interface CommandArgument {
  readonly name: string
  readonly description: string
  readonly required?: boolean
  readonly variadic?: boolean
}

/**
 * Naming a flag that bypasses a safety gate — the CLI uses three, and they are
 * not interchangeable:
 *
 *   --yes        skip a question the CLI would otherwise ask. The action is
 *                unchanged; only the prompt disappears.
 *   --force      proceed through a refusal. The CLI would decline outright,
 *                and the flag overrides that judgment.
 *   --overwrite  a --force scoped to destroying local work (edited source, a
 *                lock), so the two can be demanded together.
 *
 * Consent to a specific hazard gets its own named flag rather than a generic
 * one: `--allow-identity-override` says what is being allowed.
 */
export interface CommandOption {
  readonly flags: string
  readonly description: string
  readonly default?: string
  readonly choices?: string[]
  readonly hidden?: boolean
}

export interface CommandDefinition {
  readonly name: string
  readonly description: string
  /** One-line summary shown in the parent's command list (Commander `.summary()`). */
  readonly summary?: string
  /** Hide from help listings (internal entries, e.g. `__view-serve`). */
  readonly hidden?: boolean
  readonly aliases?: string[]
  readonly arguments?: CommandArgument[]
  readonly options?: CommandOption[]
  /**
   * Free-form prose appended to `<cmd> --help` (Commander `addHelpText('after')`).
   * Use for command-local behavior the flag list cannot express + canonical
   * examples. Pre-wrap lines to ~78 cols — Commander prints it verbatim.
   */
  readonly afterHelpText?: string
  /** Opaque Commander callback; each command module owns its concrete argument tuple. */
  readonly action: (...args: never[]) => Promise<void>
}

export interface CommandGroup {
  readonly name: string
  readonly description: string
  /** One-line summary shown in the program's command list (Commander `.summary()`). */
  readonly summary?: string
  readonly commands: CommandDefinition[]
  /** Nested subgroups (one extra level of `astrale foo bar baz` nesting). */
  readonly subgroups?: CommandGroup[]
}

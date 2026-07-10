export type CommandArgument = {
  name: string
  description: string
  required?: boolean
}

export type CommandOption = {
  flags: string
  description: string
  default?: string
  choices?: string[]
}

export type CommandDefinition = {
  name: string
  description: string
  /** One-line summary shown in the parent's command list (Commander `.summary()`). */
  summary?: string
  /** Hide from help listings (internal entries, e.g. `__view-serve`). */
  hidden?: boolean
  aliases?: string[]
  arguments?: CommandArgument[]
  options?: CommandOption[]
  /**
   * Free-form prose appended to `<cmd> --help` (Commander `addHelpText('after')`).
   * Use for command-local behavior the flag list cannot express + canonical
   * examples. Pre-wrap lines to ~78 cols — Commander prints it verbatim.
   */
  afterHelpText?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Commander passes typed args at runtime
  action: (...args: any[]) => Promise<void>
}

export type CommandGroup = {
  name: string
  description: string
  /** One-line summary shown in the program's command list (Commander `.summary()`). */
  summary?: string
  commands: CommandDefinition[]
  /** Nested subgroups (one extra level of `astrale foo bar baz` nesting). */
  subgroups?: CommandGroup[]
}

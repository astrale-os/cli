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
  aliases?: string[]
  arguments?: CommandArgument[]
  options?: CommandOption[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Commander passes typed args at runtime
  action: (...args: any[]) => Promise<void>
}

export type CommandGroup = {
  name: string
  description: string
  commands: CommandDefinition[]
}

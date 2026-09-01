import { valueSchema } from '@astrale-os/sdk/schema'

export const string = valueSchema<string>()({ type: 'string' })
export const boolean = valueSchema<boolean>()({ type: 'boolean' })
export const number = valueSchema<number>()({ type: 'number' })
export const date = valueSchema<string>()({ type: 'string', format: 'date' })

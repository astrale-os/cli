import type { OutputOpts } from '../lib/output'

export type KernelCommandOpts = OutputOpts & {
  url?: string
  instance?: string
  timeout?: string
  as?: string
  debug?: boolean
}

export type CallCommandOpts = KernelCommandOpts & {
  data?: string
}

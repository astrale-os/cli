import { defineCapability } from '@astrale-os/spec/authoring'

export const CLI_CONNECTION = defineCapability({
  id: 'CLI-CONNECTION',
  statement:
    'Selects one exact source Kernel and exposes scoped public Host, Graph, and Auth capabilities with terminal cleanup.',
})

export const CLI_AUTH = defineCapability({
  id: 'CLI-AUTH',
  statement:
    'Pins the selected source issuer, explicitly admits either credential-less or target-bound authenticated sessions, and delegates remote destinations without forwarding a prior bearer.',
})

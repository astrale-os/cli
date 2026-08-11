import { defineCapability } from '@astrale-os/spec/authoring'

export const CLI_IDENTITY = defineCapability({
  id: 'CLI-IDENTITY',
  statement:
    'Preserves local identity selection, isolated key material, and explicit import/export journeys.',
})

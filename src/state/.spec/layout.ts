import { defineLayout } from '@astrale-os/spec/authoring'

export default defineLayout({
  entries: [
    '__tests__/',
    'exchange-credentials.ts',
    'files.ts',
    'identities.ts',
    'index.ts',
    'paths.ts',
    'session-routes.ts',
    'tsconfig.json',
  ],
  exact: true,
})

import { defineLayout } from '@astrale-os/spec/authoring'

export default defineLayout({
  entries: ['__tests__/', 'index.ts', 'mutation.ts', 'projection.ts', 'query.ts', 'tsconfig.json'],
  exact: true,
})

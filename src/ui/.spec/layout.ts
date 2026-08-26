import { defineLayout } from '@astrale-os/spec/authoring'

export default defineLayout({
  entries: [
    '.spec/',
    '__tests__/',
    'index.ts',
    'lock.ts',
    'model.ts',
    'operations.ts',
    'project.ts',
    'release.ts',
    'runner.ts',
  ],
  exact: true,
})

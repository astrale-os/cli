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
    'request.ts',
    'runner.ts',
    'search/',
    'search/__tests__/',
    'search/artifacts.ts',
    'search/engine.ts',
    'search/index.ts',
    'search/model.ts',
  ],
  exact: true,
})

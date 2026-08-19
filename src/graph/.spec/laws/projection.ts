import { defineLaw } from '@astrale-os/spec/authoring'

export const CLI_GRAPH_PROPERTY_PROJECTION = defineLaw({
  id: 'CLI-GRAPH-PROPERTY-PROJECTION',
  statement:
    'An exact property key wins over a qualified leaf-name match; otherwise the first canonical property with that leaf is presented without rewriting the Node.',
  tests: [
    {
      file: '__tests__/projection.test.ts',
      id: 'TEST-CLI-GRAPH-PROJECTS-QUALIFIED-PROPERTIES',
    },
  ],
})

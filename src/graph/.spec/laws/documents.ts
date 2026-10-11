import { defineLaw } from '@astrale-os/spec/authoring'

export const CLI_GRAPH_QUERY_V6 = defineLaw({
  id: 'CLI-GRAPH-QUERY-V6',
  statement:
    'CLI query input becomes exactly one canonical Query V6 document with an explicit finite limit; --class authors one exact Class source, a canonical Query V6 document is admitted unchanged, and legacy versions or unsupported selector combinations fail before a Graph call.',
  tests: [
    { file: '__tests__/query.test.ts', id: 'TEST-CLI-GRAPH-AUTHORS-QUERY-V6' },
    { file: '__tests__/query.test.ts', id: 'TEST-CLI-GRAPH-AUTHORS-CLASS-QUERY' },
    { file: '__tests__/query.test.ts', id: 'TEST-CLI-GRAPH-ADMITS-QUERY-V6-DOCUMENT' },
    { file: '__tests__/query.test.ts', id: 'TEST-CLI-GRAPH-REJECTS-LEGACY-QUERY' },
  ],
})

export const CLI_GRAPH_MUTATION_V3 = defineLaw({
  id: 'CLI-GRAPH-MUTATION-V3',
  statement:
    'CLI mutation input is admitted as canonical Mutation V3 or its exact authoring input; input that names no operations never reaches GraphApi.mutate.',
  tests: [
    { file: '__tests__/mutation.test.ts', id: 'TEST-CLI-GRAPH-ADMITS-MUTATION-V3' },
    { file: '__tests__/mutation.test.ts', id: 'TEST-CLI-GRAPH-REJECTS-UNAUTHORED-MUTATION' },
  ],
})

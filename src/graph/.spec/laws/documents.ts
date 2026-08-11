import { defineLaw } from '@astrale-os/spec/authoring'

export const CLI_GRAPH_QUERY_V3 = defineLaw({
  id: 'CLI-GRAPH-QUERY-V3',
  statement:
    'CLI query input becomes exactly one canonical Query V3 document with an explicit finite limit; legacy AST versions and unsupported selector combinations fail before a Graph call.',
  tests: [
    { file: '__tests__/query.test.ts', id: 'TEST-CLI-GRAPH-AUTHORS-QUERY-V3' },
    { file: '__tests__/query.test.ts', id: 'TEST-CLI-GRAPH-AUTHORS-DEFINITION-QUERY' },
    { file: '__tests__/query.test.ts', id: 'TEST-CLI-GRAPH-REJECTS-LEGACY-QUERY' },
  ],
})

export const CLI_GRAPH_MUTATION_V2 = defineLaw({
  id: 'CLI-GRAPH-MUTATION-V2',
  statement:
    'CLI mutation input is admitted as canonical Mutation V2 or its exact authoring input; PatchData and other historical shapes never reach GraphApi.mutate.',
  tests: [
    { file: '__tests__/mutation.test.ts', id: 'TEST-CLI-GRAPH-ADMITS-MUTATION-V2' },
    { file: '__tests__/mutation.test.ts', id: 'TEST-CLI-GRAPH-REJECTS-PATCH-DATA' },
  ],
})

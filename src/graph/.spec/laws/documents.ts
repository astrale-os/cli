import { defineLaw } from '@astrale-os/spec/authoring'

export const CLI_GRAPH_QUERY_V6 = defineLaw({
  id: 'CLI-GRAPH-QUERY-V6',
  statement:
    'CLI query input becomes exactly one canonical Query V6 document with an explicit finite limit; --class authors one exact Class source, exact Property ordering and Node or Edge projection profiles are admitted through the canonical AST surface, and legacy versions or unsupported selector combinations fail before a Graph call.',
  tests: [
    { file: '__tests__/query.test.ts', id: 'TEST-CLI-GRAPH-AUTHORS-QUERY-V6' },
    { file: '__tests__/query.test.ts', id: 'TEST-CLI-GRAPH-AUTHORS-CLASS-QUERY' },
    { file: '__tests__/query.test.ts', id: 'TEST-CLI-GRAPH-ADMITS-QUERY-V6-ORDERING' },
    { file: '__tests__/query.test.ts', id: 'TEST-CLI-GRAPH-ADMITS-QUERY-V6-PROJECTIONS' },
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

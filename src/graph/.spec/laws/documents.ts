import { defineLaw } from '@astrale-os/spec/authoring'

export const CLI_GRAPH_QUERY_V5 = defineLaw({
  id: 'CLI-GRAPH-QUERY-V5',
  statement:
    'CLI query input becomes exactly one canonical Query V5 document with an explicit finite limit; exact Property ordering and Node or Edge projection profiles are admitted through the canonical AST surface, while legacy versions and unsupported selector combinations fail before a Graph call.',
  tests: [
    { file: '__tests__/query.test.ts', id: 'TEST-CLI-GRAPH-AUTHORS-QUERY-V5' },
    { file: '__tests__/query.test.ts', id: 'TEST-CLI-GRAPH-AUTHORS-DEFINITION-QUERY' },
    { file: '__tests__/query.test.ts', id: 'TEST-CLI-GRAPH-ADMITS-QUERY-V5-ORDERING' },
    { file: '__tests__/query.test.ts', id: 'TEST-CLI-GRAPH-ADMITS-QUERY-V5-PROJECTIONS' },
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

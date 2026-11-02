# Files

Read when a Domain stores, receives, reads, or serves files. The bytes always travel through the
Kernel, streamed: a Domain never receives file bytes in a call. It receives the caller's upload
receipt and acts with it for that caller.

## The model

1. **Upload.** A client streams the file to the Kernel: `session.content.upload(file, { mediaType })`,
   `astrale upload <file>`, or `astrale call ... --file <field>=<file>`. At most 100 MiB. The Kernel
   stores it content-addressed and answers `{ receipt, ref, expiresAt }`. Nothing is attached yet.
2. **Call.** The client calls a Function or Method with an ordinary JSON input whose file field holds
   the receipt string. Several files and both Functions and Methods work the same way.
3. **Attach.** The Domain attaches the file to a blob property through its caller session, as the
   user. The Kernel then checks the property's `maxBytes` and `mediaTypes` and stores the `Ref`.

A receipt is signed by the Kernel, bound to the identity that uploaded it, and expires (`expiresAt`;
Kernels are moving to 15 minutes, so clients upload just before the call). It works for that identity
directly or for a Domain acting for it through `ctx.kernel.caller` / `ctx.graph.caller`, never for
the Domain acting as itself (`self`, the default `mutate`) and never for another user. A refused,
expired, or forged receipt is `MUTATION_BLOB_RECEIPT_INVALID`; a `Ref` or bytes where a receipt is
expected is `MUTATION_BLOB_RECEIPT_REQUIRED`. A digest or `Ref` grants nothing.

## Declare the stored file

```ts
import { property, schema as language } from '@astrale-os/sdk/schema'

// in the Report Class
content: property(language.values.blob({ maxBytes: 20_000_000, mediaTypes: ['application/pdf'] })),
```

A blob property reads as its `Ref`, `{ digest, mediaType, size }`; its write input is a receipt. Use
`immutable: 'once'` when the file is attached after creation and must never change (see `schema.md`).
Media types are exact canonical strings: `text/csv` does not admit `text/csv;charset=utf-8`.

## Receive a file today

The field is a plain string that carries the receipt. Keep it required and non-empty; do not
validate its shape beyond that, the Kernel admits it at attach.

```ts
// schema: in the Report Class
import: method({
  auth: 'authenticated',
  static: true,
  input: z.object({ title: z.string(), file: z.string().min(1) }),
  output: z.object({ report: z.string() }),
}),
```

```ts
// mutations/report/create-report.ts
import type { schema as language } from '@astrale-os/sdk/schema'

export const createReport = defineMutation<typeof schema>()((domain) => ({
  id: 'report.create',
  build(input: { title: string; file: language.values.BlobReceipt }, mutation) {
    mutation.createNode({
      as: 'report',
      class: domain.classes.Report,
      props: { title: input.title, content: input.file },
    })
  },
  project: (result) => ({ report: result.createdNodes.report! }),
}))

// functions/report/import-report.ts: attach as the caller, the identity the receipt is bound to
export const importReport = defineAction<typeof schema>()(
  'Report.import',
  async ({ input, graph }) =>
    graph.caller.mutate(createReport, {
      title: input.title,
      file: input.file as language.values.BlobReceipt,
    }),
)
```

- Attach through `graph.caller` (or a Kernel call on `kernel.caller`), never the default `mutate`:
  the Domain's own authority is not the uploader, and the receipt is refused.
- The caller needs the right to create or update the holder; a Policy that admits the call but not
  the write still refuses the attach.
- Read the bytes once they are attached: `kernel.caller.content.download({ node, property })`
  returns a streamed binary; consume it to its end and keep nothing on a short or failed read. To
  reject a file by its content, attach it to a pending holder, read, then delete or mark the holder.
- Clients: `astrale call /:<origin>:class.Report:import title=Q3 --file file=./q3.pdf`; a View or
  client session uploads with `session.content.upload(file, { mediaType: file.type })` and passes
  `uploaded.receipt` in the call input.

## Requirements

Declare the exact Kernel Functions the Domain calls for its callers (see `runtime.md`):
`K.functions.mutate` to attach, `K.functions.download` to read the bytes, and `K.functions.upload`
when the Domain stores bytes it produces itself (it uploads as `self` and attaches as `self`: a
receipt binds to whoever uploaded it).

```ts
requirements: requirements({
  functions: [K.functions.query, K.functions.mutate, K.functions.download],
}),
```

## Durable Workflows

A durable run has no caller session: it acts as the Domain only, so a Workflow Step cannot attach a
user's receipt. Receive the file in an Action that attaches it through `graph.caller`, then starts
the Workflow with the holder's Node id (`kernel.caller.invoke(reference(domain, Report.methods.process), …)`,
`reference` from `@astrale-os/sdk/client/session`). Steps then read the file by node and property as
the Domain, which reads its own Classes.

## Binary input

`input.binary(...)` is for a callable that consumes a stream it does not store (convert, scan, relay
and answer). A file the graph keeps goes through upload and a blob property, never through a binary
input.

## Coming (not released)

Do not use these until the installed SDK and Kernel export them; check the SDK's public exports.

- A DSL `file()` value kind for callable inputs: `file()`, `file({ maxBytes, mediaTypes })`, or
  `file(Domain.classes.X.properties.y)` to reuse a blob property's bounds. Introspection shows it as
  `{ "type": "string", "x-astrale-value-kind": "file", "x-astrale-file": { "maxBytes"?, "mediaTypes"? } }`;
  the wire value stays the receipt string, so clients and `astrale call --file` work unchanged and
  check the bounds before uploading.
- Read by receipt before attaching: `ctx.kernel.caller.content.download({ receipt })` (a bad receipt
  is `FUNCTION_INPUT_INVALID` with reason `BLOB_RECEIPT_INVALID`), and an SDK file object (`text()`,
  `bytes()`, `stream()`) that can be passed to a blob property as is, with a `testing.file(...)`
  fixture.
- Kernel-started durable runs that take `file()` fields: the Kernel replaces each receipt with a
  reference bound to the Execution, usable by its Steps. Until then, use the Action-then-Workflow
  pattern above.
- Receipts shortened to 15 minutes and kept out of the journal.

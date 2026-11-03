# Files

Read when a Domain stores, receives, reads, or serves files. The bytes always travel through the
Kernel, streamed: a Domain never receives file bytes in a call. It receives the caller's upload
receipt at a `file()` input field, as a file object, and reads or attaches it for that caller.

## The model

1. **Upload.** A client streams the file to the Kernel: `astrale upload <file>`, the MCP `upload`
   tool, or `session.content.upload(file, { mediaType })`. At most 100 MiB. The Kernel stores it
   content-addressed and answers `{ receipt, ref, expiresAt }`. Nothing is attached yet.
2. **Call.** The client passes the receipt at the callable's `file()` field: `astrale call ...
   --file <field>=<file>`, the MCP `call`/`mutate` `files` argument, or a typed
   `session.invoke(reference, input)`, which uploads a `Blob`/`File` found at a `file()` field itself.
3. **Read and attach.** The handler receives a file object at that field. It reads the file and
   attaches it to a blob property as the caller; the Kernel then checks the property's `maxBytes`
   and `mediaTypes` and stores the `Ref`.

A receipt is signed by the Kernel, bound to the user who uploaded it, valid for 15 minutes and
reusable until then. It works for that user directly or for a Domain acting for them through
`ctx.kernel.caller` / `mutate(..., { as: 'caller' })`, never for the Domain acting as itself
(`ctx.kernel`, `{ as: 'executor' }`) and never for another user. Read and attach in the
invocation that received it; keep the attached Node, never the receipt. The journal never stores a
receipt. A digest or `Ref` grants nothing.

## Declare the stored file

```ts
import { property, schema as language } from '@astrale-os/sdk/schema'

// the Report Class's `content` property, also named by the import field below
const content = property(language.values.blob({ maxBytes: 5_000_000, mediaTypes: ['text/csv'] }))
```

A blob property reads as its `Ref`, `{ digest, mediaType, size }`; its write input is a receipt or a
received file object. Use `immutable: 'once'` when the file is attached after creation and must
never change (see `schema.md`). Media types are exact canonical strings: `text/csv` does not admit
`text/csv;charset=utf-8`.

## Receive a file: `file()`

```ts
// schema: in the Report Class
import { file, method } from '@astrale-os/sdk/schema'

import: method({
  auth: 'authenticated',
  static: true,
  input: z.object({
    title: z.string(),
    file: file(content), // the blob property's maxBytes and mediaTypes
    notes: z.array(file({ maxBytes: 1_000_000 })).max(10),
  }),
  output: z.object({ report: z.string() }),
}),
```

- `file()` takes any file, `file({ maxBytes, mediaTypes })` states its own bounds, and
  `file(property, { maxBytes?, mediaTypes? })` copies a blob property's bounds and may only narrow
  them. A field that feeds a property should state its bounds.
- Introspection shows `{ "type": "string", "x-astrale-value-kind": "file", "x-astrale-file": {
  "maxBytes"?, "mediaTypes"? } }`; the wire value is the receipt. Clients (`astrale call --file`,
  the typed `session.invoke`) check the bounds before they upload.
- An `anonymous` callable cannot declare a `file()` field: the runtime refuses it when it is built.
- The field typechecks as `language.values.BlobReceipt`; the handler's `input` has a `ReceivedFile`
  (from `@astrale-os/sdk/action`) in its place.

```ts
// mutations/report/create-report.ts
import type { ReceivedFile } from '@astrale-os/sdk/action'
import { LocalAlias } from '@astrale-os/sdk/graph'
import { defineMutation } from '@astrale-os/sdk/mutation'

const report = LocalAlias('report')

export const createReport = defineMutation<typeof schema>()('report.create', {
  build: (input: { readonly title: string; readonly file: ReceivedFile }, { Report }, mutation) => {
    // attaches the file's receipt
    mutation.createNode({ as: report, class: Report, props: { title: input.title, content: input.file } })
  },
  output: (result) => ({ report: result.createdNodes[report]! }),
})

// functions/report/import-report.ts
export const importReport = defineAction<typeof schema>()(
  'Report.import',
  async ({ input, mutate }) => {
    const csv = await input.file.text() // read as the caller, optional
    if (!csv.startsWith('account,')) throw new Error('Not a trial balance.')
    return mutate(createReport, { title: input.title, file: input.file }, { as: 'caller' })
  },
)
```

- Attach as the caller, `mutate(mutation, input, { as: 'caller' })` (a Mutation of the deprecated
  closure form: `graph.caller.mutate(...)`), never `{ as: 'executor' }`: the Domain's own authority
  is not the uploader, and the receipt is refused. Attaching never reads the file. A raw
  `kernel.caller.mutate((m) => ...)` takes `input.file.receipt`.
- The caller needs the right to create or update the holder; a Policy that admits the call but not
  the write still refuses the attach.
- To hand the file to a dependency's `file()` field, pass the receipt as the caller:
  `dependencies.files.caller.invoke((d) => d.functions.scan, { file: input.file.receipt })`.

## Read a file

| Member | Returns |
| --- | --- |
| `receipt` | The receipt the caller sent. |
| `stream()` | A `ReadableStream<Uint8Array>`, for a file of any size. |
| `text()` | The whole file decoded as UTF-8. |
| `bytes()` | The whole file as a `Uint8Array`. |

- Each read downloads the file again as the caller (`kernel.caller.content.download({ receipt })`);
  nothing is kept between reads.
- `text()` and `bytes()` hold the file in memory up to `FILE_MEMORY_LIMIT` (10 MiB, from
  `@astrale-os/sdk/action`) and resolve only once the whole file arrived and was verified. Read a
  larger file with `stream()`, which fails at its end if the bytes differ from the upload: write
  nothing lasting derived from it before it ends. Cancelling the stream cancels the download.
- The SDK checks the field's `maxBytes` and `mediaTypes` on each read and throws `FileReadError`
  (`FILE_TOO_LARGE`, `FILE_MEDIA_TYPE`, `FILE_MEMORY_LIMIT`). The Kernel never checks a field's
  bounds on an ordinary call; a file attached unread is checked against the property's bounds only.
- An attached file reads by holder: `kernel.caller.content.download({ node, property })` returns a
  streamed binary; consume it to its end and keep nothing on a short or failed read.

## Errors a caller sees

| When | Error |
| --- | --- |
| Upload over the Kernel's limit, or a malformed media type | `BLOB_TOO_LARGE`, `BLOB_MEDIA_TYPE_INVALID` |
| Read of an expired, forged, or another user's receipt | `FUNCTION_INPUT_INVALID`, reason `BLOB_RECEIPT_INVALID` |
| Attach of such a receipt, or of a `Ref` | `FUNCTION_INPUT_INVALID`, reason `MUTATION_BLOB_RECEIPT_INVALID` or `MUTATION_BLOB_RECEIPT_REQUIRED` |
| Attach of a file outside the property's bounds | `FUNCTION_INPUT_INVALID`, reason `MUTATION_INPUT_INVALID`, issue `MUTATION_PROPERTY_INVALID` with the `property` |
| Uncaught `FileReadError` | `LIMIT_EXCEEDED` (size) or `VALIDATION_ERROR` (media type), its code as reason |
| Durable start, per field | `FUNCTION_INPUT_INVALID`, reason `BLOB_RECEIPT_INVALID`, `BLOB_TOO_LARGE` or `BLOB_MEDIA_TYPE_INVALID`, the field's JSON Pointer as `path`; no Execution is recorded |

A refused or expired receipt means upload again. `astrale call --file` refuses a file outside the
field's bounds before uploading (`FILE_TOO_LARGE`, `FILE_MEDIA_TYPE_REFUSED`).

## Test a handler

`testing.file(content, { type, receipt })` from `@astrale-os/sdk/testing` is a file object over
bytes in memory (a string, `Uint8Array`, or `Blob`): pass it in the handler's input without a
Kernel. It reads the same bytes on every read under the same limits, and a Mutation attaches it as
its `receipt` (default `test-receipt-<n>`).

```ts
import * as testing from '@astrale-os/sdk/testing'

const file = testing.file('account,amount\n512,10', { type: 'text/csv' })
await expect(file.text()).resolves.toBe('account,amount\n512,10')
```

## Requirements

Declare the exact Kernel Functions the Domain calls for its callers (see `runtime.md`):
`K.functions.download` to read a file, `K.functions.mutate` to attach, and `K.functions.upload`
when the Domain stores bytes it produces itself (it uploads as `self` and attaches as `self`: a
receipt binds to whoever uploaded it).

```ts
requirements: requirements({
  functions: [K.functions.query, K.functions.mutate, K.functions.download],
}),
```

## Durable Workflows

A durable run acts as its Domain and outlives a receipt. At the durable start the Kernel admits each
`file()` receipt for the caller, checks the field's bounds, and replaces it with a reference bound
to the Execution, valid while the run lasts (at most 7 days). The Workflow's input holds that
reference string, not a file object, so the field's bounds are checked at the start and by the
property at the attach, not on each read. A Step uses it wherever a receipt goes,
`kernel.content.download({ receipt })` or a blob property value written with
`step.mutate(id, mutation, input, { as: 'executor' })`: a Step acts as the Domain for this Execution
and has no `caller`. It is refused to anyone else, after the run, and in a child durable call:
attach the file in a Step, then pass the Node. Once the run ends only the attached Nodes keep the
file. A replay of the same idempotency key compares each file by content, but still needs a valid
receipt. Full contract: `docs/durable-workflows.md` in `@astrale-os/sdk`, "Files in a durable
Workflow".

## Binary input

`input.binary(...)` is for a callable that consumes a stream it does not store (convert, scan, relay
and answer). A file the graph keeps goes through upload, a `file()` field, and a blob property,
never through a binary input.

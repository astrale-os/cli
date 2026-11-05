# Files

Read when a Domain stores, receives, reads, or serves files. The bytes always travel through the
Kernel, streamed: a Domain never receives file bytes in a call. It receives the caller's upload
receipt at a `file()` input field, as a file object, and attaches it to its own records as itself.

## The model

1. **Upload.** A client streams the file to the Kernel: `astrale upload <file>`, the MCP `upload`
   tool, or `session.content.upload(file, { mediaType })`. At most 100 MiB. The Kernel stores it
   content-addressed and answers `{ receipt, ref, expiresAt }`. Nothing is attached yet.
2. **Call.** The client passes the receipt at the callable's `file()` field: `astrale call ...
   --file <field>=<file>`, the MCP `call`/`mutate` `files` argument, or a typed
   `session.invoke(reference, input)`, which uploads a `Blob`/`File` found at a `file()` field itself.
   The Kernel admits the call only if each `file()` field holds a valid receipt whose file fits the
   field's `maxBytes` and `mediaTypes`.
3. **Read and attach.** The handler receives a file object at that field. It reads the file if it
   needs to, and attaches it to a blob property of its own Class as the Domain
   (`mutate(..., { as: 'executor' })`); the Kernel then checks the property's `maxBytes` and
   `mediaTypes` and stores the `Ref`.

A receipt is signed by the Kernel, names the user who uploaded it, is valid for one hour and
reusable until then. Until it expires it serves whoever presents it to this instance, like a
short-lived share link: the Domain the user hands it to (`{ as: 'executor' }` or
`{ as: 'caller' }`), or another user. Only an authenticated identity of the instance can use it, so
keep it out of logs. Read and attach in the invocation that received it; keep the attached Node,
never the receipt. The journal never stores a receipt: it records the `Ref` and who uploaded it. A
digest or `Ref` grants nothing.

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
    return mutate(createReport, { title: input.title, file: input.file }, { as: 'executor' })
  },
)
```

- Attach to the Domain's own records as the Domain, `mutate(mutation, input, { as: 'executor' })`
  (a Mutation of the deprecated closure form: `graph.self.mutate(...)`): the callable's `policy`
  already decided the user, and the Domain owns the Class. Attaching never reads the file. A raw
  `kernel.self.mutate((m) => ...)` takes `input.file.receipt`.
- `{ as: 'caller' }` also takes the receipt, but then the caller needs the right to create or
  update the holder.
- To hand the file to a dependency's `file()` field, pass its receipt, as the caller or as the
  Domain: `dependencies.files.self.invoke((d) => d.functions.scan, { file: input.file.receipt })`.

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
- The Kernel checks the field's `maxBytes` and `mediaTypes` when it admits the call, and the SDK
  checks them again on each read, throwing `FileReadError` (`FILE_TOO_LARGE`, `FILE_MEDIA_TYPE`,
  `FILE_MEMORY_LIMIT`).
- An attached file reads by holder: `kernel.caller.content.download({ node, property })` returns a
  streamed binary; consume it to its end and keep nothing on a short or failed read.

## Errors a caller sees

| When | Error |
| --- | --- |
| Upload over the Kernel's limit, or a malformed media type | `BLOB_TOO_LARGE`, `BLOB_MEDIA_TYPE_INVALID` |
| Call whose `file()` field holds an expired, forged or foreign-instance receipt, or a file outside the field's bounds | `FUNCTION_INPUT_INVALID`, reason `BLOB_RECEIPT_INVALID`, `BLOB_TOO_LARGE` or `BLOB_MEDIA_TYPE_INVALID`, the field's JSON Pointer as `path`; the handler does not run |
| Read of an expired or forged receipt | `FUNCTION_INPUT_INVALID`, reason `BLOB_RECEIPT_INVALID` |
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
when the Domain stores bytes it produces itself (it uploads and attaches as `self`).

```ts
requirements: requirements({
  functions: [K.functions.query, K.functions.mutate, K.functions.download],
}),
```

## Durable Workflows

A durable run acts as its Domain and may last far longer than a receipt. Its input holds each
`file()` receipt as the caller sent it, a string, not a file object; the Kernel checked it against
the field's bounds when it admitted the call. A Step uses it as the Domain,
`kernel.content.download({ receipt })` or a blob property value written with
`step.mutate(id, mutation, input, { as: 'executor' })`, **only until it expires, one hour after the
upload**: attach each file the run keeps to a Node in its first Steps, before any `sleep`,
`awaitSignal` or slow call, then read it from that Node. A Step past the hour, a retry after a long
engine outage included, is refused `BLOB_RECEIPT_INVALID` and the user must upload again. The
Execution keeps no file: only the attached Nodes do. Never log or return the receipt. A replay of
the same idempotency key compares each file by content. Full contract: `docs/durable-workflows.md`
in `@astrale-os/sdk`, "Files in a durable Workflow".

## Binary input

`input.binary(...)` is for a callable that consumes a stream it does not store (convert, scan, relay
and answer). A file the graph keeps goes through upload, a `file()` field, and a blob property,
never through a binary input.

# Durable executions

Start a callable whose installed Schema declares `execution.durable: true`:

```sh
astrale execution start '@record::notes.example:class.Note.method.complete' \
  --url https://example/api --as alice --json > receipt.json
astrale execution status receipt.json --url https://example/api --as alice --json
astrale execution result receipt.json --url https://example/api --as alice --wait-ms 10000 --json
```

The receipt survives CLI restarts. `status` reads the current state; `result` returns the
Kernel's terminal outcome (`completed`, `failed`, or `cancelled`). A pending result retains
the Kernel's `EXECUTION_PENDING` error. `--timeout` bounds the request separately from
`--wait-ms`; give the request enough time to cover the requested wait. These commands never
restart, cancel, resume, or delete a workflow. A lost start response has an unknown outcome;
do not automatically repeat the start.

`start` checks the installed declaration and invokes with its meaning fingerprint. The SDK carries that fingerprint
in the invocation target; the Kernel rejects a changed declaration before dispatch. Ordinary values, including objects
with an `id`, are not workflow receipts. `astrale call` keeps its existing raw result contract.
Both commands use the same callable Domain credential exchange and preserve the selected caller.

## Receipt version 1

The public JSON contract has exactly these fields:

```json
{
  "kind": "astrale.execution",
  "version": 1,
  "id": "<returned-execution-id>",
  "kernel": "https://example/api",
  "caller": "<authenticated-caller-node-id>",
  "origin": "notes.example",
  "principal": "domain"
}
```

`id` and `caller` are bare Node IDs, without `@`. `kernel` is the exact canonical Kernel
issuer, not a gateway alias. `origin` is the declaring Domain origin. `principal` is `domain`
for a remote Domain acting for the caller, or `caller` for a Kernel-hosted declaration.
Unknown fields and versions are refused. No private key, token, exchange URL, or local identity
alias is stored. The canonical runtime validator is `src/connection/execution.ts`.

For an execution previously started through `astrale call`, construct this JSON from its
returned ID and the known initiating context. Use
`astrale get @self --url <target> --as <identity> --json` with the same identity and target
to confirm the authenticated caller Node ID in the returned `id` field. Do not infer durability
from an arbitrary `{id}` application value. Observing an existing receipt has no start side effect.

An explicitly selected or active Kernel must match `kernel`; a different target is refused
before opening the target Session (resolving a managed Instance name can query Admin first).
The selected identity's authenticated caller must match `caller` before Domain exchange. Observation reads the selected Kernel's current installed issuer for `origin`
on every command, so a deployment issuer rotation requires no receipt rewrite. A change
between remote Domain and caller principal contexts is refused, including during credential
refresh. The receipt origin selects which installed Domain exchanges the caller proof. Its
endpoint comes from the Kernel installation, never a receipt-supplied URL. Treat a third-party
receipt like a third-party command that selects a Domain. Uninstallation, deleted executions,
revoked access, or a changed owner can still make observation unavailable.

Receipts describe context and grant no authority. They are not signed capabilities: a modified
or manually reconstructed receipt still has to pass the Kernel's immutable execution owner,
principal, and caller access checks. `--creds` and `--anonymous` are not supported here; select
a local identity or its configured default so the CLI can reconstruct the authenticated
Domain-for-caller session without retaining a bearer credential.

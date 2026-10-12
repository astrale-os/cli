# Durable executions

A callable whose installed Schema declares `execution.durable: true` answers with the Execution it
started. `astrale call` prints that Execution's observation receipt instead of a value:

```sh
astrale call '@record::notes.example:class.Note.method.complete' \
  --url https://example/api --as alice --json > receipt.json
astrale execution status receipt.json --url https://example/api --as alice --json
astrale execution result receipt.json --url https://example/api --as alice --wait --json
```

The Kernel tells the CLI what happened: an ordinary value, including an object with an `id`, is
printed as a value and is never a receipt. The receipt survives CLI restarts. `status` reads the
current state; `result` returns the terminal outcome (`completed`, `failed`, or `cancelled`). A
result that has not ended yet is no failure: the CLI says so, prints the commands that wait for it
and read its status (`--json`: `execution`, `follow`, `observe` beside `EXECUTION_PENDING`), and
exits 75. `--wait` waits up to `--timeout` (110 s without it), which then bounds the whole command.
These commands never restart, cancel, resume, or delete a workflow. A lost call response has an
unknown outcome; do not repeat the call automatically.

`astrale call --wait` calls and waits in one command: it answers like a plain call, with the value
once the Execution completed and the Kernel's error (exit 1) once it failed or was cancelled. Still
running when the wait ends, it prints the receipt and exits 75; follow it with
`astrale execution result receipt.json --wait`.

## Receipt version 2

The public JSON contract has exactly these fields:

```json
{
  "kind": "astrale.execution",
  "version": 2,
  "id": "<returned-execution-id>",
  "kernel": "https://example/api",
  "origin": "notes.example",
  "principal": "domain"
}
```

`id` is a bare Node ID, without `@`. `kernel` is the exact canonical Kernel issuer, not a gateway
alias. `origin` is the declaring Domain origin. `principal` is `domain` when the selected credential
acts as a Domain for the caller, or `caller` when it acts as the caller itself. This records the
actual start context, not a hosting assumption. Unknown fields and versions are refused. No private
key, token, exchange URL, or local identity alias is stored. The canonical runtime validator is
`src/connection/execution.ts`.

An explicitly selected or active Kernel must match `kernel`; a different target is refused before
opening the target Session (resolving a managed Instance name can query Admin first). Select the
identity that made the call: the Kernel admits only the caller and principal it recorded on the
Execution. A `caller` receipt preserves caller authority without inspecting the Domain installation
or exchanging credentials, even if its hosting has changed. A `domain` receipt reads the selected
Kernel's current installed issuer for `origin` on every command, so a deployment issuer rotation
requires no receipt rewrite. A Domain receipt refuses a fallback to caller authority, including
during credential refresh. Its origin selects which installed Domain exchanges the caller proof. Its
endpoint comes from the Kernel installation, never a receipt-supplied URL. Treat a third-party
receipt like a third-party command that selects a Domain. Uninstallation, deleted executions,
revoked access, or a changed owner can still make observation unavailable.

Receipts describe context and grant no authority. They are not signed capabilities: a modified or
manually reconstructed receipt still has to pass the Kernel's immutable execution owner, principal,
and caller access checks. `--creds` and `--anonymous` are not supported here; select a local
identity or its configured default so the CLI can reconstruct the authenticated Domain-for-caller
session without retaining a bearer credential.

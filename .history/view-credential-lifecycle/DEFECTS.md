# Defect ledger

## CLI-VIEW-CREDENTIAL-001: remote authenticated Views rejected fresh credentials

Status: fixed and adopted

Observed behavior:

- the CLI session server minted a valid 240-second Kernel bearer;
- local authenticated calls such as `Identity.whoami` accepted it;
- a remote-bound Domain call failed immediately with `Credential is invalid.`

Cause:

The older Shell child session requested the configured 3,600-second route delegation while its
current bearer had only 240 seconds of proof remaining. Kernel correctly refused to issue authority
that outlived its source proof.

Durable correction:

- Shell computes the child delegation TTL from the current bearer expiry with a strict safety
  margin and recomputes it after refresh;
- CLI and Domain consumers adopt the first publicly published Shell release containing that rule;
- regression proof crosses a real remote-Domain route and one live refresh boundary.

Rejected workaround:

Increasing the view token lifetime, bypassing Kernel verification, handing the browser the raw CLI
credential, or retrying `AUTH_INVALID` would preserve the invalid lifetime relationship or weaken
the trust boundary.

## CLI-VIEW-ASSET-001: a fresh Node build rejected its own Viewer bundle

Status: fixed

Observed behavior:

- the CLI build reported `built viewer/dist` and emitted both required files;
- the Node-runnable CLI immediately reported that the Viewer bundle was missing;
- `index.html` output retained an older timestamp because the content-aware Bun write was a no-op,
  so source freshness classified the otherwise complete bundle as stale;
- Node cannot rebuild browser assets through the Bun-only development path and therefore failed.

Durable correction:

The build owner now performs an actual file copy for the static HTML output. Its output timestamp is
part of the existing source-freshness evidence, so a successful build and the session server agree
without an environment override or copied runtime asset.

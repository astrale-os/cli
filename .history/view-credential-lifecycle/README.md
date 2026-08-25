# View credential lifecycle

Status: adopted

## Ownership

- The CLI session server retains the selected CLI identity outside the browser and mints a
  short-lived Kernel bearer for a Shell-handshake View.
- Shell owns mounted-window rotation, retry, expiry state, and delivery of refreshed credentials to
  the child document.
- A sandboxed child derives remote-route credentials only through `ClientSession`; the requested
  delegation lifetime must remain strictly inside the current parent proof.
- Kernel remains the authority that verifies the bearer and refuses delegation broadening.

## Invariant

For every authenticated View window:

```text
child delegation expiry < current view bearer expiry
```

The bound is recomputed from the refreshed bearer before each remote-bound call. Refresh failure
retains the last admitted bearer while it is live and fails closed once it expires. The raw CLI
credential and its private key never enter the browser.

## Delivery

- Shell PR 80 established the proof-bounded child delegation rule and refresh tests.
- CLI PR 145 made the view server mint a short-lived, explicit-audience browser credential.
- Consumer cohorts must use a published Shell release containing PR 80; pinning an older Shell
  silently restores the defect even when the CLI server is current.

## Required proof

- a freshly opened authenticated View can call a remote Domain;
- the same mounted View succeeds after at least one automatic credential rotation;
- malformed refresh output never replaces the last valid credential;
- an exhausted refresh fails closed rather than reusing an expired credential;
- public and non-Shell Views never receive an authenticated browser token.


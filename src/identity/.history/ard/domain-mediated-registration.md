# Domain-mediated Identity registration

Status: resolved
Impact: high
Selection: explicit-authority-owner-callable

## Context

`identity register` prepares an atomic graph Node and self-proven Identity designation. Submitting
that request directly to Kernel Auth is correct only when the authenticated caller already holds
creation authority for the chosen Class. A child Kernel management principal does not thereby own
an installed application Domain's `Operator` Class, and production correctly denied that attempted
authority substitution.

The CLI must still own local key proof and target-bound registration state. Manufacturing CLI state,
handing application credentials to the operator, or weakening mutation authorization would cross
the wrong boundary.

## Decision

Registration retains direct Auth submission as its default. `--via <callablePath>` selects a second,
explicit submission boundary: after constructing the exact same Provision request and fingerprint-
bound self proof, CLI invokes the named Domain callable through the normal Host route. That callable
owns admission and may exercise its Domain authority to submit the request to Kernel Auth.

CLI treats the callable response as untrusted. It admits the prepared binding's issuer, subject, and
optional created Node ID, then stores only the target-keyed issuer and subject. It never accepts or
persists application authority, and it never exposes the self proof in argv or output.

## Consequences

- Kernel mutation non-amplification remains unchanged.
- A Domain that offers registration must declare and authorize a Provision-shaped callable.
- The option is explicit because choosing the authority owner is security-significant.
- Direct registration remains useful for Classes the selected caller genuinely owns.
- A failed callable or malformed response leaves CLI registration state unchanged.

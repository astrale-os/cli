# Author feedback and DX candidates

Use this reference when authoring or acceptance exposes reusable friction. Classify one reproducible
observation at its semantic owner instead of turning a failed run into an unbounded wishlist.

## Retain the evidence

Record only non-secret evidence:

- scenario and knowledge digests plus the exact semantic outcome;
- manifest, lockfile, Node/package-manager versions, and resolved Astrale package cohort;
- runner, harness, model/effort, exact command, duration, and stable diagnostic family;
- smallest public API or source owner that reproduces the friction; and
- expected behavior, observed behavior, and whether a workaround changes semantics or topology.

Never retain credentials, private keys, tokens, headers, raw environments, tunnel credentials, or
receiver secrets. Keep registry propagation, package skew, authentication, authority, Policy,
runtime, graph, external API, tunnel, evaluator, storage, and cleanup failures distinct.

## Classify once

- `sdk-linter-candidate`: a repeatable semantic mistake that static admission can reject precisely.
- `sdk-linter-capability`: a legitimate package shape the current linter cannot validate.
- `api-sdk-dx`: a public surface is missing, ambiguous, weakly typed, or diagnosed at the wrong layer.
- `author-knowledge-gap`: the product capability exists but the owning guidance did not route to it.
- `scenario-contract`: the task is under-specified, over-prescriptive, contradictory, or claims an
  unowned guarantee.
- `lab-harness`: isolation, orchestration, evidence, retry, metrics, or cleanup failed independently.
- `product-defect`: SDK, adapter, CLI, Shell, Kernel, or a Domain violated its public contract.

Agent confusion is not automatically a product defect. Repeated confusion around a coherent but
undiscoverable surface is still useful knowledge or API-DX evidence.

## Linter-candidate ledger

For each candidate record:

1. rule name and semantic owner;
2. required or prohibited pattern without scenario-specific paths;
3. minimal positive and negative examples;
4. detection surface: manifest, AST, TypeScript program, declarations, or realized Schema/Runtime;
5. false-positive boundary and legitimate exceptions;
6. observed SDK versions and exact reproducer;
7. proposed diagnostic and correction; and
8. state: observed, reproduced, accepted, implemented, or rejected.

Good candidates include direct Kernel imports, shadow canonical types, Action step APIs, foreign
implementation imports, stored Clients for remote dispatch, missing Runtime registration, or source
topology mutation during qualification. Do not create a rule for one preferred directory name or test
style.

## API and SDK DX ledger

Record the author journey, current surface, friction, smallest coherent replacement, compatibility
impact, affected consumers, and proof the issue crosses more than one local seam. Prefer improved
facades, types, diagnostics, and scaffold defaults over wrappers that hide authentication, Domain
capability, Policy, execution, or graph effects behind one boolean.

Keep CLI vocabulary semantic. An option selecting an exact Class should say Class rather than expose
an internal generic-definition term, but treat that as a separately scoped public CLI migration with
a consumer census—not as an acceptance workaround.

## Close the loop

Update this skill when public behavior is correct and reusable guidance was missing. Change the owning
product when the public contract or implementation is wrong. Keep the original finding open until an
owner fix is published and a fresh external-project run proves it; builder-authored success never
closes live evidence.

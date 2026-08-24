# Modeling

Model the business world and its invariants, not a storage layout or anticipated UI. Every Class,
Edge, Policy, callable, View, and Core value has one semantic owner.

## Current language boundary

Kernel DSL V1 Domains expose Classes, Functions, Policies, Views, and Core data. There is no authored
Interface hierarchy. Domain code imports language builders only from `@astrale-os/sdk/schema`; do not
import Kernel DSL/Core directly or recreate resolved Definition shapes.

## Classes

Use a node Class for an independently identifiable thing with properties and behavior. Use an edge
Class for a meaningful relationship between typed endpoints.

- Put a fact on a node when it describes that thing regardless of a relationship.
- Put a fact on an Edge when it describes the relationship: role, confidence, applicability,
  effective date, ordering, or coverage.
- Reify a relationship as a node only when it needs independent identity, lifecycle, permissions,
  provenance, or relationships of its own.

State endpoint direction and cardinality explicitly. Do not hide relationships in string IDs,
paths, generic JSON, or a catch-all relation Class. Do not add a constant business slug to a many-to-
many Edge merely to satisfy storage identity.

## Properties

Choose required versus optional from the business invariant, not fixture convenience. Reuse inherited
native node properties rather than redeclaring them. Use closed literal/enum vocabulary for a stable
finite state and preserve timestamps/identities through SDK-owned canonical types.

Mutable presentation text is not a stable identity. Node identity is canonical and opaque; serving
URLs and caller-assigned paths are not semantic node identifiers.

## Behavior ownership

Put behavior on the Class whose invariant changes. A receiver-bound callable is appropriate when an
existing node is the subject of the change. Use a top-level callable for a Domain operation without a
receiver. Staticness belongs to Schema metadata; Runtime still implements the callable uniformly as an
Action or Workflow.

Abstract inheritance may share stable meaning between Classes, but do not create inheritance merely
for code reuse. Prefer composition and typed Edges when the relationship is not genuinely “is-a.”

## Policies

Schema Policy owns authorization predicates. Keep authentication mode, callable authority, and Policy
as distinct gates. Policy may refer to the authenticated subject, receiver, Core Groups, and graph
facts supported by the language. Do not move caller admission into Action/Workflow code.

## Core data

Use Core for stable Domain-owned reference facts needed immediately after installation, such as one
well-known Group. Do not use Core as demo data, mutable product state, a post-install hook, or a hidden
migration mechanism.

## Views

Schema Views declare semantic view identities. Frontend routing and Shell handshake belong to the SDK
frontend composition, not to Class properties or callable handlers.

## Review checklist

- Can every concept be named in business language?
- Does every relationship have typed endpoints, direction, and cardinality?
- Are relationship-owned facts on the Edge?
- Are required properties truly invariant and optional properties truly absent sometimes?
- Are node identities opaque rather than encoded paths?
- Does each callable have the correct receiver and authentication/Policy declaration?
- Is every visible Class given a stable icon when the language supports it?
- Is Core limited to stable installation reference data?

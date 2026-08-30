# CLI Admin Instance adapter

The adapter calls the stable singleton Fleet receiver for caller-authorized Instance inventory and
automatic creation. `list` remains the sole inventory operation: by default it excludes terminal
tombstones, while `includeRetired` asks the same Method for caller-visible deleted Instances. Every
returned Method summary is decoded locally before it reaches a command; connection itself performs
no schema discovery, introspection, or graph read.

Automatic creation invokes `Fleet.createInstance`. Status, deletion, and Domain installation first
resolve a caller-visible Instance through the ordinary inventory and then invoke that exact
Instance receiver. An explicit Node Path may still be resolved through one exact caller-authorized
graph lookup. The adapter creates internal operation IDs but preserves the existing CLI projection
and selection-required experience.

Instance invitation creation invokes the exact resolved Instance. Invitation status invokes the
exact retained Invitation receiver and returns its recorded lifecycle without provider refresh,
reconciliation, mutation, or operation identity. A sender or Fleet administrator can observe it;
the claimed user can observe it after acceptance. Diagnostic reconciliation remains a separate,
explicit recovery operation. Every Invitation result must remain scoped to one member invitation
for one managed Instance.

Retirement is not a parallel classification or API. The terminal `deleted` state in the ordinary
Instance summary is authoritative, and the optional retained issuer is evidence for authorized
operator composition. The adapter never infers retirement from reachability or a missing result.

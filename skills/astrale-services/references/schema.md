# Services schema

Origin: `services.astrale.ai`

`Service` is a provider-neutral abstract resource Class. `CloudflareWorker` is the current concrete
provider implementation. A Service is addressed by its opaque graph Node ID; `serviceKey` is stable,
owner-unique lookup metadata, not a graph path.

Service state retains provider identity, URL, lifecycle, deployment receipt/digest, deployment mode,
bounded operation expiry, and bounded error evidence.

`service_owned_by` is the only Services-owned relationship. Services does not create relationships to
consumer Kernel Domain or Function nodes and does not return installed Kernel Function Node IDs.
Each consumer Kernel owns its own installed Domain and Function nodes.

`CloudflareWorker.deploy` accepts canonical `serviceKey` plus either a plain or revisioned artifact.
The result contains provider evidence only: Service Node ID, `serviceKey`, URL, digest, and ready
state. Services does not discover, return, or install Application Publication state.

Receiver Methods manage write-only secrets, schedules, logs, and convergent provider deletion.
`Service.delete` removes provider resources and the Service graph anchor only. Consumer Domain
installations remain until explicitly uninstalled by each consumer.

`/:services.astrale.ai:view.application` is a standalone Domain View that lists and operates all
visible owned Services. It does not require a fabricated Service target.

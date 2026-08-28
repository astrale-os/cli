# Services schema

Origin: `services.astrale.ai`

`Service` is a provider-neutral abstract resource Class. `CloudflareWorker` is the current concrete
provider implementation. A Service is addressed by its opaque graph Node ID; `serviceKey` is stable,
owner-unique lookup metadata, not a graph path.

Service state retains provider identity, URL, lifecycle, deployment receipt/digest, optional
provider revision, and exact optional Published Application evidence:

- Publication issuer and Domain origin;
- Schema revision and Publication ETag;
- declared Function references and paths.

`service_owned_by` is the only Services-owned relationship. Services does not create
`service_hosts_domain` or `hosted_by_service` links and does not return installed Kernel Function
Node IDs. Each consumer Kernel owns its own installed Domain and Function nodes.

`CloudflareWorker.deploy` accepts canonical `serviceKey` plus either a plain or revisioned artifact.
The result contains provider evidence and optional `application` metadata. A missing Publication is
valid for a plain Service. Publication discovery does not install it.

Receiver Methods manage write-only secrets, schedules, logs, and convergent provider deletion.
`Service.delete` removes provider resources and the Service graph anchor only. Consumer Domain
installations remain until explicitly uninstalled by each consumer.

`/:services.astrale.ai:view.service` targets a `CloudflareWorker`; the Application View lists all
visible owned Services.

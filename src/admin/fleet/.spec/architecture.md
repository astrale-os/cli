# CLI Admin Fleet installations adapter

The adapter answers "which Instances pin this Domain's releases" across the Fleets the caller
administers (CT37, AM-38). It calls Admin's static Method `Fleet.installations` with the caller's own
credential, follows its opaque cursor to the last page, and admits every page with a strict local
decoder: fields Admin adds later are ignored, anything it reads is checked. The pin it returns is
CT12 `InstalledPin`, one meaning per variant.

Admin decides everything that matters: which Fleets the caller administers (`AdministerFleet` on each
Fleet, Group composition included), and what each Instance's Kernel lists, read with Admin's managed
credential. The adapter never reads an Instance's Kernel and never widens the scope.

Three answers are not errors. A caller outside the central Shell's members receives Admin's 2004:
`fleetView: false`, no Fleet view (AM-198). A member who administers no Fleet receives empty lists.
An Instance Admin could not read is a row of `unreachable` with its reason (`timeout`, `refused`,
`unavailable`, `unsupported` for a Kernel without the `installed` listing): it means unknown, never
"not installed". With a release filter, only release pins are compared; a legacy pin names no
release and is listed only without one.

Refusals use the registry vocabulary (CT29) of `../registry/failure.ts`. An Admin that predates
`Fleet.installations` answers that the Method is not found, which reads `REGISTRY_UNAVAILABLE` with
reason `unsupported`, never `REGISTRY_DOMAIN_NOT_FOUND`. A page loop is bounded and refuses a cursor
Admin already gave.

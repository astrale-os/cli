---
name: astrale-services
description: Use the Services domain to turn existing code or requirements into a deployed Cloudflare-backed Service with SDK-declared Functions, verify calls end to end, inspect it, manage write-only secrets, configure schedules, tail logs, delete it, or open its view.
---

# Astrale Services

Use `services.astrale.ai` as the control plane for deployed services. A service is a graph identity placed by the caller and backed by a provider deployment. `CloudflareWorker` is the current concrete backend and can host zero or many first-class kernel Functions.

## Intent router

- Build or adopt code, deploy it as a service with hosted Functions, verify it end to end, and hand back exact calls: read [references/deployer-agent.md](references/deployer-agent.md).
- Deploy artifacts, operate a service, manage secrets/schedules/logs, delete, or open the GUI: read [references/workflows.md](references/workflows.md).
- Understand the Service class, deploy payload, hosted Function reconciliation, and result shape: read [references/schema.md](references/schema.md).

---
name: astrale-services
description: Deploy and manage Cloudflare-backed Services on Astrale's Admin instance, including generic Workers, APIs, scheduled jobs, and hosted Domain releases. Use for scaffolding, immutable deployments, promotion, secrets, schedules, logs, ownership, retirement, and deletion.
---

# Astrale Services

Use the installed `services.astrale.ai` Domain on the Admin instance. `CloudflareService` is the
stable resource for one `(project, environment)`; `CloudflareDeployment` is one immutable release
of it. The Service URL and crons follow its current deployment. A deployment URL keeps serving its
own release until retired. Services hosts Workers; it never installs or uninstalls a Domain on a
consumer Kernel.

Choose the workflow the user needs:

- Generic Worker, API, or cron: [workflows.md](references/workflows.md) covers the published
  scaffolder and deployment adapter. A plain Worker needs no Domain Schema or installation.
- Background job calling an installed Domain as a dedicated account:
  [service-account-cron.md](references/service-account-cron.md).
- Turn existing code or requirements into a callable Domain release, with installation only on
  requested consumers: [deployer-agent.md](references/deployer-agent.md).
- Operate an existing Service (promote/roll back, secrets, crons, logs, transfer, retire/delete):
  [workflows.md](references/workflows.md).
- Understand ownership, wire payloads, and result interpretation:
  [schema.md](references/schema.md).

Use the exact returned Service and deployment IDs. A successful deploy, a published package, and an
installed consumer release are separate facts; verify each one needed for the requested outcome.

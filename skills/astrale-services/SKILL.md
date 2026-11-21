---
name: astrale-services
description: Deploy and manage Cloudflare-backed Services on Astrale's Admin instance, including generic Workers, APIs, scheduled jobs, and hosted Domain releases. Use for scaffolding, immutable deployments, promotion, secrets, schedules, logs, ownership, retirement, and deletion.
---

# Astrale Services

The installed `services.astrale.ai` Domain on the Admin instance:

- `CloudflareService`: the stable resource for one `(project, environment)`. Its URL and crons
  follow its current deployment.
- `CloudflareDeployment`: one immutable release of it. Its own URL serves that release until it is
  retired.
- Services hosts Workers. It never installs or uninstalls a Domain on a consumer Kernel.

| Task | Reference |
| --- | --- |
| Generic Worker, API or cron (no Domain Schema, no installation) | [workflows.md](references/workflows.md) |
| Background job calling an installed Domain as a dedicated account | [service-account-cron.md](references/service-account-cron.md) |
| Existing code or requirements → a callable Domain release, installed only on requested consumers | [deployer-agent.md](references/deployer-agent.md) |
| Operate a Service: promote or roll back, secrets, crons, logs, transfer, retire or delete | [workflows.md](references/workflows.md) |
| Ownership, wire payloads, results | [schema.md](references/schema.md) |

- Use the exact returned Service and deployment ids.
- A successful deploy, a published package and an installed consumer release are three separate
  facts: verify each one the outcome needs.

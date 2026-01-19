# Astrale CLI

Build, develop, and deploy Astrale apps.

## Installation

### From GitHub Package Registry

Add to your `~/.npmrc`:

```
@astrale-os:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN
```

Then install:

```bash
npm install -g @astrale-os/cli
```

### Local Development

```bash
# From the cli directory
cd cli
pnpm install
pnpm build

# Option A: Link globally
pnpm link --global

# Option B: Run directly with npx
npx tsx bin/astrale.ts <command>

# Option C: Add alias
alias astrale="npx tsx /path/to/cli/bin/astrale.ts"
```

## Quickstart

```bash
# 1. Authenticate
astrale auth login

# 2. Create a new app (from template)
astrale create my-app
cd my-app
pnpm install

# 3. Initialize in kernel
astrale init --title "My App"

# 4. Start development
astrale dev core/worker.ts --iframe-entry frontend/window/index.tsx
```

## Commands

### Authentication

```bash
astrale auth login              # Authenticate for active profile
astrale auth login --profile prod
astrale auth logout             # Clear credentials
astrale auth status             # Show auth status for all profiles
```

### Profiles

Manage environments (local, staging, prod).

```bash
astrale profile list            # List all profiles
astrale profile set <name>      # Switch active profile
```

Default profiles:
| Profile | Kernel WS | Kernel RPC |
|---------|-----------|------------|
| local | ws://localhost:8081 | http://localhost:8083 |
| staging | wss://kernel.staging.astrale.ai/ws | https://kernel.staging.astrale.ai/rpc |
| prod | wss://kernel.astrale.ai/ws | https://kernel.astrale.ai/rpc |

### Initialize

Create a new app in the kernel.

```bash
astrale init --title "My App"
astrale init --title "My App" --profile staging
astrale init --title "My App" --parent-id mod_xxx
```

### Development

Watch for changes with hot reload.

```bash
astrale dev <entry>
astrale dev core/worker.ts
astrale dev core/worker.ts --iframe-entry frontend/index.tsx
astrale dev core/worker.ts --profile staging
astrale dev core/worker.ts --no-deploy      # Local only, no kernel
astrale dev core/worker.ts --no-serve       # No local servers
```

Options:

- `--outdir <dir>` - Output directory (default: dist)
- `--outfile <name>` - Output filename (default: worker.js)
- `--app-id <id>` - Override appId
- `--profile <name>` - Profile to use
- `--iframe-entry <path>` - Iframe entry file
- `--iframe-html <path>` - Iframe HTML template
- `--host-port <port>` - Host app port (default: 7017)
- `--no-deploy` - Skip kernel deployment
- `--no-serve` - Skip local dev servers

### Build

Build and deploy to kernel.

```bash
astrale build <entry>
astrale build core/worker.ts --minify
astrale build core/worker.ts --production   # Use datastore bundles
astrale build core/worker.ts --no-deploy    # Bundle only
```

Options:

- `--minify` - Minify the output
- `--sourcemap` - Generate sourcemap
- `--production` - Production build
- `--no-deploy` - Skip deployment

### Start

One-command workflow: init if needed, then dev.

```bash
astrale start <entry>
astrale start core/worker.ts --title "My App"
```

### Create

Scaffold a new app from template.

```bash
astrale create <name>
astrale create my-app
astrale create my-app --template react-app
```

## Configuration

### Global Config

Located at `~/.config/astrale/`:

- `config.json` - Profiles and active profile
- `auth.json` - Credentials per profile

### Project Config

Located at `.astrale/config.json`:

```json
{
  "appId": "app_xxx",
  "profile": "local",
  "workerBundleId": "mod_xxx",
  "uiBundleId": "mod_xxx",
  "workerUrl": "http://localhost:7018/worker.js",
  "uiUrl": "http://localhost:7019"
}
```

## Environment Variables

- `XDG_CONFIG_HOME` - Override config directory location

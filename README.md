# Astrale CLI

Command-line interface for developing Astrale WebOS applications.

[![CI](https://github.com/astrale-os/cli/actions/workflows/ci.yml/badge.svg)](https://github.com/astrale-os/cli/actions/workflows/ci.yml)

## Installation

```bash
npm install -g @astrale-os/cli
```

## Commands

### `astrale init`

Initialize a new Astrale application in the current directory.

```bash
astrale init
```

### `astrale create <name>`

Create a new Astrale application with scaffolding.

```bash
astrale create my-app
```

### `astrale dev`

Start the development server with hot reload.

```bash
astrale dev
```

### `astrale build`

Build the application for production.

```bash
astrale build
```

### `astrale start`

Start the production server.

```bash
astrale start
```

## Project Structure

```
my-app/
├── src/
│   ├── index.ts          # Application entry point
│   ├── schema.ts         # Type definitions
│   ├── endpoints/        # API endpoints
│   │   └── index.ts
│   ├── window/           # Window UI components
│   │   ├── app.tsx
│   │   └── index.tsx
│   └── worker.ts         # Background worker
├── package.json
└── tsconfig.json
```

## Development

### Prerequisites

- Node.js 22+
- pnpm 10+

### Setup

```bash
git clone https://github.com/astrale-os/cli.git
cd cli
pnpm install
```

### Commands

```bash
pnpm build        # Build the CLI
pnpm typecheck    # TypeScript type checking
pnpm lint         # Run ESLint
pnpm lint:fix     # Fix linting issues
pnpm format       # Format with Prettier
```

## License

MIT

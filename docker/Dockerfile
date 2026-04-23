# Astrale kernel manager — dev-local image.
#
# The manager runs inside the container but reads source from a host
# bind-mount at `/workspace` (see `lib/docker.ts:composeYaml`). Historically
# this image was empty (`FROM oven/bun:1-slim` + entrypoint, source + deps
# via the mount). That broke on cross-platform native modules: the host's
# darwin-arm64 `node_modules/@esbuild` is unusable by the linux-arm64
# container, so any method dispatch that touched esbuild crashed.
#
# This image now bakes its own `node_modules/` (installed for linux-arm64)
# and the compose file overlays `/workspace/node_modules` with an anonymous
# volume seeded from here. Source files stay live-editable on the host
# (everything under `/workspace` except `node_modules` comes from the
# bind-mount); native modules match the container's platform.
#
# Build context: the workspace root (passed explicitly by
# `cli/src/lib/docker.ts`). The `.dockerignore` inside the workspace keeps
# the context small (no .git, no domain-level `node_modules`, no logs…).
#
# Any workspace-root `package.json` / `pnpm-lock.yaml` / sub-package
# `package.json` change invalidates the deps layer. Source-only edits
# don't trigger reinstall because no source is COPYed — pnpm only needs
# the package manifests + lockfile.
#
# Dev-local only. A prod image (bundles source + pinned versions) is a
# separate chantier.

# syntax=docker/dockerfile:1.6
# (enables BuildKit features like `--mount=type=secret`)

# ── Stage 1: install deps for linux-<arch> ─────────────────────
FROM oven/bun:1-slim AS deps

# pnpm is pinned to the same version the workspace uses. Adjust when the
# root package.json's packageManager field moves.
RUN bun install -g pnpm@10.28.0

WORKDIR /build

# Copy the full workspace (build context). The workspace's `.dockerignore`
# must exclude `node_modules/`, `.git/`, `**/dist/`, etc. — otherwise the
# image size balloons and the host's wrong-platform `node_modules/` leaks
# in.
COPY . .

# Frozen-lockfile install pins resolution to the host's lockfile, so
# subpackage symlinks in the host's bind-mount keep resolving correctly
# against the image's `node_modules/.pnpm/` store layout.
#
# Private packages live on `@astrale-os:registry=https://npm.pkg.github.com`
# and need a GitHub Packages token. We receive the token via BuildKit
# secret (never baked into layers) and construct a ready-to-use .npmrc
# inline. The host's `~/.npmrc` references `${GITHUB_TOKEN}` at runtime,
# which pnpm doesn't expand here — so we expand it ourselves.
#
# Husky prepare scripts would fail inside the image (no .git); bypass them.
RUN --mount=type=secret,id=github_token,target=/run/secrets/github_token,required=true \
    echo "@jsr:registry=https://npm.jsr.io"                                                 >  /root/.npmrc && \
    echo "@astrale-os:registry=https://npm.pkg.github.com"                                  >> /root/.npmrc && \
    echo "@astrale:registry=https://npm.pkg.github.com"                                     >> /root/.npmrc && \
    echo "//npm.pkg.github.com/:_authToken=$(cat /run/secrets/github_token)"                >> /root/.npmrc && \
    HUSKY=0 pnpm install --frozen-lockfile --ignore-scripts && \
    rm -f /root/.npmrc

# ── Stage 2: slim runtime ──────────────────────────────────────
FROM oven/bun:1-slim

WORKDIR /workspace

ENV NODE_ENV=development

EXPOSE 4400

# Bake the fully-resolved node_modules into the image at the same path as
# the host bind-mount — the compose file's anonymous volume on
# `/workspace/node_modules` reads from here on first start, then persists
# across container restarts until `docker compose down -v` wipes volumes.
COPY --from=deps /build/node_modules /workspace/node_modules

ENTRYPOINT ["bun", "run", "/workspace/cli/src/manager-entrypoint.ts"]

# Astrale kernel manager — dev-local image.
#
# No source is baked in. The workspace is bind-mounted read-only at
# `/workspace` by the `manager` docker-compose service, and bun executes
# `cli/src/manager-entrypoint.ts` directly from the mount. Editing source
# on the host + `astrale restart` picks up the new code.
#
# The build context is empty (see `cli/.dockerignore`) — no COPY happens.
#
# This image is intended for local development only. A production image
# that bundles the CLI + deps is tracked as a separate chantier.
FROM oven/bun:1-slim

WORKDIR /workspace

ENV NODE_ENV=development

EXPOSE 4400

ENTRYPOINT ["bun", "run", "/workspace/cli/src/manager-entrypoint.ts"]

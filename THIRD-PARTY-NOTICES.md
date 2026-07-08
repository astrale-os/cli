# Third-Party Notices

`@astrale-os/cli` is licensed under the **Apache License 2.0** (see `LICENSE`).

The published package additionally ships a pre-built web client for the local
Domain Studio (`studio/client/dist`). That bundle embeds third-party open-source
components. Components whose license requires attribution are listed below.

## elkjs (Eclipse Layout Kernel for JavaScript)

- **Package:** `elkjs` (used by `@astrale-os/studio`, bundled into `studio/client/dist`)
- **Version:** ^0.11.1
- **License:** Eclipse Public License 2.0 (EPL-2.0)
- **Copyright:** © Kiel University and the ELK contributors
- **Source:** https://github.com/kieler/elkjs
- **License text:** https://www.eclipse.org/legal/epl-2.0/

`elkjs` is used unmodified. Its source is publicly available at the URL above.
This notice is provided to satisfy the attribution requirement of the EPL-2.0;
it does not alter the Apache-2.0 license of `@astrale-os/cli`'s own code.

## Other bundled dependencies

The remaining components bundled in `studio/client/dist` are distributed under
permissive licenses (MIT, Apache-2.0, BSD, ISC), which require only preservation
of their copyright and permission notices. A complete, machine-generated
inventory can be produced at build time via a license-extraction plugin.

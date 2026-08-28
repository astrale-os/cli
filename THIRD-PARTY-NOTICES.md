# Third-Party Notices

`@astrale-os/cli` is licensed under the **Apache License 2.0** (see `LICENSE`).

The standalone executable additionally ships a pre-built web client for the local
Domain Studio (`studio/client/dist`). That bundle embeds third-party open-source
components. Components whose license requires attribution are listed below.

## skills (agent registry compatibility)

- **Project:** `vercel-labs/skills`
- **Compatible version:** `skills@1.5.23`
- **License:** MIT
- **Copyright:** © 2026 Vercel, Inc.
- **Source:** https://github.com/vercel-labs/skills

Astrale derives its global agent names, paths, detection conventions, and v3
lock-file interoperability from this project. Astrale does not embed or execute
the `skills` package.

```text
MIT License

Copyright (c) 2026 Vercel, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## cloudflared

- **Project:** `cloudflare/cloudflared`
- **Bundled version:** 2026.8.2
- **License:** Apache License 2.0
- **Copyright:** Cloudflare, Inc. and contributors
- **Source:** https://github.com/cloudflare/cloudflared/tree/2026.8.2

Standalone release archives carry the unmodified official executable as
`astrale-cloudflared` and include the Apache License 2.0 text as
`LICENSE.cloudflared`, sourced from the reviewed distribution copy at
`licenses/cloudflared.txt`. Astrale disables cloudflared self-update and
advances the binary only through a checksum-pinned Astrale CLI release.

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

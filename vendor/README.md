# Vendored publication artifacts

CLI vendors only autonomous archives downloaded from public npm publications:

- `@astrale-os/sdk@0.5.0-beta.14`
  (`sha256:1f3b5cc75329961ab4c8f703b98d2e290a59bfc559ae1e3b21c233158640f68a`)
- `@astrale-os/shell@0.3.8-beta.3`
  (`sha256:924a7fa91d56f1be9bd730b635ed32b8ed6d9b1fbd8b255b9edf69f17090ec2c`)

They were downloaded after publication with:

```sh
npm pack @astrale-os/sdk@0.5.0-beta.14 @astrale-os/shell@0.3.8-beta.3 \
  --pack-destination vendor --registry=https://registry.npmjs.org
```

Studio and its fixture consume these archives directly. Their Kernel peer dependencies resolve from
the official SemVer cohort declared in the consuming package; no override rewrites an archive's
dependency graph. Kernel archives are therefore neither required nor vendored.

Never create these archives from a local checkout. When the cohort changes, download the new
published SDK and Shell archives, update their direct `file:` references, regenerate the lockfile,
and verify the checksums before deleting the previous pair.

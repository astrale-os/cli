# Changelog

## [0.8.1-alpha.3](https://github.com/astrale-os/cli/compare/cli-v0.8.1-alpha.2...cli-v0.8.1-alpha.3) (2026-08-19)


### Bug Fixes

* **commands:** admit Kernel journal v2 `occurredAt` records in `astrale logs`
* **commands:** describe callables from the installed Domain schema
* **commands:** send the current remote install syscall from `domain install --direct`
* **commands:** explain that managed `instance list` needs Admin + IdP
* **commands:** reject PatchData on `mutate --dry` with a Mutation V3 error

## [0.8.1-alpha.2](https://github.com/astrale-os/cli/compare/cli-v0.8.1-alpha.1...cli-v0.8.1-alpha.2) (2026-08-19)


### Bug Fixes

* **ci:** resolve unpublished Shell for standalone Studio `bun install`

## [0.8.1-alpha.1](https://github.com/astrale-os/cli/compare/cli-v0.8.1-alpha.0...cli-v0.8.1-alpha.1) (2026-08-19)


### Bug Fixes

* **deps:** decode Kernel V2 explicit edge direction and drop private tmp packs
* **ci:** install build-time Kernel packages before compiling the standalone binary

## [0.8.1-alpha.0](https://github.com/astrale-os/cli/compare/cli-v0.8.0-alpha.0...cli-v0.8.1-alpha.0) (2026-07-17)


### Performance Improvements

* defer schema layout bundle ([f9ff7dc](https://github.com/astrale-os/cli/commit/f9ff7dc70a98e366ec06bbfd5b0e98b23e2e5927))
* defer schema layout bundle ([2707642](https://github.com/astrale-os/cli/commit/2707642cb15a0a1713f30d993c8c48cec082ac65))


### Documentation

* update astrale-domain skill ([e958239](https://github.com/astrale-os/cli/commit/e958239cecbeb0e13316b7d9867e1b34ebbd9126))
* update astrale-domain skill ([dd38678](https://github.com/astrale-os/cli/commit/dd38678526d71161fef7d90613b490bcf911d91f))

## [0.8.0-alpha.0](https://github.com/astrale-os/cli/compare/cli-v0.7.0-alpha.0...cli-v0.8.0-alpha.0) (2026-07-16)


### Features

* **studio:** add Codex harness and model selection ([027701c](https://github.com/astrale-os/cli/commit/027701c0e274ce503805bc27f8799330fc3f0bfa))


### Bug Fixes

* **view:** resolve packaged viewer from module ([bbf647b](https://github.com/astrale-os/cli/commit/bbf647b34223970e11d5855ec7a9031444b2c160))
* **view:** resolve packaged viewer from module ([d4264f7](https://github.com/astrale-os/cli/commit/d4264f7dd61190d031d8f174952c1334ba32bf1b))

## [0.7.0-alpha.0](https://github.com/astrale-os/cli/compare/cli-v0.6.3-alpha.0...cli-v0.7.0-alpha.0) (2026-07-16)


### Features

* **commands:** adopt owned managed instances ([8fbbfd8](https://github.com/astrale-os/cli/commit/8fbbfd8d9beb5af82b915a88d4aa53be9c4bf4a7))
* **commands:** adopt owned managed instances ([a674fbf](https://github.com/astrale-os/cli/commit/a674fbf40fb06a6fba55e5e3a83aabe9395e0261))


### Bug Fixes

* **commands:** clarify installed CLI runtimes ([d0b1f70](https://github.com/astrale-os/cli/commit/d0b1f70cf353300f0a6469888de1cd3bd6bf3128))
* **commands:** clarify published cli runtime (issue iss_90fd577f) ([ae1ea16](https://github.com/astrale-os/cli/commit/ae1ea16553da99b1a881db5ffc3e96fef0642b15))
* **commands:** correct call payload guidance ([1fc9e73](https://github.com/astrale-os/cli/commit/1fc9e738b9089265e463d6ee855b7ee2d309e333))
* **commands:** document call payload inputs (issue iss_60382d35) ([2614053](https://github.com/astrale-os/cli/commit/26140535bebb8f4cafc126a890c1740f720cdff4))
* **commands:** narrow view port lock boundary ([4414821](https://github.com/astrale-os/cli/commit/441482167697b535029be4a8ae25810ae2c21c51))
* **commands:** serialize view port allocation (issue iss_414b7690) ([aa794c0](https://github.com/astrale-os/cli/commit/aa794c0b034512f9a6a08042b6ced70e80776052))
* **commands:** serialize view session port allocation ([90538fb](https://github.com/astrale-os/cli/commit/90538fbcebcad6e81eed8f8771970f72a249d1f8))

## [0.6.3-alpha.0](https://github.com/astrale-os/cli/compare/cli-v0.6.2-alpha.0...cli-v0.6.3-alpha.0) (2026-07-15)


### Documentation

* add frontend architecture guidance to astrale-domain skill ([5b5f311](https://github.com/astrale-os/cli/commit/5b5f311863daa8d6656d9fdb56b1dd58c3493d78))
* add frontend architecture guidance to astrale-domain skill ([f18001d](https://github.com/astrale-os/cli/commit/f18001d24e224da918c3c3edd889e8819586026a))
* update Shell domain search examples ([3aea636](https://github.com/astrale-os/cli/commit/3aea636422b8b4c61e46ecefadb0a8eb63503bab))
* update Shell domain search examples ([ae5e517](https://github.com/astrale-os/cli/commit/ae5e517f671945d168da30a4605f90ac261aa847))

## [0.6.2-alpha.0](https://github.com/astrale-os/cli/compare/cli-v0.6.1-alpha.0...cli-v0.6.2-alpha.0) (2026-07-15)


### Bug Fixes

* target native issues domain ([09b5e98](https://github.com/astrale-os/cli/commit/09b5e983fe828380c4c8396434ce44b7c1bfdacc))
* target native issues domain ([cd24aaa](https://github.com/astrale-os/cli/commit/cd24aaa7a0846a80934700b94c6d900d50279fcc))


### Documentation

* teach issue listing through graph queries ([961de08](https://github.com/astrale-os/cli/commit/961de08576b90526308aeb14f404f42d8a1eb0c3))
* teach issue listing through graph queries ([505f9f1](https://github.com/astrale-os/cli/commit/505f9f119623ef34ceb1ec42d42dc17b33be4001))

## [0.6.1-alpha.0](https://github.com/astrale-os/cli/compare/cli-v0.6.0-alpha.0...cli-v0.6.1-alpha.0) (2026-07-14)


### Bug Fixes

* **deps:** declare msgpackr for package builds ([034ca16](https://github.com/astrale-os/cli/commit/034ca1694faf6ef01af7c9d1f03aaea094a68fd9))
* **deps:** declare package build dependencies ([de35cb5](https://github.com/astrale-os/cli/commit/de35cb53403ba1cfef724a62d2671278e837e77b))

## [0.6.0-alpha.0](https://github.com/astrale-os/cli/compare/cli-v0.5.0-alpha.0...cli-v0.6.0-alpha.0) (2026-07-14)


### Features

* add schema module tests and client package extraction ([5a9831f](https://github.com/astrale-os/cli/commit/5a9831f02e121a57b9bdd076a7657e47eaf8d07b))
* astrale view — single-view sessions in an emulated shell host ([4df3125](https://github.com/astrale-os/cli/commit/4df3125de3e3d8a2a75d28510b197428ff8406cc))
* astrale view — single-view sessions in an emulated shell host ([9f2d855](https://github.com/astrale-os/cli/commit/9f2d8554004254d21c0ab6756a8057a7817e85c3))
* local telemetry — session recorder, harness adapters, opportunistic DX analyzer ([46dbe55](https://github.com/astrale-os/cli/commit/46dbe55f391187792c71c3eb3871cd1fbd3895c0))
* local telemetry — session recorder, harness adapters, opportunistic DX analyzer ([34fe32c](https://github.com/astrale-os/cli/commit/34fe32c35caf2586e00b42c37a287400e709cae5))
* make Studio domain headers draggable ([0a6f502](https://github.com/astrale-os/cli/commit/0a6f502006b2774ededa4f6704f4452d66b2f131))
* studio exports ASTRALE_SESSION; skill end-of-task DX-issue checklist ([8f94fb1](https://github.com/astrale-os/cli/commit/8f94fb1132d9af45446284a1af2433f4d33c0ef9))
* studio exports ASTRALE_SESSION; skill end-of-task DX-issue checklist ([717a612](https://github.com/astrale-os/cli/commit/717a61297d6481e6131aecca71ea4f32c05a853e))
* **studio:** add multi-domain workspaces ([170f0d7](https://github.com/astrale-os/cli/commit/170f0d744bb7454c9d3521f6f833c381640c76e1))
* **studio:** compose multiple domains on canvas ([5bcfb14](https://github.com/astrale-os/cli/commit/5bcfb1407402722e790c8bbaa9fbde3aec9b317f))
* **studio:** guard and resize workspace domains ([84d5801](https://github.com/astrale-os/cli/commit/84d580161b089d090f349abc0bd0bf4f27ca980f))
* unify Studio domain canvas controls ([6144626](https://github.com/astrale-os/cli/commit/6144626cc95efa4f2a1def4ae8ff012607a6ab29))
* **view:** route open intents to associated views ([9f8c2b1](https://github.com/astrale-os/cli/commit/9f8c2b156097eb805a31c15ff2143bfdd5096902))


### Bug Fixes

* analyzer files issues with --ci and plain-ASCII bodies (non-ci hang) ([9534203](https://github.com/astrale-os/cli/commit/9534203e14e936304dadbaed46cd8251fa564972))
* **ci:** restore automated CLI publishing ([ab5d246](https://github.com/astrale-os/cli/commit/ab5d2469bd08bc242335db0caf703f46d04b3381))
* **cli:** keep command timeout defaults ([6554e95](https://github.com/astrale-os/cli/commit/6554e9509e74a6a3ecbf13901f94dd81caed4b8f))
* **commands:** list view candidates before selection ([11be6ba](https://github.com/astrale-os/cli/commit/11be6ba6b0c4d0b0d393b170791a19bd28f9b222))
* **commands:** use semantic admin method paths ([9b5d1b2](https://github.com/astrale-os/cli/commit/9b5d1b2e4e2ab592ee7c046ed9f3293c5b2ec031))
* **commands:** use semantic admin method paths ([a271fbf](https://github.com/astrale-os/cli/commit/a271fbf42e4882fef198fd32fd6bbc6eb63e3484))
* **lib:** keep open-intent tests runtime-independent ([1396af4](https://github.com/astrale-os/cli/commit/1396af44a6982d71e68395c3962d18b9c7734b21))
* **release:** restore automated CLI publishing ([91d0c3e](https://github.com/astrale-os/cli/commit/91d0c3e7b1f658bb5c8f5039d574e589df10723c))
* **studio:** discover local preview packages ([7805fa3](https://github.com/astrale-os/cli/commit/7805fa373f1a296d3a036671579a66cdb02b23aa))
* **studio:** stabilize external workspace frames ([f3e23a0](https://github.com/astrale-os/cli/commit/f3e23a049984ae9ea1645c5878fa0f8f3bfb292c))
* sync standalone lockfile with @astrale-os/shell devDependency ([7b1b3c9](https://github.com/astrale-os/cli/commit/7b1b3c940c34dbcc82f54f806f7a0596fcad36e0))
* sync standalone lockfile with @astrale-os/shell devDependency ([e74f933](https://github.com/astrale-os/cli/commit/e74f9339839d27f3b97679b02a4ca8b3c0dc94a1))
* telemetry paths resolve at call time; test cleanups confined to tmpdir ([d38aecf](https://github.com/astrale-os/cli/commit/d38aecf59707abe88ddc9c87836706b8485d5c92))
* telemetry review pass — bunfs self-spawn, analyzer sandbox, GC, redaction shapes ([5ec0785](https://github.com/astrale-os/cli/commit/5ec07859f99cce9b97fb9d27093647df97b092c0))
* typed fail-fast for unknown -i instances; machine-readable errors in machine mode ([c262b99](https://github.com/astrale-os/cli/commit/c262b99a6acde0f4f9a403734b484ef09f8d475c))
* typed fail-fast for unknown -i instances; machine-readable errors in machine mode ([49f2476](https://github.com/astrale-os/cli/commit/49f2476679b100e16d039717d50aeeb43af23efc))
* **view:** list candidates before selection ([9141b18](https://github.com/astrale-os/cli/commit/9141b1809478ed5111dc70d0ee5f9c313f5f0136))
* **view:** wait for settled captures ([845881d](https://github.com/astrale-os/cli/commit/845881d3afd3be635f4fdb16bdbd29296af4a379))
* **view:** wait for settled one-shot captures ([4677b62](https://github.com/astrale-os/cli/commit/4677b62c72465e7824361b3804967383009e620f))


### Documentation

* add Issues-retrospective topics to astrale-domain skill ([#42](https://github.com/astrale-os/cli/issues/42)) ([f3570ef](https://github.com/astrale-os/cli/commit/f3570ef920cada5910d696b747ea14d4449f21b3))
* add no-instance domain validation topic to astrale-domain skill ([#43](https://github.com/astrale-os/cli/issues/43)) ([605ad5c](https://github.com/astrale-os/cli/commit/605ad5c7c28dffcf9879b7ec88b3d92e2f779c6b))
* update astrale-domain skill ([#44](https://github.com/astrale-os/cli/issues/44)) ([143ddb3](https://github.com/astrale-os/cli/commit/143ddb36a0d49d9a7892da943d34e2e29fdc1de8))
* update shell domain examples ([aea8f23](https://github.com/astrale-os/cli/commit/aea8f23f85183dff74883ef1b7a35b6fdd77dd6b))
* update shell domain examples ([9092315](https://github.com/astrale-os/cli/commit/90923151de49b5ac42f621bfb5a276617c4cab0e))

## 0.4.0-alpha.10 (2026-06-15)

### Public Alpha

* unify instance target resolution across active, named, admin, managed, and direct URL targets
* fix `-i admin` so it selects the configured admin instance instead of probing `/admin/instances/admin`
* document the concrete admin host list method as `ScalewayVPS.list`

## 0.4.0-alpha.9 (2026-06-11)

### Public Alpha

* durable IdP sessions: one login lasts until the IdP ends the session — refreshes serialize on a per-identity file lock, so parallel (agent-driven) commands no longer burn the single-use refresh token
* cache access tokens per audience: alternating commands between instances no longer triggers a refresh per flip (~2x faster on mixed-instance workflows)
* tell transient IdP/network failures apart from a dead grant — only the latter asks for `astrale auth login`
* lazy whoami-backed `@self` for IdP identities
* saga-sized default timeout on `instance create`/`instance delete`

## 0.4.0-alpha.8 (2026-06-08)

### Public Alpha

* publish deterministic standalone builds from CI
* track channel release identity so `astrale update --check` is accurate
* publish current kernel package contracts in the CLI lockfile

## 0.4.0-alpha.7 (2026-06-08)

### Public Alpha

* make WorkOS device login work on fresh script installs without env setup

## 0.4.0-alpha.6 (2026-06-08)

### Public Alpha

* point fresh `instance create` users at `astrale auth login`

## 0.4.0-alpha.5 (2026-06-08)

### Public Alpha

* build Linux release assets with musl targets for Alpine-based sandboxes
* document the `wget` installer path for minimal Linux images

## 0.4.0-alpha.4 (2026-06-08)

### Public Alpha

* add script-only alpha installer and GitHub Releases binary workflow
* add `astrale update` for script-installed CLI binaries
* make `astrale instance create` call admin `Instance.alphaCreate`
* fix standalone `--version` output and exit behavior

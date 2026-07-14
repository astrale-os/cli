# Changelog

## [1.0.0-alpha.0](https://github.com/astrale-os/cli/compare/cli-v0.5.0-alpha.0...cli-v1.0.0-alpha.0) (2026-07-14)


### ⚠ BREAKING CHANGES

* **commands:** split reads — get = point read, query = structured AST read over function.get
* **commands:** fold get children flags into a single --children <json>
* **commands:** retarget domain install to kernel Domain.install
* `astrale logs <service>` (positional) is now `astrale logs --service <name>`; the default reads the kernel journal.

* **commands:** fold get children flags into a single --children &lt;json&gt; ([57bc66c](https://github.com/astrale-os/cli/commit/57bc66c9a094412cc3614f82b194700c1ced66cd))
* **commands:** retarget domain install to kernel Domain.install ([edc77bd](https://github.com/astrale-os/cli/commit/edc77bd5b673d374a6eec0f79745734aa4789573))


### Features

* add --timing flag to astrale logs (per-step breakdown) ([e41dabf](https://github.com/astrale-os/cli/commit/e41dabf7de22127ae2e15a41a3a74bb213ec6c98))
* add Domain Studio (`astrale studio`) shipped inside the CLI ([3674d6b](https://github.com/astrale-os/cli/commit/3674d6b69c825eb6222070df4d2e95f9cf249ff6))
* add guided `astrale setup` onboarding command ([f53f192](https://github.com/astrale-os/cli/commit/f53f192f73fb2702a5f3563b4a25c8267b7c5943))
* add schema module tests and client package extraction ([5a9831f](https://github.com/astrale-os/cli/commit/5a9831f02e121a57b9bdd076a7657e47eaf8d07b))
* astrale logs --timing (per-step dispatch breakdown) ([f8aa125](https://github.com/astrale-os/cli/commit/f8aa125bd0527c7b16f069f7d6d98a535312a66b))
* astrale logs &lt;service&gt; — tail a managed service's runtime buffer ([31eb22d](https://github.com/astrale-os/cli/commit/31eb22da767350fe1f2e0aaa2d3e01b0ac82dc13))
* astrale logs reads the kernel journal (Root.journal) by default ([8b61899](https://github.com/astrale-os/cli/commit/8b61899fa9c4f48a1ff34ccc19c3d1dbe9d03254))
* astrale logs reads the kernel journal (Root.journal) by default ([50e0c58](https://github.com/astrale-os/cli/commit/50e0c587c83111d0388906dbb2bb446f7a633708))
* astrale view — single-view sessions in an emulated shell host ([4df3125](https://github.com/astrale-os/cli/commit/4df3125de3e3d8a2a75d28510b197428ff8406cc))
* astrale view — single-view sessions in an emulated shell host ([9f2d855](https://github.com/astrale-os/cli/commit/9f2d8554004254d21c0ab6756a8057a7817e85c3))
* **cli:** connect-core seam + IdP device-flow onVerification ([#34](https://github.com/astrale-os/cli/issues/34)) ([1e495e4](https://github.com/astrale-os/cli/commit/1e495e40b1034c614f230fd624496abc91bfdba0))
* **commands:** add `astrale browser` to drive the GUI via agent-browser ([44bed0b](https://github.com/astrale-os/cli/commit/44bed0b6d821958db47c9ae478f2910dd4ff318f))
* **commands:** add domain list and complete the domain DX refactor ([7b1b240](https://github.com/astrale-os/cli/commit/7b1b2404975249f42ce10e74e18b5c2aa966c208))
* **commands:** candidate-based instance use resolution + list twin-merge + review fixes ([7a9df07](https://github.com/astrale-os/cli/commit/7a9df07ad9fe46613d47cbae6347975e19e2cb94))
* **commands:** drop the admin control-plane confirm prompt in setup ([1ae9c3f](https://github.com/astrale-os/cli/commit/1ae9c3f6cdad377c90683985b020557d1dcd3fc4))
* **commands:** gate identity overrides at install behind a DANGER consent prompt ([784f35d](https://github.com/astrale-os/cli/commit/784f35dd5363356f5c6f4224576555dca26c9ca2))
* **commands:** refresh installed agent skills on astrale update ([af69416](https://github.com/astrale-os/cli/commit/af694163c8b95ac856316906843e9a3f850bea1c))
* **commands:** split reads — get = point read, query = structured AST read over function.get ([fa1403b](https://github.com/astrale-os/cli/commit/fa1403b81cedca55b041be5a874e6245e755ac72))
* cut get/ls/describe over to function.get; add astrale mutate ([147ea17](https://github.com/astrale-os/cli/commit/147ea173c0a24a6c7ac6e9e4f18308f75a937c96))
* cut get/ls/describe over to function.get; add mutate command ([f502e15](https://github.com/astrale-os/cli/commit/f502e15050f2b700055ca6f6284777d27de288b2))
* enhance instance status reporting and readiness checks ([4f671ee](https://github.com/astrale-os/cli/commit/4f671eea4d90cae29d515d6ef771d2bf0c949fba))
* idempotent 'domain publish' + astrale-domain skill metadata ([fb28d86](https://github.com/astrale-os/cli/commit/fb28d86f0eee2a7af8f4a3af9d6446a3fe89f1c8))
* include error data (cause chain) in --debug extras ([b0aa454](https://github.com/astrale-os/cli/commit/b0aa454a770da768f0e7d606f0ebf7581bc04b86))
* lazy whoami-backed [@self](https://github.com/self) for idp identities ([01c45d0](https://github.com/astrale-os/cli/commit/01c45d0c02861ef32117fb7b6ef7bb33b0964fa4))
* **lib:** publish astrale-domain skill from the cli repo ([c08dc7c](https://github.com/astrale-os/cli/commit/c08dc7cafd8b73d6bf00ad37de15718faeb86cea))
* local telemetry — session recorder, harness adapters, opportunistic DX analyzer ([46dbe55](https://github.com/astrale-os/cli/commit/46dbe55f391187792c71c3eb3871cd1fbd3895c0))
* local telemetry — session recorder, harness adapters, opportunistic DX analyzer ([34fe32c](https://github.com/astrale-os/cli/commit/34fe32c35caf2586e00b42c37a287400e709cae5))
* make 'domain publish' idempotent — skip no-op catalog writes ([5b9866d](https://github.com/astrale-os/cli/commit/5b9866de8baa08cf00bd7ce67727d2dc19c773e1))
* make Studio domain headers draggable ([0a6f502](https://github.com/astrale-os/cli/commit/0a6f502006b2774ededa4f6704f4452d66b2f131))
* publish astrale-cli skill for npx skills / gh skill / Claude plugin ([aeb43b8](https://github.com/astrale-os/cli/commit/aeb43b83ac37731ac2e8e95ff7f9c969ea0329f7))
* publish CLI + Domain Studio to npm as @astrale-os/cli ([da5d79e](https://github.com/astrale-os/cli/commit/da5d79e3fe58ba3000326e5ddcd797c8dd30fd14))
* refine domain dx refactor ([f92c168](https://github.com/astrale-os/cli/commit/f92c1683c30e34d213c3abb1f39f76b1df738760))
* show op latency column in astrale logs ([2548353](https://github.com/astrale-os/cli/commit/2548353b39de5c77851ae7d51be4c9450e6eede6))
* show op latency in astrale logs ([b60a77c](https://github.com/astrale-os/cli/commit/b60a77c62bef77eacdfac8790271a473c05741ae))
* studio exports ASTRALE_SESSION; skill end-of-task DX-issue checklist ([8f94fb1](https://github.com/astrale-os/cli/commit/8f94fb1132d9af45446284a1af2433f4d33c0ef9))
* studio exports ASTRALE_SESSION; skill end-of-task DX-issue checklist ([717a612](https://github.com/astrale-os/cli/commit/717a61297d6481e6131aecca71ea4f32c05a853e))
* studio UX fixes and comment/anchor improvements ([a01d670](https://github.com/astrale-os/cli/commit/a01d670ff221081641e79ff50c08c50c24cefd31))
* studio UX fixes and comment/anchor improvements ([fcb8d5f](https://github.com/astrale-os/cli/commit/fcb8d5fe336d05c5936c5e0fdde5072d679ac628))
* studio visibility + interface materialization, gateway & CLI WIP ([a9230d7](https://github.com/astrale-os/cli/commit/a9230d73a2ebbd22f25d8042c849a87fc26d6e83))
* **studio:** add multi-domain workspaces ([170f0d7](https://github.com/astrale-os/cli/commit/170f0d744bb7454c9d3521f6f833c381640c76e1))
* **studio:** compose multiple domains on canvas ([5bcfb14](https://github.com/astrale-os/cli/commit/5bcfb1407402722e790c8bbaa9fbde3aec9b317f))
* **studio:** guard and resize workspace domains ([84d5801](https://github.com/astrale-os/cli/commit/84d580161b089d090f349abc0bd0bf4f27ca980f))
* unified per-element studio canvas visibility layer ([7fb9193](https://github.com/astrale-os/cli/commit/7fb919383210923f6ad7f7cb6d29105f0b96f8d7))
* unify Studio domain canvas controls ([6144626](https://github.com/astrale-os/cli/commit/6144626cc95efa4f2a1def4ae8ff012607a6ab29))
* **view:** route open intents to associated views ([9f8c2b1](https://github.com/astrale-os/cli/commit/9f8c2b156097eb805a31c15ff2143bfdd5096902))
* warn when the admin bookmark pins a different identity on create ([3784c76](https://github.com/astrale-os/cli/commit/3784c76efecf16206b6ab112570869383d11e04a))


### Bug Fixes

* [@self](https://github.com/self) for idp identities — refuse with the whoami recipe instead of expanding the idp subject ([0c83325](https://github.com/astrale-os/cli/commit/0c83325db4f3bd67eca209bd9b02ec9366f5899f))
* analyzer files issues with --ci and plain-ASCII bodies (non-ci hang) ([9534203](https://github.com/astrale-os/cli/commit/9534203e14e936304dadbaed46cd8251fa564972))
* **ci:** resolve [@astrale-os](https://github.com/astrale-os) from public npm + refresh lockfile ([d90fee4](https://github.com/astrale-os/cli/commit/d90fee4dde8ce3f757fe0c7ca547af0644795062))
* **ci:** restore automated CLI publishing ([ab5d246](https://github.com/astrale-os/cli/commit/ab5d2469bd08bc242335db0caf703f46d04b3381))
* **cli:** keep command timeout defaults ([6554e95](https://github.com/astrale-os/cli/commit/6554e9509e74a6a3ecbf13901f94dd81caed4b8f))
* **commands:** identity register resolves classes via graph.query; skills teach doors-only reads ([80e8a40](https://github.com/astrale-os/cli/commit/80e8a408439889d1c38e76b44f78fb09cf56d584))
* **commands:** list view candidates before selection ([11be6ba](https://github.com/astrale-os/cli/commit/11be6ba6b0c4d0b0d393b170791a19bd28f9b222))
* **commands:** render missing-argument errors + spinner on admin instance commands ([9c4e03c](https://github.com/astrale-os/cli/commit/9c4e03c97d84a9665258e6a33d2695f92cfc6015))
* **commands:** use point read for get ([5f0b3fd](https://github.com/astrale-os/cli/commit/5f0b3fdaa2f706807d11b152efe164a95aab81f2))
* **commands:** use semantic admin method paths ([9b5d1b2](https://github.com/astrale-os/cli/commit/9b5d1b2e4e2ab592ee7c046ed9f3293c5b2ec031))
* **commands:** use semantic admin method paths ([a271fbf](https://github.com/astrale-os/cli/commit/a271fbf42e4882fef198fd32fd6bbc6eb63e3484))
* create runs as the logged-in identity; stale bookmark orgs self-heal ([7d7a792](https://github.com/astrale-os/cli/commit/7d7a7923e9f6b8235dff48adeb024bd1dde2196d))
* **deps:** floor kernel-client at 0.3.1 (single kernel-core) ([94c92a4](https://github.com/astrale-os/cli/commit/94c92a419ead9b1dcd7265d066a9a85ec74b7c33))
* **deps:** floor kernel-client at 0.3.1 (single kernel-core) ([138e61b](https://github.com/astrale-os/cli/commit/138e61bb8b62e174a2ea60662a96d0b0db4088b3))
* enhance error handling in instance deletion command ([2af3650](https://github.com/astrale-os/cli/commit/2af3650a998bbc084ace8bf4d813a876908e758b))
* guide alpha create users to auth login ([a0915b3](https://github.com/astrale-os/cli/commit/a0915b3a23df21ecda17711544a72d12edbc0df8))
* harden cli release updates ([9b1c740](https://github.com/astrale-os/cli/commit/9b1c740f630c3b9eaa63d2002372b54b13da4669))
* include default WorkOS alpha client id ([ace009c](https://github.com/astrale-os/cli/commit/ace009ce307e0287d88f06d47e28afe4f42173bd))
* instance store read no longer rewrites the file — active clobber race ([540052a](https://github.com/astrale-os/cli/commit/540052a7cd82d283ae4f8876ccbba3335767eabe))
* keep managed instances out of bookmarks ([dbe80af](https://github.com/astrale-os/cli/commit/dbe80af009270980a59effd860917c15be5873d4))
* kernel-client/kernel-core are runtime deps (CLI source imports them) ([1b25d42](https://github.com/astrale-os/cli/commit/1b25d422cd2377122a76c189f79f1cf1b8a2dcd7))
* **lib:** durable IdP sessions — locked refresh, per-audience tokens, transient error split ([88839a1](https://github.com/astrale-os/cli/commit/88839a1fa3e49d8aff345e74583847993b99f0b8))
* **lib:** keep open-intent tests runtime-independent ([1396af4](https://github.com/astrale-os/cli/commit/1396af44a6982d71e68395c3962d18b9c7734b21))
* **lib:** refresh idp self registrations ([bd19ca8](https://github.com/astrale-os/cli/commit/bd19ca8251ca1c8cbafdee6545b7e2c193d43ab3))
* normalize managed instance bookmarks ([cc36377](https://github.com/astrale-os/cli/commit/cc363773fc859249f371bff610704ca615ed3a5f))
* pin token scoping to the org returned by instance create ([db519e4](https://github.com/astrale-os/cli/commit/db519e4bbf2b597c02c7f2dcafc8ee5accc0c467))
* regenerate cli lockfile for studio deps; studio create-&gt;context nav ([a5b0646](https://github.com/astrale-os/cli/commit/a5b06462ef44221424bc39d3c06a565924410673))
* **release:** bump release-please manifest to 0.4.0-alpha.13 ([fd0c1c3](https://github.com/astrale-os/cli/commit/fd0c1c397a77d98d1ed45a2046bd7a4e25482bd2))
* **release:** restore automated CLI publishing ([91d0c3e](https://github.com/astrale-os/cli/commit/91d0c3e7b1f658bb5c8f5039d574e589df10723c))
* saga-sized default timeout on instance create/delete ([dae38a0](https://github.com/astrale-os/cli/commit/dae38a03c3378e628572ff1109db7445e7cd6db1))
* studio introspection resolves member names from the defineSchema map ([dc54081](https://github.com/astrale-os/cli/commit/dc54081b9e44940a37403a2ce56efe7b04b4cbb2))
* **studio:** discover local preview packages ([7805fa3](https://github.com/astrale-os/cli/commit/7805fa373f1a296d3a036671579a66cdb02b23aa))
* **studio:** stabilize external workspace frames ([f3e23a0](https://github.com/astrale-os/cli/commit/f3e23a049984ae9ea1645c5878fa0f8f3bfb292c))
* sync standalone lockfile with @astrale-os/shell devDependency ([7b1b3c9](https://github.com/astrale-os/cli/commit/7b1b3c940c34dbcc82f54f806f7a0596fcad36e0))
* sync standalone lockfile with @astrale-os/shell devDependency ([e74f933](https://github.com/astrale-os/cli/commit/e74f9339839d27f3b97679b02a4ca8b3c0dc94a1))
* telemetry paths resolve at call time; test cleanups confined to tmpdir ([d38aecf](https://github.com/astrale-os/cli/commit/d38aecf59707abe88ddc9c87836706b8485d5c92))
* telemetry review pass — bunfs self-spawn, analyzer sandbox, GC, redaction shapes ([5ec0785](https://github.com/astrale-os/cli/commit/5ec07859f99cce9b97fb9d27093647df97b092c0))
* track cli channel release identity ([5cdf3d5](https://github.com/astrale-os/cli/commit/5cdf3d5a02708fbd1c445d856140df2ca3d2ff02))
* typed fail-fast for unknown -i instances; machine-readable errors in machine mode ([c262b99](https://github.com/astrale-os/cli/commit/c262b99a6acde0f4f9a403734b484ef09f8d475c))
* typed fail-fast for unknown -i instances; machine-readable errors in machine mode ([49f2476](https://github.com/astrale-os/cli/commit/49f2476679b100e16d039717d50aeeb43af23efc))
* unify instance target resolution ([1b1d936](https://github.com/astrale-os/cli/commit/1b1d9362657ffa41c08122750028f4e5e6d5b476))
* update default issuer to 'https://unregistered.invalid' across configurations and tests ([a5d18fc](https://github.com/astrale-os/cli/commit/a5d18fcedd5361da156921253dc3612b77a1e9e2))
* **view:** list candidates before selection ([9141b18](https://github.com/astrale-os/cli/commit/9141b1809478ed5111dc70d0ee5f9c313f5f0136))
* **view:** wait for settled captures ([845881d](https://github.com/astrale-os/cli/commit/845881d3afd3be635f4fdb16bdbd29296af4a379))
* **view:** wait for settled one-shot captures ([4677b62](https://github.com/astrale-os/cli/commit/4677b62c72465e7824361b3804967383009e620f))


### Documentation

* add issue-reporting + container-vs-edge skill guidance ([092367f](https://github.com/astrale-os/cli/commit/092367f39442127dc01f969f90f9614293cb793b))
* add Issues-retrospective topics to astrale-domain skill ([#42](https://github.com/astrale-os/cli/issues/42)) ([f3570ef](https://github.com/astrale-os/cli/commit/f3570ef920cada5910d696b747ea14d4449f21b3))
* add no-instance domain validation topic to astrale-domain skill ([#43](https://github.com/astrale-os/cli/issues/43)) ([605ad5c](https://github.com/astrale-os/cli/commit/605ad5c7c28dffcf9879b7ec88b3d92e2f779c6b))
* astrale-domain skill — add when_to_use + scaffold note ([9da89f1](https://github.com/astrale-os/cli/commit/9da89f1e86cf10d595189f32bef76a3ac096cbba))
* rename astrale-domain skill name to kebab-case convention ([cb40b16](https://github.com/astrale-os/cli/commit/cb40b16af08db18755f540db0c01b45083f55886))
* skill — key=value coercion rules ([8eda487](https://github.com/astrale-os/cli/commit/8eda48719181adc82a023d0608ab72e7d4c66e6a))
* skill revisions — [@id](https://github.com/id) gotchas, stdin payloads, cause-chain debug, managed adapter ([8c5145f](https://github.com/astrale-os/cli/commit/8c5145fbc8db0798ec8b7f4f220f8a8ed4008d5d))
* token help says which flows it serves (worker-direct, no .grant) ([33a5552](https://github.com/astrale-os/cli/commit/33a55520fde56a5f0611e321151c3af3115d0351))
* update astrale-domain skill ([31331ec](https://github.com/astrale-os/cli/commit/31331ecf39c976885f97a3d8bb7000bfd523d735))
* update astrale-domain skill ([3558ca6](https://github.com/astrale-os/cli/commit/3558ca625b54755378c402b6e6426461be0b7169))
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

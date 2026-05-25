# Astrale CLI — Design & Invariants

> Niveau conceptuel : **vision, invariants, contrats, rationale de design**. Doc **non-normatif**.
> **Source de vérité** : le code. Ce doc est *outdated by design* — il capture l'intention et le « pourquoi », pas l'état exact. Toute ambiguïté se résout en faveur du code.
> - **Surface CLI** (commandes, flags) → `astrale --help` (source de vérité, test-enforced via `help-contract.test.ts`).
> - **Référence d'usage** → skill `astrale-cli`.
> - **Vision & invariants** (ce fichier) → voir §16 *Décisions de conception* en particulier.
>
> **Maintenance / niveau** : on reste **conceptuel** — invariants, contrats, rationale. On **refuse** ici l'implem, le pseudo-code, l'anticipation prématurée, l'overengineering. Une édition est bonne si elle clarifie un invariant existant ou comble un trou conceptuel réel ; mauvaise si elle ajoute de l'implem ou un cas trop spécifique. Cible : zéro incohérence interne, trous conceptuels majeurs comblés, aucune dérive vers l'implem.

---

## 1. Vision

La CLI Astrale est l'**unique surface d'orchestration** du lifecycle Astrale côté poste de travail. Elle gère :

- des **identités** (keypairs locales, authentification kernel / cloud),
- un **manager local** (un seul par machine, optionnel),
- un ensemble d'**instances** (locales, managées par astrale cloud, ou bookmarkées).

---

## 2. Identités

Une identité = authentifié depuis un IDP ou une **keypair (souvent ES256) nommée**, peut être gérée localement par la CLI.

### 2.1 Rôles

Une identité peut servir à :

1. **Créer une instance** auprès d'un manager (local ou astrale cloud) en tant qu'identité root.
2. **S'enrôler** auprès d'un kernel (pré-enregistrement de la `publicJwk` côté kernel).
3. **Se connecter** à un kernel (obtenir un delegation token).

### 2.2 Initialisation

À la première utilisation de la CLI :

- Si aucune identité locale n'existe, la CLI crée une **identité locale par défaut**.
- Au premier `astrale start`, cette identité devient l'**identité root du manager local** (sauf `--as` override).
- L'identité **astrale cloud** s'ajoute via `astrale auth login`.

**Invariant** : il n'existe **pas d'identité « root »** au sens absolu CLI — le rôle `root` est toujours relatif à une instance.

### 2.4 Identité root vs identité par défaut

Deux concepts distincts par instance :

- **Identité root** — Créée au `instance create`. **Pas toujours accessible** depuis la CLI (ex. instance managée cloud : scellée côté cloud).
- **Identité par défaut** — identité utilisée par la CLI quand on cible cette instance sans `--as`. Stockée par instance, persistée dans le registre.

**Règle de résolution `identité root × identité par défaut`** à la création :


| Cas                    | Identité root                           | Identité par défaut              |
| ---------------------- | --------------------------------------- | -------------------------------- |
| Local — défaut         | L'identité `--as` (dédiée à l'instance) | L'identité `--as` (admin)        |
| Local — `--distroless` | L'identité `--as` (dédiée à l'instance) | L'identité root (=`--as`)        |
| Managée cloud          | Scellée côté cloud                      | Identité `astrale cloud` (admin) |


**Invariant** : chaque instance locale a **sa propre identité root**, fournie via `--as` (ou l'identité active CLI par défaut). Il n'y a pas de partage ni d'héritage de la root du manager vers les children.

**Invariant** : l'identité par défaut est attachée à l'**instance** (persistée), distincte de l'identité *active* CLI (pointeur shell courant).

### 2.5 État CLI : deux dimensions orthogonales

L'état interactif de la CLI tient sur **deux dimensions indépendantes** :

1. **Identité active** — qui je suis (`astrale identity use <name>`).
2. **Instance active** — sur quoi je travaille (`astrale instance use <name>`).

**Invariant d'orthogonalité** : changer l'une ne touche **jamais** l'autre.

Exemple :

```
# État initial
kernel=kernel1, identité=identité1

# Switch d'identité → seule l'identité change
astrale identity use identité2
# état : kernel=kernel1, identité=identité2

# Switch d'instance → seule l'instance change
astrale instance use kernel2
# état : kernel=kernel2, identité=identité2
```

**Override ponctuel** : `--as <identity>` et `--instance <name>` overrident pour une commande unique, sans muter l'état persistant.

**Identité par défaut d'une instance** (cf. §2.4) : propriété **de l'instance**, jamais appliquée automatiquement à l'identité active CLI — elle sert uniquement de référence pour le prompt DX au `instance use` (cf. §7).

### 2.5.1 Identités par défaut par cible

Quand une commande cible un kernel sans `--as` explicite, l'identité utilisée est **toujours l'identité active CLI** (conséquence de §2.5). Les colonnes ci-dessous précisent l'identité par défaut *de la cible* — utilisée au moment de `instance create` / `instance bookmark`, et référence pour le prompt DX (§7) :


| Cible                    | Identité par défaut de la cible                                 |
| ------------------------ | --------------------------------------------------------------- |
| Manager local            | Identité root du manager                                        |
| Instance locale (child)  | Identité par défaut de l'instance (cf. §2.4 — admin en général) |
| Instance remote bookmark | Identité par défaut du bookmark (défaut `astrale cloud`)        |
| Astrale cloud (API)      | Identité `astrale cloud`                                        |


> Les identités **hors identité astrale cloud** ont deux modes — `local` ou `remote` (cf. §2.7).

### 2.7 Modes local / remote (multi-machine)

Les identités (hors identités astrale cloud) et les bookmarks d'instance existent en **deux modes** :

- `**local`** — stocké dans le registre machine uniquement.
- `**remote`** — stocké côté astrale cloud, **synchronisé automatiquement** sur toutes les machines du même compte cloud.

**Défaut à la création** : `remote` (sync transparent). Override par `--local`.

**Migration** :

- Un bookmark peut être migré `local ↔ remote`.
- Une identité peut être migrée `local ↔ remote`.

**Règle de cohérence `bookmark × identité par défaut`** : un bookmark `remote` doit avoir une identité par défaut `remote` (sinon le lien casse sur une autre machine). Deux cas symétriques déclenchent la même protection :


| Op tentée                                                                                | Blocage            | Comportement                                                                                             |
| ---------------------------------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------- |
| `identity unsync <id>` (remote → local) où `<id>` est défaut d'un bookmark `remote`      | Blocage par défaut | Warning + prompt : **migrer aussi le bookmark en `local`** ? (`Y` = migrate les deux, `n` = annule l'op) |
| `instance bookmark unsync <name>` (local → remote) où l'identité par défaut est `local` | Blocage par défaut | Warning + prompt : **migrer aussi l'identité en `remote`** ? (`Y` = migrate les deux, `n` = annule l'op) |


- Mode `--ci` / `--no-prompt` → pas de prompt, opération **refusée** avec `CoupledMigrationRequiredError`. Bypass explicite via `--cascade` (migre l'entité couplée) ou `--force-decouple` (ne migre pas — laisse le bookmark dans un état où il devra être refait sur l'autre machine).

**Import au login** : `astrale auth login` **importe automatiquement** toutes les identités `remote` du compte cloud dans la CLI locale (elles deviennent utilisables immédiatement, sans re-enrollment).

---

## 3. Manager local & API partagée

### 3.1 Manager local

- `astrale start` — lance le manager local **et son proxy machine-level** (cf. §4.6). **Un seul manager local max** par machine, géré par la CLI.
- `astrale stop` — éteint le manager local, son proxy, et toutes ses instances enfant.
- `astrale status` — état du manager local.

### 3.2 API partagée

Il n'y a **qu'une seule API locale** servie par le manager, partagée entre le manager et ses instances enfant :

- Requêtes sur `**base url`** → routées vers le **manager**.
- Requêtes sur `**base url / instanceId`** → routées vers l'**instance enfant** correspondante.

Le manager a le domaine `manager` installé, les enfants ont le domaine `distribution`.

### 3.3 Statut du manager

Le manager **est lui-même une instance Astrale** (avec un statut spécial). Tout ce qu'on peut faire avec une instance, on peut le faire avec le manager.

---

## 4. Typologie des kernels

La CLI distingue **4 cas** de kernels adressables :

### 4.1 Instance remote (bookmark)

Instance qui existe déjà — déployée par nous-même (via Docker, etc.) ou par un tiers. On l'ajoute à la CLI pour s'y connecter facilement.

```bash
astrale instance bookmark <name> --url <url> [--as <identity>] [--local]
```

- `<name>` : label (requis).
- `--url` : URL de l'instance.
- `--as` : identité optionnelle. **Défaut : astrale cloud**.
- `--local` : stocke le bookmark uniquement sur cette machine. **Défaut : `remote`** (sync cloud, cf. §2.7).

**Invariant** : la commande **tente une authentification** auprès du kernel cible avec l'identité résolue. L'entrée locale (ou remote) n'est créée **qu'en cas de succès** — pas de bookmark orphelin. L'identité par defaut pour cette instance est l'identité utilisée pour le bookmark.

### 4.2 Instance managée (astrale cloud)

Instance gérée par astrale dans le cloud. La CLI appelle directement le service astrale cloud pour la créer.

```bash
astrale instance create <name>
```

- `<name>` : requis.
- **Pas de `--as`** : l'identité astrale cloud est toujours utilisée (voir invariants).

**Invariants** :

- Authentification à astrale cloud requise (identité `astrale cloud` active).
- L'**identité root** de l'instance est **créée et scellée côté astrale cloud** — jamais exposée à la CLI.
- L'identité `astrale cloud` est automatiquement enregistrée comme `admin` dans le domaine `distribution` de l'instance créée.
- Pas de `--as`, pas de `--root`, pas de `--distroless` — le modèle managé est volontairement **fermé** (minimal).

**Flow** : CLI → astrale cloud → provisionne l'instance, installe `distribution`, boot, scelle l'identité root cloud-side, enregistre l'identité cloud comme `admin`. L'instance est ensuite listable via `astrale instance list` ou `--managed`.

**Note implémentation** : l'intégration astrale cloud passe par un **adapter stub** (état actuel) — surface CLI définie, flow non opérationnel tant que l'adapter réel n'est pas livré.

### 4.3 Instance locale (child du manager local)

Instance locale allouée par le manager local.

```bash
astrale instance create <slug> --local [--name <s>] [--config <c>] [--tunnel <id>] [--as <identity>] [--distroless]
```

- `<slug>` : identifiant URL-safe (`[a-z0-9][a-z0-9-]*`), **requis** — sert dans l'issuer (cf. §4.6). Omissible si `--config` fournit un `slug`.
- `--local` : cible le manager local.
- `--name <s>` : label humain optionnel (display DX), libre. Omissible si `--config` fournit un `name`.
- `--config <c>` : config d'instance (cf. §4.5). Tout flag explicite override un champ de la config.
- `--tunnel <id>` : bind un tunnel machine (cf. §12) → **issuer tunneled** (cf. §4.6). Sans ce flag (et sans `config.tunnel`), issuer = **proxied** (défaut).
- `--as` : dans le cas "distribution", identité utilisée comme "admin" au lieu de l'identité active. Sinon erreur si `--distroless` car identité root est auto-générée.
- `--distroless` *(local uniquement)* : ne pas installer le domaine `distribution`. Sans admin, l'identité par défaut retombe sur la root (`--as`).

**Post-create** : check JWKS obligatoire (cf. §4.6). Échec → rollback destructif (issuer baked, pas de rattrapage).

**Comportement par défaut** (sans `--distroless`) :

1. L'identité `root` est auto-générée.
2. Installe `distribution`.
3. Enregistre l'identité active ou  `--as` comme `admin` dans `distribution` → devient **identité par défaut de l'instance**.
4. Boot.

**Flow** : CLI → manager local → création du child dans le graph, enregistrement de la root identity, install `distribution`, enroll admin, boot.

### 4.4 Manager local

Cas particulier de l'instance locale, avec un statut spécial (un seul, géré par `astrale start|stop`).

### 4.5 Configs d'instance

Une **config d'instance** décrit comment créer une instance locale. Champs : `**slug` (requis)**, `**name` (requis)**, `domains`, `tunnel?`, `install?`, `env?`. Soit **built-in CLI** (`local`, `dev`, …), soit user-defined (fichier `astrale.instance.ts` ou entrée dans `config.json`).

```bash
astrale instance create --local --config <config-name>   # slug + name hérités de la config
astrale instance create foo --local --config dev         # slug explicite override config.slug
```

**Règles** :

- Config `local` (minimale, pas de tunnel) toujours dispo.
- Précédence : **flag explicite > champ de la config > défaut CLI**.
- `slug` + `name` requis dans la config → garantit la **reproductibilité** (même config → même identité d'instance).
- Une config portant `tunnel` est **1:1 avec une instance** — un tunnel n'appartient qu'à une seule instance à la fois.
- La macro `astrale dev` compose deux axes indépendants : **config kernel** (ici) × **config domaine** (manifeste `astrale.config.ts`). Résolution per-env : flags > `workspace.json` > config built-in.

> **Naming** : `astrale.config.ts` (manifeste domaine, existant) ≠ config d'instance (ici). Scope différent, terme partagé assumé.

### 4.6 Issuer & proxy machine-level

Chaque instance a un **issuer** (URL d'où est servi `/.well-known/jwks.json`), fixé au boot et porté par tous ses tokens. Deux modes pour un child du manager local :


| Mode                 | Issuer                                                      | Vérifiable depuis        |
| -------------------- | ----------------------------------------------------------- | ------------------------ |
| **proxied** (défaut) | `http://<slug>.astrale.localhost:4444`                      | La machine uniquement    |
| **tunneled**         | URL publique du tunnel (ex. `https://<slug>.<tunnel-host>`) | Partout où le DNS résout |


**Proxy machine-level** : composant lifecycle-collé au manager (`astrale start` lance, `astrale stop` coupe). Écoute `:4444`, route `<slug>.astrale.localhost` → `<manager-url>/<instance-id>`. Utilise le TLD `.localhost` (RFC 6761, loopback garanti, zéro `/etc/hosts`). Port `:4444` fixe (évite les ports privilégiés 80/443).

**Manager** : slug réservé `manager` → `http://manager.astrale.localhost:4444` (redirige vers le manager directement). Utiliser `manager` comme nom d'instance → `ReservedSlugError`.

**Choix du mode** : défaut = proxied. Tunneled = `--tunnel <id>` explicite ou `config.tunnel`. Le tunnel est configuré out-of-band (§12).

**Post-create check (invariant)** : après boot, la CLI `GET <issuer>/.well-known/jwks.json` et match `kid` ↔ `/meta.kid`. Échec → `IssuerUnreachableError` ou `IssuerKidMismatchError` + rollback destructif.

**Switch de mode** : non supporté — changer l'issuer invalide tous les tokens émis. Recreate l'instance.

> **Roadmap** : issuer stable cross-toggle via domaine Astrale-owned (`*.local.astrale.ai`) + DNS override local — permet d'activer/désactiver le tunnel sans recréer l'instance. Hors scope actuel (nécessite ownership DNS + routing cloud + DNS override machine).

### 4.7 Identifiants CLI (slug & name)


| Cas             | Identifiant primary                            | Identifiant secondaire             |
| --------------- | ---------------------------------------------- | ---------------------------------- |
| Local child     | `slug` (requis, URL-safe `[a-z0-9][a-z0-9-]*`) | `name?` (display libre, optionnel) |
| Bookmark remote | `name` (requis, libre)                         | —                                  |
| Managée cloud   | `name` (requis, libre)                         | —                                  |
| Manager local   | `manager` (réservé, fixe)                      | —                                  |


**Uniqueness** : tout `slug` et tout `name` partagent **le même namespace d'adressage CLI**, unique **cross-all-instances**. Collision (nouveau slug qui match un name existant, ou vice versa) → `IdentifierCollisionError`. Slug réservé `manager` → `ReservedSlugError`.

**Résolution** : `astrale instance use <x>`, `--instance <x>`, etc. matchent `<x>` contre n'importe quel slug ou name ; résultat unique par construction.

**Display** : format `<name> (<slug>)` si les deux existent ; sinon l'un ou l'autre seul.

**Config** : impose `slug` + `name` (cf. §4.5) — reproductibilité garantie.

---

## 5. Sémantique `forget` vs `delete`

Deux verbes, deux effets distincts :


| Verbe                     | Effet                                                                   | Cibles valides                             |
| ------------------------- | ----------------------------------------------------------------------- | ------------------------------------------ |
| `astrale instance bookmark forget` | Drop du bookmark (local ou cloud). **Aucun effet côté kernel.**         | Instance remote bookmarkée **uniquement**  |
| `astrale instance delete` | **Destructif kernel-side** : détruit l'instance sur son manager parent. | Instance locale (child) ou managée (cloud) |


### 5.1 Règles d'erreur explicites

- `astrale instance delete` sur le **manager local** → refus, `CannotDeleteManagerError` (hint : `astrale stop`).
- `astrale instance delete` sur un **bookmark remote** → refus (hint : `astrale instance forget`).
- `astrale instance bookmark forget` sur une **instance locale / managée** → refus (hint : `astrale instance delete`).

**Invariant** : jamais d'op destructive silencieuse ; toujours un hint actionnable.

---

## 6. `astrale instance list`

Retourne un **agrégat** sur toutes les sources :

1. Le **manager local** (statut spécial `manager`).
2. Les **instances locales** (children du manager local — récupérées via call au manager).
3. Les **bookmarks locaux** — références dans le registre machine.
4. Les **bookmarks cloud** — références côté astrale cloud, sync multi-machine.
5. Les **instances managées astrale cloud**.

**Bookmark local vs cloud** :

- `local` → valide pour *cette* machine uniquement.
- `cloud` → sync automatique sur toutes les machines du même compte. **Défaut pour `bookmark` : `cloud`** (overridable par `--local`).

### 6.1 Filtres

```bash
astrale instance list
astrale instance list --local               # manager + children locaux
astrale instance list --managed             # instances astrale cloud (créées par moi)
astrale instance list --bookmarked          # tous les bookmarks (local + cloud)
```

---

## 7. `astrale instance use`

Change l'**instance active** (cf. §2.5 — dimension indépendante de l'identité active). Les ops ultérieures ciblent cette instance par défaut (overridable par `--instance <name>`).

**Rappel invariant (§2.5)** : `instance use` ne modifie **jamais** l'identité active. Le prompt ci-dessous est une **convenance DX** — le seul cas où un `instance use` peut entraîner un switch d'identité est une acceptation explicite du prompt par l'utilisateur.

**JWKS reachability check** : au switch, la CLI fetch `<issuer>/.well-known/jwks.json` et match `kid` ↔ `/meta.kid`.

- Instance **tunneled** injoignable → **block** (`IssuerUnreachableError`) : l'intégration remote est cassée, mieux vaut le savoir maintenant.
- Instance **proxied** injoignable → warning (proxy probablement down, hint `astrale start`).
- Bookmark remote : même check, pas de traitement spécial.

### 7.1 Prompt identité par défaut (DX)

Au switch, la CLI compare :

- identité par défaut de l'instance cible (cf. §2.4),
- identité active CLI.


| Cas                   | Comportement                                                          |
| --------------------- | --------------------------------------------------------------------- |
| Identités égales      | Switch silencieux.                                                    |
| Identités différentes | Prompt : propose de switcher aussi l'identité active (réponse libre). |


```
Instance "<name>" a pour identité par défaut "<default>".
Identité active : "<current>". Switcher aussi l'identité ? [Y/n]
```

- Réponse `Y` (défaut) → switch aussi l'identité active.
- Réponse `n` → garde l'identité active (l'orthogonalité §2.5 est respectée).
- Mode `--ci` / `--no-prompt` → **pas de prompt**, identité active conservée (sauf flag explicite `--adopt-default` qui force l'adoption).

---

## 8. Notes d'implémentation (kernel-side)

> Cette section oriente le code kernel pour supporter ce design, pas un invariant CLI utilisateur.

- **Supprimer le port `instances`** actuellement utilisé par le manager.
- **Stocker les instances dans le graph** (as first-class nodes / edges).
- Le **syscall `create instance`** du manager doit appeler le **port `boot`** pour booter l'instance (séparation claire : allocation dans le graph ≠ lifecycle du process).

---

## 9. Surface CLI

> **La surface (commandes, sous-commandes, flags) n'est PAS spécifiée ici.** Elle vit dans
> `astrale --help` — source de vérité unique, **test-enforced** (`help-contract.test.ts` vérifie
> que `--help` ne fuite aucun ancrage `§` et que le skill `astrale-cli` en est le miroir exact).
> Pour la référence d'usage : skill `astrale-cli`. Pour les *conventions* de nommage des verbes
> (`create` / `bookmark` / `forget` / `delete` …), voir §16.10.
>
> *Une liste de commandes a déjà vécu ici ; elle a divergé du `--help` réel et a été retirée
> pour éviter une seconde source de vérité contradictoire.*

---

## 10. Contract `/meta`

Chaque kernel (et domaine installé) expose `GET /meta`. **Shape stable dev ↔ prod** (mêmes champs, valeurs différentes, aucune branche conditionnelle).

**Champs minimaux** :


| Champ             | Sens                                                                                                                                               |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`            | `manager`                                                                                                                                          |
| `url`             | URL publique                                                                                                                                       |
| `iss`             | URL du kernel émetteur — **toujours atteignable par les vérifieurs** (proxy local ou tunnel, cf. §4.6). JWKS servi à `<iss>/.well-known/jwks.json` |
| `kid`             | JWK thumbprint (RFC 7638) de la clé publique courante                                                                                              |
| `version`         | semver du kernel / domaine (savoir à qui on parle)                                                                                                 |
| `protocolVersion` | semver du protocole runtime (négociation de compat)                                                                                                |
| `serverTime`      | ISO 8601 (détection du clock skew)                                                                                                                 |


**Invariants** :

- `deploy` / `instance status` / `domain check` fetchent `<iss>/.well-known/jwks.json` et matchent `kid` observé.
- Champ absent ou `kid` manquant → `KidMissingError` (shape invalide).

---

## 11. Architecture & ports

**Hexagonal** : core pur → use cases → ports (interfaces) → adapters (remplaçables). **Règle inviolable** : le core et les use cases n'importent **aucune lib I/O** — tout passe par des ports.

**Ports principaux** (contrats conceptuels, signatures ajustables) :


| Port             | Rôle                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------- |
| `DomainPlatform` | Ship le worker d'un domaine (`startDev`, `deploy`, `scaffold` + capabilities optionnelles). |
| `TunnelAdapter`  | Expose un port local en HTTPS public (cf. §12).                                             |
| `KernelClient`   | `call` / `query` / `meta` sur un kernel.                                                    |
| `ConfigStore`    | Read/write/lock sur les registres (écritures atomiques).                                    |
| `IdentityStore`  | CRUD keypairs ES256, signature JWT.                                                         |


**Capability flags** plutôt qu'interface fat : un adapter sans `rollback` ne l'implémente pas et ne liste pas la capability ; le use case branche proprement. Capabilities usuelles : `stagedPreview`, `rollback`, `logs`. Commande exigeant une capability absente → `CapabilityMissingError`.

**Contraintes transverses** :

- `ConfigStore.lock` : lock par registre, **ordre total** entre registres (évite deadlocks) ; timeout → `LockTimeoutError`.
- `HttpClient` : dedupe in-flight + cache TTL sur GETs idempotents.
- `Logger` : **redaction obligatoire** (aucun secret dans les outputs).
- **Stdout = machine-parseable, stderr = humain** (mandaté).

---

## 12. Tunnels

**Position** : setup machine-level persistant, **pas une op de lifecycle domaine**.

**Consommés par** les children du manager local via `instance create --tunnel <id>` ou `config.tunnel` (cf. §4.6). Un tunnel machine peut servir d'autres besoins hors surface CLI, mais côté CLI **seuls les children du manager local** le consomment. Binding **1:1** : un tunnel est attaché à une instance à la fois.

**Consommation out-of-process** : `instance create --tunnel <id>` ne spawn rien — il lit le tunnel du registre, dérive les hostnames, préflight DNS. La **gestion** est explicite : `tunnel setup` crée le tunnel, `tunnel start` le lance en background via l'adapter, `tunnel ingress add` édite ses routes.

**`TunnelAdapter` résolu via `resolveTunnelAdapter()`** (parité avec `resolveDomainPlatform`) : `cloudflared` (v1) ; `ngrok` / `tailscale` en roadmap. Sélection via `--adapter <id>`, jamais l'adapter concret (règle oxlint). Contrat neutre = routage **http(s) hostname→service** : un `adopt` portant un service non-http (tcp/ssh/…), un `originRequest` ou `warp-routing` est refusé (`TunnelUnsupportedConfigError`). Binaire adapter indisponible → `TunnelNotConfiguredError`.

**DNS preflight obligatoire** à `tunnel setup` : DNS non résolvable → `TunnelDnsUnresolvedError`.

**Warning d'exposition publique** : un tunnel expose un port local sur Internet. Warning fort + pédago à `tunnel setup` (premier usage), rappel court à chaque `dev up` tunneled. Pas de blocage.

---

## 13. Registres

La CLI maintient trois registres locaux sous `$ASTRALE_HOME` (plus miroir cloud pour le mode `remote`) :


| Registre          | Contenu                                                                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `identities.json` | Keypairs + `name`, `mode` (`local`                                                                                                                    |
| `instances.json`  | `slug?` (requis pour local-child), `name?` (requis pour non-local, optionnel display pour local-child), `url`, `issuer` (cf. §4.6), `kind` (`manager` |
| `config.json`     | Config CLI globale (endpoint astrale cloud, defaults, telemetry opt-in)                                                                               |


**Écritures atomiques** + **lock par registre** (ordre total entre registres pour éviter les deadlocks).

Les entrées `mode: remote` sont miroir du state cloud — la CLI les rafraîchit au démarrage et lors des ops `auth login`.

---

## 14. Hors scope

> Frontières délibérées — décisions de *ne pas* faire (pas un backlog daté).

- **Révocation active de tokens** : non — on s'appuie sur des TTL courts (le TTL fait foi).
- **Multi-user sur machine partagée (ACL)** : non — single-user assumé.
- **Offline mode complet** : non couvert au-delà de `--offline-ok`.
- **Windows natif** : non supporté.

---

## 15. Notes d'intégration

- **Astrale cloud = adapter stub** (état actuel). La surface CLI est définie, le flow managé passe par un adapter qui sera livré ultérieurement. Ne pas implémenter le backend cloud pour l'instant — se concentrer sur le chemin local (manager + instances locales + bookmarks remote de kernels deployés out-of-band).

---

## 16. Décisions de conception & rationale

> Choix non triviaux qu'un changement futur ne doit pas révoquer à la légère.
> (Rationale rapatrié d'un ancien `docs/DESIGN.md`, retrié — seul ce
> qui reste vrai est conservé ; le code reste la source de vérité.)

### 16.1 Identités locales, portables, découplées des kernels

Une identité = entrée de keyring **locale** (nom, subject, matériel de
credential) ; elle n'est liée à aucun kernel. Le même identifiant peut être
connu de zéro, un ou N kernels indépendamment, et copier le dossier identité
suffit à l'utiliser ailleurs. Coupler l'identité à un kernel casserait la
portabilité et brouillerait la sémantique d'état (« supprimer alice » si alice
est sur trois kernels ?). La confiance kernel est un concern **séparé,
kernel-side**.

### 16.2 Le kernel est agnostique des IdP

Le kernel détient une liste d'**issuers de confiance** + un vérifieur JWKS par
issuer. Il ne connaît ni WorkOS, ni Google, ni aucun provider : il valide des
signatures, vérifie les claims standard, mappe `(iss, sub)` → principal local.
La CLI est le seul côté qui sait jouer les flows OIDC. CLI et kernel ne se
rencontrent qu'au JWT. Conséquence : innovation auth côté CLI sans toucher au
kernel.

### 16.3 Schémas standard, zéro contrat auth maison

Métadonnées IdP = **OpenID Connect Discovery 1.0** exact (`snake_case`),
tokens = RFC 6749 / OIDC, thumbprint = **RFC 7638**. Inventer un schéma crée
une douleur de migration pour zéro gain ; un `curl` de la discovery est
consommable tel quel.

### 16.4 Une source non ambiguë par valeur

Noms d'identité : `--name` (user) ou `--verify` (kernel, source autoritaire) —
**jamais** dérivés du nom de fichier (le filename est une métadonnée de
stockage, pas d'identité). Instance/identité actives : config ou flags
explicites, **jamais** de magie d'environnement. Deux sources en désaccord →
la CLI **échoue bruyamment** plutôt que d'élire un gagnant.

### 16.5 Les deux voies de confiance kernel (Path A / Path B)

Une identité devient « connue » d'un kernel par l'une de deux voies, selon sa
source de credential :

- **Path A — identités IdP : auto-provisionnées.** Le JWT arrive avec
  `(iss, sub)` d'un IdP externe ; le kernel vérifie la signature via la
  discovery `<iss>/.well-known/...`, évalue sa **provisioning policy**, et
  crée le nœud identité à la première authentification si l'issuer est de
  confiance. Aucune étape d'enregistrement explicite côté CLI.
- **Path B — identités à clé : sponsorisées.** `registerIdentity`
  **ne peut pas** être self-call (il exige EDIT sur un nœud identité
  pré-existant en statut `creating`). Un sponsor privilégié (admin ou
  identité système ; `astrale server init` en local dev) crée le nœud puis
  appelle `registerIdentity` avec la clé publique de l'utilisateur.

**Convention d'issuer (contrat cross-composant unique CLI↔kernel)** : pour une
identité à clé, l'issuer est dérivé **déterministiquement** de la clé :

```
iss = <kernelIssuer>/iss/<thumbprint RFC 7638 de la clé publique>
```

Le **kernel** (pas la CLI) calcule ce thumbprint et construit l'URL ; le `iss`
du token bootstrap est **ignoré**. Raison : (1) **autorité** — le kernel est
seul maître de son espace de noms d'URL ; (2) **surface d'attaque** — faire
confiance à un `iss` fourni par le client permettrait d'enregistrer avec un
`iss` falsifié. La CLI reconstruit le même `iss` indépendamment via la clé
publique + le thumbprint caché à la génération + l'issuer kernel (depuis
`/meta`, cf. §10).

### 16.6 `audience` instance-scoped, pas IdP-scoped

L'`audience` OAuth identifie *la ressource visée*, pas l'autorité émettrice :
un même IdP émet légitimement pour `kernel-prod` et `kernel-staging`. Mettre
l'audience dans la config IdP forcerait des entrées IdP dupliquées par
instance. Elle vit donc dans `instances.json` (chaque instance déclare
l'audience qu'elle attend) ; le flag `--audience` reste l'override edge-case.

### 16.7 Mode stateless

CI runners, conteneurs éphémères et scripts ne peuvent / ne doivent pas écrire
`~/.astrale/`. Le mode stateless (`--url` + creds explicites) est le **même
code path** que le mode persistant, sans le storage — pas une branche à part.

### 16.8 Contextes différés

Le cas commun est « une instance, une identité » ou « une identité sur N
instances ». Un concept de contexte (tuples nommés `(instance, identité)`
à la kubectl) n'est justifié que si un user a deux identités sur une instance.
Tant que le besoin n'est pas démontré, `instance active + --as <identité>`
suffit (cf. §2.5, dimensions orthogonales).

### 16.9 Pas de rétro-compat avant 1.0

La CLI est pré-1.0 : design propre > confort de migration. Quand un
comportement change, l'ancien est retiré **net** (pas d'alias silencieux qui
fait diverger la doc). C'est le principe sous-jacent aux suppressions du top-
level `use`, de l'alias `instance add`, et de `astrale domain install` (au
profit de `astrale instance install <domain-spec>` — un domaine ne « vit » pas
seul, il est toujours installé *sur une instance* ; le flag `--install` permet
l'install directement au `instance create`).

### 16.10 Conventions de nommage des verbes

Les verbes de commande portent une sémantique stable (le `--help` est la
surface, mais ces conventions sont l'intention sous-jacente) :

- **`create`** — provisionne une nouvelle entité (instance, identity).
- **`bookmark`** — ajoute une référence à une entité distante existante (local ou cloud).
- **`forget`** — drop une référence. **Jamais** destructif kernel-side (cf. §5).
- **`delete`** — destructif kernel-side. Confirmation TTY, refuse sur cibles invalides (cf. §5).
- **`use`** — change l'entité active dans un registre (instance / identity).
- **`list`** — lecture agrégée, jamais de mutation.
- **`sync` / `unsync`** — migration local ↔ remote (cf. §2.7).

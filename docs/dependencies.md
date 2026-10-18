# Dependency management

A person, the Packages interface or an agent inspects the dependencies of a local workspace, checks what its registries publish, asks before installing whether every declaration has a source, plans explicit changes and applies an accepted plan. This is the `beyond-dependencies/1` contract, implemented by the dependencies feature of the development service's host ([service/host/dependencies/](../service/host/dependencies/index.mjs)) and claimed in `GET /session` as the `dependencies` capability. The engineering design of the contract and of the interface that uses it is the Beyond Suite's `docs/products/packages/developer-journey.md`; the requirements are its `dependencies.md` (acceptance PKG-A22).

It is a client of the [local installation](local-installation.md), never a second resolver or a package manager: every resolution is `Resolution.workspace` through `Installation` (`@beyond-js/packages/installation`), with the same provider settings, metadata cache, transport bounds, lock (`beyond-lock/2`) and projection (`beyond-execution/1`). It never installs part of a graph, never uses `update` for a targeted change and never substitutes a source: a package no configured registry publishes is said to be missing, whoever else could supply it.

The feature works through the File API of the development extension (`@beyond-js/packages/development`), which writes manifests with their revisions. A service started without it does not claim the capability, and the routes answer as unmounted (`404`). Long work runs as [operations of the host](#long-operations) (`beyond-dev-operations/1`).

## Routes

| Route | Answer |
| --- | --- |
| `GET /dependencies?scope=` | `200` [the inventory](#the-inventory) of the scope; `400 SCOPE_INVALID`, `404 SCOPE_NOT_FOUND` |
| `POST /dependencies/checks {scope}` | `202 {operation}` of kind `dependencies.check` ([checks](#checks)); `404 SCOPE_NOT_FOUND` |
| `POST /dependencies/preflight` | `202 {operation}` of kind `dependencies.preflight` ([preflight](#preflight)) |
| `POST /dependencies/plans {changes, base}` | `202 {operation}` of kind `dependencies.plan` ([plans](#plans)); `400 CHANGES_INVALID`, `400 BASE_REQUIRED`, `422 CHANGE_UNDECLARED`, `409 PLAN_STALE` |
| `GET /dependencies/plans/:plan` | `200 {plan}`; `404 PLAN_NOT_FOUND` |
| `POST /dependencies/plans/:plan/apply {base}` with `Idempotency-Key` | `202 {operation}` of kind `dependencies.apply` ([applying a plan](#applying-a-plan)); `400 IDEMPOTENCY_KEY_REQUIRED`, `404 PLAN_NOT_FOUND`, `422 PLAN_INVALID`, `409 PLAN_STALE` |

A request that starts an operation may carry an `Idempotency-Key`, with the one rule of every feature of the host (launches and production too): 8 to 128 letters, digits, `_`, `.`, `:` or `-`, required to apply (`400 IDEMPOTENCY_KEY_REQUIRED` without one) and refused when malformed, needed or not (`400 IDEMPOTENCY_KEY_INVALID`). The same key for the same kind answers the operation it started, `200` instead of `202`, whatever the workspace became since. Bodies are JSON sent as `Content-Type: application/json` (`415 CONTENT_TYPE_UNSUPPORTED` otherwise), at most 64 KiB, with no field but the route's (`400 BODY_INVALID`). Every answer is `no-store`, and refusals use the service's envelope `{error: {code, message, details?}}`. Who reaches the routes is decided as for every route of the service that is not a compiled module: the `Host` check, the same-origin rule of an unpaired loopback service, and a paired page's token or the local credential on a service that pairs ([portable connections](portable.md)).

## The inventory

`GET /dependencies` reads the workspace as it is on disk now: the declaration, the lock, the projection's state and the packages the toolchain supplies (the host's `supplied` setting, and the libraries of its `runtime` setting resolved from the toolchain's installation). It requests nothing from a registry.

```json
{
	"protocol": "beyond-dependencies/1",
	"scope": { "kind": "member", "id": "apps/web" },
	"installation": { "state": "ready", "diagnostics": [] },
	"lock": { "present": true, "digest": "sha256-…" },
	"inputs": { "digest": "sha256-…" },
	"base": { "lock": "sha256-…", "inputs": "sha256-…" },
	"members": [{ "id": "apps/web", "name": "@fixture/web", "version": "1.0.0", "node": "workspace:apps/web", "manifest": "apps/web/package.json", "declared": [{ "name": "react", "range": "^18.3.1", "type": "prod" }] }],
	"nodes": [{
		"key": "npm:react@18.3.1", "name": "react", "version": "18.3.1",
		"source": { "kind": "registry", "registry": "https://registry.npmjs.org/" },
		"declared": [{ "importer": "apps/web", "range": "^18.3.1", "type": "prod" }],
		"dependencies": [{ "key": "npm:loose-envify@1.4.0", "name": "loose-envify", "range": "^1.1.0", "type": "prod" }],
		"dependents": [{ "key": "workspace:apps/web", "range": "^18.3.1", "type": "prod" }],
		"status": "installed", "integrity": "sha512-…", "visibility": "public"
	}],
	"counts": { "members": 3, "nodes": 14, "scope": 6, "shown": 6 },
	"truncated": false,
	"diagnostics": []
}
```

- **Members** are the importers of the graph: every member whose manifest can be used, and the root package (`.`, `root: true`) when it declares dependencies without being a member. `declared` is what each one declares now, `type` being `prod`, `dev`, `peer` or `optional` by manifest group.
- **Nodes.** A node of the lock keeps its key (`npm:react@19.1.1`, `registry-<slug>-<digest>:…`, `git:…`, `digest:…`, `toolchain:<name>@<version>`, `workspace:<id>`). A declaration the lock does not hold yet is `declared:<name>`; a package the toolchain supplies, and no member provides, is `supplied:<name>@<version>`, never a member or a node of the installed graph; a name a member provides leads to that member's node. `source.kind` is `registry`, `member`, `supplied`, `toolchain` (a release no registry publishes, installed from the archives the Beyond toolchain carries: [local installation](local-installation.md#releases-the-beyond-toolchain-supplies)), `git`, `archive`, `snapshot` or `declared`; a supplied node adds `source.from`: `toolchain` for a Beyond package the toolchain compiles and serves (Widgets, the development runtime), `installation` for a library its installation resolves for a workspace without an installed graph (the Kernel, and frameworks such as React that the supplied packages depend on, the session's `runtime.packages`), with the version installed there. Only a `member` is a package of the workspace and so in development: a supplied package, whatever imports it, is never said to be in development, and a declared name the toolchain supplies leads to the supplied node with its version rather than to an unresolved `declared:` one.
- **Status.** `installed` (the projection locates it), `locked` (the lock holds it, the projection does not), `supplied`, `declared` (nothing resolved it yet) or `missing` (its sources are gone, `SOURCE_MISSING`, or the lock skipped it, an optional dependency that could not be pinned).
- **Edges.** `dependencies` and `dependents` are the lock's edges, with the edges of declarations it does not hold yet; a peer carries the `context` it was provided in, and a skipped optional edge has `key: null` and the reason it was `skipped`.
- **Scope.** `workspace` (every node), `member:<id>` or `node:<key>`: the node, every node it reaches and every node that reaches it, each once, however many paths lead there. At most 5000 nodes are listed; `truncated` says when the scope holds more.
- **Base.** `base.lock` is the revision of the lock file's bytes (`absent` without one, so any change of the file is seen) and `base.inputs` the canonical digest of the declaration's inputs (`Declaration.inputs`: what every manifest declares). A plan is made against a base, and refused once the workspace left it. `lock.digest` is the digest of the lock's content when its recorded digest is its own.

## Checks

A check reads, for every registry node of the scope and every registry dependency declared and not resolved yet, what the configured provider publishes now. It writes nothing: no lock, manifest, projection or development choice. Each node answers:

| Field | Meaning |
| --- | --- |
| `current` | The version the lock holds, null for a declaration not resolved yet |
| `ranges` | The ranges that select the node: its dependents' edges (an override in their place), or the declarations |
| `wanted` | The highest published version every one of those ranges admits, or null |
| `latest` | The `latest` distribution tag, as the registry answered it |
| `available` | The newest published versions, at most 20, highest first |
| `deprecated` | The deprecation message of the current version, when it has one |
| `registry`, `access` | The registry the settings send the name to, and how it was read: `public` (without a credential), `private` (with one), `denied` (`401` or `403`), `unknown` (no answer tells: an outage, or no such package) |
| `checked`, `error` | When it was read; why it could not be (`PACKAGE_NOT_FOUND`, `PROVIDER_AUTH_REQUIRED`, `PROVIDER_AUTH_DENIED`, `NETWORK_ERROR`, …) |

`counts` gives `packages`, `nodes`, `outdated` (`wanted` above `current`), `behind` (`latest` above `current`), `denied` and `failed`. Every package document is read again, a cached one with a conditional request, through `Installation.releases`. A check is cancellable.

## Preflight

Before an installation is offered, the preflight says for every declaration of every importer which source would provide it:

| `status` | `source` | Meaning |
| --- | --- | --- |
| `available` | `member` | A member provides the name, at a version the range admits (`member`, `version`) |
| `available` | `registry` | A configured registry publishes satisfying versions (`version`, the highest; `satisfying`, how many; `registry`, `access`) |
| `blocked` | `member` | `WORKSPACE_RANGE_UNSATISFIED`: a member owns the name, and none satisfies the range |
| `blocked` | `registry` | `VERSION_UNRESOLVED` (nothing published satisfies the range), `PROVIDER_AUTH_REQUIRED` or `PROVIDER_AUTH_DENIED` (the registry refused) |
| `blocked` | `supplied` | `PACKAGE_NOT_FOUND`: only the toolchain supplies it to live development (`finding.supplied`); no configured registry publishes it, so an installed graph and a clean CI machine cannot use that source |
| `available` | `toolchain` | A version only the Beyond toolchain carries satisfies the range: the installation takes it from the toolchain's archives, which this machine has (a clean CI machine needs the same toolchain bundle) |
| `blocked` | `none` | `PACKAGE_NOT_FOUND`: no member provides it and no configured registry publishes it |
| `unavailable` | `registry` | Whether the registry publishes it cannot be told now (`NETWORK_ERROR`, …) |
| `skipped` | any | An optional declaration that would fail, which an installation skips |
| `unverified` | `unverified` | A git, archive or path source, which the installation checks when it resolves it (`SOURCE_UNVERIFIED`) |

Each blocker has a `finding` with its `code`, a message naming the importer and the range, and `recovery`: the routes on. For a package only the toolchain supplies they are: declare a member that provides it (through `workspaces`, `beyond.workspaces` or the `packages` of `beyond.json`), configure a registry that publishes it, or keep developing without an installed graph, where the development service supplies it. `ready` is true when nothing blocks; nothing is written. This is the case of the suite's React Hello application, which declares `@beyond-js/react-19-widgets ^1.0.0` and `@beyond-js/widgets ^1.1.0`: both are blocked as supplied only, before the installation that would end in `GRAPH_INCOMPLETE` and `PACKAGE_NOT_FOUND` through `workspace:app`.

## Plans

`POST /dependencies/plans` takes `changes`, at most 50 of `{name, importer?, range?, version?}`, and the `base` the inventory answered:

- `range` changes what an importer declares, written to its manifest when the plan is applied: to `importer` when it is given (a name it does not declare yet is added to its `dependencies`), else to every importer that declares the name. The groups written are those that install the name (`dependencies`, `devDependencies`, `optionalDependencies`); `peerDependencies` only when it is the one group that declares it, since a peer range states what a library accepts.
- `version` is an exact release preferred wherever the declared ranges admit it, across the workspace.
- With neither, the name's locked selections are released: the newest release every range admits is chosen.

The plan resolves the whole workspace with `Installation.resolve`, the manifest edits applied in memory, and the lock's releases as preferences except what the changes release: unrelated nodes keep their versions whenever the result stays valid. A requested version is pinned, and a locked version of the same name above it is not offered, so the request wins wherever the ranges admit both. When a peer requirement blocks the change (`PEER_INCOMPATIBLE`, `PEER_MISSING`, or a requested version the graph did not select), the packages whose peer requirement failed are released as well and the workspace is resolved once more; the second resolution is kept only when it has fewer errors, and the packages it released are the plan's `peer` changes (`work.released`).

The operation's result, also kept as `<root>/.beyond/dependencies/plans/<id>.json` (mode `0600`, removed after seven days) and answered by `GET /dependencies/plans/:plan`:

| Field | Meaning |
| --- | --- |
| `id`, `created`, `operation`, `changes` | `pln_<24 hex>`, when, the operation that made it, the changes as requested |
| `base`, `proposed` | The base it was made against; the digest of the lock it would write and of the inputs the workspace will declare |
| `valid` | No finding is an error: the plan can be applied |
| `edits` | `[{member, path, group, name, before, after}]`: `path` is the manifest as a path of the File API, `before` null for an added name |
| `changed` | `[{name, from: {key, version}, to: {key, version}, reason, dependents}]`: a dependent's edge reaches another node, `reason` `requested`, `peer` or `transitive` |
| `added`, `removed` | Nodes only the proposed, or only the current, graph holds, with their reason |
| `preserved` | `{count}`: the external nodes both graphs hold with the same key |
| `diagnostics` | `[{code, message, severity, kind, …}]`, `kind` `version`, `source`, `peer`, `singleton`, `integrity`, `manifest`, `graph` or `resolution` (below) |
| `contexts` | The names the proposed graph holds in several releases, with the importers whose pages reach each |
| `affected` | `members` whose closure differs between the graphs (with those nodes) or whose manifest is edited; `modules`, the public modules those members publish (`count`, at most 200 listed); `targets`, the execution targets whose package is one of them, when the catalog of applications is shared. The served workspace and the catalog are each given 10 s to answer; one that does not, or is not there, is `available: false` (with its `reason`) |
| `work` | `resolution: {milliseconds, requests, attempts}`: the measured resolution, its metadata requests and whether the peers were released |
| `preferences` | What applying the plan resolves with |

**Findings.** Every diagnostic of the resolution, classified (`VERSION_UNRESOLVED`, `PACKAGE_NOT_FOUND`, `PROVIDER_AUTH_DENIED`, `PEER_INCOMPATIBLE`, …), and: `VERSION_NOT_FOUND` (a requested version is not published), `VERSION_NOT_ADMITTED` (published, and no declared range admits it, or a peer requirement keeps another release), `SINGLETON_DUPLICATED` (a warning: one importer's page would load two releases of a package a page holds once, such as `react`, `react-dom`, `vue`, `svelte`, `preact`, `solid-js`, `@beyond-js/kernel`, `@beyond-js/widgets` or `@beyond-js/local-2026`, with whether the current graph already did), `INTEGRITY_MISMATCH` (a release kept under the same key with another integrity), `MANIFEST_INVALID` and `MANIFEST_OUTSIDE_ROOT` (a manifest the plan cannot edit: the File API writes only inside the served root). A page of an importer is what its runtime dependencies reach: no development edge, and a peer only in the context of a node of that page.

Plans and checks are cancellable; a plan made against another base is refused at once (`409 PLAN_STALE` with `details: {base, current}`).

## Applying a plan

`POST /dependencies/plans/:plan/apply {base}` applies a valid plan (`422 PLAN_INVALID` otherwise) whose `base` the request names (`409 PLAN_STALE` otherwise). Applications run one at a time and cannot be cancelled once they started. Steps:

1. **`verify`** reads the workspace again. At the plan's base, the plan is applied. Already at its proposed lock and inputs (an earlier application whose answer was lost), nothing is repeated: `reconciled: true`. With the plan's manifests written and another lock (an application that stopped after its writes), the installation runs again. Anything else is `PLAN_STALE`, and nothing is written.
2. **`write`** reads every manifest through the File API, edits its text where the value is still the one the plan read (other fields, order, indentation, line endings and final newline as they are now, so an edit a person saved meanwhile stays), and writes each with the revision it was read at, as the actor `{sub: 'dependencies', kind: 'service', task: <plan>}`. A file that changed in between is `MANIFEST_CONFLICT`, naming what was written before it.
3. **`resolve`**, **`fetch`**, **`materialize`** are the installation of the edited workspace with the plan's preferences, never with `update`: the inputs must be the plan's (`PLAN_STALE` otherwise), and the lock and the projection are written as every installation writes them. A failed installation writes neither and fails with its own code (`GRAPH_INCOMPLETE`, `SOURCES_INCOMPLETE`, …), naming the manifests already written.
4. **`reload`** reloads the served workspace; one that does not settle is a warning, and the next request that describes the workspace reloads it.

The result gives `written` (paths and revisions), the installation's `lock`, `execution`, `counts` and `diagnostics`, `reloaded`, and `PLAN_DIVERGED` as a warning when the installed lock is not the planned one (a registry published or withdrew a release since). The plan records each application (`application: {operation, state, at, …}`): `running`, with the host that runs it (`owner`), as soon as it begins, then how it ended. An application the service stopped while it ran is `interrupted` with `outcome: unknown` ([long operations](#long-operations)); when the service starts again the feature reads the workspace and records on the plan what it found: `applied`, `not-applied`, `partial` (the manifests were written, the lock was not) or `diverged`. A retry is then decided from that reading, never by repeating blindly. Only a host that finds the one that ran the application gone reconciles it, once: an application another live host runs on the same root (an exclusive `beyond build` beside a person's service) is left as it is, and so is the record of a later application of the plan.

## Long operations

| Kind | Steps (phase) | Counts | Cancellable |
| --- | --- | --- | --- |
| `dependencies.check` | `metadata` (`metadata`), `compare` (`compare`) | packages read of packages to read, the package being read as `current`; nodes compared | Yes |
| `dependencies.preflight` | `declaration`, `metadata`, `evaluate` | declarations; packages read; declarations evaluated | Yes |
| `dependencies.plan` | `draft`, `resolve` (`resolution`), `compare` | edits; metadata requests started, the package asked about as `current`; nodes of the proposed graph | Yes |
| `dependencies.apply` | `verify`, `write`, `resolve` (`resolution`), `fetch` (`download`), `materialize` (`materialization`), `reload` | files written; metadata requests; packages of the external nodes, archives answered as they arrive; nodes located | No |

Counts are of work actually done, never estimated; a step that reports none says since when it runs. An important change (a state, a step's state or phase, the end) is announced as `operation.changed`, which the event log keeps; a count or a current item as `operation.progress {operation}`, the summary of that moment, at most four times a second per operation and never kept, so a client that reconnects reads `GET /operations/:id`. Each record names the host that runs it (`owner`, its process and a token chosen at its start, which no route answers): a starting host marks `interrupted` only what a host that is gone left, and never another live host's work on the same root. A process identifier the system reuses can make a dead host look alive; its work is then put right by a later start. The expectations of each step are the host's measured median and 90th percentile once five runs of the step succeeded, and these written defaults before: check `metadata` 4 s (p90 15 s), `compare` 200 ms; preflight `metadata` 4 s; plan `resolve` 8 s (p90 30 s); apply `resolve` 8 s, `fetch` 10 s (p90 60 s), `materialize` 1 s, `reload` 3 s. An application holds the service for at most 20 minutes, above the installation's own deadline.

## What the installation module gives it

Dependency management uses these compatible extensions of `@beyond-js/packages/installation`:

- `install({preferences, progress})`: `preferences` (a list of `{name, version}`, or any form the resolver accepts as a lock) replace the lock's selections; the workspace is then always resolved, never frozen. With `update` it is `INSTALLATION_OPTIONS_INVALID`, and offline it is `OFFLINE_UNAVAILABLE`. `progress` is told each phase (`resolution`, `download` with the number of external nodes, `materialization`) and each request (`{url, kind: metadata | archive, answered}`).
- `resolve({preferences?, update?, names?, signal?, progress?})`: the graph an installation with the same options would install, the digest of the lock it would write, its diagnostics, the metadata requests and milliseconds it took, and the releases of `names`, without fetching or writing anything. Past the installation's deadline it is `RESOLUTION_TIMEOUT`, aborted through `signal` `RESOLUTION_CANCELLED`, and an unexpected failure `RESOLUTION_FAILED`; it never rejects for one.
- `releases(names, {signal?, progress?})`: for each name once, `{name, found, registry, access, versions, tags, deprecated, checked, error?}`, read through the installation's settings, metadata cache and breaker, within its deadline.
- The installations of one root run one at a time in a process, whichever `Installation` instance asks: the service's installation routes and an application of a plan never write the lock and the projection together.

## Codes

| Code | Where | Meaning |
| --- | --- | --- |
| `SCOPE_INVALID`, `SCOPE_NOT_FOUND` | Inventory, checks | A scope that is not `workspace`, `member:<id>` or `node:<key>`; a member or node the workspace does not have |
| `CHANGES_INVALID`, `BASE_REQUIRED`, `BODY_INVALID` | Plans | A malformed list of changes or base, an unknown field |
| `CHANGE_UNDECLARED` | Plans | A change of a name no importer declares, without an importer and a range to add it; an importer that is not one |
| `PLAN_STALE` | Plans, applications | The lock or the declared dependencies changed since the base was read |
| `PLAN_NOT_FOUND`, `PLAN_INVALID` | Applications | No such plan; a plan with errors |
| `IDEMPOTENCY_KEY_REQUIRED`, `IDEMPOTENCY_KEY_INVALID` | Applications, every operation | `400`: an application without a request identifier; a malformed one |
| `MANIFEST_CONFLICT` | Applications | A manifest changed between its read and its write, or declares something else than the plan read |
| `PLAN_DIVERGED` | Applications (warning) | The installed lock is not the one the plan proposed |
| `VERSION_NOT_FOUND`, `VERSION_NOT_ADMITTED`, `SINGLETON_DUPLICATED`, `INTEGRITY_MISMATCH`, `MANIFEST_INVALID`, `MANIFEST_OUTSIDE_ROOT` | Plans | [Findings](#plans) |
| `SOURCE_UNVERIFIED` | Preflight | A source the preflight does not check |
| `INSTALLATION_OPTIONS_INVALID`, `RESOLUTION_TIMEOUT`, `RESOLUTION_CANCELLED`, `RESOLUTION_FAILED` | Installation module | [Above](#what-the-installation-module-gives-it) |

## Limits

- A `version` change pins a release across the workspace: every importer whose ranges admit it moves, and the plan discloses each one. A per-importer version is expressed with a `range`.
- Manifests outside the served root (a member declared through `beyond.workspaces` elsewhere) are planned and never edited: the plan is invalid with `MANIFEST_OUTSIDE_ROOT`.
- The preflight checks registry ranges and members; git, archive and path sources are resolved only by the installation, and the checks list registry nodes only. Snapshot sources are listed by kind when a lock records them; snapshot identities are not read here.
- The plan measures the resolution, not the compilation that follows an application: which public modules and targets are affected is listed, the outputs they will generate or reuse are not measured.
- The installation routes' own queue (`GET /installation`'s `running`, `queued`) does not see an application; both are serialized by the installation module.
- The duplicated-singleton list is fixed; the catalog of applications is read only when the development extension shares one.

## Validation

`node --test "service/test/*.test.mjs"` runs the feature's units with stand-ins (`dependencies.test.mjs`, `dependencies.plans.test.mjs`, `dependencies.units.test.mjs`). [`tests/dependencies`](../tests/dependencies/README.md) runs the installation module through its public specifier and the feature on the real host against in-process registries, under BEE Node, including the React Hello preflight; [`tests/local-install`](../tests/local-install/README.md) and `tests/cdn-resolution/workspace.test.mjs` keep the installation's own contract.

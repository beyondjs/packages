# Local workspace installation

A local installation turns the declaration of a workspace into a graph that the development service consumes instead of an application `node_modules`. It reads the members a workspace declares (npm `workspaces`, the Beyond extension `beyond.workspaces`, a `beyond.json` or a standalone package), resolves the whole workspace with the resolver of Packages, fetches the external closure into a source store on the user's disk, and writes two documents at the workspace root: the portable lock `beyond-lock.json` (`beyond-lock/2`) and the machine-local execution projection `.beyond/execution.json` (`beyond-execution/1`). The development service then resolves every bare import of a module through the edges of the package that imports it.

The command line's `beyond install` and `beyond run` are the user-facing entry points; they call the routes of the development service described [below](#the-development-service-in-install-mode). This guide is the contract of the Packages side.

```text
Declaration ──► Resolution.workspace ──► Installation ──► beyond-lock.json + .beyond/execution.json ──► Execution ──► development service
 (members)       (beyond-workspace-graph/1)  (fetch into the store)        (portable)       (this machine)     (resolve)      (install mode)
```

| Part | Public identity | Role |
| --- | --- | --- |
| `Declaration`, `Context` | `@beyond-js/packages/service` ([service/workspace](../service/workspace/declaration.mjs), [context.mjs](../service/context.mjs)) | What a root declares: kind, members, diagnostics and the digests of its inputs; which workspace a directory belongs to |
| `Resolution.workspace` | `@beyond-js/packages/resolution` | The graph of the whole workspace |
| `Installation` | `@beyond-js/packages/installation` | Resolve, fetch, then write the lock and the projection |
| `Execution` | `@beyond-js/packages/execution` | Read a projection, decide its state and resolve an import through the importer's edges |
| `FilesystemStore`, `FilesystemMetadataStore` | `@beyond-js/packages/sources`, `@beyond-js/packages/providers` | The source store and the metadata cache of the user |
| The host of the service | `service/host/` | `GET`/`POST /installation` and the install mode of every route |

The earlier installer of a local project (`modules/project/local`) is superseded by `@beyond-js/packages/installation` and kept unchanged as reference; no command or service uses it.

## Declaring a workspace

A directory is a **workspace root** when it holds a `beyond.json`, or a `package.json` that declares `workspaces` (npm's field) or `beyond.workspaces` (the Beyond extension). Any other directory with a `package.json` is a **standalone** package, its own single member `.`.

| Kind | Members |
| --- | --- |
| `npm` | The matches of `workspaces` (an array of patterns, or `{"packages": [...]}`), then the entries of `beyond.workspaces` |
| `beyond-json` | The `packages` of `beyond.json`: literal paths relative to the root, a directory or its `package.json`; an entry that is not a non-empty string, is absolute or leaves the root is skipped with the warning `INVALID_PACKAGE_PATH`. The root alone when `packages` is absent, `null` or `""`; an empty list `[]` declares no member, and nothing reports it |
| `standalone` | The package itself, `.` |

A root that declares members in `beyond.json` and also in `workspaces` or `beyond.workspaces` is `WORKSPACE_CONFIG_CONFLICT`: the two are never merged, and the declaration has no members until one of them is removed.

**Patterns** follow npm's semantics. A leading `./` or `/` is removed and `..` segments leave the root, so a member can stay in its own repository beside the application (`"../repositories/widgets"`). A pattern with an odd number of leading `!` is a negation: it removes the matches of every pattern, except where a later pattern withdraws it, and a pattern it matches is not expanded at all. Nothing inside `node_modules` matches and a wildcard never matches a name that starts with a dot. The root is a member only when a pattern names it: `.`, or a pattern that leaves the root and comes back into it, such as `../*`, which matches the root by its name, as npm's does; a wildcard alone (`**`) never makes it a member. A match is a member only when it holds a `package.json`; a pattern that yields none is the warning `WORKSPACE_PATTERN_EMPTY`. Matches are ordered by pattern, then by path. Wildcards are expanded by Node's `fs.globSync`, which does not descend into a symbolic link that `**` reaches; a pattern without wildcards names one path, link included.

**`beyond.workspaces`** is the labeled Beyond extension for what npm cannot express, a second package of a name another member already has. Its entries are patterns with the same semantics, or objects naming exactly one directory by a path relative to the root (an absolute one is `WORKSPACE_CONFIG_INVALID`), which must exist (`MEMBER_NOT_FOUND`) and whose optional `version` must equal its manifest's (`MEMBER_VERSION_MISMATCH`, the manifest being authoritative):

```json
{
	"private": true,
	"workspaces": ["apps/*", "message"],
	"beyond": { "workspaces": [{ "path": "../message-v2", "version": "2.0.0" }] }
}
```

**Members.** A member is identified by its canonical directory and named by its **id**, the POSIX path relative to the root as declared or matched (`apps/app`, `../message-v2`, `.`), even when that path is a symbolic link to somewhere else. A directory reached twice is one member under its first id. Each member keeps `{id, path, name, version, manifest, source}`. A member needs a string `name` and a `version` in canonical semver form (`1.2.3`, `1.2.3-beta.1`), otherwise `MEMBER_MANIFEST_INVALID`; it stays listed so that a command still knows which package a directory belongs to. One name at two directories inside npm's `workspaces` is `WORKSPACE_NAME_DUPLICATED`, because npm refuses it too: the second version belongs in `beyond.workspaces`. One name and version at two directories, wherever they were declared, is `WORKSPACE_INSTANCE_DUPLICATED` with both paths. Problems never throw: they are diagnostics `{code, message, severity, paths?}`, and the declaration is `valid` when none is an error.

**Inputs.** `Declaration.inputs` are the digests the lock and the projection record, `sha256-` of canonical JSON (keys sorted, no whitespace, undefined omitted):

- `members[id]`: the `name`, `version`, `dependencies`, `devDependencies`, `peerDependencies`, `peerDependenciesMeta` and `optionalDependencies` of that member's manifest;
- `declaration`: the kind, the members' `{id, name, version}` sorted by id, and the root manifest's `dependencies`, `devDependencies`, `peerDependencies`, `peerDependenciesMeta`, `optionalDependencies` and `overrides`, for every kind of root: the `overrides` of a standalone package, or of a root that is a member, are in no member's digest.

Any other field, the order of keys and the order of patterns change no digest.

### Which workspace a command is in

`Context` locates the workspace from a directory, deterministically and without searching the machine:

1. An explicit root (`--workspace`) is that exact directory: a workspace root, else a standalone package when it holds only a `package.json`, else `CONTEXT_WORKSPACE_INVALID`, as for a path that is not an existing directory.
2. Otherwise the nearest ancestor that is a workspace root is the workspace, when the nearest package that contains the directory is one of its members or the root itself. A package below a root that does not declare it is `CONTEXT_NOT_MEMBER`, and a package below a root whose declaration cannot decide its members (`WORKSPACE_CONFIG_INVALID`, `WORKSPACE_CONFIG_CONFLICT`) is `CONTEXT_WORKSPACE_INVALID`. The search skips a `node_modules` directory and the directories directly inside it.
3. Without a workspace root, the nearest package is standalone. No workspace file is written into it; an installation there writes its own `beyond-lock.json` and `.beyond/` beside its manifest. With no `package.json` or `beyond.json` up to the filesystem root, the context is `CONTEXT_NOT_FOUND`, and a starting path that is not an existing directory is `CONTEXT_DIRECTORY_INVALID`.

Apart from the case of rule 2, the context is decided by the files that exist and never fails for what a manifest contains, so that a service can start and the files be corrected through it. A `package.json` that cannot be read declares no workspace and the search goes on above it; the declaration reports it when it is the context's own (`WORKSPACE_CONFIG_INVALID` for the root's, first, then `MEMBER_MANIFEST_INVALID` when the root is also a member). One consequence: while the manifest of an npm root cannot be read, a directory inside one of its members is that member as a standalone package, and an installation there would write the member's own lock and projection.

A member outside its root has no ancestor that declares it: it reaches its workspace only with an explicit root. From its own directory without one, a command uses what that directory's own ancestors declare: the workspace of its repository, or the member alone as a standalone package, whose installation writes its own lock and projection beside its manifest. No machine-wide index of workspaces is kept. `context.declaration` is the `Declaration` of the root.

## The graph: ownership and several versions

`Resolution.workspace(params)` is built on the resolver of `Resolution.pin` and answers a `beyond-workspace-graph/1` document: `members` (the importers by id, each `{name, version, node}`), `nodes`, `edges`, `overrides`, `exceptions`, `diagnostics` and `digest`. It is usable when no diagnostic is an error (`Resolution.valid`), and the same members, root, lock and metadata give the same document and digest whatever order they were given in.

```ts
const graph = await Resolution.workspace({
	root: { manifest },            // the root package.json: its dependency groups and its overrides
	members,                       // [{ id, name, version, path, manifest }]
	lock,                          // a previous lock in any format, offered as preferences
	providers,                     // provider settings, or a metadata source such as an installation's
	update: false,                 // ignore the preferences of the lock
	development: true              // follow the importers' devDependencies, as build edges
});
```

- **Importers.** The graph has a virtual root whose dependencies are the importers: every member, keyed `workspace:<id>`, and the root package as the importer `.` when it is not a member and declares dependencies of its own. When a member is the root (a standalone package, `packages: ['.']`, a pattern naming `.`), it is the only importer of the root, and the root manifest supplies only its `overrides`. A member node is `{name, version, origin: {provider: 'workspace'}, member, visibility: 'public', integrity: null, tarball: null}`, read from its directory and never requested from a provider; an external node keeps the keys and description of `beyond-graph/1` ([the resolution guide](cdn-resolution.md#resolution)).
- **Ownership.** A name that any member provides is owned by the workspace. A plain version or range of it, anywhere in the graph, is satisfied by the members alone: each occurrence takes the highest member version that satisfies its own range (npm semantics: `*` admits any version, prereleases included), so two consumers can use two members of one name. No package document, manifest or archive of an owned name is ever requested, even when a registry publishes a newer satisfying release. A range no member satisfies is `WORKSPACE_RANGE_UNSATISFIED`, naming the consumer, the range and the versions and ids the workspace provides; the registry is not asked instead.
- **`workspace:` specifiers**, as pnpm and yarn write them: `workspace:<range>` selects among the members of the declared name, `workspace:*`, `workspace:^` and `workspace:~` admit any of them, and `workspace:<id>` names one member by id (`workspace:./v1` for an id that would read as a range). A name or id no member provides is `WORKSPACE_PACKAGE_NOT_FOUND`. Only what belongs to the workspace may declare one, an importer (a member or the root) or an override of the root: a `workspace:` specifier that an installed package declares is `SOURCE_UNSUPPORTED`. `Resolution.pin` refuses every `workspace:` specifier, as a root and as a dependency a registry package declares (`SOURCE_UNSUPPORTED`, or `INVALID_SPECIFIER` for a malformed id), without requesting anything for it.
- **Escapes.** An `npm:` alias reaches the registry copy of an owned name under its own node key, and so does a root override whose value is an alias; a version override of an owned name keeps it owned.
- **Peers.** A peer an importer declares is resolved as its own dependency, an edge of kind `peer` without `context`; an optional peer of an importer is not followed. Below an importer the policy of the resolver applies: a peer is provided by the nearest dependent and its edge names that `context`. A shared member reached from two applications that provide two releases of its peer records both contexts and the warning `PEER_CONTEXT_CONFLICT`: one graph may bind it differently per application, and the development service refuses a page that would need both (below).
- **Development dependencies** of the importers are followed (unless `development` is false) as `build` edges, never below them. At an importer a `devDependencies` declaration wins over another group of the same name, as package managers install the top of a project.
- **Instances.** A page registers a package by its name and version, so two nodes with one name and version (an alias reaching the registry copy of a member's release, one release from two registries) are `INSTANCE_NAME_CONFLICT`, an error.
- **Lock preferences.** The lock in any format (`beyond-lock/2`, a `beyond-graph/1` or workspace graph, the entries of the previous lock format, a list of `{name, version}`) keeps the registry releases it pins while they satisfy what is required; workspace nodes are never preferences. `update` ignores them.
- A member without a usable name, version or manifest is `MEMBER_MANIFEST_INVALID` and is no instance, though it still owns its name. Members that are not a list, a member without an id and an id given twice are programming errors that reject.

## The lock: `beyond-lock.json`

The lock is at the workspace root (the package root of a standalone package) and is committed with the project. Protocol `beyond-lock/2`:

```json
{
	"protocol": "beyond-lock/2",
	"inputs": { "declaration": "sha256-…", "members": { "apps/app": "sha256-…" } },
	"members": { "apps/app": { "name": "@lt/app", "version": "1.0.0", "node": "workspace:apps/app" } },
	"nodes": { "npm:react@19.1.1": { "name": "react", "version": "19.1.1", "origin": { "provider": "npm", "registry": "…" }, "…": "…" } },
	"edges": [{ "from": "workspace:apps/app", "to": "npm:react@19.1.1", "kind": "dependency", "range": "^19.0.0" }],
	"overrides": [],
	"exceptions": [],
	"digest": "sha256-…"
}
```

It records the inputs it was resolved from, the importers, every node (`name`, `version`, `origin`, `visibility`, `integrity`, `tarball`, `publication`, `member`, and `access` on a private node only), every edge (`from`, `to`, `name`, `kind`, `range`, `context`, `override`, `skipped`), the overrides and the exceptions, and nothing else: no diagnostic, absolute path, store, credential or readiness. Because `access` is kept on private nodes only, a teammate logged in to a registry and one who is not write the same lock; a login only adds the requests of the anonymous visibility probe during the resolution, a package document and an archive status per release read with it ([visibility and access](cdn-resolution.md#resolution)). `digest` is `sha256-` of the canonical JSON of every other member. The lock is written with sorted keys, arrays sorted by their canonical text, two-space indentation and a final newline, so equal graphs give byte-equal locks, and it is rewritten unless the lock on disk is sound and has the new digest.

A sound `beyond-lock/2` whose `inputs` equal the current inputs and whose members are the declared ones **is** the graph: the installation is frozen, no resolution runs and no metadata is requested. Sound means the shape the projection must have (every member names a `workspace:<id>` node, every edge and context names a node of the lock, a workspace key belongs to the `workspace` provider) and a recorded digest equal to the one recomputed from the content. Any other readable content (another protocol, the previous format, a lock recorded for other inputs) is offered to the resolution as preferences, without a warning. The warning `LOCK_UNREADABLE` is reported only for a file that cannot be read, is not JSON, or is a `beyond-lock/2` document that is not sound; the workspace is then resolved again, with the selections of an unsound `beyond-lock/2` still offered as preferences, and none from a file that could not be parsed.

## The execution projection: `.beyond/execution.json`

The projection maps the lock to this machine. Protocol `beyond-execution/1`: `root` (the canonical workspace root), `lock` (the digest of the lock it was built from), `inputs`, `store` (the root of the source store), `members` and `nodes` as in the lock with an absolute `location` each (a member's directory; the `files/` directory of a verified source in the store), `edges`, and `written` (ISO-8601). Every location is a real path, symbolic links resolved, and consumers compare real paths on both sides. The projection names absolute paths and is never committed: the installation writes `.beyond/.gitignore` (`*`) when the directory has none.

It is written only after every node's sources are available. The lock and the projection are first written to temporary files of `.beyond/`, flushed, and then put in place with one rename each, the lock first: a reader finds the previous content of a file or the new one, never a part, and a failed installation never leaves a projection that claims sources it does not have. `Execution.read(root, {inputs, locations})`, given the declaration's inputs and the canonical directory of each member by id, decides its state:

| State | Diagnostic | Meaning |
| --- | --- | --- |
| `ready` | | Written from the current lock and inputs, and every location exists |
| `missing` | `EXECUTION_GRAPH_MISSING` (warning) | No projection: the workspace was never installed |
| `stale` | `EXECUTION_GRAPH_STALE` (warning), `details.changed`: `declaration`, `member:<id>`, `lock` | The declaration, a member manifest or the lock changed since it was written. The lock is compared by the digest of its content, so a lock edited without updating its own digest is a change, and an absent lock counts as changed |
| `incomplete` | `SOURCE_MISSING` (error) per node | The sources of a node are no longer at their location; it wins over `stale` |
| `incompatible` | `EXECUTION_GRAPH_INCOMPATIBLE` (error) | Unreadable, not JSON, another protocol, written for another root, naming a node, member or context it does not hold, or locating something where it may not be: an external node outside its place in the store (`<store>/<scope>/<origin>/<name>/<version>/<integrity>/files`, `established` for a source that published no integrity), a member's node apart from the member, or a member at another directory than the one declared now (`details.changed`: `member:<id>`, such as another checkout with the same manifest) |

`ready`, `stale` and `incomplete` return the `Execution`; every diagnostic tells the person to run `beyond install`. `Execution.from(data, root)` applies only the structural checks to a document already in memory.

## Installing

```ts
import { Installation } from '@beyond-js/packages/installation';

const installation = new Installation({ root, members: declaration.members, inputs: declaration.inputs, manifest: declaration.manifest });
const report = await installation.install({ update: false, offline: false });
```

The parameters are the canonical `root`, the `members` (`{id, name, version, path, manifest}`), the `inputs` recorded as given, the root `manifest` of an `npm` or `beyond-json` workspace, and optionally `store`, `metadata`, `providers`, `transport` (every metadata and archive request goes through it), `limits`, `deadline` and `logger`. The sequence is:

1. Read the lock. Frozen when it is sound, covers the inputs and `update` is not set.
2. Unless frozen, `Resolution.workspace` with the lock as preferences, the importers' development dependencies and the metadata cache of the user. A graph with an error is `GRAPH_INCOMPLETE`, with the resolution's diagnostics, and nothing is written.
3. Fetch every external node with `Sources.fetch` (tenant `local`, the user's `FilesystemStore`): a member is already on disk and is never fetched, and git exceptions travel with their nodes. A source that cannot be fetched is `SOURCES_INCOMPLETE`, with each node's diagnostic (`SOURCE_STORE_UNAVAILABLE` with its cause code when the store itself fails), and nothing is written.
4. Locate every node: a member at its declared directory, an external node at its place in the store. A node without sources there (`MEMBER_NOT_FOUND`, `SOURCE_MISSING`) is `SOURCES_INCOMPLETE`, and nothing is written.
5. Write the lock when it differs from the one on disk, then the projection. A write that fails is `INSTALLATION_WRITE_FAILED`, and its message says what landed: nothing, or the new lock without the new projection, which then reads as stale.

The deadline (`deadline`, else `BEYOND_INSTALL_DEADLINE`, else 540000 ms) bounds the resolution and the fetching, up to the start of the writes: past it the answer is `INSTALLATION_TIMEOUT` at once, the requests still running are aborted, and nothing is written. Once the writes started the deadline no longer interrupts them, so the report always says what is on disk. A provider that fails at the network level is not asked again during that installation, so an unreachable registry costs one timeout, not one per package. `install()` never rejects for a failure of the installation: an unexpected one is `INSTALLATION_FAILED`. Its report (`beyond-installation/1`) is `{protocol, valid, frozen, lock: {path, digest?, written}, execution: {path, written}, counts: {members, nodes, fetched, reused}, diagnostics}`, where `valid` means no error and a projection written, `lock.digest` is that of the lock now at its path, `counts.members` counts the importers (the root importer included), `counts.nodes` every node, and `fetched` and `reused` the external sources. Graph warnings such as `PEER_CONTEXT_CONFLICT` pass through on success. The projection is rewritten by every valid installation.

### Store, metadata and settings

| What | Location |
| --- | --- |
| Source store | `store`, else `BEYOND_SOURCES_DIR`, else `sources` in the cache directory `env-paths` gives the name `beyond-js` (`beyond-js-nodejs` under the user's cache, such as `~/Library/Caches` on macOS or `~/.cache` on Linux). Layout: `<store>/<scope>/<origin>/<name>/<version>/<integrity>/{source.json,files/}`, with `<scope>` `public` or `org/local` |
| Metadata cache | `metadata`, else `BEYOND_METADATA_DIR`, else `metadata` in the same cache directory. `FilesystemMetadataStore`: one record per key at `<root>/<2 hex>/<62 hex>.json` (`beyond-metadata/1`, the SHA-256 of the key), keeping the scope, the document and its `etag`/`lastModified` validators, readable by its owner only; user information in any address is removed before writing, and credentials never reach it |
| Lock | `<root>/beyond-lock.json` (`Execution.LOCK`), committed |
| Projection | `<root>/.beyond/execution.json` (`Execution.PATH`), this machine only, with `<root>/.beyond/.gitignore` |

The store and the cache are shared by every workspace of the user: a second project reuses the stored sources while keeping its own graph, and a source is stored once per scope, origin, name, version and integrity. A source is verified before it is published and is found again only while its `source.json` and `files/` are both present, so a source whose files were removed is fetched again. The metadata cache is a convenience: a record that cannot be written, or a cache directory that cannot be used, never fails a resolution, which goes on with a memory cache and the warning `METADATA_CACHE_UNAVAILABLE`. A source store whose root cannot be created or read fails the installation instead (`INSTALLATION_FAILED`, naming the directory and the code of the cause), and nothing is written. When the installation runs in the development service, these variables are read by the service's process, which inherits the environment of the command that started it.

Provider settings are read as npm reads them, over `{workspace: root, path: root}`: the project, workspace, user and global rc files and the environment (`NPM_REGISTRY`, `NPM_TOKEN`, `NPM_SCOPE_<scope>`, …), unless the `providers` options disable a source. The providers are created on first use: a frozen installation whose sources are public and already stored loads no settings and makes no request, and one with private stored sources loads the settings to authorize them and still makes no request. A private release is cached and stored for the tenant `local`; a public one is fetched without any credential. A resolution revalidates each package document it reads with a conditional request against the cached validators, so only a frozen installation is free of metadata requests.

### Offline and update

- `offline`: only a frozen installation whose sources are all in the store succeeds. Inputs the lock does not cover, and `update`, are `OFFLINE_UNAVAILABLE` before any work; the transport refuses every request, so a node missing from the store is `OFFLINE_UNAVAILABLE` naming it. Nothing is written either way.
- `update`: the workspace is resolved again without the lock's preferences, newer satisfying releases are selected and the lock is rewritten when it changed.
- A changed manifest makes the projection `stale` without changing anything it served. The next installation resolves with the lock as preferences, so the locked external releases stay while they still satisfy what is declared, and new requirements are added.

### Concurrency and recovery

The calls of one `Installation` run one at a time, and so do the installations of one development service, each reading the declaration when its turn comes; one service runs per workspace, so the `beyond install` commands of one workspace never overlap. The store is shared across processes: a source is written in a stage, `<store>/.staging/source-*` marked as such, and published by renaming its directory; when another process published the same source meanwhile, its copy is kept and the stage discarded, and a stage that vanished before its commit is never recreated (`SOURCE_STORE_UNAVAILABLE`, cause `STAGE_LOST`). A stage that is not open in this process and has not changed for longer than the download timeout (120 s by default, `limits.timeout`) was abandoned by a process that ended mid-download: once per installation it is moved aside with one rename and then deleted, so a live download is never half-deleted. Metadata records are replaced atomically, the last writer winning. Two processes that install one workspace outside a service are not coordinated: the lock and the projection are each replaced whole, by the last of them.

A failure before the writes leaves the previous lock and projection byte for byte; one between the two renames leaves the new lock beside the previous projection, which then reads as stale. Either way the next installation fetches only what is still missing.

## Consuming the projection

```ts
import { Execution } from '@beyond-js/packages/execution';

const locations = Object.fromEntries(declaration.members.map(({ id, path }) => [id, path]));
const { execution, state, diagnostics } = await Execution.read(root, { inputs: declaration.inputs, locations });
const from = execution.instance(packageDirectory);           // 'workspace:apps/app'
const { key, node, error } = execution.resolve(from, 'react'); // 'npm:react@19.1.1', with node.location
```

`Execution.from(data, root)` validates a document already in memory and throws an error with the code `EXECUTION_GRAPH_INCOMPATIBLE`; `Execution.PATH` is `.beyond/execution.json`. An instance exposes `state`, `diagnostics`, `root`, `lock`, `inputs`, `store`, `written`, `members` (id → `{id, name, version, node, location}`), `nodes` (key → node with `key` and `location`, members included), `node(key)`, `find(name, version?)`, `instance(path)` (the node whose location is exactly that directory), `edges(from)` and `resolve(from, name, context?)`. Nodes are frozen.

`resolve` never guesses by name. A node resolves its own name to itself. Otherwise the importer's edges for that name decide (an alias edge by its declared name): the edge whose `context` is the given context, then the edge without a context, then a target every edge agrees on. Anything else is `PEER_CONTEXT_AMBIGUOUS`, with the candidates in `details`; a name the importer's edges do not provide, or only through a skipped optional edge, is `DEPENDENCY_NOT_INSTALLED` ("… imports …, which its graph does not provide: declare it and run beyond install"). Serving, which walks a page's graph, binds a peer by the chain of instances that reached the importer instead: for each of them, nearest first, an edge of exactly that context wins; only when none of them matches, the edge without a context; then a target every edge agrees on; otherwise `PEER_CONTEXT_AMBIGUOUS`. A shared member whose own peer edge has no context therefore takes, in a page reached through an application, the release that application provides. The classification of an artifact's dependencies, which compiles a package once, binds without a context. The type check resolves without a context first and, on `PEER_CONTEXT_AMBIGUOUS`, retries with the nodes that reached the importer in that program, nearest first.

## The development service in install mode

The host reads the `Declaration` of the root when it starts and at every reload, and the projection with the current inputs and member directories. It gives the Packages `Workspace` the members (all kinds of declaration, each by its id at its own directory, outside the root included) and, when the projection is `ready`, `stale` or `incomplete`, the `Execution`: that is **install mode**. A `missing` or `incompatible` projection is no installed graph, and the workspace is served as one that was never installed, which `/state` and `GET /installation` report.

- **No fallback.** In install mode no package the toolchain supplies is added (the development runtime, Widgets and its adapters must be members or nodes of the graph), installed packages are located only by their nodes (never from the workspace's directories, the toolchain's installation or the working directory), and declarations and `@types` packages are resolved only through the importer's edges. Without an installed graph, a supplied package whose name a member provides is not added either: the workspace wins.
- **One runtime per page.** A module imports its runtime (the Kernel's `@beyond-js/kernel/bundle` family, or the package its bundler's `runtime` setting names, with the Kernel identities mapped to it) without necessarily declaring it. In install mode every runtime import of one document resolves to the runtime instance of the page: the instance the edge of the page's entry package selects for that name, else the only instance of that name in the graph, else `RUNTIME_NOT_INSTALLED` ("… is the runtime of …; declare it in the application … and run beyond install"). A document without an entry, such as the workspace-wide resolution documents, uses the only instance or is refused (`422 BUILD_FAILED` with a `RUNTIME_NOT_INSTALLED` diagnostic); in the preview such a module is unresolved, with the diagnostic. The toolchain's runtime is never used in its place.
- **Imports follow edges.** `Workspace.imports.resolve(specifier, importer, context?)` answers the member or external node the importer's edge reaches (`DEPENDENCY_NOT_INSTALLED`, `PEER_CONTEXT_AMBIGUOUS`, or `EXECUTION_GRAPH_STALE` for an edge to a member the workspace no longer has or whose directory now holds another release); each of these is an error of the importing module's build. The dependencies of an artifact are classified by those edges: a member is a workspace dependency checked against that instance, with the range declared under the name it is imported by (an alias included) or the override the edge records, and an external node is an external dependency with its exact version, key and location. A lookup without an importer is `IMPORTER_REQUIRED`. Without a projection, a name that several members hold resolves to none of them (`PACKAGE_AMBIGUOUS`), never to the first.
- **Several versions are instances.** `PACKAGE_DUPLICATED` is one name and version at two directories; a selector of a name held in several versions needs the version (`name@version/subpath`), otherwise `PACKAGE_AMBIGUOUS` lists them.
- **Addresses.** The registry of an installed package's address is its node's provider, read from the projection and not from any package manager's lockfile: npm and the workspace unprefixed, another registry as `/m/<registry id>/…`, and a git or archive source has no address (`SOURCE_UNSUPPORTED`). A request for a release that is no node of the graph from the registry it names is `PACKAGE_NOT_FOUND` (`VERSION_MISMATCH` when that registry provides another version of the name), and a member requested under a registry is `PACKAGE_NOT_FOUND`. Every node of the graph is served by the service, members included, never routed to a CDN origin. Installed packages are compiled from their node's location, cached under their node key.
- **Documents and the preview.** `/resolution.json`, `/importmap.json` and the preview walk the edges of the instances: transitive imports follow the node that was located, a peer is bound in the context of the instances that reached the importer, and the development runtime's coordinator is the one of the page's runtime instance. One import map holds one address per importer and specifier, so a document whose graph would bind one instance to two releases of a peer is refused: the resolution documents with `422 BUILD_FAILED` and `PEER_CONTEXT_AMBIGUOUS` diagnostics, the preview with `409 PEER_CONTEXT_AMBIGUOUS`. A bare `?entry=` that several local versions publish is `409 PREVIEW_ENTRY_REQUIRED` with their versioned specifiers, and the workspace-wide documents give such a specifier no top-level entry, only the scopes of its importers.
- **Failures stay where they are.** A store package that does not build, or whose sources are missing, is never served: the preview lists it `unresolved` with its diagnostic (`BUILD_FAILED`, `SOURCE_MISSING`), while a member that does not build keeps its address, as in development. An import with no address (`DEPENDENCY_NOT_INSTALLED`, a git or archive source, a store failure) is mapped in its importer's scope to a module that throws `[beyond preview] <code>: "<specifier>" has no address: <reason>`, so the page fails at that import instead of loading another importer's release. The workspace-wide resolution documents cannot carry such an address: they answer `422 BUILD_FAILED` with the specific diagnostics whenever any import of the workspace has none, instead of omitting it, while each application's preview is affected only when its page reaches such an import. A stylesheet selected by specifier follows the same edges and never falls back to the disk, the toolchain or a CDN.
- **Stale and incomplete.** A stale projection is still served with its diagnostics, so a new import is `DEPENDENCY_NOT_INSTALLED` until the next installation; a node of an incomplete one is `SOURCE_MISSING` where it is needed.
- **Reloads.** The manifests the host compares before describing or resolving the workspace include the members outside the root or behind links, the member list of a fresh declaration, `beyond-lock.json` and `.beyond/execution.json`, so an installation, a manual edit of either document or a member that a pattern now matches reloads the workspace.

| Route | In install mode |
| --- | --- |
| `GET /installation` | `{state, diagnostics, declaration: {kind, valid, members: [{id, name, version}], diagnostics}, lock: {path, digest}, execution: {path, nodes, written}, running, queued}`, read from disk now; `digest` and `written` are null when absent, `running` says whether an installation runs and `queued` how many wait |
| `POST /installation` | Sent as `Content-Type: application/json`: any other media type, or none, is `415 CONTENT_TYPE_UNSUPPORTED`. On the loopback address a `Host` that is not a loopback name with the service's port is `403 HOST_REFUSED`, and an `Origin` other than the one the request was addressed to is `403 ORIGIN_REFUSED`, so a page of another site cannot install through the developer's browser. The body is `{update?, offline?}`; an empty body means no options, and a body that is not a JSON object, an unknown option, a value that is not a boolean or more than 16 KiB is `400 OPTION_INVALID`. Installations run one at a time: a request that does not get its turn within `BEYOND_INSTALL_QUEUE_TIMEOUT` (120000 ms) is `503 UNAVAILABLE` and never runs. Once it has its turn the declaration is read again, and an invalid one is `422 DECLARATION_INVALID` with its diagnostics; a request queued behind a long installation can therefore be answered `503` before its declaration is read. The workspace is reloaded when the projection was written, and the answer is `200` with the report, valid or not; a reload that does not settle adds a warning and is retried by the next request. An installation holds the service while it runs, within its deadline and 30 s more for its writes: a client that stops waiting, such as an interrupted command, does not end the service under it. The answers of `/installation` carry no cross-origin headers |
| `GET /state` | Adds `installation: {state, diagnostics}`, the declaration's diagnostics first in `diagnostics`, and `packages: [{name, version, source, node, location}]`, where `source` is `workspace`, `supplied`, `store` or `installation` (a runtime package a Node consumer resolves from the toolchain) |
| `GET /session` | `service.extensions` lists the loaded extensions; `runtime.packages`, what a Node consumer resolves from the toolchain, holds only the toolchain's own runtime (`@beyond-js/kernel`) when the graph does not provide it, and none of the libraries that only the supplied adapters needed; a specifier that several local versions publish is keyed by each versioned specifier |
| `GET /selection` | A module that builds for browsers only answers `200 {selected, browser: true, preview, modules, failures}`, its graph checked for browsers and `preview` the relative address of its preview, or null without the development extension |

The client is `Connection.installation()` (bounded by `BEYOND_REQUEST_TIMEOUT`) and `Connection.install({update, offline, signal})`, bounded by `BEYOND_INSTALL_TIMEOUT` (900000 ms by default, above what one request may take on the service: the queue, the installation's deadline, the 30 s allowed for its writes and the reload, 810 s by default). A refusal is a `ContractError` (`DECLARATION_INVALID`, `OPTION_INVALID`, `UNAVAILABLE` for a request that never got its turn), whose outcome is known: nothing was installed. No answer in time, or a connection that ended before its answer, is a `TimeoutError` (`SERVICE_NOT_ANSWERING`, `outcome: 'unknown'`), because the installation may have been carried out; `GET /installation` tells. A connection that was refused is no installation at all. The caller's `signal` stops the wait and closes the connection, never the installation, which goes on holding the service: an `AbortError` (`REQUEST_ABORTED`) with `outcome: 'unknown'` once the request was sent. `Service.acquire` does not reuse a running service that lacks an extension the caller names, since a service never gains one after its start: a service that ends with its clients is replaced once it has stopped, and one still in use, held by its owner or still ending is `SERVICE_EXTENSIONS_MISSING` ([the service guide](service.md#embedding-the-service)).

In delegated mode (a Workspace project environment), the development extension's guard requires `inspect.read` for `GET` and `HEAD /installation`, `files.write` for `POST` and any other method of that path, since an installation writes the committed lock and `.beyond/` in the working copy and makes registry requests, and `artifacts.read` for the resolution documents, whatever the case of the path or a trailing slash ([access](development-contract.md#access)).

## Codes

| Code | Severity | Where | Meaning |
| --- | --- | --- | --- |
| `WORKSPACE_CONFIG_CONFLICT` | error | Declaration | Members declared in `beyond.json` and in `package.json` |
| `WORKSPACE_CONFIG_INVALID` | error | Declaration | A field, entry or configuration file that cannot be used |
| `WORKSPACE_PATTERN_EMPTY` | warning | Declaration | A pattern matches no package |
| `INVALID_PACKAGE_PATH` | warning | Declaration | A `beyond.json` entry that is not a non-empty string, is absolute or leaves the root: skipped |
| `MEMBER_NOT_FOUND` | error | Declaration, installation | A directory named exactly does not exist or holds no `package.json` |
| `MEMBER_VERSION_MISMATCH` | error | Declaration | A `beyond.workspaces` entry asserts a version its manifest does not have |
| `MEMBER_MANIFEST_INVALID` | error | Declaration, graph | No string `name` or no canonical semver `version` |
| `WORKSPACE_NAME_DUPLICATED` | error | Declaration | One name twice in npm's `workspaces` |
| `WORKSPACE_INSTANCE_DUPLICATED` | error | Declaration | One name and version at two directories |
| `CONTEXT_NOT_MEMBER` | `ContextError` | Context | A package below a root that does not declare it |
| `CONTEXT_WORKSPACE_INVALID` | `ContextError` | Context | An explicit root that is not an existing directory or holds neither file, or a package below a root whose declaration cannot decide its members |
| `CONTEXT_NOT_FOUND` | `ContextError` | Context | No `beyond.json` or `package.json` from the directory up |
| `CONTEXT_DIRECTORY_INVALID` | `ContextError` | Context | The starting path is not an existing directory |
| `WORKSPACE_RANGE_UNSATISFIED` | error | Graph | No member satisfies a range of an owned name |
| `WORKSPACE_PACKAGE_NOT_FOUND` | error | Graph | A `workspace:` specifier of a name or id no member provides |
| `INSTANCE_NAME_CONFLICT` | error | Graph, serving | Two nodes with one name and version |
| `LOCK_UNREADABLE` | warning | Installation | The lock cannot be read, is not JSON, or is a `beyond-lock/2` document that is not sound: it is not the graph, and the workspace is resolved again |
| `GRAPH_INCOMPLETE` | error | Installation | The graph has errors, or cannot be projected |
| `SOURCES_INCOMPLETE` | error | Installation | A source could not be fetched |
| `OFFLINE_UNAVAILABLE` | error | Installation | Offline without a covering lock, or a source not in the store |
| `INSTALLATION_WRITE_FAILED` | error | Installation | The lock or the projection could not be written |
| `INSTALLATION_FAILED` | error | Installation | An unexpected failure, reported instead of a rejection; also a source-store root that cannot be created or read |
| `INSTALLATION_TIMEOUT` | error | Installation | The installation exceeded its deadline; nothing was written |
| `SOURCE_STORE_UNAVAILABLE` | error | Installation | The source store failed while fetching a node, with the cause's code (`STAGE_LOST` for a stage removed under it) |
| `METADATA_CACHE_UNAVAILABLE` | warning | Installation | The metadata cache could not be written or used; a memory cache served the resolution |
| `EXECUTION_GRAPH_MISSING` | warning | Projection | Not installed |
| `EXECUTION_GRAPH_STALE` | warning (projection), error (imports) | Projection, imports | In the projection, a warning: inputs or lock changed. In imports, an error of the importer's build: an edge to a member no longer in the workspace, or whose directory now holds another release |
| `EXECUTION_GRAPH_INCOMPATIBLE` | error | Projection | Unusable projection |
| `SOURCE_MISSING` | error | Projection, installation, serving | A node's sources are not at their location |
| `DEPENDENCY_NOT_INSTALLED` | error | Imports | The importer's edges do not provide the name |
| `IMPORTER_REQUIRED` | error | Imports | With an installed graph, a name looked up without its importer: nothing is resolved by name |
| `PEER_CONTEXT_AMBIGUOUS` | error | Imports, documents, preview | A binding no context decides, or two bindings one page cannot hold |
| `RUNTIME_NOT_INSTALLED` | error | Documents, preview | The runtime a module imports has no instance the page can use |
| `PACKAGE_AMBIGUOUS` | error | Selection, imports | A name held in several versions, without a version or a graph |
| `PACKAGE_DUPLICATED` | error | Selection, imports, assets | One name and version at two directories, which cannot be told apart |
| `PREVIEW_ENTRY_REQUIRED` | `409` | Preview | A bare entry that several local versions publish |
| `PREVIEW_ENTRY_NOT_FOUND` | `404` | Preview | No public module of that specifier |
| `PREVIEW_SOURCE_UNSUPPORTED` | diagnostic | Preview | A git or archive source, which has no address |
| `DECLARATION_INVALID` | `422` | `POST /installation` | The declaration has errors, read once the request has its turn |
| `OPTION_INVALID` | `400` | `POST /installation` | A body that is not a JSON object, an unknown option, a value that is not a boolean, or more than 16 KiB |
| `CONTENT_TYPE_UNSUPPORTED` | `415` | `POST /installation` | A request not sent as `application/json` (any other media type, or none) |
| `ORIGIN_REFUSED`, `HOST_REFUSED` | `403` | `POST /installation` | Another origin, or on the loopback address a name that is not a loopback one |
| `UNAVAILABLE` | `503` | `POST /installation` | The request did not get its turn within the queue bound; it never ran |
| `UNAVAILABLE` | warning in the report | `POST /installation` | The installation was written and the service did not reload the workspace yet; the next request that describes it reloads it (a reload failure with a code of its own reports that code) |
| `SERVICE_EXTENSIONS_MISSING` | `ServiceError` | `Service.acquire` | The running service lacks a requested extension and is still in use |

The command line adds its own (`PREVIEW_UNAVAILABLE` for a browser module without the development extension). Fetch diagnostics (`INTEGRITY_MISMATCH`, `PROVIDER_AUTH_REQUIRED`, …) and resolution diagnostics (`VERSION_UNRESOLVED`, `PEER_MISSING`, …) are those of [the resolution guide](cdn-resolution.md).

## Limits

- **Node consumers.** A Node consumer (BEE Node) of an installed workspace resolves workspace modules from the service and nothing installed: `runtime.packages` lists no package of the graph, so a Node import of an external package of the graph fails instead of loading the toolchain's copy. Installed packages are delivered to browsers only. Node consumers do not resolve per importer either: a specifier that several local versions publish is in the session under each versioned specifier only, so in Node one version of a name is usable, and a bare import of a name held in several versions fails.
- **One page, one binding per instance.** A release bound to two peer contexts within one page, or one name and version from two locations, is refused (`PEER_CONTEXT_AMBIGUOUS`, `INSTANCE_NAME_CONFLICT`, `WORKSPACE_INSTANCE_DUPLICATED`): the compiled-module contract has no instance qualifier, and a runtime registers a package by its name and version. Load each application through its own preview.
- **No store garbage collection.** Sources and metadata records accumulate; only abandoned stages are removed.
- **Editors.** No `node_modules` is created, so an editor's TypeScript service does not find the installed packages or their types. The service's own type check resolves them through the graph, and `GET /declarations/<specifier>` serves the declarations of workspace modules only.
- **Type check of several instances.** A program holds one ambient declaration per public specifier: when it reaches two instances of one name through the same specifier text (not through an alias), the first declared answers for both. A declaration of the store that imports a member's name is typed only when the program read that member's declaration.
- **Sources a browser cannot be given.** A git or archive URL dependency installs, but has no address for the service to serve (`SOURCE_UNSUPPORTED`, `PREVIEW_SOURCE_UNSUPPORTED`).
- Git and archive URL sources in a workspace and installations of one workspace from several processes at once outside a service are implemented through the shared providers, sources and atomic writes, and are not exercised by the validations below; registries with credentials are exercised against fixture registries only. No Workspace project environment runs an installation.

## Validation

`tests/local-install` validates the contracts of this guide with Node's test runner under BEE Node, against in-process fixture registries only ([its guide](../tests/local-install/README.md)): `resolution.test.mjs` and `resolution.peers.test.mjs`, `installation.test.mjs` and `installation.failures.test.mjs`, `stores.test.mjs`, `execution.test.mjs`, `workspace.test.mjs` and `workspace-types.test.mjs`, `serving.test.mjs` and `serving.walk.test.mjs`, `service.test.mjs` and the acceptance of the owner's criteria in `acceptance.test.mjs` (discovery, installation, consumption) and `recovery.test.mjs` (freshness, offline limits and failures); `tests/cdn-resolution/workspace.test.mjs` compares the lock with what `Resolution.pin` gives CDN and checks that nothing of a workspace enters CDN's path. The declaration, the context and the host are unit-tested with `node --test "service/test/*.test.mjs"`. The behavior of an installed toolchain (`beyond install`, `beyond run` and a browser) is accepted by the command line's `install` group and the `local-install` case of its `web` group, never by these files.

```sh
cd "$PACKAGES_DIR"
node --test "service/test/*.test.mjs"
BEE_URL=http://localhost:1112 node --import "$BEE_NODE_DIR/register.mjs" tests/local-install/<file>.test.mjs
# service.test.mjs also needs the watchers service: WATCHERS_URL=http://localhost:1120
```

Executed on 2026-10-05 against this checkout, served by a freshly started bootstrap Engine: `tests/local-install` 140/140 in its 13 files (`resolution` 13, `resolution.peers` 10, `installation` 10, `installation.failures` 9, `execution` 13, `stores` 9, `workspace` 9, `workspace-types` 7, `serving` 12, `serving.walk` 8, `service` 8, `acceptance` 16, `recovery` 16), the service unit tests 156/156 and `tests/cdn-resolution/workspace.test.mjs` 5/5.

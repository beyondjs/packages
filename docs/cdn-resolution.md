# Package resolution and source fetching for published builds

A published build starts with two stages that Packages supplies and CDN orchestrates: pinning the package/version graph of an application, and bringing every pinned package into durable storage. This guide describes the two public modules that implement them, the dependency graph and providers they are built on, the policies they apply and how their validation is run. The [CDN contract](cdn-contract.md) states the requirements; the [source audit](reviews/2026-09-19-cdn-readiness.md) records the defects this work repaired.

| Public module | Role |
| --- | --- |
| `@beyond-js/packages/resolution` | `Resolution.pin()` resolves roots into a `beyond-graph/1` document. It reads provider metadata only |
| `@beyond-js/packages/sources` | `Sources.fetch()` downloads, verifies and publishes every package of a pinned graph into a store |
| `@beyond-js/packages/dependencies/graph` | The package/version graph both the resolution and the installer of a local project use |
| `@beyond-js/packages/providers`, `…/providers/settings` | Requests to registries and git hosts, their settings, credentials and metadata cache |
| `@beyond-js/packages/dependency-source` | Reads a version specifier: range, alias, git reference or archive URL |

Neither stage analyses code. Which public modules an application reaches is decided later, over sources that are already durable.

## Resolution

```ts
import { Resolution } from '@beyond-js/packages/resolution';

const graph = await Resolution.pin({
	roots: { '@acme/shop': '1.4.0' }, // or [{ name, range, kind?, targets? }]
	targets: ['web'],
	overrides: { '@acme/cart': { '@acme/money': '1.0.7' } },
	lock: previous, // a previous beyond-graph/1 document, a list of {name, version}, or a project lock file
	providers: { values: { default: { registry: 'https://registry.npmjs.org' } } },
	tenant: 'acme',
	store, // optional IMetadataStore shared between resolutions; memory by default
	development: false, // follow the development dependencies of the roots as build dependencies
	passes: 25
});

if (!Resolution.valid(graph)) report(graph.diagnostics);
```

`pin()` returns the document specified by the `beyond-graph/1` schema of the CDN contracts: `roots` (each with the key of the node that satisfies it), `nodes` keyed `provider:name@version` with `origin`, `visibility`, `integrity` and `tarball`, `edges`, `overrides`, `lock`, `exceptions`, `diagnostics` and `digest`. Failures are returned as diagnostics with a `severity`; the call rejects only on a programming error. The document has no validity flag because the schema fixes its members: a graph is usable when none of its diagnostics is an error, which is what `Resolution.valid()` answers.

- **Node key and origin.** `origin.provider` is `npm`, `github`, `gitlab` or `bitbucket` for those providers. Any other registry or host gets an identifier derived from its address plus a short digest of it (`registry-127-0-0-1-4873-npm-1a2b3c4d`), so two addresses never share a key prefix. `origin.registry` is the normalized base address and never carries credentials.
- **Visibility.** `private` when the provider is reached with credentials, `public` otherwise.
- **Integrity and archive.** Taken from the `dist` of the release (`dist.integrity`, or `dist.shasum` as a `sha1-` value when that is all the registry publishes) and `dist.tarball`. A registry release without either is the error `RELEASE_DIST_MISSING`.
- **Edges.** `kind` is `dependency`, `peer`, `optional` or `build`. `range` is what the dependent declares; `override` is the selection that replaced it. `name` is present when it differs from the target (an alias) or when there is no target. A peer edge carries the `context` node. An optional dependency that could not be pinned is an edge with `to: null`, `name` and `skipped`, plus a warning.
- **Exceptions.** One `manifest-fetch` entry per release whose manifest required its own request because its provider publishes no package metadata (git hosts, and registries whose package document lists versions without their manifests).
- **Digest.** `sha256-` of the canonical JSON (members sorted by key, no whitespace) of the document without `digest`. Arrays are emitted sorted, so equal inputs give an equal digest whatever order they were given in.

The resolution requests one package document per package and nothing else. Its validation counts the requests a registry receives by type and asserts that no archive and, for a registry with full metadata, no manifest is requested.

Provider settings given as plain options are isolated from the host: the rc files of the user, the global rc file and the environment are read only when the options ask for them (`user`, `global`, `env`), so the credentials of whoever runs the service never reach the graph of a tenant.

## Sources

```ts
import { Sources, FilesystemStore } from '@beyond-js/packages/sources';
import { PackageProviders } from '@beyond-js/packages/providers';

const store = new FilesystemStore(root); // absolute path
const report = await Sources.fetch(graph, store, { compressed: 64 << 20 }, 'acme', new PackageProviders(settings));
// { protocol: 'beyond-sources/1', graph, complete, packages: [{ node, key, scope, integrity, bytes, extracted, entries, reused }], diagnostics }
```

`fetch(graph, store, limits?, tenant?, authorizer?)` deals with every node of the graph in one call and returns when all of them are done; it never fetches progressively. For each node it looks the source up in the store and reuses it (`reused: true`, no request); otherwise it downloads the archive the graph pinned, and publishes it only after every check passed. `complete` is true only when every node is in the store. The fifth parameter is whoever knows the credentials (`authorize(package, url)`, implemented by `PackageProviders`); it is required for private packages only.

- **One pass over the bytes.** The compressed stream is hashed and counted while it is decompressed and extracted into a stage of the store. The compressed size (also refused from a declared `content-length` before reading), the extracted size (refused from the declared size of an entry before it is inflated) and the number of entries are enforced during streaming, and the transfer is aborted at the first excess.
- **Integrity before publication.** The digest (`sha512`, `sha384`, `sha256` or `sha1`; the strongest declared) is compared when the stream ends. The stage is committed only then; on any refusal it is discarded, so the store never holds a partial or unverified source.
- **Entries.** Only regular files are written; directories are skipped. Links, devices and every other entry type are `ENTRY_UNSUPPORTED`. Absolute paths, backslashes, null bytes and any `..` segment are `ENTRY_UNSAFE`; the name is never normalized to make it acceptable. The first path segment is the archive root and is removed.
- **Scope.** A source is stored as `public` or as `org:<tenant>`. It is private when the graph says so **or** when a credential was attached to the download, whatever the graph says; a private source without a tenant is `TENANT_REQUIRED`. The scope is part of every lookup and never part of the key, so a tenant cannot find the private source of another, and an authorized second tenant downloads its own copy.
- **Exceptions.** A node without published integrity is accepted only if the graph lists it in `exceptions`; its `sha512` is then computed at fetch and reported with `established: true`. Otherwise it is `INTEGRITY_MISSING`.

### Store

`IStore` is the injected interface: `has(record)`, `get(record)`, `put(record)` (opens a stage), `commit(stage, source)` (atomic publication) and `discard(stage)`. A record is `{key, scope, origin, name, version, integrity}` with `key = origin/name/version/<algorithm>-<hex digest>`. `FilesystemStore` keeps `source.json` and the extracted `files/` under `<root>/<scope>/<origin>/<name>/<version>/<integrity>/`, writes in `<root>/.staging` and publishes by renaming the directory, which is atomic within one filesystem. An adapter for object storage implements the same five members.

Default limits, all overridable: 64 MiB compressed, 256 MiB extracted, 20000 entries, 120 s per download, 6 simultaneous downloads. They admit the largest packages in common use while stopping an abusive archive early; they are engineering defaults, not product limits.

## The dependency graph

`DependenciesGraph(project, options)` resolves in passes. A pass walks the dependencies in name order with the versions the previous pass selected, and an occurrence met for the first time takes the best version for its own range. When the pass ends, every requirement of each package is grouped at once and the versions are selected again. The resolution is settled when a pass confirms the versions it was walked with.

- **Occurrences and releases.** A `Node` is one occurrence: a package required by one dependent. Its identity is the path of declared names from the root, so repeated occurrences of one package never overwrite each other in the registry, and registering and unregistering use the same key. A release is expanded once, by the first occurrence that reaches it; the others link to it. This is the visited guard: a cycle reaches a release an ancestor already claimed, links to it and stops.
- **Groups.** Occurrences of a package share a group when at least one published version satisfies all of their ranges (`^1.0.0` and `~1.2.0` share `1.2.5`). Each range is tested on its own, so alternatives (`^1 || ^2`) intersect correctly. Grouping is recomputed from all occurrences in a canonical order (best version of each range, then range, then occurrence), never incrementally, so it does not depend on the order requirements were met in. Disjoint ranges give several groups and several nodes. A range nothing satisfies is `VERSION_UNRESOLVED`, naming the package, the range and the number of published versions.
- **Completion.** `processed` means the resolution settled; `completed` (and `valid`) additionally require that no required occurrence failed. A failed occurrence is processed, so it can never yield a completed closure. `Closure` judges failures: one reached only through optional dependencies, or an optional peer, is tolerated and recorded; the same failure reached through a required dependency is blocking, whichever occurrence expanded the release.
- **Bounds.** Each pass starts from a clean registry, which bounds what a changing version invalidates. After `passes` passes (25 by default) the graph fails with `GRAPH_UNSETTLED` instead of looping. Processing flags are reset in `finally` blocks, so a failure never leaves a node being processed.

### Policies

These are engineering defaults with their rationale. Each is configurable or replaceable without changing the document format.

| Policy | Rule | Rationale |
| --- | --- | --- |
| Peers | A peer is not installed by the package that declares it. It is provided by the nearest dependent, from the direct dependent up to the root, that depends on it or is it. Its range constrains the group of the provider when the intersection allows it, so `react@*` with a renderer that requires `^18.3.1` selects 18. The edge records the `context`. An unmet required peer is `PEER_MISSING` or `PEER_INCOMPATIBLE`; an optional peer without provider is tolerated | One shared instance is what a renderer and its library need at runtime. Installing peers automatically would hide a conflict that must be visible before publishing |
| Peer context of the root | The root of an application is not a node. When the root selections provide the peer, `context` is the root selection the requirement was reached through | The schema requires a node key as context |
| Development dependencies | Never followed below the root. Those of the root are followed only with `development: true`, as `build` edges. The installer of a local project requests them | They build or test a package; its consumers do not execute them |
| Optional dependencies | A failure is recorded (`to: null`, `skipped`, warning) and does not invalidate the graph | The declaring package states it works without them |
| Overrides | Applied to every requirement, with the most specific (deepest) rule winning: `"foo": "1.0.0"`, `"foo@^2": "2.1.0"`, `"bar": {"foo": "1.0.0", ".": "2.0.0"}` and `"$foo"`. Defaults to the `overrides` of the root manifest | The semantics package managers give the field |
| Lock | While a pinned release satisfies the intersection of a group it is selected instead of a newer one. `process({update: true})` ignores the lock | Same lock and inputs give the same graph after new versions are published |
| Kind precedence | A name declared in several groups is `optional` over `main` over `peer` over `development` | A regular dependency makes the package its own; an optional declaration replaces a regular one |
| Aliases | `npm:target@range` resolves, caches and keys the target package; the declared name stays on the edge | Target identity is what sharing and storage depend on |
| Git | The reference is pinned to a commit: a full hash as is, anything else through the GitHub commits API. Another host with a branch or tag is `SOURCE_UNSUPPORTED`. The node version is `<manifest version>+git.<commit>`, its manifest fetch is an exception and its integrity is established at fetch | Nothing is pinned to a placeholder, and the key stays a valid exact version |
| Archive URLs | Require their integrity as the URL fragment (`#sha512-…`), else `INTEGRITY_REQUIRED`. The node version is `0.0.0-url.<digest prefix>`. Their dependencies are unknown until fetched: none is pinned, with the warning `URL_DEPENDENCIES_UNKNOWN` | Content is the only identity a URL has |

## Providers and settings

`Endpoint` normalizes a registry address once: scheme, lowercased host, non-default port and path prefix, without credentials, query or trailing slash. Package documents, manifests and the check that an archive URL belongs to the registry all derive from it; `registry` (`host[:port][/prefix]`) is the identity that cache records and release identities use.

Settings precedence, from highest to lowest: explicit `values` > database of a CDN project > environment variables > project rc > workspace rc > user rc > global rc > built-in default. Environment variables rank above rc files, as the settings guide of the module and package managers do; this is the rule implemented and tested. Each rc file is its own layer, so a broader file cannot overwrite a more specific one, and a higher source replaces a lower one key by key.

- Every `ProvidersSettings` instance owns its state. There is no shared default object, so settings of two tenants loaded in one process never mix.
- The location of the global rc file is asked to the package manager and awaited. `user`, `global` and `env` accept a path, an object or `false` to control or disable each source.
- `NPM_REGISTRY` is accepted with or without scheme and never receives a second one.
- A credential declared for `//host:port/prefix/` applies to that host, port and prefix only, found by the most specific match. Credentials without a host apply to the default registry only. `${NAME}` references in rc values are expanded.
- Credentials are attached to a URL only when it belongs to the provider they were declared for. They never follow an archive URL to another host.

`Metadata` wraps `PackageProviders` with the cache. A record is keyed by scope, document kind, registry identity, package and release; the scope is `public` for anonymous providers and `org:<tenant>` (or, without a tenant, a digest of the credential) for authenticated ones. Writes are awaited, concurrent requests of one document share a single fetch, and release manifests are read from the package document. `IMetadataStore` (`get`, `set`) is the injected storage; `MemoryMetadataStore` is the default, and a local project uses the local database.

No credential reaches a diagnostic, a log line, a URL, a cache key or a returned document. Failures to load settings are reported without their cause, because the cause may quote a settings file.

## Validation

The checks run under BEE Node against the implementation served by the bootstrap Engine, as described in the [stage-1 validation](../tests/stage-1/README.md). They start their own npm-compatible registries in process (`node:http`, custom port and path prefix, one of them requiring a bearer token) that serve generated package documents and real gzipped archives, and count the requests they receive.

```sh
cd "$PACKAGES_DIR"
BEE_URL=http://localhost:1112 WATCHERS_URL=http://localhost:1120 \
  node --import "$BEE_NODE_DIR/register.mjs" tests/cdn-resolution/index.mjs
BEE_URL=http://localhost:1112 WATCHERS_URL=http://localhost:1120 \
  node --import "$BEE_NODE_DIR/register.mjs" tests/cdn-sources/index.mjs
```

Each check prints `PASS` or `FAIL`, the run ends with `N/N passed` and the exit code reflects it. Set `CDN_CONTRACTS_DIR`, or `CDN_DIR` (its `contracts` directory is used), to also validate every usable graph against the `beyond-graph/1` JSON Schema; without them that check prints `SKIP` and the rest runs. The schema check uses `ajv`, which is present in the installation as a transitive dependency and is not yet declared by this package.

`tests/cdn-resolution` covers cycles, diamonds, intersection, several versions, reordered inputs, peers and their context, optional failures, development dependencies, overrides, lock reuse, missing packages, unresolvable ranges, the pass limit, the object model of the graph, aliases, git and archive URLs, request counts, manifest-fetch exceptions, address normalization, settings precedence, scoped credentials, a private registry, tenant isolation of cached records and the absence of secrets. `tests/cdn-sources` covers fetching a whole graph, reuse without download, durability after the origin is lost, refused graphs, corrupt and substituted archives, compressed and extracted size, entry count, traversal, absolute paths and links, interrupted and unavailable transfers, authentication failures, storage scope, tenant isolation, secrets and established integrity.

## Limits

- The schema requires every root to have a node and at least one node. A resolution that fails at a root is still returned with its diagnostics, but that document cannot validate; consumers must test `Resolution.valid()` before validating or persisting a graph.
- The schema restricts names to lowercase. A legacy registry package with uppercase letters in its name resolves, but its document does not validate.
- A release is one node whatever peers it was given. When two dependents provide different releases for the same peer of one release, every context is recorded and `PEER_CONTEXT_CONFLICT` warns; the node is not split per context.
- `overrides` in the document keep the package name, the selection and the innermost `within`. A range selector (`foo@^2`) and deeper nesting are applied but not represented.
- A tolerated failure below an optional dependency leaves that dependency in the graph with a warning; it is not removed as a package manager would.
- Distribution tags (`latest`) and `file:` specifiers are `INVALID_SPECIFIER`. Targets are recorded on the roots and are part of the digest; they do not yet filter optional dependencies by platform.
- Git references other than a full commit are pinned only on GitHub. Private GitHub archives are served by a different host than the one credentials are declared for, so they are requested anonymously.
- The database settings loader and the local-project adapters (`project/local`: metadata cache in the local database, downloader over `Sources`, lock entries with `dist` and provider) are repaired in source but were not executed: they depend on the persistence modules, which load through the legacy runtime only. `project/cdn` is an unfinished stub that does not compile and was left as found.

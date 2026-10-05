# Installation and execution fixtures

Checked-in workspaces, registry releases and documents that `tests/local-install/execution.test.mjs`, `installation.test.mjs` and `installation.failures.test.mjs` exercise. Their harness, `tests/local-install/support/installation.mjs`, copies what a test needs to a unique temporary directory and never writes these files; it reads a copied workspace with the service's own `Declaration` (`service/workspace/declaration.mjs`), so the inputs an installation records are the real ones. Run any of them from the Packages directory under BEE Node, with the bootstrap Engine serving this implementation:

```sh
node --import "$BEE_NODE_DIR/register.mjs" tests/local-install/execution.test.mjs
node --import "$BEE_NODE_DIR/register.mjs" tests/local-install/installation.test.mjs
node --import "$BEE_NODE_DIR/register.mjs" tests/local-install/installation.failures.test.mjs
```

`tests/local-install/stores.test.mjs` (the metadata cache and the source store) needs no fixture of its own: its records and files are a few inline values, and its last two tests install `workspace/` as `installation.test.mjs` does, with the store, the metadata cache and the workspace reached through symbolic links in the last one.

## `workspace/` and `registry/`: what an installation installs

`installation.test.mjs`, through its harness `support/installation.mjs`, copies `workspace/` to a temporary directory and publishes the releases of `registry/` to the in-process registry of `tests/cdn-resolution/registry.mjs` (each directory is one release: its `package.json` is the manifest, every other file goes into the archive below `package/`).

| Path | Content |
| --- | --- |
| `workspace/package.json` | An npm workspace, `workspaces: ["app", "widgets"]` |
| `workspace/app/` | `@fixture/app@1.0.0`: `@fixture/widgets` (`^1.0.0`, a member), `lib-a` (`^1.0.0`), and `lib-dev` as a development dependency |
| `workspace/widgets/` | `@fixture/widgets@1.0.0`: `lib-b` (`^1.0.0`) |
| `registry/lib-a@1.0.0/` | Depends on `lib-c` (`^1.0.0`) |
| `registry/lib-b@1.0.0/`, `registry/lib-c@1.0.0/`, `registry/lib-dev@1.0.0/` | No dependencies |
| `registry/lib-c@1.1.0/` | Published during a test only, to show that a frozen installation keeps `1.0.0` and an update selects `1.1.0` |

What the tests expect of it: two importers and six nodes (both members, `lib-a`, `lib-b`, `lib-c`, `lib-dev`), four packument requests and four archives on a first installation, and no request at all for `@fixture/widgets`, which the workspace owns. The tests change a copy with short inline edits (a dependency on `lib-missing`, which the registry does not have; an added `lib-c` to change the inputs; a lock edited, reordered or made unsound; a `.beyond` that is a file; a store or cache under a file or without write permission) and make the registry misbehave with its faults (`corrupt`, `truncate`), point at an address nothing answers, or at an inline server that accepts connections and never answers; the fixture itself has no invalid part.

## `projection/`: a hand-written execution projection

What an installation leaves behind, written by hand so that `Execution` is tested independently of the installation that normally produces it. Nothing is fetched: the integrities and archive URLs of the external nodes are placeholders.

| Path | Copied to | Content |
| --- | --- | --- |
| `workspace/` | `<tmp>/workspace`, the workspace root | An npm workspace (`workspaces`: `app`, `legacy`, `widgets-v1`) with the labeled Beyond extension `beyond.workspaces` naming a second `@fixture/widgets` outside the root, and its `beyond-lock.json` (`beyond-lock/2`) |
| `outside/widgets-v2/` | `<tmp>/outside/widgets-v2` | `@fixture/widgets@2.0.0`, the member outside the root (id `../outside/widgets-v2`) |
| `store/public/npm/<name>/<version>/sha512-<hex>/files/` | `<tmp>/store/…` | The external sources, where a `FilesystemStore` keeps them (the hexadecimal of each node's placeholder integrity): `react` 19.1.1 and 18.3.1, `react-dom`, `scheduler`, `some-ui`. A projection read from disk that locates an external node anywhere else is incompatible |
| `execution.json` | `<tmp>/workspace/.beyond/execution.json` | The `beyond-execution/1` projection of that lock. `${ROOT}`, `${OUTSIDE}` and `${STORE}` are replaced by the three directories of the run, the only substitution |

The projection is not kept under a `.beyond/` directory because this repository ignores those as generated output.

What the graph models, which the tests rely on:

- `@fixture/app` uses `@fixture/widgets@2.0.0` (outside the root), `react@19.1.1`, `react-dom@19.1.1`, the alias `react-legacy` of `react@18.3.1`, `some-ui`, and an optional `fsevents` that was skipped (an edge without a target).
- `@fixture/legacy` uses `@fixture/widgets@1.0.0`, `react@18.3.1` and `some-ui`.
- Each widgets member declares `react` as a peer, resolved for itself without a context, as an importer's peers are.
- `some-ui@1.0.0` is one release reached from both applications: its peer `react` is bound to 19.1.1 in the context of `workspace:app` and to 18.3.1 in the context of `workspace:legacy`. Without a context its binding is ambiguous (`PEER_CONTEXT_AMBIGUOUS`).
- `react-dom@19.1.1` has one peer context only, so its `react` resolves without one; `scheduler` is in the graph but no edge of `@fixture/app`, so the application importing it is `DEPENDENCY_NOT_INSTALLED`.

The lock's `digest` and the projection's `lock` are the `sha256-` of the canonical JSON (object keys sorted, no whitespace) of the lock without its `digest` member, and must stay equal: a test that finds the copied projection `stale` with `changed: ['lock']` before editing anything means they drifted. After editing the lock, recompute the digest with the resolver's canonical form and write it into both files:

```sh
node --import "$BEE_NODE_DIR/register.mjs" --input-type=module -e "
import { readFileSync } from 'node:fs';
import { Canonical } from '@beyond-js/packages/resolution';
const { digest, ...lock } = JSON.parse(readFileSync('tests/local-install/fixtures/installation/projection/workspace/beyond-lock.json', 'utf8'));
console.log(Canonical.digest(lock));"
```

The `inputs` of the lock and of the projection are the digests of the declaration and of each member manifest, computed by the contract's rule; the execution tests treat them as opaque recorded values.

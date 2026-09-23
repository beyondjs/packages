# Baseline validation: local execution capabilities

Validates what Packages provides for local execution, as described in [the local execution guide](../../docs/local-cli-baseline.md): the artifact guarantees, the authoring forms a package can use to declare its public modules, and how a selector becomes a public module. Each case builds its own temporary workspace with the public workspace and artifact services, and executes artifacts in a separate Node process, as a consumer does.

## Run

Prerequisites are those of [the stage-1 validation](../stage-1/README.md) (the bootstrap Engine serving this implementation and BEE Node), without the watchers service: nothing here watches, and the suite testbed is never read or edited.

```sh
cd "$PACKAGES_DIR"
BEE_URL=http://localhost:1112 node --import "$BEE_NODE_DIR/register.mjs" tests/cli-baseline/index.mjs [defects|declarations|selection]
```

Expected: `22/22 steps passed` (4 artifact guarantees in `defects`, 14 declaration cases in `declarations`, 4 selector and standalone cases in `selection`). A group name runs that group alone.

| File | Established |
| --- | --- |
| [defects.mjs](defects.mjs) | A consumer reads the value of a default export; export names that collide with the update closure keep their values and `hmr` is `EXPORT_RESERVED`; an undeclared dependency leaves no file and no import map entry; a failed rebuild removes the previous files of the module, and the correction restores execution |
| [declarations.mjs](declarations.mjs) | Each of the six authoring forms builds and executes on its own; `exports` define the published root and `main` does not restore it; a `main` that is not a source warns `MAIN_NOT_SOURCE`; root conditions, patterns and fallback arrays are `EXPORTS_UNSUPPORTED`; a manifest without an entry, a package without bundlers and a module without a selected bundler are reported |
| [selection.mjs](selection.mjs) | Selector forms, qualified and shorthand resolution in a workspace, a duplicated package name and a standalone package without `beyond.json` |
| [fixtures.mjs](fixtures.mjs), [runner.mjs](runner.mjs) | The temporary workspaces (a copy of a checked-in fixture, or a small description written by a check) and the build and consumer process |

## Fixtures

Every checked-in workspace under [`fixtures/`](fixtures) is copied by `Fixture.copy()` into a temporary directory whose name contains a space on purpose, and removed at the end of its case; the checked-in files are never written. Manifests are tab-indented without a final newline, byte-identical to what the former inline descriptions wrote.

| Fixture | Packages and entry modules | Intended behavior |
| --- | --- | --- |
| [`forms/exports-only`](fixtures/forms/exports-only) | `form-exports`: `./greet` → `greet/index.ts` | `exports` alone, no module manifest and no platforms: one platform-neutral conditional satisfies the node request |
| [`forms/manifest-only`](fixtures/forms/manifest-only) | `form-manifest`: `greet/module.json` names its `entry` | No `exports`: the manifest is discovered under `beyond.modules` |
| [`forms/combined`](fixtures/forms/combined) | `@form/combined`: `./utils/greet` | `exports` locate the entry point; `utils/greet/module.json` adds the platforms and selects the bundler |
| [`forms/root-exports`](fixtures/forms/root-exports) | `@form/root`: `.` → `src/index.ts` | The `.` subpath publishes the package name itself |
| [`forms/root-string`](fixtures/forms/root-string) | `form-string`: `"exports": "./src/index.ts"` | The string shorthand of the root entry |
| [`forms/root-main`](fixtures/forms/root-main) | `form-main`: `"main": "src/index.ts"` | Without `exports`, a source-valued `main` publishes the root |
| [`defects`](fixtures/defects) | `@case/shared` (`./value`) and `@case/app` (`./main` → [`main/index.ts`](fixtures/defects/app/main/index.ts), importing `@case/shared/value`, with the dependency declared) | The two dependency cases. The undeclared case removes `dependencies` from its copied `app/package.json`, the one substitution, and expects `DEPENDENCY_NOT_DECLARED`. The stale case writes an unterminated string into its copy, then a manifest without exports, and restores `app` from the fixture to prove recovery |
| [`selection`](fixtures/selection) | `@example/app@1.2.3` (`./main`, `.`) and `tools@1.2.3` (`./main`, `./utils/text`) | Two packages that publish the same subpath, a root module and a nested subpath; `tools` has no root module on purpose |

Each form's module exports `form` and a default function naming the form, which is what its execution asserts. The form fixtures are the examples the authoring-forms table of [the local execution guide](../../docs/local-cli-baseline.md#authoring-forms) describes; change them together.

### Inputs that stay inline

Small invalid or single-purpose inputs are written by their checks, because each isolates one refusal or one lookup and is shorter than its assertion: the declaration precedence case, a `main` that is not a source, the three unsupported `exports` shapes, a manifest without an entry, a package without bundlers and one without a selected bundler (all in `declarations.mjs`); the default-export and reserved-name packages and the short invalid edits of the stale case (`defects.mjs`); the two packages with one name and the standalone package without `beyond.json` (`selection.mjs`).

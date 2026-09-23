# Semantic diagnostics validation

Validates `@beyond-js/packages/diagnostics`, the capability that type-checks one public module with a real TypeScript program. The guide of the capability is [CDN diagnostics](../../docs/cdn-diagnostics.md).

The run copies the checked-in workspace [`fixtures/workspace`](fixtures/workspace), described [below](#fixtures), into a temporary directory and removes that copy when it ends. It edits nothing in the repository and starts no process.

## Prerequisites

Node 22.21.1 or later, Engine and BEE Node configured as in the [stage-1 validation](../stage-1/README.md), and a bootstrap Engine serving the Packages implementation (ports 1110–1112). The group that compares the check with generation creates a workspace without a watcher, so the watchers service is not used.

## Run

From the Packages directory:

```sh
cd "$PACKAGES_DIR"
BEE_URL=http://localhost:1112 WATCHERS_URL=http://localhost:1120 \
  node --import "$BEE_NODE_DIR/register.mjs" tests/cdn-diagnostics/index.mjs
```

Expected: every step prints `PASS …` and the run ends with `24/24 passed` (exit code 0). A failure prints its assertion and the run continues, so one report shows every outcome.

## What each file checks

- [semantic](semantic.mjs): `ts.transpileModule`, with the options of the TypeScript processor, accepts a value of the wrong type and a call that does not match a signature declared in another file, and the check reports them as `TS2322` and `TS2345` with the file relative to the package and the exact range; a clean module has no diagnostics; a syntax error is reported by both; sources supplied in memory; the declared configuration and its own problems.
- [dependencies](dependencies.mjs): the types of a bare public dependency supplied as a package of Beyond sources, as a declaration, through a `node_modules`-like root and as a compiled package; a public module of the same package; without types, one `types-unresolved` warning and no false error, including implicit `any` reports and missing platform types; a location outside the package is never read.
- [generation](generation.mjs): on a live workspace, `Delivery.module()` delivers the module whose types are wrong and refuses the one that does not parse, and `Diagnostics.module()` describes a workspace module for the check.
- [bounds](bounds.mjs): the file and time limits, the time limit acting inside the type checker, cancellation before and during a check, requests that cannot be checked, the measured cost, and the absence of any host location in every result of the run.
- [harness](harness.mjs): how a step is run and reported, and the temporary copy of the fixture.

## Fixtures

`fixtures/workspace` is a workspace authored with the model Packages compiles. `beyond.json` names two packages, `shared` and `app`; the other directories are inputs a check supplies explicitly. Every public module of `app` is an `exports` entry whose target is its entry point, and each isolates one behavior of the check:

| Location | Entry and relevant files | Intended behavior |
| --- | --- | --- |
| `app` (`@fixture/app@1.0.0`, TypeScript bundler) | [`package.json`](fixtures/workspace/app/package.json) declares the dependency on `@fixture/shared` | The package under check |
| `app/broken` | [`index.ts`](fixtures/workspace/app/broken/index.ts), `geometry.ts` | **Intentionally wrong types** in valid syntax: a string assigned to a number (`TS2322`) and a call that does not match the signature declared in `geometry.ts` (`TS2345`). Transpilation accepts both |
| `app/clean` | `index.ts`, `format.ts` | No diagnostics |
| `app/syntax` | `index.ts` | **Intentionally unparsable**: reported by transpilation and by the check |
| `app/consumer`, `app/misuse`, `app/derived` | `index.ts` each | Import `@fixture/shared/message`: correct use; a wrong use that is only an error when the dependency's types are known; a genuine implicit `any` beside one that exists only while the dependency has no types |
| `app/rooted` | `index.ts` | Types of `@fixture/typed`, found through `typed/node_modules`; one intentional `TS2322` |
| `app/compiled` | `index.ts` | Types of the compiled package `store/compiled`, through a `types` condition and a pattern; one intentional `TS2322` |
| `app/own` | `index.ts` | Imports another public module of its own package by its public specifier; one intentional `TS2322` |
| `app/platform` | `index.ts` | Needs Node's platform types, which the fixture does not install on purpose |
| `app/escape` | `index.ts` | Imports `../../outside/secret`, a location the check must never read |
| `app/large` | `index.ts` re-exporting `part-0.ts` … `part-11.ts` | Thirteen sources, for the file limit, the time limit and cancellation. These are ordinary files; nothing in them depends on being generated |
| `app/configured` | `index.ts`, [`tsconfig.json`](fixtures/workspace/app/configured/tsconfig.json) | **Intentionally broken configuration**: it extends a file that does not exist, which is an options diagnostic |
| `shared` (`@fixture/shared@1.0.0`) | [`message/index.ts`](fixtures/workspace/shared/message/index.ts) | The package of Beyond sources `app` depends on |
| `typed/node_modules/@fixture/typed` | `index.js`, `index.d.ts` | A `node_modules`-like root with a package that ships declarations. It is checked in: the repository's `.gitignore` re-includes this one `node_modules` directory by name |
| `store/compiled` (`@fixture/compiled@2.0.0`) | `dist/tool.js` with `tool.d.ts`, `dist/features/alpha.js` with `alpha.d.ts` | An extracted compiled package |
| `declared/message.d.ts` | | A loose declaration file standing for `@fixture/shared/message` |
| `outside/secret.ts` | | What `app/escape` reaches for; it must never be read |

The JSON manifests are tab-indented without a final newline, byte-identical to what the former inline generator wrote. The semantic checks read the expected source of a file from the checked-in fixture (`Fixture.source()`) to locate a diagnostic in it.

### Generated inputs that stay generated

- **The time limit inside the type checker** ([bounds](bounds.mjs), `limits: the time limit stops the type checker in the middle of a source`) builds one source in memory, `heavy/index.ts`, and supplies it through `sources`, so nothing is written to disk. It is a chain of 900 generic functions, each spreading the result of the previous one (`step<N><T extends { id: number }>(value: T)` returning `{ ...step<N-1>(value), field<N>: N }`). The size is the behavior under test: the source must take long enough to check (more than 30 ms) that a limit of a quarter of the checking time stops the checker inside it. The count, 900, is the only parameter. To inspect the source, evaluate the `chain` expression of that step in Node and write `chain.join('\n')` to a file.
- **Sources supplied in memory** ([semantic](semantic.mjs), `sources supplied in memory replace those of the package`): a one-file edit of `clean/format.ts`, kept inline as a short edit.

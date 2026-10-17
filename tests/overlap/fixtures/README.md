# Overlap fixtures

The workspace `overlap.test.mjs` copies into a temporary directory and compiles with the `ts` bundler for Node; nothing here is edited.

| Package | Public modules | What it shows |
| --- | --- | --- |
| `@fixture/shared` | `./main` (`main/index.ts`) and `./math` (`main/math.ts`), two `exports` entries in one directory | `index.ts` imports `./math` relatively and records its evaluation; `math.ts` records its own; `leftover.ts` is a file of the directory that no entry imports. Each module shares its directory with the other: `./main` holds `./index` and `./math`, `./math` holds `./math` alone, neither holds `./leftover`, and both warn `MODULES_SHARE_DIRECTORY` |
| `@fixture/own` | `./lib` (`lib/index.ts`) | A directory of its own: `helper.ts`, which the entry does not import, is still an internal module of `./lib`, and nothing is warned |

The top-level statements push to `globalThis.evaluations` when a consumer defines it; the test reads the composition of the artifacts, which decides what a consumer evaluates.

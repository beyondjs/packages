# Source map fixtures

The workspace `maps.test.mjs` copies into a temporary directory and compiles with the `ts` bundler; nothing here is edited.

| Package | Public module | What it shows |
| --- | --- | --- |
| `@fixture/maps` | `./math` (`lib/math.ts`), which imports `./format` (`lib/format.ts`) | `fail` throws `new Error(…)` at line 3, column 8 of `lib/math.ts`: the inline map of the artifact, for Node and for browsers, must map that expression there and name both sources by their absolute paths |

# import.meta fixtures

The workspace `meta.test.mjs` copies into a temporary directory and compiles with the `ts` bundler; nothing here is edited.

| Package | Public module | What it shows |
| --- | --- | --- |
| `@fixture/meta` | `./hot` (`hot/index.ts`, which imports `./half`) | `import.meta` in statement positions (`export const url = import.meta.url`, `import.meta.hot?.data`, `if (import.meta.hot)`): it builds for Node and for browsers, its creator declares `__beyond_meta` from the artifact's `import.meta` with the `hot` the runtime gives it, the creator of `./half` declares nothing, and its declaration type-checks `import.meta.hot` |
| | `./plain` (`plain/index.ts`) | No `import.meta`: no creator declares anything |
| | `./reserved` (`reserved/index.ts`) | Invalid on purpose: it declares `__beyond_meta` itself, refused with `NAME_RESERVED` at line 2 |
| | `./typo` (`typo/index.ts`) | Invalid on purpose, for its types only: `import.meta.hott` builds, and its declaration fails with `TS2551`, which suggests `hot`: the types conditional checks `ImportMeta`, and declares `hot` |

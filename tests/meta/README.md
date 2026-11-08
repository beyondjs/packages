# import.meta validation: what a `ts` source may write

Validates that a source of a `ts` module may use `import.meta` in any position (audit F6: before, `const url = import.meta.url` failed the build with `ANALYSIS_ERROR: Parse error`, because a creator body is CommonJS and its analysis refuses `import.meta` outside call parentheses). The transpilation replaces it with `__beyond_meta`, which the envelope of that source's internal module declares from the artifact's `import.meta` with the `hot` the runtime gives the creator ([Meta](../../modules/bundlers/ts/processors/ts/meta.ts), [the runtime artifact contract](../../docs/architecture.md#runtime-artifact-contract)); a source that writes the name itself is refused; and the program of the `types` conditional declares `ImportMeta.hot`. See [the fixtures](fixtures/README.md).

```sh
BEE_URL=http://localhost:1112 node --import "$BEE_NODE_DIR/register.mjs" --test tests/meta/meta.test.mjs
```

Prerequisites: an Engine serving this implementation, as for [stage 1](../stage-1/README.md); no watcher. Expected: 5 tests pass.

What `import.meta.hot` does once the artifact runs is the development runtime's (`local-2026`, `tests/hot.test.mjs`), and in a running program the command line's `updates` acceptance group.

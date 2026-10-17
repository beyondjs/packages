# Source map validation: what a stack trace of a compiled module names

Validates that the inline map of a `ts` module, built for Node and for browsers, names every source by its absolute path and maps the code of the artifact back to the line and column of the source, so a stack trace remapped with it (`node --enable-source-maps`, a debugger, a coverage tool) names `lib/math.ts:3:8` rather than the compiled module's address. See [source maps and test files](../../docs/architecture.md#source-maps-and-test-files) and [the fixtures](fixtures/README.md).

```sh
BEE_URL=http://localhost:1112 node --import "$BEE_NODE_DIR/register.mjs" --test tests/maps/maps.test.mjs
```

Prerequisites: an Engine serving this implementation, as for [stage 1](../stage-1/README.md); no watcher. Expected: 4 tests pass.

What a stack trace shows also depends on the process that runs the module: it remaps only with source maps enabled, and an absolute path in `sources` resolves to a file only when the module itself has a `file:` identity (`BEE_IDENTITY`, which `beyond test` sets). A module loaded over HTTP without it resolves the path against its own origin. Both are the launcher's, not this map's.

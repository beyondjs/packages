# Overlap validation: public modules that share a directory

Validates that a public module whose entry point lies in a directory another public module also uses (two `exports` entries in one directory, or one nested under another's directory) is made of the internal modules its entry imports and warns with `MODULES_SHARE_DIRECTORY`, while a module whose directory is its own keeps every file of it. See [the architecture](../../docs/architecture.md#modules-that-share-a-directory) and [the fixtures](fixtures/README.md).

```sh
BEE_URL=http://localhost:1112 node --import "$BEE_NODE_DIR/register.mjs" --test tests/overlap/overlap.test.mjs
```

Prerequisites: an Engine serving this implementation, as for [stage 1](../stage-1/README.md); no watcher. Expected: 3 tests pass.

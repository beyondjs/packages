# Validation: failures of processing answer

A conditional or a processor that fails answers with a diagnostic, never with a request that waits forever. The dynamic processor settles the readiness of a conditional only when a processing returns, so a conditional that throws or rejects, or a processor whose build throws, used to leave `Delivery.module`, and the HTTP request behind it, pending. `BaseConditional` now ends such a processing with `PROCESSING_FAILED` and `ConditionalProcessor` with `PROCESSOR_FAILED`; `ConditionalOutput` answers `undefined` for the code and hash of an output without code, and for a map that is not JSON, instead of throwing inside a processing.

[`processing.test.mjs`](processing.test.mjs) runs under Node's test runner against the workspace and the defective bundler of [`fixtures/`](fixtures/README.md), with a bounded wait on every delivery:

```sh
cd "$PACKAGES_DIR"
BEE_URL=http://localhost:1112 node --import "$BEE_NODE_DIR/register.mjs" --test tests/processing/processing.test.mjs
```

Expected: 6 tests pass. No watcher is used. Without the guards the first case passes and the other five never settle.

# Processing fixtures: conditionals and processors that fail

Used by [`processing.test.mjs`](../processing.test.mjs). The harness copies `workspace/` into a unique temporary directory and writes one value into the copy: the `file:` URL of `bundler/module.mjs` in place of `FIXTURE_BUNDLER` in `fixture/package.json`. The bundler itself is imported from where it is checked in; nothing here is written by a run.

## `workspace/`

One package, `@fixture/processing` 1.0.0, whose modules are compiled by the fixture bundler (`beyond.bundler: fixture`). Each module is a one-line ES module; what matters is how its conditional behaves.

| Module | Behaviour of its conditional | Expected answer of `Delivery.module` |
| --- | --- | --- |
| `./sound` | Processes and produces its code | The code, `export const name = 'sound';` |
| `./thrown` | Its processing throws | `BUILD_FAILED` with `PROCESSING_FAILED` |
| `./rejected` | Its processing returns a rejected promise | `BUILD_FAILED` with `PROCESSING_FAILED` |
| `./faulty` | Has one processor, whose build throws | `BUILD_FAILED` with `PROCESSOR_FAILED` |

## `bundler/`

- `module.mjs` exports the `Module` a package names as its bundler: one `web` conditional per module, extending the SDK `Conditional`, which fails as the table says and otherwise produces its code and an artifact that imports nothing.
- `processor.mjs` exports the `Processor` of `./faulty`, extending the SDK `ConditionalProcessor`, whose `_build` throws.

Both are intentionally defective: they stand for a defect in a real bundler or processor, which must end in a diagnostic and never in a request that waits forever.

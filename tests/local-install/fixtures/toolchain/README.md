# Toolchain fixtures

What `tests/local-install/toolchain.test.mjs` installs: a workspace that depends on a release no registry publishes and that the Beyond toolchain carries as an archive. Its harness, `tests/local-install/support/toolchain.mjs`, packs each directory of `archives/` with `npm pack` into a temporary directory of archives (packing is the behavior under test: the archives are what the command line's installation carries), copies `workspace/` to a temporary directory and installs it against the in-process registry of `fixtures/installation/registry`, as `installation.test.mjs` does. Nothing here is written by a test.

| Path | Content |
| --- | --- |
| `workspace/package.json` | `@fixture/supplied-app@1.0.0`, a standalone package: `@fixture/runtime` (`~1.0.0`), which no registry publishes, and `lib-a` (`^1.0.0`) of the registry |
| `archives/runtime@1.0.0/` | `@fixture/runtime@1.0.0`, packed into the toolchain's archives: depends on `lib-b` (`^1.0.0`) of the registry |
| `archives/lib-c@1.0.0/` | A copy of `lib-c@1.0.0` with other bytes: the registry publishes that version, so the registry's release is installed and this archive is never read |

What the tests expect: `@fixture/runtime@1.0.0` installed from the toolchain with the origin `toolchain`, its archive address `toolchain:@fixture/runtime@1.0.0` and the integrity of its archive; `lib-a`, `lib-b` and `lib-c` from the registry.

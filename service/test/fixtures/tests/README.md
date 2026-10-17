# Test-run fixtures

`workspace/` is a workspace whose test files `tests.test.mjs` runs through the test runs of the development service (`POST /tests/runs`), as `beyond test` runs them. The cases copy it into a unique temporary directory and never write it.

| Path | Expected |
| --- | --- |
| `package.json` | The package `@fixture/tests` 1.0.0, an ES module package |
| `math.test.mjs` | Four tests: `adds` passes; `receives the loader configuration` passes when the runner was given `BEE_URL`, `BEE_ADAPTER=packages` and `BEE_IDENTITY` under `.beyond/modules`; `subtracts` fails at its line 15 (`assert.equal(2 - 1, 2)`); `later` is skipped |
| `nested/ok.test.mjs` | One test, `nested passes`, which passes |
| `slow/hang.test.mjs` | One test that never ends, which a case cancels; never run without being named |
| `notes.md` | Not a test file: naming it is `TESTS_FILES_INVALID` |

# Applications contract

The declaration of applications and execution targets and the documents of their catalog (`beyond-applications/1`), as JSON Schema 2020-12 definitions in `schema.json`; their rules are in [applications and execution targets](../../docs/applications.md).

| Definition | Document |
| --- | --- |
| `branch` | The value of `applications` in `beyond.json`: a declaration, or the name of the JSON file that holds it |
| `declaration` | The applications, keyed by identifier |
| `application` | One application as declared, which is also the body of `PUT /applications/:application` |
| `declaredTarget` | One execution target as declared |
| `catalog` | The answer to `GET /applications`, with `following`, how the service follows the declaration now |
| `resolved` | The answer to `GET /applications/:application/targets/:target` |
| `written` | The answer to `PUT` and `DELETE /applications/:application` |
| `changed` | The data of an `applications.changed` event |
| `refusal` | Any refusal: `{error: {code, message, diagnostics?}}` |

`fixtures/valid` and `fixtures/invalid` hold documents named `<definition>.<case>.json` that must pass or fail their definition; the invalid ones are a list of applications, identifiers that do not follow CDN's patterns, a runtime on a frontend target, an entry without its `./`, repeated conditions, a blank title, a catalog without its generation, an absent document with a revision, a document outside the root, a watchers service unavailable without its reason, a live catalog that nothing follows, an unsupported launch without its reason, a completed write without its revision and a generation of zero.

```sh
node --test contracts/applications/test/fixtures.test.mjs
```

The schema states structure. What the Core decides beyond it (that conditions are sorted, that a runtime is one it launches, that a named file is inside the workspace) is tested on the real service in [tests/applications](../../tests/applications/README.md). When Packages is checked out inside the Beyond Suite, the same test validates the declarations of the suite's testbed scenarios.

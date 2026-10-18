# Portable connection contract

The documents a development service that pairs browsers answers, for `beyond-dev-pairing/1` and `beyond-dev-exports/1`, as JSON Schema 2020-12 definitions in `schema.json`; their rules are in [portable connections](../../docs/portable.md).

| Definition | Document |
| --- | --- |
| `code` | The answer to `POST /pairing/codes`, with the `fragment` a command line appends to an interface link |
| `paired` | The answer to `POST /pairing`: the token, given once |
| `pairings` | The answer to `GET /pairings`, which never holds a token |
| `refusal` | Any refusal: `{error: {code, message}}` |
| `capabilities` | `capabilities` of `GET /session` |
| `session` | What `GET /session` adds for its caller on a service that pairs: its `pairing` and `exports.destinations` |
| `probe` | The answer to `GET /session` for a page without a token: `{protocol, capabilities, pairing: null}`, nothing of the workspace |
| `declaration` | The body of `PUT /pairing` (and the `snapshots` of `POST /pairing`): the Snapshots origin of the page |
| `export` | An export; a `ready` one carries the digest, size, files and exclusions of each package, a `failed` one its error |
| `transfer` | The body of `POST /exports/:id/transfer`, each `upload` the archive route of a snapshot (`/v1/captures/<id>/archive`) |
| `changed` | The data of an `export.changed` event |

`fixtures/valid` and `fixtures/invalid` hold documents named `<definition>.<case>.json` that must pass or fail their definition; the invalid ones are a lowercase or ambiguous code, a fragment written as a query, a probe that holds workspace data, a declared Snapshots origin with a path or on plain HTTP off loopback, a short token, a listing that holds a token, a zero capability, a ready export without its archive, a failed one without its error, a package path that climbs out of the root, a transfer record that holds a grant and an upload to another route.

```sh
node --test contracts/portable/test/fixtures.test.mjs
```

The schema states structure; what the service accepts beyond it (which origins, which paths of the workspace, the exact upload address of a snapshot) is decided by the service and tested in `service/test`.

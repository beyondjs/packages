# Utilities validation: which utilities run, and whether updates keep arriving

Validates the utilities this implementation runs on (`@beyond-js/dynamic-processor`, `@beyond-js/finder`, `@beyond-js/watchers`) and the update lifecycle that depends on them: an edited source is compiled again, a build that failed is reported and recovers, a stylesheet of another package invalidates what reads it, and a manifest reload releases its watchers without taking the service down.

Every run begins by reporting the **identity of each utility module it loaded**, so a result is always attributable to the utilities that produced it. A run against the published copies and a run against the ones served from their sources are different runs, and the report says which one it was.

## Why the scenarios repeat

The behaviour these scenarios check was intermittent: a change announcement that is lost leaves a file silently no longer followed, and one passing round is not evidence of a repair. `BEYOND_ROUNDS` sets how many rounds run; three is the default.

## What each step establishes

| Step | Established |
| --- | --- |
| identities | Where each utility module came from: an installed copy or a development server that serves its sources |
| emitter ownership | A subclass of the dynamic processor that emits an event of its own reaches the subscribers of the outer object. The mixin forwards prototype members only, so an emitter held as an instance field is read as `undefined` there and every such emit throws, while the subscribers are registered on the emitter of the implementation |
| watchers service and workspace | The real watchers service runs and the fixture is served |
| finder lifetime | The change announcement of a finder is deferred, so a finder destroyed inside that window must not emit. What a destruction announces on its own is measured first, and the deferred announcement adds none |
| listener isolation | `all` and the event itself are independent announcements of the watchers client: a subscriber of `all` that throws does not keep the specific event from being announced |
| round *n*, edit | An edited source is compiled again and the service delivers it |
| round *n*, recovery | A source that does not compile is a failed build with diagnostics, and its correction is compiled again |
| round *n*, stylesheet | A stylesheet of another package of the workspace is a compile-time dependency: editing it changes the stylesheet of the module that reads it |
| round *n*, manifest | A module that stops being declared is not delivered, one declared again is, and an edit of it after the reload is compiled: the workspace was replaced, its watchers were released and the new ones answer |
| the service is still usable | Every declared module is delivered after all of it |

## Run

Prerequisites are those of [the stage-1 validation](../stage-1/README.md), with `BEE_URL` naming the servers that publish the utilities as well when they are selected locally.

```sh
cd "$PACKAGES_DIR"
BEE_URL=http://localhost:1112,http://localhost:1121,http://localhost:1122,http://localhost:1120 \
WATCHERS_URL=http://localhost:1120 BEYOND_ROUNDS=3 \
  node --import "$BEE_NODE_DIR/register.mjs" tests/utilities/index.mjs
```

Expected with the utilities served from their sources: `18/18 steps passed` for three rounds.

With `BEE_URL` naming the implementation alone, the utilities are the installed copies, the identities step reports `0 of 4 served from a development server`, the emitter step fails and the run ends when the installed finder throws inside its deferred announcement. That is the behaviour of the published versions and the reason the sources are served.

## Not covered

A browser; the delivery of an update to a running consumer, which is the unified-runtime and preview validations; the cost of the toolchain in a constrained container.

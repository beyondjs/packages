# Sharing validation: one state behind the public subpaths that share it

Every public subpath of an ordinary npm package is compiled as one ES module, with the other subpaths kept as references. Two subpaths whose graphs share a file would each carry a copy of it, and a copy of a file that holds state is a second state: a component mounted against one of them is not the component the other knows, which is what `Cannot read properties of null` from a view framework looks like in a delivered application.

The delivery answers that with a **carrier** and its **facades**: the subpath whose graph reaches the entry points of the others is compiled from an entry that keeps its own API and republishes the API of each subpath it contains under a name of its own, and each contained subpath becomes a module that renames those back. A facade keeps the public identity of its subpath and its live bindings and adds nothing private, so what a page loads is still public modules only. Naming every re-export instead of starring it is what lets a name two subpaths export be carried for both, rather than becoming ambiguous and dropped by the compiler without saying so.

This validation checks that from the outside: the outputs a consumer receives, and the state a delivered application reads through two public subpaths of the same package. The same contract is checked in a browser, over real packages, by [the preparation validation](../preparation/README.md).

## What each step establishes

| Step | Established |
| --- | --- |
| inventory | Every public subpath of every fixture is reached and generated, with no diagnostic |
| roles | The subpath whose graph reaches another carries it, and that one is a facade over it, named by the public specifier of the carrier |
| delivery: carrier and facade | The carrier holds the shared file exactly once; the facade references the carrier and nothing else, and carries no copy of the state |
| delivery: default | A default export of a contained subpath, which `export *` never carries, is named back by its facade |
| delivery: independent | Two subpaths that reach nothing of each other are each delivered on their own, and neither becomes a facade |
| delivery: collision | A name two subpaths export with different bindings is carried for both, each under a name of its own, instead of being dropped |
| delivery: opaque | A subpath whose API the union cannot list — one that re-exports an external module in turn, or whose API has a name that is not an identifier — stays on its own, with its copy |
| delivery: CommonJS | A package whose subpaths are not ES modules is not planned. What keeps one state there is the boundary alone: a `require` of the entry point of another subpath stays a public reference |
| identity | Tracing the same inputs again answers the same inventory digest and the same compatibility keys, so a plan is a fact of the inputs and not of the run |
| conditions | The production delivery keeps the roles and answers keys of its own, which a development output is not compatible with |
| execution | A delivered application run in a process of its own writes through one public subpath and reads through the other: one state for a carried package, two for a package the union could not name |
| boundary | The public module `@beyond-js/packages/analysis`, which now owns the plan, does not depend on `@beyond-js/packages/artifacts`, which depends on it |

## The fixtures

They are written by [store.mjs](store.mjs), not copied from anywhere, so what decides a role — which files a subpath reaches and which names it exports — is readable beside the checks. `@fixture/app` imports every public subpath of every one of them and reports what it observed.

## Run

Prerequisites are those of [the stage-1 validation](../stage-1/README.md), without the watchers service: nothing here watches.

```sh
cd "$PACKAGES_DIR"
BEE_URL=http://localhost:1112,… \
  node --import "$BEE_NODE_DIR/register.mjs" tests/sharing/index.mjs
```

Expected: `12/12 steps passed`. `BEYOND_ESBUILD` selects another compiler build, as elsewhere.

## Not covered

A package that shares internal files with another subpath **without ever importing that subpath's entry point** is not planned, and keeps its copies: reaching the entry point is what relates two subpaths here. A subpath that re-exports an external module in turn does not say what it exports, so it is never carried, and neither is one whose API has a name that is not an identifier. Browsers, stylesheets, assets and the `system` format belong to other validations.

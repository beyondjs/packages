# Packages bootstrap

`@beyond-js/packages-bootstrap` prepares the implementation of a `@beyond-js/packages` distribution that carries sources instead of compiled modules. It is transitional: it exists because Packages is written in Beyond and is not yet distributed compiled, and a compiled Packages does not install or use it.

The development service of Packages asks for it when it starts and the installed Packages is not compiled:

```js
import { Bootstrap } from '@beyond-js/packages-bootstrap';

const bootstrap = new Bootstrap(packages);                 // the installed Packages component
const launch = await bootstrap.prepare({ directory, log }); // { execArgv, env, cwd, watchers, groups, versions }
await bootstrap.stop();
```

`prepare` starts **one** Engine development server over a staged package configuration that registers every project it has to serve, and returns how to start a host process that imports them through BEE Node's `engine` adapter. Engine never sees the workspace the service serves, and nothing of this reaches a consumer of the served modules.

## What the server serves

Engine reads `beyond.json` of its working directory and serves every package registered there, each on the port of its own manifest, from one process. Three kinds of project are registered:

- **Packages**, the implementation the host imports.
- **The watchers service**, which the published `@beyond-js/watchers` does not contain compiled. It is always served.
- **The local packages selected**, whose sources are served instead of the copies the installation resolved from the registry.

Engine takes the port from the manifest of each project, writes its cache beside it and refuses a project whose declared packages are not installed. An installed project is therefore not served in place: under the directory of the service each one gets a staged project with its sources linked, its manifest reduced to one ESM distribution on a port that is free now and without development or peer dependencies, and `node_modules` linked to where the installation resolved its dependencies. Two projects never share a port, and an installation can be read-only.

The server leads its own process group, which is how it is stopped: Engine's workers outlive a signal sent only to their parent. The published `beyond` package does not include the `index.js` of its repository, and its `run` command opens an inspector port, so [engine.cjs](engine.cjs) is the entry used.

## Local packages

Packages resolves its utilities as ordinary installed dependencies, so a change in one of them reaches nothing that runs until a new version is published. Registering the package in the configuration of the compiler removes that step: the package is compiled from its sources, the loader of the host is given its origin, and the specifier resolves there instead of in `node_modules`.

`BEYOND_LOCAL_PACKAGES` names the selection:

| Value | Meaning |
| --- | --- |
| unset | `@beyond-js/dynamic-processor`, `@beyond-js/finder` and `@beyond-js/watchers`, from the sources this package carries |
| `none` | Nothing. The utilities are the installed copies, which is the registry-backed operation of an ordinary installation. The watchers **service** is still compiled from source, because the published package does not contain it |
| a list | Package names separated by commas or whitespace, each optionally `name=<directory>` to take its sources from a checkout instead of the ones carried here |

A selected package whose sources are not where they are expected **fails the start of the service**, naming what is missing. It is never silently replaced by the installed copy: a selection that is quietly ignored would report a repair that never ran.

What the service serves locally is published in its session description, under `service.versions`, as `<version> (local: <origin>)`. That is what tells a run on the sources from a run on the installed copies.

## The carried sources

`resources/<package>` holds the sources of each package this one can serve, generated when the package is packed:

```sh
npm run resources      # copies them from BEYOND_UTILITIES, or from the utility checkouts beside the suite
```

They cannot be dependencies, because each has the name and the version of the published package that the same installation also needs. Their own dependencies are dependencies of this package (`chokidar`, `@beyond-js/ipc`, `@beyond-js/pending-promise`, `@beyond-js/kernel`) or of `@beyond-js/packages` (`colors`, `@beyond-js/file`, `@beyond-js/equal`), as are Engine (`beyond`), the loader (`@beyond-js/bee-node`) and the Node type declarations that Engine's compiler needs.

An installation therefore carries the selected sources and depends on no checkout of the host it was built on. **An image that was built before is not changed by any of this**: it holds the installation it was built with, and it has to be rebuilt from a packed `@beyond-js/packages-bootstrap` that carries the sources.

## Limits

- Engine listens on all interfaces, on ports chosen when the service starts.
- Validated on macOS. Process groups are POSIX; Windows was not exercised.
- `@beyond-js/packages-bootstrap` is a provisional name whose availability in a registry has not been checked.

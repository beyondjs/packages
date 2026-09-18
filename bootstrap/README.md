# Packages bootstrap

`@beyond-js/packages-bootstrap` prepares the implementation of a `@beyond-js/packages` distribution that carries sources instead of compiled modules. It is transitional: it exists because Packages is written in Beyond and is not yet distributed compiled, and a compiled Packages does not install or use it.

The development service of Packages asks for it when it starts and the installed Packages is not compiled:

```js
import { Bootstrap } from '@beyond-js/packages-bootstrap';

const bootstrap = new Bootstrap(packages);                 // the installed Packages component
const launch = await bootstrap.prepare({ directory, log }); // { execArgv, env, cwd, watchers, groups, versions }
await bootstrap.stop();
```

`prepare` starts two Engine development servers, one for Packages and one for the watchers service, and returns how to start a host process that imports them through BEE Node's `engine` adapter. Engine never sees the workspace the service serves, and nothing of this reaches a consumer of the served modules.

## Why each server is staged

Engine takes its port from the manifest of the project it serves, writes its cache beside it and refuses a project whose declared packages are not installed. An installed implementation is therefore not served in place. Under the directory of the service each one gets a staged project: sources linked, the manifest reduced to one ESM distribution on a port that is free now and without development or peer dependencies, and `node_modules` linked to where the installation resolved its dependencies. Two services never share a port, and an installation can be read-only. Each Engine leads its own process group, which is how it is stopped: Engine's workers outlive a signal sent only to their parent.

The published `beyond` package does not include the `index.js` of its repository, and its `run` command opens an inspector port, so [engine.cjs](engine.cjs) is the entry used.

## The watchers resource

The published `@beyond-js/watchers` contains the client that Packages imports but not its service, which is compiled from source. That source is distributed inside this package as `resources/watchers`, generated when the package is packed:

```sh
npm run resources      # copies it from BEYOND_WATCHERS_SOURCE, or from the utility checkout beside the suite
```

It cannot be a dependency, because it has the name and version of the published package that the same installation needs. Its dependencies (`chokidar`, `@beyond-js/ipc`, `@beyond-js/pending-promise`, `@beyond-js/kernel`) are dependencies of this package for that reason, as are Engine (`beyond`), the loader (`@beyond-js/bee-node`) and the Node type declarations that Engine's compiler needs.

## Limits

- Engine listens on all interfaces, on ports chosen when the service starts.
- Validated on macOS. Process groups are POSIX; Windows was not exercised.
- `@beyond-js/packages-bootstrap` is a provisional name whose availability in a registry has not been checked.

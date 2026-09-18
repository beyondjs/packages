# @beyond-js/packages

Packages is the Beyond packaging implementation written in Beyond. It models workspaces, packages, public modules, bundlers, conditional outputs and processors. Its intended consumers include a local development server and an independent CDN service.

The existing Engine generation compiles Packages implementation modules; modern BEE Node loads their ECMAScript output. Packages must then compile and serve the target application itself. Discovery, processing and output abstractions are present, while final assembly and the complete HTTP/widget/types/styles/HMR loop still require integration.

- [Development and acceptance](docs/development.md): execution roles, configuration, current blockers and the functional widget development loop.
- [Architecture and bundlers SDK](docs/architecture.md): actual public extension interfaces, source/output flow, diagnostics and lifecycle.
- [Programming conventions](docs/programming.md): Beyond authoring, public versus internal modules, naming, state and tests.
- [Coding standards](docs/coding-standards.md): binding file-length, object-oriented design and naming rules.

The manifest supplies Beyond build/distribution configuration, not a standalone npm start command. Begin with the development guide before running historical fixtures or changing public interfaces.

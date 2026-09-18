# @beyond-js/packages

Packages is the Beyond packaging implementation written in Beyond. It models workspaces, packages, public modules, bundlers, conditional outputs and processors. Its intended consumers include a local development server and an independent CDN service.

The existing Engine generation compiles Packages implementation modules; modern BEE Node loads their ECMAScript output. Packages then compiles the target packages itself: it discovers their public modules, selects their bundler and conditions, and assembles executable artifacts that keep their public references and can be updated one source file at a time. HTTP delivery, widgets, styles, declarations and the complete update loop still require integration.

- [Development and acceptance](docs/development.md): execution roles, configuration, current blockers and the functional widget development loop.
- [Architecture and bundlers SDK](docs/architecture.md): actual public extension interfaces, source/output flow, artifacts, diagnostics and lifecycle.
- [Programming conventions](docs/programming.md): Beyond authoring, public versus internal modules, naming, state and tests.
- [Coding standards](docs/coding-standards.md): binding file-length, object-oriented design and naming rules.
- [First-stage validation](tests/stage-1/README.md): two packages compiled, executed and updated, with the commands to reproduce it.

The manifest supplies Beyond build/distribution configuration, not a standalone npm start command. Begin with the development guide before running historical fixtures or changing public interfaces.

# Compiled-module API specification

The OpenAPI source that lived here moved to the shared contract package, `@beyond-js/artifact-api`, which is
now the one maintained specification of the compiled-module API for local development, Workspace environments
and CDN delivery. It distributes the authoritative YAML source, the generated bundle (`dist/openapi.json`), the
identity and URL codec, and the conformance fixtures.

The [HTTP routes](../modules/http/routes/index.ts) of this repository consume that package: `specs()` returns
the path of its bundled document, and the module routes parse requests with its codec. Do not add a copy of the
specification here; change it in the contract package and update the dependency.

# Package dependency graph

## Overview

This retained conceptual guide describes package/version grouping. The current implementation is in [index.ts](index.ts), with a [registry](registry/index.ts) rather than the older List directory. Public-module resolution and internal source evaluation are separate graphs; see [Packages architecture](../../../docs/architecture.md). The design description below does not imply that every conflict or invalidation path is complete.

## Current implementation

The maintained description of the resolver is [package resolution and source fetching](../../../docs/cdn-resolution.md): occurrences and releases, canonical grouping by range intersection, pass-based resolution with a limit, error-aware completion, peers, overrides and the lock. The conceptual text below predates it: nodes no longer reprocess themselves when a version changes (a pass is walked again instead), and the "list" is the [registry](registry/index.ts).

## Graph Dependencies Resolver

The Graph Dependencies Resolver constructs a project dependency graph and resolves all dependencies, ensuring satisfaction of version requirements and handling potential conflicts.

The resolver operates with the concepts of a "node" and a "list". The "node" represents an individual package within the project, and the "list" is a collection of all packages required across the project.

### Node

Each node has three main properties:

1. **Version**: An object containing the specified version (from the package's package.json) and the resolved version (determined by the resolver). The version object emits a 'change' event when its resolved version changes.
2. **Parent**: The node's parent within the dependency graph.
3. **Dependencies**: The node's dependencies, also represented as nodes.

Nodes register themselves in the list and notify it about the package version they require. If a node's resolved version changes during the graph's processing, it invalidates the node.

For more details, see the [Node documentation](./node/readme.md).

### List

The list groups nodes requiring the same package but with different version requirements. It manages all required versions of each package, grouping versions that satisfy multiple nodes, and updates the resolved version in each node's version object.

The list contains Dependency objects, each representing a package required by one or more nodes. Dependencies have "groups", and each group contains nodes that require compatible versions of the package. Groups resolve the required version range and notify nodes of the resolved version.

For more details, see the [Registry design reference](./registry/readme.md).

# Beyond CDN - Graph Dependencies Resolver

## Overview

Beyond CDN is a content delivery network for JavaScript modules, similar to Skypack or JSPM. A crucial part of Beyond CDN is the Graph Dependencies Resolver, an algorithm for managing project dependencies.

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

For more details, see the [List documentation](./list/readme.md).

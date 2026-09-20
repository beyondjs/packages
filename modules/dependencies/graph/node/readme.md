# Node Class/Object

This is the original design note of the node. A node is one occurrence of a dependency, identified by the path of declared names from the root; see [package resolution and source fetching](../../../../docs/cdn-resolution.md#the-dependency-graph) for its current contract (`id`, `link`, `release`, `soft`, `provider`, error-aware `processed`).

The Node class represents individual packages within the project dependency graph.

## Properties

- **version**: An object holding the specified version (from the package's package.json) and the resolved version (decided by the resolver). The version object emits a 'change' event when its resolved version changes, which invalidates the node.
- **parent**: The parent Node of this package within the graph.
- **dependencies**: An array of Node objects representing the dependencies of this package.

## Methods

- **register()**: A method that the node calls to register itself in the list. This action helps notify the list about the package version this node requires.
- **unregister()**: A method called when a node no longer needs to be considered in the list. This typically occurs when a node has been fully processed or if it has been invalidated and is about to be reprocessed.
- **invalidate()**: A method triggered when a node's resolved version changes. This initiates reprocessing of the node.

# List Concept

The list is a collection of all packages required throughout the project dependency graph.

## Properties

- **dependencies**: An array of Dependency objects, where each Dependency groups together Nodes requiring the same package.

## Methods

- **register(node)**: This method is called by each Node to register its required package version in the list.
- **unregister(node)**: This method is called by a Node to unregister itself when it is no longer required to be part of the list.

## Dependency Object

Each Dependency object in the list represents a package required by one or more Nodes.

- **package**: The name of the required package.
- **groups**: An array of Group objects, where each Group represents a set of Nodes requiring compatible versions of the package.
- **register(node)**: Registers a node in the appropriate group.
- **unregister(node)**: Unregisters a node, potentially removing groups if they no longer contain any nodes.

## Group Class

The Group class extends Array and represents a set of Nodes requiring compatible versions of the package. Each element in the array is a Node object.

- **max**: The maximum satisfying version for all Nodes in the group, i.e., the resolved version.
- **#updateMax()**: This method finds the maximum satisfying version for all Nodes in the group, updates the `max` property, and notifies all nodes of the updated version.
- **register(node)**: Adds a node to the group (array).
- **unregister(node)**: Removes a node from the group (array).

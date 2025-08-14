# Beyond CDN - Dependencies

The `dependencies` directory of Beyond CDN contains tools and components necessary for resolving, managing, and visualizing dependencies. This directory includes three main components:

## Graph

The `graph` component constructs a project dependency graph and resolves all dependencies. It is a custom graph dependencies resolver, ensuring satisfaction of version requirements and handling potential conflicts. The resolver operates with the concepts of a "node" and a "list". The "node" represents an individual package within the project, and the "list" is a collection of all packages required across the project. For a deeper dive, see the [Graph documentation](./graph/readme.md).

## Specs

The `specs` component is a class that transforms the dependencies of the `package.json` (including `dependencies`, `devDependencies`, and `peerDependencies`) into a Map. Each key in the Map is a package name, and the corresponding value is an object with two properties: `.version` (the value specified in the `package.json`) and `.kind` (the type of dependency - either 'dependency', 'development', or 'peer').

## Printer

The `printer` is a utility that provides a visual representation of a project's dependency graph. It takes a graph as input and prints out a structured, console-friendly dependency tree, making it easier to visualize and understand the project's dependencies.

## Introduction to `.npmrc`

When working with JavaScript or TypeScript projects that use NPM (Node Package Manager) or compatible tools like Yarn or
pnpm, the `.npmrc` file allows you to define custom behavior for how packages are installed, resolved, and
authenticated. It is a simple, line-based configuration file used by the package manager.

### What is it used for?

`.npmrc` is used to:

-   **Define the default registry** for downloading packages.
-   **Redirect specific package scopes** (like `@myorg`) to custom registries.
-   **Provide authentication tokens or credentials** for private registries.
-   **Customize install behavior**, proxy settings, or timeouts.

This is critical in both **open-source** and **enterprise** environments where multiple registries, internal packages,
and secure access are common.

---

## Handling Authentication and Security

Many real-world projects interact with **private registries** or **scoped packages** that require authentication. The
`.npmrc` file supports several authentication strategies:

### Scopes and Registry Routing

A **scope** is a namespace in a package name. For example, `@myorg/mypackage` belongs to the `@myorg` scope. You can
redirect that scope to a custom registry using:

```ini
@myorg:registry=https://packages.mycompany.com/
```

This tells the package manager: “Anything under @myorg should be fetched from that registry instead of the default.”

### Authentication Methods

You can define credentials either for: • A specific host (like //packages.mycompany.com/) • The default registry
(fallback for any unscoped packages)

Supported methods include: • Token-based authentication:

//registry.mycompany.com/:\_authToken=abcdef123456

    •	Basic authentication (base64 encoded username:password):

\_auth=dXNlcjpwYXNz

    •	User/Password authentication:

username=john password=secret

These credentials are sensitive and should never be committed to source control. Instead, you should: • Use .npmrc in
your home folder (~/.npmrc), not in the project root. • Use environment variables in CI pipelines. • Use a secure
secrets manager (or Firestore as we support in this system). • Never log full tokens or passwords in any output or debug
logs.

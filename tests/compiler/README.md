# Compiler validation: a compiler whose process ends

The compiler of the packaging mode runs in a child process of its own. A memory ceiling of a container can kill that child without killing the service, and everything the service builds afterwards fails with the same message until the compiler is released.

What the service must never do then is answer with a stale success or with a build that never lands. This validation kills the child in a controlled way and checks the three things that follow from that.

| Step | Established |
| --- | --- |
| the service builds the packaged module | The fixture builds and the compiler runs in a process of its own |
| a compiler that ends is a failed build naming it | After the child is killed, an edit produces a **failed** build — `BUILD_FAILED` with the diagnostic `COMPILER_UNAVAILABLE`, whose message says that this is what a memory ceiling looks like from here — and never a stale hash or a result that does not arrive |
| a later build has a compiler again | The next edit builds: the ended compiler was released, so a new process of it started |

## Run

Prerequisites are those of [the stage-1 validation](../stage-1/README.md).

```sh
cd "$PACKAGES_DIR"
BEE_URL=http://localhost:1112 WATCHERS_URL=http://localhost:1120 \
  node --import "$BEE_NODE_DIR/register.mjs" tests/compiler/index.mjs
```

Expected: `3/3 steps passed`.

## Limits

A controlled termination stands in for a memory ceiling. **A real cgroup kill was not exercised**: this validation establishes how the service reports and recovers from a compiler that ends, not what a constrained container does. The `ts` bundler compiles in the process of the service and has no such child.

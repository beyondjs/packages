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

Expected: `3/3 steps passed`. A controlled termination stands in for a memory ceiling here; [the section below](#under-a-real-memory-ceiling) is the real one.

## Under a real memory ceiling

[oom.mjs](oom.mjs) runs the same three steps inside a Linux cgroup v2 whose `memory.max` is set, and lets the kernel's memory controller end the compiler instead of a signal. An edit makes the module import a generated source (`BEYOND_OOM_MB`, 60 by default) that the service can read but the compiler cannot compile within the ceiling. Nothing signals any process: the run reads the `oom_kill` counter of `memory.events` before and after, names the process that disappeared, checks that the process hosting the service is alive, requires `COMPILER_UNAVAILABLE`, and then requires a valid build on a new compiler process.

| Step | Established |
| --- | --- |
| the service builds under the ceiling | The fixture builds with `memory.max` set, and the compiler runs in a process of its own |
| the memory controller ends the compiler | `oom_kill` rose, the process that ended is the compiler, the service lives, and the build failed with `COMPILER_UNAVAILABLE` |
| a later build has a compiler again | The next edit builds on a new compiler process |

Outside such a cgroup — macOS, or Linux without a memory limit — it prints `BLOCKED` and exits with 2, which is neither a pass nor a failure.

Only the service and its compiler belong under the ceiling. The Engine that serves the implementation to the service compiles all of Packages when it starts and needs more memory than a tight ceiling allows, so it runs in a container of its own on the same network, which is also where it is when a Workspace environment runs the service:

```sh
docker network create beyond-oom
docker volume create beyond-oom-work
# a clean Linux installation from the acceptance archives into the volume, then:
docker run -d --name beyond-oom-engine --network beyond-oom --memory=1536m -v beyond-oom-work:/work node:22-bookworm <start the bootstrap Engine>
docker run --rm --network beyond-oom --memory=768m --memory-swap=768m -v beyond-oom-work:/work node:22-bookworm \
  <run oom.mjs from the installed Packages with BEE_URL and WATCHERS_URL naming beyond-oom-engine>
```

The size of the source is part of what is proved. A much larger one (240 MB) never reaches the compiler: the service reads the source into its own heap and ends at the heap limit of its runtime, which the memory controller did not cause and `COMPILER_UNAVAILABLE` does not describe. That is a limit of the service, recorded as such, and not the failure this validation establishes.

## Limits

The `ts` bundler compiles in the process of the service and has no compiler child; a ceiling that ends it ends the service. A source large enough to exhaust the heap of the service ends the service too. The memory controller was exercised on Docker Desktop's Linux virtual machine (cgroup v2), not on a hosted runtime.

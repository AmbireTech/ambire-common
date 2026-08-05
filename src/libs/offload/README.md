# Offloading work off the main thread

CPU-heavy pure functions can be moved off the calling thread without any caller
knowing about it. `offload('taskName', input)` returns the same value whether the
work ran on another thread or inline, so correctness never depends on a runner
being registered.

## Adding a task

Add the function to `OFFLOAD_TASKS` in `tasks.ts` and call it through `offload`:

```ts
const result = await offload('processBalances', input)
```

That is the whole change. There is no per-domain registry to write, no host to
update, and no new thread-boundary code — the platform's runner dispatches every
task through the same path.

## How a platform registers a runner

The platform calls `setOffloadRunner(runner, onFailure)` once at startup.
Environments that never register one (browser extension, web, tests) run every
task inline. Today only the mobile app registers a runner, backed by a
`react-native-worklets` runtime; see `src/mobile/services/worklets/`.

`onFailure` exists because this package is environment-agnostic and has no error
reporting of its own. The mobile host passes a Sentry reporter.

## Limitations

### 1. Every npm package a task reaches must be whitelisted

The worklet runtime resolves imports through the Metro module registry only for
packages listed in `workletizableModules` in the app's `babel.config.js`. A
package left off the list is copied into the worklet's closure instead, where
calling it throws.

**So: adding a new library to a task's import graph means adding it to that
list.** There is no wildcard. This is the one place the "any library" promise
costs you a line of config.

### 2. Tasks must be pure and free of platform APIs

No React Native modules, no DOM, no filesystem, no native modules. The worklet
runtime actively rejects React Native imports in development builds. A task gets
its input, computes, and returns.

`ethers` is excluded in practice: it drags in crypto and `process` polyfills that
the worklet runtime never installed. Use `viem` in offloaded code.

### 3. Never pass an object something else still owns

Handing an object to a task marks it as serialized for the rest of its life.
Whoever owned it can still write to it, but every write then logs

> Tried to modify key `x` of an object which has been already passed to a worklet

and the task may not see the new value. Controller state, module-level constants
and cached objects are all owned by someone, so **project what the task needs
into a fresh object at the call site**.

`toMapTokenNetwork` and `toMapTokenHints` in `../portfolio/tokenProcessing.ts`
are the examples to copy. Passing a whole `Network` caused exactly this warning,
because the networks controller reassigns `network.features` afterwards.

Two things follow from the same rule, and both are worth doing anyway:

- Send only the fields the task reads. A smaller payload is a cheaper clone.
- Do not send a field the task never reads. It costs a clone and freezes an
  object for nothing.

### 4. Arguments and return values must be cloneable

Everything crossing the boundary is structured-cloned. Plain objects, arrays,
strings, numbers and `bigint` are fine. Class instances, functions, `Error`
objects and anything holding a native handle are not — they arrive stripped of
their prototype.

This is why a task signals failure by throwing normally and letting the runner
convert it: `offload` re-throws an `OffloadTaskError` on the calling thread. A
typed error thrown inside a task keeps its message but loses its class and any
extra fields, so anything the caller needs to branch on must be part of the
task's ordinary return value.

### 5. Network calls stay on the calling thread

`fetch` is not available in worklet runtimes unless a native preview flag is
compiled in, and moving I/O off-thread buys nothing anyway — waiting on a socket
does not block the JS thread. Do the request first, offload the parsing and
mapping.

### 6. One runtime, one queue

The mobile host uses a single shared worklet runtime, so tasks run one at a time
in call order. Additional runtimes would each cost a full JS heap, and the
calling thread still pays the argument and result clone, so it would serialise
there regardless.

## Failure behaviour

- The runner throws, or takes longer than the timeout → offloading latches off
  for the rest of the process, `onFailure` fires once, and this call and every
  later one runs inline. A broken runtime degrades performance, never
  correctness.
- The task itself throws → `OffloadTaskError` propagates to the caller. No
  fallback, because running the same input inline would fail the same way.

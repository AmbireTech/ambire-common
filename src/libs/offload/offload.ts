import { portfolioDebugLog } from '../portfolio/debug'
import { OFFLOAD_TASKS, OffloadInput, OffloadOutput, OffloadTask } from './tasks'

/**
 * What a runner returns. A task that throws is reported as `ok: false` rather
 * than a rejection, because an Error crossing a thread boundary is cloned and
 * arrives without its prototype or typed fields.
 */
export type OffloadEnvelope = { ok: true; value: unknown } | { ok: false; error: string }

/**
 * Runs a task somewhere other than the calling thread. Registered by the
 * platform; environments without one (extension, web, tests) run tasks inline.
 */
export type OffloadRunner = (task: OffloadTask, input: unknown) => Promise<OffloadEnvelope>

/** Called once when offloading is latched off, so the platform can report it. */
export type OffloadFailureReporter = (task: OffloadTask, error: unknown) => void

/** Thrown when the task itself failed. Not an infrastructure problem. */
export class OffloadTaskError extends Error {
  constructor(
    public readonly task: OffloadTask,
    message: string
  ) {
    super(`${task}: ${message}`)
    this.name = 'OffloadTaskError'
  }
}

let runner: OffloadRunner | null = null
let reportFailure: OffloadFailureReporter | null = null

// A runner that fails once fails every time, and retrying per call turns one
// broken install into hundreds of rejected promises and wasted argument clones.
// The first infrastructure failure latches offloading off for the lifetime of
// the process and the inline path serves everything from then on.
let disabled = false

/**
 * Registers the platform runner. Pass null to go back to running inline.
 * `onFailure` is called at most once, when offloading latches off.
 */
export function setOffloadRunner(
  newRunner: OffloadRunner | null,
  onFailure?: OffloadFailureReporter
): void {
  runner = newRunner
  reportFailure = onFailure ?? null
  disabled = false
  consecutiveTimeouts = 0
}

/** Reset state between tests; not for production use. */
export function resetOffloadRunner(): void {
  runner = null
  reportFailure = null
  disabled = false
  consecutiveTimeouts = 0
  inFlightCount = 0
}

/** Whether calls are currently going to the runner rather than running inline. */
export function isOffloadActive(): boolean {
  return runner !== null && !disabled
}

// Generous for the pure CPU work a single task is meant to do. Anything slower
// has hung, and the caller should get the inline result rather than wait forever.
const OFFLOAD_TIMEOUT_MS = 2000

// A runner may queue calls behind each other, and the promise it returns covers
// the wait for a free slot as well as the run. A task sitting in a healthy queue
// is not a hang, so every call already in flight when this one is dispatched adds
// its own budget. Without this, a portfolio update over many networks trips the
// timeout on the tasks at the back of the queue purely because the queue is deep.
let inFlightCount = 0

// One slow call is not evidence of a broken runner, so a timeout falls back inline
// for that call only. Offloading latches off after this many in a row, which does
// point at a runtime that stopped making progress. Reset by any success.
const MAX_CONSECUTIVE_TIMEOUTS = 3
let consecutiveTimeouts = 0

class OffloadTimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, budgetMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new OffloadTimeoutError(`timed out after ${budgetMs}ms`)),
      budgetMs
    )
  })

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function latchOff(task: OffloadTask, error: unknown): void {
  if (disabled) return
  disabled = true

  const message = error instanceof Error ? error.message : String(error)
  portfolioDebugLog('update', `offloading disabled for this process (${task}): ${message}`)
  reportFailure?.(task, error)
}

function runInline<K extends OffloadTask>(task: K, input: OffloadInput<K>): OffloadOutput<K> {
  // The task table is keyed so that input and output line up per task, but
  // TypeScript cannot follow that through the index access.
  const fn = OFFLOAD_TASKS[task] as (taskInput: OffloadInput<K>) => OffloadOutput<K>

  return fn(input)
}

/**
 * Runs a task, off the main thread when the platform registered a runner and
 * inline otherwise. Falls back to inline on any infrastructure failure, so the
 * result is the same either way and callers never need to know which path ran.
 *
 * Throws OffloadTaskError when the task itself failed. That is not a reason to
 * fall back, since running the same input inline would fail the same way.
 */
export async function offload<K extends OffloadTask>(
  task: K,
  input: OffloadInput<K>
): Promise<OffloadOutput<K>> {
  if (!runner || disabled) return runInline(task, input)

  const budgetMs = OFFLOAD_TIMEOUT_MS * (inFlightCount + 1)

  let envelope: OffloadEnvelope
  inFlightCount += 1
  try {
    envelope = await withTimeout(runner(task, input), budgetMs)
    consecutiveTimeouts = 0
  } catch (error) {
    if (!(error instanceof OffloadTimeoutError)) {
      // The runner itself failed, which means the runtime could not be built or
      // the call never reached it. Retrying that per call turns one broken install
      // into hundreds of rejected promises.
      latchOff(task, error)
      return runInline(task, input)
    }

    consecutiveTimeouts += 1
    if (consecutiveTimeouts >= MAX_CONSECUTIVE_TIMEOUTS) latchOff(task, error)

    return runInline(task, input)
  } finally {
    inFlightCount -= 1
  }

  if (!envelope.ok) throw new OffloadTaskError(task, envelope.error)

  // The runner is trusted to return what the task returned, and the envelope
  // cannot carry the per-task type through the thread boundary.
  return envelope.value as OffloadOutput<K>
}

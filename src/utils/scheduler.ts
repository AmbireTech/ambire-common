import { startPerfSpan } from '../libs/perf/perf'

/**
 * Allow the main thread to process other events.
 */
function yieldToMain() {
  if ((globalThis as any)?.scheduler?.yield) {
    return (globalThis as any).scheduler.yield()
  }

  // Fall back to yielding with setTimeout.
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

/**
 * How long one slice of `forEachInSlices` may hold the thread: one frame at 60Hz. On mobile the
 * controllers share the thread with the UI, so a longer slice delays taps and drops frames of
 * the animations driven from JS.
 */
const SLICE_BUDGET_MS = 16

/**
 * Runs `fn` over every item in order, yielding to the main thread whenever a slice has run for
 * `budgetMs`, so a loop over thousands of items does not block the thread in one go. Anything
 * else may run between slices, so the caller must not rely on state it read before the loop
 * staying unchanged until the end of it.
 *
 * `perfSpanName` records every slice as a perf span (see `startPerfSpan`).
 */
async function forEachInSlices<T>(
  items: readonly T[],
  fn: (item: T) => void,
  { budgetMs = SLICE_BUDGET_MS, perfSpanName }: { budgetMs?: number; perfSpanName?: string } = {}
) {
  let sliceStart = performance.now()
  let endSliceSpan = perfSpanName ? startPerfSpan(perfSpanName) : null

  for (const [index, item] of items.entries()) {
    fn(item)

    const isLastItem = index === items.length - 1
    if (isLastItem || performance.now() - sliceStart < budgetMs) continue

    endSliceSpan?.()
    await yieldToMain()
    sliceStart = performance.now()
    endSliceSpan = perfSpanName ? startPerfSpan(perfSpanName) : null
  }

  endSliceSpan?.()
}

export { forEachInSlices, SLICE_BUDGET_MS, yieldToMain }

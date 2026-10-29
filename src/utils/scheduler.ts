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
 */
async function forEachInSlices<T>(
  items: readonly T[],
  fn: (item: T) => void,
  { budgetMs = SLICE_BUDGET_MS }: { budgetMs?: number } = {}
) {
  let sliceStart = performance.now()

  for (const [index, item] of items.entries()) {
    fn(item)

    const isLastItem = index === items.length - 1
    if (isLastItem || performance.now() - sliceStart < budgetMs) continue

    await yieldToMain()
    sliceStart = performance.now()
  }
}

export { forEachInSlices, SLICE_BUDGET_MS, yieldToMain }

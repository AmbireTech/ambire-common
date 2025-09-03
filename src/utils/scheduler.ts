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

export { yieldToMain }

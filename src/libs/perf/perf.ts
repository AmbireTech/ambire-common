/**
 * Ends a span started with `startPerfSpan`, recording how long it held the JS thread.
 */
export type EndPerfSpan = () => void

/**
 * Records spans of synchronous work. Registered by an app that profiles where its JS thread time
 * goes (the mobile interaction profiler); nothing is recorded while none is registered.
 */
export type PerfRecorder = {
  startSpan: (name: string) => EndPerfSpan
}

const noop: EndPerfSpan = () => {}

let recorder: PerfRecorder | null = null

/** Registers the app's recorder. Without one, every span is a no-op. */
export const setPerfRecorder = (nextRecorder: PerfRecorder | null) => {
  recorder = nextRecorder
}

/**
 * Starts timing a block of synchronous work, e.g. a loop over a large list. Call the returned
 * function where the block ends. A block that throws is simply not recorded.
 */
export const startPerfSpan = (name: string): EndPerfSpan =>
  recorder ? recorder.startSpan(name) : noop

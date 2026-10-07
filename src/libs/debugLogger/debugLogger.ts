// Module-level debug logging shared by EventEmitter (controllers) and pure libs
// (which have no `this`). Logging is per-controller (namespace) on/off, toggled
// and persisted by DebugController. `flow` is only an embedded tag for console
// filtering (e.g. "[PortfolioController:simulation]").
//
// Output goes to the console AND to a capped in-memory ring buffer of *serialized
// strings* per namespace. Strings (not live objects) are stored so DevTools cannot
// retain unbounded expandable object graphs, and the cap frees memory deterministically.

import { stringify } from '@/libs/richJson/richJson'

const LIMIT_PER_NAMESPACE = 200

// Controllers NOT constructed by MainController at startup (they're created on
// demand inside other controllers), so they'd be missing from the UI catalog
// until their flow first runs. Seed them so their toggles are available cold,
// letting a dev pre-enable logging before triggering the flow.
export const SEED_NAMESPACES = [
  'SignAccountOpController',
  'EstimationController',
  'GasPriceController'
]

const enabled = new Set<string>()
const known = new Set<string>(SEED_NAMESPACES)
const buffers = new Map<string, string[]>()
const subscribers = new Set<() => void>()

// richJson.stringify preserves nested objects/arrays (plain JSON) and additionally
// supports BigInt and Error values, which the wallet's debug payloads commonly carry.
function serialize(payload: unknown): string {
  if (payload === undefined) return ''
  try {
    return ` ${stringify(payload)}`
  } catch {
    return ' [unserializable payload]'
  }
}

export type DebugLogOptions = {
  /**
   * Can be used to correlate related log lines across flows and controllers. E.g.,
   * every log inside of a portfolio update has the same traceId, so one can filter for that ID in the console.
   * Although nice, this is a lot more cumbersome for complex flows so we don't require it and it's opt-in per log line rather than per logger.
   */
  traceId?: string
  level?: 'log' | 'warn'
}

export const debugLoggerRegistry = {
  isEnabled: (namespace: string) => enabled.has(namespace),
  // Every EventEmitter registers its name on construction, so this is the full,
  // self-maintaining catalog of toggleable controllers for the UI.
  registerNamespace: (namespace: string) => {
    if (known.has(namespace)) return
    known.add(namespace)
    subscribers.forEach((cb) => cb())
  },
  catalog: () => [...known].sort(),
  setEnabled: (namespace: string, value: boolean) => {
    if (value) enabled.add(namespace)
    else enabled.delete(namespace)
    subscribers.forEach((cb) => cb())
  },
  hydrate: (state: Record<string, boolean>) => {
    enabled.clear()
    Object.entries(state).forEach(([namespace, on]) => {
      if (!on) return
      enabled.add(namespace)
      // A persisted-enabled controller stays visible in the UI on boot even before
      // it has been (re)constructed - so a dynamic one can be seen and turned off.
      known.add(namespace)
    })
    subscribers.forEach((cb) => cb())
  },
  snapshot: (): Record<string, boolean> =>
    Object.fromEntries([...enabled].map((namespace) => [namespace, true])),
  // Recent serialized lines for a namespace, for an on-demand dump from the console.
  read: (namespace: string) => buffers.get(namespace) ?? [],
  clear: (namespace?: string) => (namespace ? buffers.delete(namespace) : buffers.clear()),
  subscribe: (cb: () => void) => {
    subscribers.add(cb)
    return () => {
      subscribers.delete(cb)
    }
  }
}

export function debugLog(
  namespace: string,
  flow: string,
  message: string,
  payload?: unknown | (() => unknown),
  options?: DebugLogOptions
): void {
  if (!enabled.has(namespace)) return

  let data = undefined

  try {
    data = (typeof payload === 'function' ? (payload as () => unknown)() : payload) as unknown
  } catch (err) {
    console.error(`Debug: ${namespace}:${flow} payload function threw`, err)
  }
  const scope = `${namespace}:${flow}`
  const prefix = options?.traceId ? `${options.traceId}:${scope}` : `${scope}`
  const line = `Debug: ${prefix} (at ${Date.now()}) ${message}${data ? serialize(data) : ' No payload (perhaps an error?)'}`

  const buffer = buffers.get(namespace) ?? []
  buffer.push(line)
  if (buffer.length > LIMIT_PER_NAMESPACE) buffer.shift()
  buffers.set(namespace, buffer)
  ;(options?.level === 'warn' ? console.warn : console.log)(line)
}

/**
 * Used by libraries to create a logger function pre-bound to their namespace, so they
 * don't have to pass the namespace on every call. Example: Used by the portfolio lib to
 * log under the PortfolioController namespace
 */
export function createScopedDebugLogger<Flow extends string = string>(namespace: string) {
  debugLoggerRegistry.registerNamespace(namespace)
  return (
    flow: Flow,
    message: string,
    payload?: unknown | (() => unknown),
    options?: DebugLogOptions
  ) => debugLog(namespace, flow, message, payload, options)
}

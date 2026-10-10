/**
 * Temporary profiling of Privacy Pools syncs and withdrawals, to find where the time goes and to
 * report it to Kohaku. Remove once that is settled.
 *
 * Every line starts with `[kohaku-debug]`, so filtering the console by it shows the whole timeline.
 * A trace (one withdrawal, one sync, one broadcast) prints each call it can see as it finishes,
 * with its offset from the start of the trace, its duration and how long nothing visible was
 * running before it. That idle time is the SDK's own CPU work (Merkle trees, serialization) and the
 * calls it makes without going through us (the bundler), which cannot be timed from outside.
 *
 * Nothing secret is logged: no phrases, keys, derivation paths, note secrets, proof inputs, amounts
 * or recipients - only timings, counts and gas figures.
 */
export const IS_KOHAKU_DEBUG_ENABLED = true

const KOHAKU_DEBUG_PREFIX = '[kohaku-debug]'

/** Calls faster than this are folded into the summary without a line of their own. */
const MIN_LOGGED_CALL_MS = 50

type CallStats = { count: number; totalMs: number; maxMs: number }

export type KohakuDebugTrace = {
  id: string
  startedAt: number
  /** Leaf calls in flight; idle time is only counted while there are none. */
  inFlight: number
  lastBusyAt: number
  idleMs: number
  calls: Map<string, CallStats>
  phases: { label: string; ms: number }[]
}

let traceCount = 0
const openTraces: KohakuDebugTrace[] = []

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

const seconds = (ms: number) => `${(ms / 1000).toFixed(3)}s`

/** Logs one `[kohaku-debug]` line. */
export const kohakuDebugLog = (message: string, details?: Record<string, unknown>) => {
  if (!IS_KOHAKU_DEBUG_ENABLED) return

  if (details) console.log(`${KOHAKU_DEBUG_PREFIX} ${message}`, details)
  else console.log(`${KOHAKU_DEBUG_PREFIX} ${message}`)
}

const currentTrace = () => openTraces[openTraces.length - 1]

const tracePrefix = (trace: KohakuDebugTrace | undefined, at: number) =>
  trace ? `${trace.id} +${seconds(at - trace.startedAt)}` : 'untraced'

/**
 * Starts timing one operation. Calls made through the wrapped SDK dependencies are recorded into
 * the most recently started trace that is still open.
 */
export const startKohakuDebugTrace = (
  name: string,
  details?: Record<string, unknown>
): KohakuDebugTrace | null => {
  if (!IS_KOHAKU_DEBUG_ENABLED) return null

  traceCount += 1
  const startedAt = now()
  const trace: KohakuDebugTrace = {
    id: `${name}#${traceCount}`,
    startedAt,
    inFlight: 0,
    lastBusyAt: startedAt,
    idleMs: 0,
    calls: new Map(),
    phases: []
  }
  openTraces.push(trace)
  kohakuDebugLog(`${trace.id} started`, details)

  return trace
}

/**
 * Times one of our own steps of a trace. Not counted as busy time, so the SDK's idle time inside it
 * still shows.
 */
export const kohakuDebugPhase = async <T>(
  trace: KohakuDebugTrace | null,
  label: string,
  run: () => Promise<T>
): Promise<T> => {
  if (!trace) return run()

  const startedAt = now()
  try {
    return await run()
  } finally {
    const ms = now() - startedAt
    trace.phases.push({ label, ms })
    kohakuDebugLog(`${tracePrefix(trace, startedAt)} phase ${label} took ${seconds(ms)}`)
  }
}

const countResult = (result: unknown): number | undefined => {
  if (Array.isArray(result)) return result.length
  if (!result || typeof result !== 'object') return undefined

  const arrays = Object.values(result).filter(Array.isArray)
  if (!arrays.length) return undefined

  return arrays.reduce((sum, array) => sum + array.length, 0)
}

/**
 * Times one call the SDK makes through us, recording it into the current trace.
 *
 * `quiet` calls are only summed into the summary - for the ones made hundreds of times a sync.
 */
export const kohakuDebugCall = async <T>(
  label: string,
  run: () => Promise<T>,
  options: { quiet?: boolean; details?: (result: T) => Record<string, unknown> } = {}
): Promise<T> => {
  if (!IS_KOHAKU_DEBUG_ENABLED) return run()

  const trace = currentTrace()
  const startedAt = now()
  let idleBefore = 0
  if (trace) {
    if (trace.inFlight === 0) {
      idleBefore = startedAt - trace.lastBusyAt
      trace.idleMs += idleBefore
    }
    trace.inFlight += 1
  }

  let result: T | undefined
  let failed = false
  try {
    result = await run()
    return result
  } catch (error) {
    failed = true
    throw error
  } finally {
    const endedAt = now()
    const ms = endedAt - startedAt

    if (trace) {
      trace.inFlight -= 1
      if (trace.inFlight === 0) trace.lastBusyAt = endedAt

      const stats = trace.calls.get(label) || { count: 0, totalMs: 0, maxMs: 0 }
      trace.calls.set(label, {
        count: stats.count + 1,
        totalMs: stats.totalMs + ms,
        maxMs: Math.max(stats.maxMs, ms)
      })
    }

    const isWorthALine =
      !options.quiet && (ms >= MIN_LOGGED_CALL_MS || idleBefore >= MIN_LOGGED_CALL_MS)
    if (isWorthALine) {
      const size = failed ? undefined : countResult(result)
      let extra: Record<string, unknown> = {}
      try {
        extra = !failed && options.details ? options.details(result as T) : {}
      } catch (error) {
        extra = { detailsError: String(error) }
      }

      kohakuDebugLog(
        `${tracePrefix(trace, startedAt)} ${label} took ${seconds(ms)}${
          idleBefore >= MIN_LOGGED_CALL_MS
            ? ` (SDK busy/invisible ${seconds(idleBefore)} before it)`
            : ''
        }${failed ? ' FAILED' : ''}`,
        size === undefined && !Object.keys(extra).length ? undefined : { items: size, ...extra }
      )
    }
  }
}

/** Closes a trace and prints where its time went, plus whatever the caller adds. */
export const endKohakuDebugTrace = (
  trace: KohakuDebugTrace | null,
  summary: Record<string, unknown> = {}
) => {
  // Already ended - a failure after the summary was printed must not print a second one
  const index = trace ? openTraces.indexOf(trace) : -1
  if (!trace || index === -1) return

  const endedAt = now()
  openTraces.splice(index, 1)

  // Idle time since the last call is the tail of the trace, the same kind of invisible work
  const tailIdleMs = trace.inFlight === 0 ? endedAt - trace.lastBusyAt : 0
  const calls = Object.fromEntries(
    [...trace.calls.entries()].map(([label, stats]) => [
      label,
      {
        count: stats.count,
        total: seconds(stats.totalMs),
        max: seconds(stats.maxMs)
      }
    ])
  )

  const fullSummary = {
    ...summary,
    phases: Object.fromEntries(trace.phases.map(({ label, ms }) => [label, seconds(ms)])),
    calls,
    sdkBusyOrInvisible: seconds(trace.idleMs + tailIdleMs)
  }

  // As text rather than an object, so copying the console line copies all of it - a logged object
  // is copied collapsed
  kohakuDebugLog(
    `${trace.id} finished in ${seconds(endedAt - trace.startedAt)}\n${JSON.stringify(
      fullSummary,
      (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
      2
    )}`
  )
}

/**
 * Wraps an SDK dependency object (the data service, the ASP service) so that every method returning
 * a promise is timed under `<name>.<method>`.
 */
export const withKohakuDebugTiming = <T extends object>(target: T, name: string): T => {
  if (!IS_KOHAKU_DEBUG_ENABLED) return target

  return new Proxy(target, {
    get(object, property, receiver) {
      const value = Reflect.get(object, property, receiver)
      if (typeof value !== 'function' || typeof property !== 'string') return value

      return (...args: unknown[]) => {
        const result = value.apply(object, args)
        if (!(result instanceof Promise)) return result

        return kohakuDebugCall(`${name}.${property}`, () => result)
      }
    }
  })
}

type KohakuProverLike = { prove: (circuit: any, signals: any) => Promise<any> }

const countNonZero = (values: unknown) =>
  Array.isArray(values) ? values.filter((value) => String(value) !== '0').length : undefined

/**
 * Times each proof. The tree depths come from the count of non-zero Merkle siblings - roughly
 * log2 of each tree's leaves, and the only thing read from the inputs.
 */
export const withKohakuDebugProver = <P extends KohakuProverLike>(
  proverFactory: () => Promise<P>
): (() => Promise<P>) => {
  if (!IS_KOHAKU_DEBUG_ENABLED) return proverFactory

  return async () => {
    // Loaded once and cached, so this is only worth a line the first time
    const prover = await kohakuDebugCall('prover.loadArtifacts', proverFactory)

    return {
      ...prover,
      prove: (circuit: any, signals: any) =>
        kohakuDebugCall(`proof.${circuit}`, () => prover.prove(circuit, signals), {
          details: () => ({
            stateTreeDepth: countNonZero(signals?.stateSiblings),
            aspTreeDepth: countNonZero(signals?.ASPSiblings)
          })
        })
    }
  }
}

/**
 * Counts the leaves of every Merkle tree the SDK rebuilds for each proof, from `dumpState()`.
 * Never throws: debugging must not break what it watches, so a plugin without `dumpState` or a
 * changed state shape only loses the counts.
 */
export const readKohakuDebugTreeSizes = (dumpState: () => unknown): Record<string, unknown> => {
  try {
    const stores = Object.values((dumpState() || {}) as Record<string, any>)

    return Object.fromEntries(
      stores.map((store, index) => [
        `store${index}`,
        {
          aspLeaves: store?.asp?.leaves?.length,
          poolLeaves: Object.fromEntries(
            (store?.poolsLeaves?.poolLeavesTuples || []).map(
              ([pool, leaves]: [string, unknown[]]) => [String(pool), leaves?.length]
            )
          ),
          deposits: store?.deposits?.depositsTuples?.length,
          withdrawals: store?.withdrawals?.withdrawalsTuples?.length
        }
      ])
    )
  } catch (error) {
    return { treeSizesError: String(error) }
  }
}

/** The SDK's own multiplier on the sum of the gas limits when it locks the fee into the proof. */
const SDK_FEE_CAP_MULTIPLIER_PERCENT = 120n

const byteLength = (hex: string | undefined) => (hex ? Math.max(0, (hex.length - 2) / 2) : 0)

const toGwei = (wei: bigint) => (Number(wei) / 1e9).toFixed(3)

/**
 * The gas limits and prices a prepared userOp carries, and the gas its fee cap pays for.
 *
 * `callGasLimit` is 0 for one note and the SDK's fixed per-note budget for a batch; the bundler only
 * refines the rest. The calldata sizes matter because every extra note adds a proof to `callData`
 * while `preVerificationGas`, which pays for it, does not move.
 */
export const describeKohakuDebugUserOperationGas = (userOperation: {
  callData: string
  callGasLimit: string
  verificationGasLimit: string
  preVerificationGas: string
  maxFeePerGas: string
  maxPriorityFeePerGas: string
  paymasterVerificationGasLimit?: string
  paymasterPostOpGasLimit?: string
  paymasterData?: string
}): Record<string, unknown> => {
  const limits = {
    verificationGasLimit: BigInt(userOperation.verificationGasLimit),
    callGasLimit: BigInt(userOperation.callGasLimit),
    preVerificationGas: BigInt(userOperation.preVerificationGas),
    paymasterVerificationGasLimit: BigInt(userOperation.paymasterVerificationGasLimit ?? 0),
    paymasterPostOpGasLimit: BigInt(userOperation.paymasterPostOpGasLimit ?? 0)
  }
  const sumOfLimits = Object.values(limits).reduce((sum, limit) => sum + limit, 0n)

  return {
    ...Object.fromEntries(Object.entries(limits).map(([key, value]) => [key, value.toString()])),
    sumOfLimits: sumOfLimits.toString(),
    feeCapGas: ((sumOfLimits * SDK_FEE_CAP_MULTIPLIER_PERCENT) / 100n).toString(),
    maxFeePerGasGwei: toGwei(BigInt(userOperation.maxFeePerGas)),
    maxPriorityFeePerGasGwei: toGwei(BigInt(userOperation.maxPriorityFeePerGas)),
    callDataBytes: byteLength(userOperation.callData),
    paymasterDataBytes: byteLength(userOperation.paymasterData)
  }
}

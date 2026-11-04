import { Call } from '../../libs/accountOp/types'
import { PhraseScopedModule, PrivacyPoolsContext } from './context'

export type BuiltCallKind = 'deposit' | 'ragequit'

/**
 * A deposit or ragequit call this wallet built, with the account and chain it changes. Once the
 * call is broadcast, `broadcast` holds the account's notes as they were then.
 */
export type BuiltCall = {
  seedId: string
  chainId: string
  kind: BuiltCallKind
  /** `baseline` is a fingerprint of the notes, or null when the chain had not been read yet. */
  broadcast: { baseline: string | null } | null
}

/** Identifies a call the same way wherever it ends up, without decoding it. */
export const getCallKey = (chainId: bigint | string, { to, value, data }: Call) =>
  `${chainId}:${(to || '').toLowerCase()}:${value}:${data.toLowerCase()}`

/**
 * The deposit and ragequit calls this wallet built, so that a transaction that carries one can be
 * traced back to the account it changes, however it was signed. Kept in memory only, as a local
 * log would link deposits to their withdrawals. Lost on a restart, which the periodic sync covers.
 *
 * The calls survive a lock: one built before it may be broadcast or land after it, and must still
 * be recognised. The calls are public once broadcast, but a baseline is a fingerprint of the
 * account's notes, which is derived from the phrase, so a lock drops it.
 */
export class PrivacyPoolsBuiltCalls implements PhraseScopedModule {
  #ctx: PrivacyPoolsContext

  #builtCalls = new Map<string, BuiltCall>()

  constructor(ctx: PrivacyPoolsContext) {
    this.#ctx = ctx
  }

  /**
   * Remembers a call built for an account. Drops the earlier calls of the same kind built for it
   * that nothing is waiting to send, as a form builds a new one on every change of its amount.
   */
  add({
    chainId,
    call,
    seedId,
    kind
  }: {
    chainId: string
    call: Call
    seedId: string
    kind: BuiltCallKind
  }) {
    const pendingKeys = new Set(
      this.#ctx
        .getPendingAccountOps()
        .flatMap((op) => op.calls.map((pendingCall) => getCallKey(op.chainId, pendingCall)))
    )

    this.#builtCalls.forEach((builtCall, key) => {
      const isSameAccount = builtCall.seedId === seedId && builtCall.chainId === chainId
      if (isSameAccount && builtCall.kind === kind && !builtCall.broadcast && !pendingKeys.has(key))
        this.#builtCalls.delete(key)
    })

    const key = getCallKey(chainId, call)
    if (!this.#builtCalls.has(key))
      this.#builtCalls.set(key, { seedId, chainId, kind, broadcast: null })
  }

  /**
   * Records that a call built here was broadcast, with the account's notes as of now. A call
   * built elsewhere is ignored, and so is one already marked.
   */
  markBroadcast(chainId: bigint, call: Call, getBaseline: (builtCall: BuiltCall) => string | null) {
    const builtCall = this.#builtCalls.get(getCallKey(chainId, call))
    if (!builtCall || builtCall.broadcast) return

    builtCall.broadcast = { baseline: getBaseline(builtCall) }
  }

  /** Forgets the call and returns what was known of it, if it was built here. */
  take(chainId: bigint, call: Call): BuiltCall | undefined {
    const key = getCallKey(chainId, call)
    const builtCall = this.#builtCalls.get(key)
    this.#builtCalls.delete(key)

    return builtCall
  }

  /** Only a baseline is derived from the phrase, so a call without one is not reported. */
  hasPhraseDerivedState(): boolean {
    return [...this.#builtCalls.values()].some((builtCall) => !!builtCall.broadcast?.baseline)
  }

  forgetSeed(seedId: string) {
    this.#builtCalls.forEach((builtCall, key) => {
      if (builtCall.seedId === seedId) this.#builtCalls.delete(key)
    })
  }

  /** Drops every baseline but keeps the calls, so a broadcast one is still recognised later. */
  clear() {
    this.#builtCalls.forEach((builtCall) => {
      if (builtCall.broadcast) builtCall.broadcast.baseline = null
    })
  }
}

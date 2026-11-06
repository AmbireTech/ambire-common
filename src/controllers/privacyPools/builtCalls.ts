import { Call } from '../../libs/accountOp/types'
import { PrivacyPoolsContext } from './context'

export type BuiltCallKind = 'deposit' | 'ragequit'

/** What is known of a built call when it is broadcast. */
export type BuiltCallBroadcast = {
  /** Its expected change in `PrivacyPoolsExpectedChanges`, or null when none was added. */
  changeId: number | null
}

/** A deposit or ragequit call this wallet built, and the account and network it is for. */
export type BuiltCall = {
  seedId: string
  chainId: string
  kind: BuiltCallKind
  /** The token the call moves, in the wallet's convention - `ZERO_ADDRESS` for native. */
  tokenAddress: string
  /**
   * What the call adds to the account's total of the token once it lands: a deposit's amount after
   * the pool's fee, or minus the whole deposit a ragequit takes back.
   */
  amount: bigint
  broadcast: BuiltCallBroadcast | null
}

/** Identifies a call the same way wherever it ends up, without decoding it. */
export const getCallKey = (chainId: bigint | string, { to, value, data }: Call) =>
  `${chainId}:${(to || '').toLowerCase()}:${value}:${data.toLowerCase()}`

/**
 * The deposit and ragequit calls this wallet built, so a finished transaction can be matched to
 * its Privacy Pools account. Kept in memory only, as a stored log would link deposits to
 * withdrawals. Kept through a lock, as a call may land after it.
 */
export class PrivacyPoolsBuiltCalls {
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
    kind,
    tokenAddress,
    amount
  }: Pick<BuiltCall, 'seedId' | 'chainId' | 'kind' | 'tokenAddress' | 'amount'> & {
    call: Call
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
      this.#builtCalls.set(key, { seedId, chainId, kind, tokenAddress, amount, broadcast: null })
  }

  /** Marks a call built here as sent and stores the id from `getChangeId`. Ignores other calls. */
  markBroadcast(chainId: bigint, call: Call, getChangeId: (builtCall: BuiltCall) => number | null) {
    const builtCall = this.#builtCalls.get(getCallKey(chainId, call))
    if (!builtCall || builtCall.broadcast) return

    builtCall.broadcast = { changeId: getChangeId(builtCall) }
  }

  /** Forgets the call and returns what was known of it, if it was built here. */
  take(chainId: bigint, call: Call): BuiltCall | undefined {
    const key = getCallKey(chainId, call)
    const builtCall = this.#builtCalls.get(key)
    this.#builtCalls.delete(key)

    return builtCall
  }

  forgetSeed(seedId: string) {
    this.#builtCalls.forEach((builtCall, key) => {
      if (builtCall.seedId === seedId) this.#builtCalls.delete(key)
    })
  }
}

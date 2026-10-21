import { getPrivacyPoolsStoreKey } from '../../consts/privacyPools'
import { Hex } from '../../interfaces/hex'
import { PrivacyPoolsNote, PrivacyPoolsRagequitDeposit } from '../../interfaces/privacyPools'
import { Call } from '../../libs/accountOp/types'
import {
  readPrivacyPoolsDepositors,
  readPrivacyPoolsRagequit
} from '../../libs/privacyPools/ragequit'
import { getChainConfig, PrivacyPoolsContext } from './context'
import { privacyPoolsErrors } from './errors'
import { PrivacyPoolsProtocolRegistry } from './protocolRegistry'
import { PrivacyPoolsSync } from './sync'

/**
 * Taking back deposits that are still being verified (ragequit): publicly and in full, to the
 * account that made them, which is the only one the pool lets do it. Verified deposits are sent
 * from the Privacy Pools account instead, so they are never offered here.
 *
 * Holds nothing of its own: the notes come from the last sync, and the depositors from this
 * device's copy of the pools' history, so nothing about single deposits is asked of the network.
 */
export class PrivacyPoolsRagequit {
  #ctx: PrivacyPoolsContext

  #registry: PrivacyPoolsProtocolRegistry

  #sync: PrivacyPoolsSync

  constructor(
    ctx: PrivacyPoolsContext,
    registry: PrivacyPoolsProtocolRegistry,
    sync: PrivacyPoolsSync
  ) {
    this.#ctx = ctx
    this.#registry = registry
    this.#sync = sync
  }

  /** A token's deposits that can be taken back, each with the account it would go back to. */
  async getDeposits({
    seedId,
    chainId,
    tokenAddress
  }: {
    seedId: string
    chainId: string
    tokenAddress: string
  }): Promise<PrivacyPoolsRagequitDeposit[]> {
    const notes = this.#getPendingNotes(seedId, chainId).filter(
      (note) => note.tokenAddress.toLowerCase() === tokenAddress.toLowerCase()
    )
    if (!notes.length) return []

    const depositors = await this.#readDepositors(
      chainId,
      notes.map(({ label }) => label)
    )

    return notes.map(({ label, amount }) => ({
      label,
      amount,
      depositorAddr: this.#getDepositor(depositors, label)
    }))
  }

  /**
   * Proves the deposit's reclaim and returns it as a call of the account that made it, for the
   * regular signing flow. The call is checked against the deposit before it is handed over, as
   * the SDK picks the pool and leaves out a deposit it could not prove for.
   */
  async buildCalls({
    seedId,
    chainId,
    label
  }: {
    seedId: string
    chainId: string
    label: bigint
  }): Promise<{ accountAddr: Hex; calls: Call[] }> {
    const generation = this.#ctx.lock.current
    const note = this.#getPendingNotes(seedId, chainId).find((n) => n.label === label)
    if (!note) throw privacyPoolsErrors.ragequitDepositNotFound()

    const depositors = await this.#readDepositors(chainId, [label])
    const accountAddr = this.#getDepositor(depositors, label)

    let txns: { to: string; data: string; value: bigint }[]
    try {
      const protocol = await this.#registry.getProtocol(chainId, seedId)
      ;({ txns } = await protocol.ragequit([label]))
    } catch (error) {
      throw privacyPoolsErrors.ragequitPreparationFailed(error)
    }

    // Built from the phrase's secrets, so not handed over once they are gone
    if (!this.#ctx.lock.isCurrent(generation)) throw privacyPoolsErrors.locked()
    if (!this.#ctx.hasAccount(seedId)) throw privacyPoolsErrors.depositAccountRemoved(seedId)

    const [txn] = txns
    if (!txn || txns.length !== 1)
      throw privacyPoolsErrors.ragequitPreparationFailed(
        new Error(`privacyPools: the SDK built ${txns.length} ragequit calls for one deposit`)
      )

    const ragequit = readPrivacyPoolsRagequit(txn.data)
    const poolAsset = getChainConfig(chainId).pools[txn.to.toLowerCase()]
    const isForTheDeposit =
      !!ragequit &&
      ragequit.label === label &&
      ragequit.amount === note.amount &&
      txn.value === 0n &&
      poolAsset?.toLowerCase() === note.tokenAddress.toLowerCase()
    if (!isForTheDeposit)
      throw privacyPoolsErrors.ragequitPreparationFailed(
        new Error('privacyPools: the SDK built a ragequit call not matching the deposit')
      )

    return { accountAddr, calls: [{ to: txn.to, value: 0n, data: txn.data }] }
  }

  /** The account's deposits on the chain still being verified, with something left in them. */
  #getPendingNotes(seedId: string, chainId: string): PrivacyPoolsNote[] {
    const notes = this.#sync.getAccountChainStates(seedId)[chainId]?.notes || []

    return notes.filter(({ approval, amount }) => approval === 'pending' && amount > 0n)
  }

  async #readDepositors(chainId: string, labels: bigint[]): Promise<Map<bigint, Hex>> {
    try {
      const storedState = await this.#ctx.kohakuStorage.get(
        getPrivacyPoolsStoreKey(getChainConfig(chainId))
      )

      return readPrivacyPoolsDepositors(storedState, labels)
    } catch (error) {
      throw privacyPoolsErrors.ragequitDepositsReadFailed(error)
    }
  }

  /** Every note comes from a deposit the same sync persisted, so one missing is a broken state. */
  #getDepositor(depositors: Map<bigint, Hex>, label: bigint): Hex {
    const depositor = depositors.get(label)
    if (!depositor)
      throw privacyPoolsErrors.ragequitDepositsReadFailed(
        new Error(`privacyPools: no stored deposit for label ${label}`)
      )

    return depositor
  }
}

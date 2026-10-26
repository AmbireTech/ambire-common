import { Hex } from '../../interfaces/hex'
import { PrivacyPoolsNote, PrivacyPoolsRagequitDeposit } from '../../interfaces/privacyPools'
import { Call } from '../../libs/accountOp/types'
import { readPrivacyPoolsRagequit } from '../../libs/privacyPools/ragequit'
import { getChainConfig, PrivacyPoolsContext } from './context'
import { privacyPoolsErrors } from './errors'
import { PrivacyPoolsProtocolRegistry } from './protocolRegistry'
import { PrivacyPoolsSync } from './sync'

/**
 * Taking back deposits that are still being verified (ragequit): publicly and in full, to the
 * account that made them, which is the only one the pool lets do it. Verified deposits are sent
 * from the Privacy Pools account instead, so they are never offered here.
 *
 * Holds nothing of its own: the notes, with the account each deposit came from, are those of the
 * last sync, so nothing about single deposits is asked of the network.
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

  /** A token's deposits that can be taken back, newest first, each with the account it goes back to. */
  getDeposits({
    seedId,
    chainId,
    tokenAddress
  }: {
    seedId: string
    chainId: string
    tokenAddress: string
  }): PrivacyPoolsRagequitDeposit[] {
    return this.#getPendingNotes(seedId, chainId)
      .filter((note) => note.tokenAddress.toLowerCase() === tokenAddress.toLowerCase())
      .sort((a, b) => b.depositIndex - a.depositIndex)
      .map(({ label, amount, depositorAddr }) => ({ label, amount, depositorAddr }))
  }

  /**
   * Proves the deposit's reclaim and returns it as a call of the account that made it, for the
   * regular signing flow. The call is checked against the deposit before it is handed over, as
   * the SDK picks the pool and leaves out a deposit it could not prove for. Then the deposit is
   * read again, as it may have been verified while it was proved.
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
    // The SDK syncs before proving, outside the queue, so wait for this account's sync of the
    // chain rather than run beside it on the same plugin, as a withdrawal does
    await (this.#sync.getRunningSync(seedId, chainId) || Promise.resolve())
    if (!this.#ctx.lock.isCurrent(generation)) throw privacyPoolsErrors.locked()

    const note = this.#getPendingNotes(seedId, chainId).find((n) => n.label === label)
    if (!note) throw privacyPoolsErrors.ragequitDepositNotFound()

    let txns: { to: string; data: string; value: bigint }[]
    try {
      const protocol = await this.#registry.getProtocol(chainId, seedId)
      ;({ txns } = await protocol.ragequit([label]))
    } catch (error) {
      throw privacyPoolsErrors.ragequitPreparationFailed(error)
    }

    // Built from the phrase's secrets, so not handed over once they are gone
    this.#assertSecretsHeld(seedId, generation)

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

    // The SDK synced before proving, so the deposit may have been verified since our last sync.
    // It would then go back publicly although it could be sent privately, so it is read again,
    // through the queue so that read never runs beside another sync of the plugin
    const epoch = this.#sync.getEpoch(chainId, seedId)
    await this.#sync.queue(chainId, seedId)
    this.#assertSecretsHeld(seedId, generation)
    // The queue never rejects: a failed sync leaves the notes as they were, unread
    if (this.#sync.getEpoch(chainId, seedId) === epoch)
      throw privacyPoolsErrors.ragequitPreparationFailed(
        new Error('privacyPools: the deposit could not be read again after proving its ragequit')
      )

    const syncedNote = (this.#sync.getAccountChainStates(seedId)[chainId]?.notes || []).find(
      (n) => n.label === label
    )
    if (syncedNote?.approval === 'approved') throw privacyPoolsErrors.ragequitDepositVerified()
    if (syncedNote?.amount !== note.amount) throw privacyPoolsErrors.ragequitDepositNotFound()

    return { accountAddr: note.depositorAddr, calls: [{ to: txn.to, value: 0n, data: txn.data }] }
  }

  /** Throws once the wallet was locked or the account removed since `generation` was read. */
  #assertSecretsHeld(seedId: string, generation: number) {
    if (!this.#ctx.lock.isCurrent(generation)) throw privacyPoolsErrors.locked()
    if (!this.#ctx.hasAccount(seedId)) throw privacyPoolsErrors.depositAccountRemoved(seedId)
  }

  /** The account's deposits on the chain still being verified, with something left in them. */
  #getPendingNotes(seedId: string, chainId: string): PrivacyPoolsNote[] {
    const notes = this.#sync.getAccountChainStates(seedId)[chainId]?.notes || []

    return notes.filter(({ approval, amount }) => approval === 'pending' && amount > 0n)
  }
}

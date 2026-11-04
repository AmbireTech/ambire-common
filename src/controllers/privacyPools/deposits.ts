import { Interface } from 'ethers'

import EmittableError from '../../classes/EmittableError'
import { getPrivacyPoolsDepositAsset, toPrivacyPoolsAssetAddress } from '../../consts/privacyPools'
import { PrivacyPoolsDepositAssetConfig } from '../../interfaces/privacyPools'
import { Call } from '../../libs/accountOp/types'
import { encodePrivacyPoolsDeposit, readPrivacyPoolsDeposit } from '../../libs/privacyPools/deposit'
import { readEntrypointAssetConfig } from '../../libs/privacyPools/entrypointAssetConfig'
import { ZERO_ADDRESS } from '../../services/socket/constants'
import { PrivacyPoolsBuiltCalls } from './builtCalls'
import {
  AssetRef,
  getChainConfig,
  getChainProvider,
  PhraseScopedModule,
  PrivacyPoolsContext
} from './context'
import { privacyPoolsErrors } from './errors'
import { PrivacyPoolsProtocolRegistry } from './protocolRegistry'
import { PrivacyPoolsSync } from './sync'
import { PrivacyPoolsWatches } from './watches'

const ERC20_INTERFACE = new Interface([
  'function approve(address spender, uint256 amount)',
  'function allowance(address owner, address spender) view returns (uint256)'
])

const readDepositPrecommitment = (data: string): bigint | null =>
  readPrivacyPoolsDeposit({ data, value: 0n })?.precommitment ?? null

/** A deposit from a wallet account into a Privacy Pools account. */
export type PrivacyPoolsDepositParams = AssetRef & {
  /** The Privacy Pools account receiving the funds. */
  seedId: string
  /** The wallet account sending them. */
  accountAddr: string
  chainId: string
  amount: bigint
}

/**
 * The next deposit's precommitment of an account on a chain, and the sync epoch it was derived
 * after (null while that sync runs). See `#getNextDepositPrecommitment`.
 */
type NextDepositPrecommitment = {
  seedId: string
  derivation: Promise<bigint>
  epoch: number | null
}

/**
 * Deposits into Privacy Pools accounts: building them, and refusing one while the previous one into
 * the same account is still pending.
 */
export class PrivacyPoolsDeposits implements PhraseScopedModule {
  #ctx: PrivacyPoolsContext

  #registry: PrivacyPoolsProtocolRegistry

  #sync: PrivacyPoolsSync

  #builtCalls: PrivacyPoolsBuiltCalls

  #watches: PrivacyPoolsWatches

  /** Entrypoint deposit requirements per `${chainId}:${tokenAddress}` (lowercase), read once. */
  assetConfigs: { [key: string]: PrivacyPoolsDepositAssetConfig } = {}

  /** Per `${chainId}:${seedId}`. See `#getNextDepositPrecommitment`. */
  #nextDepositPrecommitments = new Map<string, NextDepositPrecommitment>()

  constructor(
    ctx: PrivacyPoolsContext,
    registry: PrivacyPoolsProtocolRegistry,
    sync: PrivacyPoolsSync,
    builtCalls: PrivacyPoolsBuiltCalls,
    watches: PrivacyPoolsWatches
  ) {
    this.#ctx = ctx
    this.#registry = registry
    this.#sync = sync
    this.#builtCalls = builtCalls
    this.#watches = watches
  }

  /**
   * The deposit calls, once the controller has checked the account, the lock and the chain.
   * See `PrivacyPoolsController.buildDepositCalls`.
   */
  async buildCalls({
    seedId,
    accountAddr,
    chainId,
    tokenAddress,
    amount
  }: PrivacyPoolsDepositParams): Promise<Call[]> {
    const config = getChainConfig(chainId)

    const asset = getPrivacyPoolsDepositAsset(BigInt(chainId), tokenAddress)
    if (!asset) throw privacyPoolsErrors.depositUnsupportedToken(tokenAddress, chainId)

    if (amount > asset.maxDeposit)
      throw privacyPoolsErrors.depositAboveMaximum(asset.maxDeposit, asset)

    const { minimumDepositAmount, poolAddress } = await this.loadAssetConfig(chainId, tokenAddress)
    if (amount < minimumDepositAmount)
      throw privacyPoolsErrors.depositBelowMinimum(minimumDepositAmount, asset)

    // A pool the paymaster has no adapter for, e.g. one 0xBow replaced, could not be sent out of
    // until an update adds it, so the funds would wait for that update.
    if (!config.paymaster?.poolAdapters[poolAddress.toLowerCase()])
      throw privacyPoolsErrors.depositUnsupportedPool(asset.symbol, poolAddress)

    const precommitment = await this.#getNextDepositPrecommitment(chainId, seedId)

    if (this.#isDepositPending(seedId, chainId, precommitment))
      throw privacyPoolsErrors.depositAwaitingChain()

    const depositCall: Call = {
      to: config.entrypointAddress,
      ...encodePrivacyPoolsDeposit({
        isNative: asset.isNative,
        assetAddress: asset.address,
        amount,
        precommitment
      })
    }
    this.#builtCalls.add({ chainId, call: depositCall, seedId, kind: 'deposit' })

    if (asset.isNative) return [depositCall]

    return [...(await this.#approvalCallIfNeeded(chainId, asset, amount, accountAddr)), depositCall]
  }

  /** Reads the entrypoint's deposit requirements for an asset once, into `assetConfigs`. */
  async loadAssetConfig(
    chainId: string,
    tokenAddress: string
  ): Promise<PrivacyPoolsDepositAssetConfig> {
    const key = `${chainId}:${tokenAddress.toLowerCase()}`
    const loaded = this.assetConfigs[key]
    if (loaded) return loaded

    const config = getChainConfig(chainId)

    try {
      const assetConfig = await readEntrypointAssetConfig({
        provider: getChainProvider(this.#ctx.providers, chainId),
        entrypointAddress: config.entrypointAddress,
        assetAddress: toPrivacyPoolsAssetAddress(tokenAddress)
      })

      this.assetConfigs = { ...this.assetConfigs, [key]: assetConfig }
      this.#ctx.emitUpdate()

      return assetConfig
    } catch (error: any) {
      throw privacyPoolsErrors.depositAssetConfigReadFailed(error)
    }
  }

  hasPhraseDerivedState(): boolean {
    return !!this.#nextDepositPrecommitments.size
  }

  forgetSeed(seedId: string) {
    this.#nextDepositPrecommitments.forEach((entry, key) => {
      if (entry.seedId === seedId) this.#nextDepositPrecommitments.delete(key)
    })
  }

  /** Drops the precommitments derived ahead. */
  clear() {
    this.#nextDepositPrecommitments.clear()
  }

  /**
   * The next deposit's precommitment. It depends on the phrase's deposit count, not the amount, so
   * it is derived once per sync (deriving needs a sync first). Taken from an SDK-built deposit only
   * if that goes to the configured entrypoint.
   */
  #getNextDepositPrecommitment(chainId: string, seedId: string): Promise<bigint> {
    const key = `${chainId}:${seedId}`
    const cached = this.#nextDepositPrecommitments.get(key)
    const isCachedCurrent =
      !!cached && (cached.epoch === null || cached.epoch === this.#sync.getEpoch(chainId, seedId))
    if (cached && isCachedCurrent) return cached.derivation

    const entry: NextDepositPrecommitment = {
      seedId,
      derivation: Promise.resolve(0n),
      epoch: null
    }
    const derivation = (async () => {
      const config = getChainConfig(chainId)
      // prepareShield syncs anyway, so a chain already on this device only waits for a running
      // sync. A new chain still goes through the queue, which reads its history once.
      if (await this.#registry.isChainCold(config)) await this.#sync.queue(chainId, seedId)
      else await this.#sync.getRunningSync(seedId, chainId)
      // Pinned to the latest finished sync
      entry.epoch = this.#sync.getEpoch(chainId, seedId)

      const protocol = await this.#registry.getProtocol(chainId, seedId)
      const { txns } = await protocol.prepareShield({
        asset: { __type: 'erc20', contract: toPrivacyPoolsAssetAddress(ZERO_ADDRESS) },
        amount: 1n
      })
      const [txn] = txns
      if (!txn || txn.to.toLowerCase() !== config.entrypointAddress.toLowerCase())
        throw new Error('privacyPools: the prepared deposit does not go to the entrypoint')

      const precommitment = readDepositPrecommitment(txn.data)
      if (precommitment === null)
        throw new Error('privacyPools: the prepared deposit is not an entrypoint deposit')

      return precommitment
    })()

    entry.derivation = derivation
    this.#nextDepositPrecommitments.set(key, entry)
    // Not cached on failure, so the next attempt retries
    derivation.catch(() => {
      if (this.#nextDepositPrecommitments.get(key) === entry)
        this.#nextDepositPrecommitments.delete(key)
    })

    return derivation.catch((error) => {
      if (error instanceof EmittableError) throw error

      throw privacyPoolsErrors.depositPreparationFailed(error)
    })
  }

  /**
   * Whether a deposit with this precommitment is broadcast and not confirmed yet, or in the
   * current request batch. A second one would reuse the precommitment, which the entrypoint
   * rejects. Read from the transactions themselves, so it holds across a restart; one that failed,
   * was dropped or got stuck is no longer pending and frees the precommitment.
   *
   * Also while a deposit into the account's chain is still being looked for: one that landed is
   * not in the notes until a sync shows it, and until then the precommitment is the same.
   */
  #isDepositPending(seedId: string, chainId: string, precommitment: bigint): boolean {
    if (this.#watches.isWatchingDeposit(seedId, chainId)) return true

    const entrypointAddress = getChainConfig(chainId).entrypointAddress.toLowerCase()

    return this.#ctx
      .getPendingAccountOps()
      .some(
        (op) =>
          op.chainId.toString() === chainId &&
          op.calls.some(
            (call) =>
              call.to?.toLowerCase() === entrypointAddress &&
              readDepositPrecommitment(call.data) === precommitment
          )
      )
  }

  /**
   * The approval `Entrypoint.deposit`'s `transferFrom` needs, which the SDK does not build. A
   * leftover allowance is reset to zero first, as USDT refuses non-zero to non-zero.
   */
  async #approvalCallIfNeeded(
    chainId: string,
    asset: { address: string },
    amount: bigint,
    owner: string
  ): Promise<Call[]> {
    const config = getChainConfig(chainId)

    // Not an ethers `Contract`, whose generated methods are untyped
    const allowanceResult = await getChainProvider(this.#ctx.providers, chainId).call({
      to: asset.address,
      data: ERC20_INTERFACE.encodeFunctionData('allowance', [owner, config.entrypointAddress])
    })
    const allowance = ERC20_INTERFACE.decodeFunctionResult(
      'allowance',
      allowanceResult
    )[0] as bigint

    if (allowance >= amount) return []

    const approve = (value: bigint): Call => ({
      to: asset.address,
      value: 0n,
      data: ERC20_INTERFACE.encodeFunctionData('approve', [config.entrypointAddress, value])
    })

    return allowance ? [approve(0n), approve(amount)] : [approve(amount)]
  }
}

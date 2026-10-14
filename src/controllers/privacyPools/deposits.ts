import { Interface } from 'ethers'

import EmittableError from '../../classes/EmittableError'
import {
  getPrivacyPoolsChainConfig,
  getPrivacyPoolsDepositAsset,
  toPrivacyPoolsAssetAddress
} from '../../consts/privacyPools'
import { PrivacyPoolsDepositAssetConfig } from '../../interfaces/privacyPools'
import { Call } from '../../libs/accountOp/types'
import { encodePrivacyPoolsDeposit, readPrivacyPoolsDeposit } from '../../libs/privacyPools/deposit'
import { readEntrypointAssetConfig } from '../../libs/privacyPools/entrypointAssetConfig'
import { ZERO_ADDRESS } from '../../services/socket/constants'
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

/** How long a broadcast deposit blocks another into the same account. See `#broadcastDeposits`. */
const DEPOSIT_CONFIRMATION_WINDOW_MS = 15 * 60 * 1000

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

/** Deposits into Privacy Pools accounts: building them, and recognising them once broadcast. */
export class PrivacyPoolsDeposits implements PhraseScopedModule {
  #ctx: PrivacyPoolsContext

  #registry: PrivacyPoolsProtocolRegistry

  #sync: PrivacyPoolsSync

  /** Entrypoint deposit requirements per `${chainId}:${tokenAddress}` (lowercase), read once. */
  assetConfigs: { [key: string]: PrivacyPoolsDepositAssetConfig } = {}

  /** Per `${chainId}:${seedId}`. See `#getNextDepositPrecommitment`. */
  #nextDepositPrecommitments = new Map<string, NextDepositPrecommitment>()

  /** Deposits `buildCalls` prepared, by precommitment, so a broadcast can be recognised. */
  #preparedDeposits = new Map<bigint, { seedId: string; chainId: string }>()

  /**
   * Broadcast time per precommitment. A second deposit before the first lands would reuse its
   * precommitment, which the entrypoint rejects - so it is refused for a fixed window rather than
   * until seen on chain, which a never-landing broadcast would block forever.
   */
  #broadcastDeposits = new Map<bigint, number>()

  constructor(
    ctx: PrivacyPoolsContext,
    registry: PrivacyPoolsProtocolRegistry,
    sync: PrivacyPoolsSync
  ) {
    this.#ctx = ctx
    this.#registry = registry
    this.#sync = sync
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

    const { minimumDepositAmount } = await this.loadAssetConfig(chainId, tokenAddress)
    if (amount < minimumDepositAmount)
      throw privacyPoolsErrors.depositBelowMinimum(minimumDepositAmount, asset)

    const precommitment = await this.#getNextDepositPrecommitment(chainId, seedId)

    if (this.#isDepositAwaitingChain(precommitment)) throw privacyPoolsErrors.depositAwaitingChain()

    this.#preparedDeposits.set(precommitment, { seedId, chainId })

    const depositCall: Call = {
      to: config.entrypointAddress,
      ...encodePrivacyPoolsDeposit({
        isNative: asset.isNative,
        assetAddress: asset.address,
        amount,
        precommitment
      })
    }

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
      const { minimumDepositAmount } = await readEntrypointAssetConfig({
        provider: getChainProvider(this.#ctx.providers, chainId),
        entrypointAddress: config.entrypointAddress,
        assetAddress: toPrivacyPoolsAssetAddress(tokenAddress)
      })
      const assetConfig = { minimumDepositAmount }

      this.assetConfigs = { ...this.assetConfigs, [key]: assetConfig }
      this.#ctx.emitUpdate()

      return assetConfig
    } catch (error: any) {
      throw privacyPoolsErrors.depositAssetConfigReadFailed(error)
    }
  }

  /**
   * Marks a broadcast account op's deposits as awaiting the chain, however it was signed. Only
   * those `buildCalls` prepared are recognised, by precommitment - others are not this wallet's.
   * Nothing is persisted, as a local log would link deposits to their withdrawals.
   */
  onAccountOpBroadcast({ chainId, calls }: { chainId: bigint; calls: Call[] }) {
    const config = getPrivacyPoolsChainConfig(chainId)
    if (!config) return

    calls
      .filter((call) => call.to?.toLowerCase() === config.entrypointAddress.toLowerCase())
      .map((call) => readPrivacyPoolsDeposit(call))
      .filter((deposit): deposit is NonNullable<typeof deposit> => !!deposit)
      .filter(
        ({ precommitment }) =>
          this.#preparedDeposits.get(precommitment)?.chainId === chainId.toString()
      )
      .forEach(({ precommitment }) => this.#broadcastDeposits.set(precommitment, Date.now()))
  }

  hasPhraseDerivedState(): boolean {
    return !!this.#nextDepositPrecommitments.size
  }

  /** Keeps its prepared and broadcast deposits, for the reason given in `clear`. */
  forgetSeed(seedId: string) {
    this.#nextDepositPrecommitments.forEach((entry, key) => {
      if (entry.seedId === seedId) this.#nextDepositPrecommitments.delete(key)
    })
  }

  /**
   * Drops the precommitments derived ahead. Prepared and broadcast deposits are kept, as one made
   * before a lock may be broadcast or land after it: it must still be recognised, and still block
   * another deposit from reusing its precommitment.
   */
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
      await this.#sync.queue(chainId, seedId)
      // Pinned to the sync just awaited
      entry.epoch = this.#sync.getEpoch(chainId, seedId)

      const config = getChainConfig(chainId)
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

  #isDepositAwaitingChain(precommitment: bigint) {
    const broadcastAt = this.#broadcastDeposits.get(precommitment)

    return !!broadcastAt && Date.now() - broadcastAt < DEPOSIT_CONFIRMATION_WINDOW_MS
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

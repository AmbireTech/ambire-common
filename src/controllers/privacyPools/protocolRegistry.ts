import { JsonRpcProvider } from 'ethers'

import { OxBowAspService, PrivacyPoolsV1Protocol } from '@kohaku-eth/privacy-pools'
import type { Host, Keystore } from '@kohaku-eth/plugins'

import {
  getPrivacyPoolsBundlerUrl,
  getPrivacyPoolsChainConfig,
  getPrivacyPoolsStoreKey,
  PRIVACY_POOLS_ACCOUNT_INDEX,
  PRIVACY_POOLS_SUPPORTED_CHAIN_IDS
} from '../../consts/privacyPools'
import { PrivacyPoolsChainConfig } from '../../interfaces/privacyPools'
import {
  createKohakuKeystore,
  createKohakuNetwork,
  createKohakuProvider
} from '../../libs/kohaku/host'
import { createPrivacyPoolsDataService } from '../../libs/privacyPools/dataService'
import { PrivacyPoolsProverFactory } from '../../libs/privacyPools/prover'
import {
  getChainConfig,
  getChainProvider,
  PhraseScopedModule,
  PrivacyPoolsContext
} from './context'

/** The SDK's prover factory type, which it does not export. */
type SdkProverFactory = NonNullable<
  ConstructorParameters<typeof PrivacyPoolsV1Protocol>[1]['proverFactory']
>

/** A plugin: it binds one chain's provider to one phrase's secrets. */
type ProtocolEntry = {
  chainId: string
  seedId: string
  protocol: PrivacyPoolsV1Protocol
  /** The provider it was built against, so a provider swap can invalidate it. */
  provider: JsonRpcProvider
  /** The chain version its in-memory state matches. See `#chainVersions`. */
  chainVersion: number
  /** Whether it reads pool history from the CDN. See `markChainSynced`. */
  isSagaHydrated: boolean
}

const toEntryKey = (chainId: string, seedId: string) => `${chainId}:${seedId}`

/**
 * Starts a cold chain's entrypoint walk at its deployment block instead of block zero (22M blocks
 * of `eth_getLogs` before the first event). Pools are left empty, so they are read in full.
 */
const resolveInitialState = async (): Promise<Record<string, any>> =>
  PRIVACY_POOLS_SUPPORTED_CHAIN_IDS.reduce((state, chainId) => {
    const config = getPrivacyPoolsChainConfig(chainId)
    if (!config) return state

    return {
      ...state,
      [getPrivacyPoolsStoreKey(config)]: {
        sync: { lastSyncedBlock: `0x${config.deploymentBlock.toString(16)}` }
      }
    }
  }, {})

/** The Privacy Pools plugins, one per chain and recovery phrase, and what they are built from. */
export class PrivacyPoolsProtocolRegistry implements PhraseScopedModule {
  #ctx: PrivacyPoolsContext

  #proverFactory: PrivacyPoolsProverFactory

  /** Per `${chainId}:${seedId}`. */
  #entries = new Map<string, ProtocolEntry>()

  /** Per phrase, outliving its plugins, so a rebuilt plugin skips re-deriving keys (pbkdf2). */
  #kohakuKeystores = new Map<string, Keystore>()

  /**
   * Bumped whenever a sync persists a chain's history. A plugin reads the store only when built, so
   * an older one would re-read blocks another phrase's sync already read. See `getProtocol`. Kept
   * through a lock: none of it comes from a phrase.
   */
  #chainVersions = new Map<string, number>()

  constructor(ctx: PrivacyPoolsContext, proverFactory: PrivacyPoolsProverFactory) {
    this.#ctx = ctx
    this.#proverFactory = proverFactory
  }

  getHost(chainId: string, seedId: string): Host {
    return this.#createHost(getChainProvider(this.#ctx.providers, chainId), seedId)
  }

  /** Rebuilt when another phrase's sync persisted newer history since, to start from that. */
  async getProtocol(chainId: string, seedId: string): Promise<PrivacyPoolsV1Protocol> {
    const key = toEntryKey(chainId, seedId)
    const chainVersion = this.#chainVersions.get(chainId) || 0
    const existing = this.#entries.get(key)

    if (existing?.chainVersion === chainVersion) return existing.protocol
    if (existing) this.#entries.delete(key)

    const config = getChainConfig(chainId)
    const provider = getChainProvider(this.#ctx.providers, chainId)
    const host = this.#createHost(provider, seedId)
    const { dataService, isSagaHydrated } = await this.#getDataService(config, host.provider)

    const protocol = new PrivacyPoolsV1Protocol(host, {
      accountIndex: PRIVACY_POOLS_ACCOUNT_INDEX,
      // Skipped once this chain has a persisted store
      initialState: resolveInitialState,
      dataService,
      entrypoint: {
        address: BigInt(config.entrypointAddress),
        deploymentBlock: config.deploymentBlock
      },
      // The SDK types it as the circuits package's whole `Prover`, but only ever calls `prove`
      proverFactory: this.#proverFactory as SdkProverFactory,
      // Not the SDK's IPFS default, which needs ipfs.io up and the last root update's CID pinned
      aspServiceFactory: () =>
        new OxBowAspService({ network: host.network, aspUrl: config.aspUrl }),
      // Not the SDK's built-in table: withdrawals are built with the adapters
      // `readPaymasterWithdrawal` checks, and reach the bundler with our key. Empty without a
      // paymaster, so the SDK refuses rather than falls back to its table.
      paymasterConfig: config.paymaster
        ? {
            [Number(config.chainId)]: {
              bundlerUrl: getPrivacyPoolsBundlerUrl(config.chainId),
              entryPointAddress: config.paymaster.entryPointAddress,
              paymasterAddress: config.paymaster.paymasterAddress,
              poolsAccountsMap: config.paymaster.poolAdapters
            }
          }
        : {}
    })

    this.#entries.set(key, { chainId, seedId, protocol, provider, chainVersion, isSagaHydrated })

    return protocol
  }

  /** Whether the plugin has stored nothing for this chain yet. */
  async isChainCold(config: PrivacyPoolsChainConfig): Promise<boolean> {
    try {
      // The shared adapter, not the raw store, so another phrase's in-flight save counts
      return !(await this.#ctx.kohakuStorage.get(getPrivacyPoolsStoreKey(config)))
    } catch {
      // Treated as cold: reading from the CDN is the cheaper way to be wrong
      return true
    }
  }

  /**
   * After a sync persisted the chain's history: other phrases' plugins on the chain are now behind
   * the store, while this one is at it. Also drops the plugins that hydrated the chain from the
   * CDN, whose reader would re-download the whole history on every sync. Their replacements start
   * from the persisted store.
   */
  markChainSynced(chainId: string, seedId: string) {
    const chainVersion = (this.#chainVersions.get(chainId) || 0) + 1
    this.#chainVersions.set(chainId, chainVersion)

    const key = toEntryKey(chainId, seedId)
    const syncedEntry = this.#entries.get(key)
    if (syncedEntry) this.#entries.set(key, { ...syncedEntry, chainVersion })

    this.#dropWhere((entry) => entry.chainId === chainId && entry.isSagaHydrated)
  }

  /** Drops the plugins built against a provider that has since been replaced. */
  dropStaleProviders() {
    this.#dropWhere((entry) => this.#ctx.providers.providers[entry.chainId] !== entry.provider)
  }

  hasPhraseDerivedState(): boolean {
    return !!this.#entries.size || !!this.#kohakuKeystores.size
  }

  forgetSeed(seedId: string) {
    this.#dropWhere((entry) => entry.seedId === seedId)
    this.#kohakuKeystores.delete(seedId)
  }

  clear() {
    this.#entries.clear()
    this.#kohakuKeystores.clear()
  }

  #createHost(provider: JsonRpcProvider, seedId: string): Host {
    return {
      network: createKohakuNetwork(this.#ctx.fetch),
      storage: this.#ctx.kohakuStorage,
      keystore: this.#getKohakuKeystore(seedId),
      provider: createKohakuProvider(provider)
    }
  }

  #getKohakuKeystore(seedId: string): Keystore {
    const existing = this.#kohakuKeystores.get(seedId)
    if (existing) return existing

    const keystore = createKohakuKeystore((path) =>
      this.#ctx.keystore.derivePrivacyPoolsKey(seedId, path)
    )
    this.#kohakuKeystores.set(seedId, keystore)

    return keystore
  }

  /**
   * The CDN only for a cold chain: its reader replays a pool's whole history on every call,
   * ignoring the start block. A warm chain reads new blocks from the provider. See
   * `markChainSynced`.
   */
  async #getDataService(config: PrivacyPoolsChainConfig, provider: Host['provider']) {
    const canUseSaga = !!config.sagaSyncUrl && (await this.isChainCold(config))

    return createPrivacyPoolsDataService({
      provider,
      ...(canUseSaga
        ? { saga: { sourceUrl: config.sagaSyncUrl as string, chainId: config.chainId } }
        : {}),
      onSagaUnavailable: (error) =>
        this.#ctx.emitError({
          message:
            'Loading your Privacy Pools history is taking the slow route on this network. It will still finish.',
          level: 'silent',
          error:
            error instanceof Error ? error : new Error('privacyPools: saga hydration unavailable')
        })
    })
  }

  #dropWhere(shouldDrop: (entry: ProtocolEntry) => boolean) {
    this.#entries.forEach((entry, key) => {
      if (shouldDrop(entry)) this.#entries.delete(key)
    })
  }
}

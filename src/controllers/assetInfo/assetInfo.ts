import { getAddress, JsonRpcProvider, ZeroAddress } from 'ethers'

import { Fetch } from '../../interfaces/fetch'
import { Network, NetworkId } from '../../interfaces/network'
import { GetOptions, Portfolio } from '../../libs/portfolio'
import EventEmitter from '../eventEmitter/eventEmitter'

export type AssetInfo =
  | { type: 'ERC-20'; decimals: number; symbol: string }
  | {
      type: 'ERC-721'
      name: string
      isLoading: false
    }
  | { type: 'LOADING' }
  | { type: 'NON-ASSET' }

const DEBOUNCE_TIMEOUT = 500
/**
 * Asset Info controller- responsible for handling the token and nft metadata
 * Resolved names are saved in `assetInfo` for a short period of time(15 minutes) to avoid unnecessary lookups.
 */
export class AssetInfoController extends EventEmitter {
  #fetch: Fetch

  #loadingNetworkAddressPairs: { address: string; network: NetworkId }[] = []

  // public for testing purposes
  hasScheduledFetching: { [network: NetworkId]: boolean } = {}

  assetInfos: { [addressAndNetwork: string]: AssetInfo } = {}

  constructor(fetch: Fetch) {
    super()
    this.#fetch = fetch
  }

  async #executeBatchedFetch(addresses: string[], network: Network) {
    const provider = new JsonRpcProvider(network.rpcUrls[0])
    const portfolio = new Portfolio(this.#fetch, provider, network, '')
    const options: Partial<GetOptions> = { disableAutoDiscovery: true, additionalHints: addresses }
    const portfolioResponse = await portfolio.get(ZeroAddress, options)

    portfolioResponse.tokens.forEach((t) => {
      this.assetInfos[`${t?.address}:${t?.networkId}`] = {
        type: 'ERC-20',
        decimals: t?.decimals,
        symbol: t?.symbol
      }
    })
    this.emitUpdate()
  }

  // @TODO add nfts
  /**
   * Resolves symbol and decimals for tokens or name for nfts.
   */
  async resolveAssetInfo(address: string, network: Network) {
    const checksummedAddress = getAddress(address)
    const isAlreadyFound = !!this.assetInfos[`${checksummedAddress}:${network}`]
    // this is also a guard for not adding assets that are currently loading
    if (isAlreadyFound) return

    if (!this.hasScheduledFetching[network.id]) {
      this.assetInfos[`${checksummedAddress}:${network}`] = { type: 'LOADING' }
      this.#loadingNetworkAddressPairs.push({ address: checksummedAddress, network: network.id })
      this.hasScheduledFetching[network.id] = true
      setTimeout(() => {
        this.#executeBatchedFetch(
          this.#loadingNetworkAddressPairs
            .filter((x) => x.network === network.id)
            .map((i) => i.address),
          network
        ).catch((e) => {
          this.emitError({
            error: new Error(
              `assetInfo.resolveAssetInfo: error executing infoFetching ${e?.message}`
            ),
            message: 'We had an issue getting info about displayed tokens',
            level: 'major'
          })
        })
        // remove tokens we just updated
        this.#loadingNetworkAddressPairs = this.#loadingNetworkAddressPairs.filter(
          (x) => x.network !== network.id
        )

        this.hasScheduledFetching[network.id] = false
      }, DEBOUNCE_TIMEOUT)
      this.emitUpdate()
    }
  }
}

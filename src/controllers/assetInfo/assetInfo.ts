import { getAddress, JsonRpcProvider, ZeroAddress } from 'ethers'

import { Fetch } from '../../interfaces/fetch'
import { Network, NetworkId } from '../../interfaces/network'
import { GetOptions, Portfolio } from '../../libs/portfolio'
import EventEmitter from '../eventEmitter/eventEmitter'

type AssetInfos = {
  [addressAndChain: string]: 
  { isLoading: false, 
    type: 'ERC-20'
    decimals: number
    symbol: string
  }
  | {
    type: 'ERC-721'
    name: string
    isLoading:false
  }
  |  { isLoading: true }
}

/**
 * Asset Info controller- responsible for handling the token and nft metadata
 * Resolved names are saved in `assetInfo` for a short period of time(15 minutes) to avoid unnecessary lookups.
 */
export class AssetInfoController extends EventEmitter {
  #fetch: Fetch

  #hasScheduledFetching: { [network: NetworkId]: boolean } = {}

  assetInfos: AssetInfos = {}

  #loadingNetworkAddressPairs: { address: string; network: NetworkId }[] = []

  constructor(fetch: Fetch) {
    super()
    this.#fetch = fetch
  }

  async #executeBatchedFetch(addresses: string[], network: Network) {
    const provider = new JsonRpcProvider(network.rpcUrls[0])
    const portfolio = new Portfolio(this.#fetch, provider, network, '')
    const options: Partial<GetOptions> = { disableAutoDiscovery: true, additionalHints: addresses }
    const portfolioResponse = await portfolio.get(ZeroAddress, options)

    portfolioResponse.tokens.forEach(t=>{
      this.assetInfos[`${t?.address}:${t?.networkId}`] = { type:'ERC-20', decimals: t?.decimals, symbol: t?.symbol , isLoading:false }
    })
    this.emitUpdate()
  }

  /**
   * Resolves the ENS and UD names for an address if such exist.
   */
  async resolveAssetInfo(address: string, network: Network, urgency?: number) {
    const checksummedAddress = getAddress(address)
    const isAlreadyFound = !!this.assetInfos[`${checksummedAddress}:${network}`]
    if (isAlreadyFound) return
    if (!this.#hasScheduledFetching[network.id]){
      this.assetInfos[`${checksummedAddress}:${network}`] = { isLoading: true }
      this.#loadingNetworkAddressPairs.push({ address: checksummedAddress, network: network.id })
      this.#hasScheduledFetching[network.id] = true
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
        this.#loadingNetworkAddressPairs = this.#loadingNetworkAddressPairs
            .filter((x) => x.network !== network.id)
        
        this.#hasScheduledFetching[network.id] = false
      }, urgency || 200)
    }

    this.emitUpdate()
  }
}

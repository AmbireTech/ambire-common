import { JsonRpcProvider, ZeroAddress } from 'ethers'

import { Network, NetworkId } from '../../interfaces/network'
import { GetOptions, Portfolio } from '../../libs/portfolio'

const scheduledActions: { [network in NetworkId]: { callback: Function; address: string }[] } = {}

async function executeBatchedFetch(network: Network) {
  const provider = new JsonRpcProvider(network.rpcUrls[0])
  const allAddresses = scheduledActions[network.id].map((i) => i.address)
  const portfolio = new Portfolio(fetch, provider, network)
  const options: Partial<GetOptions> = {
    disableAutoDiscovery: true,
    previousHints: {
      erc20s: allAddresses,
      erc721s: Object.fromEntries(
        allAddresses.map((i) => [
          i,
          {
            tokens: ['1'],
            isKnown: false
          }
        ])
      )
    }
  }
  const portfolioResponse = await portfolio.get(ZeroAddress, options)
  scheduledActions[network.id].forEach((i) => {
    const tokenInfo =
      (i.address,
      portfolioResponse.tokens.find(
        (t) => t.address.toLocaleLowerCase() === i.address.toLowerCase()
      ))
    const nftInfo =
      (i.address,
      portfolioResponse.collections.find(
        (t) => t.address.toLocaleLowerCase() === i.address.toLowerCase()
      ))
    console.log(portfolioResponse.collections)
    i.callback({ tokenInfo, nftInfo })
  })
}

// @TODO add nfts
/**
 * Resolves symbol and decimals for tokens or name for nfts.
 */
export async function resolveAssetInfo(address: string, network: Network, callback: Function) {
  if (!scheduledActions[network.id]?.length) {
    scheduledActions[network.id] = [{ address, callback }]
    setTimeout(async () => {
      await executeBatchedFetch(network)
    }, 500)
  } else {
    scheduledActions[network.id].push({ address, callback })
  }
}

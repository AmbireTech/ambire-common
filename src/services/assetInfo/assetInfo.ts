import { JsonRpcProvider } from 'ethers'

import { Network, NetworkId } from '../../interfaces/network'
import { GetOptions, Portfolio, TokenResult } from '../../libs/portfolio'

const RANDOM_ADDRESS = '0x0000000000000000000000000000000000000001'
const scheduledActions: {
  [network in NetworkId]?: {
    promise: Promise<any>
    data: { callback: Function; address: string }[]
  }
} = {}

export async function executeBatchedFetch(network: Network): Promise<void> {
  const provider = new JsonRpcProvider(network.selectedRpcUrl || network.rpcUrls[0])
  const allAddresses =
    Array.from(new Set(scheduledActions[network.id]?.data.map((i) => i.address))) || []
  const portfolio = new Portfolio(fetch as any, provider, network)
  const options: Partial<GetOptions> = {
    disableAutoDiscovery: true,
    additionalErc20Hints: allAddresses,
    additionalErc721Hints: Object.fromEntries(
      allAddresses.map((i) => [
        i,
        {
          tokens: ['1'],
          isKnown: false
        }
      ])
    )
  }
  const portfolioResponse = await portfolio.get(RANDOM_ADDRESS, options)

  scheduledActions[network.id]?.data.forEach((i) => {
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

    i.callback({ tokenInfo, nftInfo })
  })
}

/**
 * Resolves symbol and decimals for tokens or name for nfts.
 */
export async function resolveAssetInfo(
  address: string,
  network: Network,
  callback: (arg: { tokenInfo?: TokenResult; nftInfo?: { name: string } }) => void
): Promise<void> {
  if (!scheduledActions[network.id]?.data?.length) {
    scheduledActions[network.id] = {
      promise: new Promise((resolve, reject) => {
        setTimeout(async () => {
          await executeBatchedFetch(network).catch(reject)
          scheduledActions[network.id] = undefined
          resolve(0)
        }, 500)
      }),
      data: [{ address, callback }]
    }
  } else {
    scheduledActions[network.id]?.data.push({ address, callback })
  }
  // we are returning a promise so we can await the full execution
  return scheduledActions[network.id]?.promise
}

import { Network } from '../../interfaces/network'
import { ITokenPricesController } from '../../interfaces/tokenPrices'
import { GetOptions, Portfolio, TokenResult } from '../../libs/portfolio'
import { getRpcProvider } from '../provider'

const RANDOM_ADDRESS = '0x0000000000000000000000000000000000000001'
const scheduledActions: {
  [chainId: string]:
    | {
        promise: Promise<any>
        /** Prices every token of the batch if any of its lookups asked for prices */
        tokenPrices?: ITokenPricesController
        data: {
          callback: (arg: { tokenInfo?: TokenResult; nftInfo?: { name: string } }) => void
          address: string
        }[]
      }
    | undefined
} = {}

export async function executeBatchedFetch(network: Network): Promise<void> {
  const rpcUrl = network.selectedRpcUrl || network.rpcUrls[0]!
  const provider = getRpcProvider([rpcUrl], network.chainId)
  const allAddresses =
    Array.from(new Set(scheduledActions[network.chainId.toString()]?.data.map((i) => i.address))) ||
    []
  const portfolio = new Portfolio(
    provider,
    network,
    scheduledActions[network.chainId.toString()]?.tokenPrices
  )
  const options: Partial<GetOptions> = {
    additionalErc20Hints: allAddresses,
    additionalErc721Hints: Object.fromEntries(allAddresses.map((i) => [i, [1n]])),
    preventTokenBlacklisting: true,
    // Only the looked up tokens are needed
    fetchPinned: false
  }
  const portfolioResponse = await portfolio.get(RANDOM_ADDRESS, options)

  scheduledActions[network.chainId.toString()]?.data.forEach((i) => {
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
 * Resolves symbol and decimals for tokens or name for nfts. The tokens are priced only when
 * `tokenPrices` is passed (e.g. to show a fee in USD).
 */
export async function resolveAssetInfo(
  address: string,
  network: Network,
  callback: (arg: { tokenInfo?: TokenResult; nftInfo?: { name: string } }) => void,
  tokenPrices?: ITokenPricesController
): Promise<void> {
  const scheduledAction = scheduledActions[network.chainId.toString()]
  if (!scheduledAction?.data?.length) {
    scheduledActions[network.chainId.toString()] = {
      promise: new Promise((resolve, reject) => {
        setTimeout(async () => {
          await executeBatchedFetch(network).catch(reject)
          scheduledActions[network.chainId.toString()] = undefined
          resolve(0)
        }, 500)
      }),
      tokenPrices,
      data: [{ address, callback }]
    }
  } else {
    scheduledAction.data.push({ address, callback })
    scheduledAction.tokenPrices = scheduledAction.tokenPrices || tokenPrices
  }
  // we are returning a promise so we can await the full execution
  return scheduledActions[network.chainId.toString()]?.promise
}

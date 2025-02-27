import { JsonRpcProvider } from 'ethers'

import { ChainlistNetwork, Network } from '../interfaces/network'

const checkIsRpcUrlWorking = async (rpcUrl: string) => {
  const provider = new JsonRpcProvider(rpcUrl)

  try {
    await provider.getBlockNumber()
  } catch {
    provider?.destroy()
    return false
  }

  provider.destroy()

  return true
}

const rollProviderUrlsAndFindWorking = async (
  rpcUrls: string[],
  index: number
): Promise<string | null> => {
  const isProviderWorking = await checkIsRpcUrlWorking(rpcUrls[index])

  if (isProviderWorking) {
    return rpcUrls[index]
  }

  const nextIndex = index + 1

  if (rpcUrls.length > nextIndex) {
    return rollProviderUrlsAndFindWorking(rpcUrls, nextIndex)
  }

  return null
}

const convertToAmbireNetworkFormat = async (network: ChainlistNetwork): Promise<Network> => {
  const freeHttpRpcUrls = network.rpc.filter((rpcUrl: string) => {
    const isHttpOrHttps = rpcUrl.startsWith('http')

    if (!isHttpOrHttps) return false

    const isApiKeyRequired = /${.+}/.test(rpcUrl)

    return !isApiKeyRequired
  })
  const workingRpcUrl = await rollProviderUrlsAndFindWorking(freeHttpRpcUrls, 0)

  let platformId = null
  let nativeAssetId = null

  try {
    const coingeckoRequest = await fetch(
      `https://cena.ambire.com/api/v3/platform/${Number(network.chainId)}`
    ).catch(() => ({
      error: 'currently, we cannot fetch the coingecko information'
    }))

    // set the coingecko info

    if (!('error' in coingeckoRequest)) {
      const coingeckoInfo = await coingeckoRequest.json()
      if (!coingeckoInfo.error) {
        platformId = coingeckoInfo.platformId
        nativeAssetId = coingeckoInfo.nativeAssetId
      }
    }
  } catch (e) {
    console.error(e)
    // do nothing
  }

  return {
    id: network.name.toLowerCase(),
    name: network.name,
    chainId: BigInt(network.chainId),
    rpcUrls: [workingRpcUrl ?? network.rpc[0]],
    explorerUrl: network.explorers[0].url,
    selectedRpcUrl: workingRpcUrl || '',
    platformId,
    nativeAssetId,
    nativeAssetSymbol: network.nativeCurrency.symbol,
    nativeAssetName: network.nativeCurrency.name,
    // Not needed for benzin
    hasRelayer: false,
    rpcNoStateOverride: false, // TODO
    reestimateOn: 0,
    areContractsDeployed: false, // TODO
    features: [],
    feeOptions: { is1559: false },
    flagged: false,
    hasSingleton: false,
    iconUrls: [],
    erc4337: { enabled: false, hasPaymaster: false },
    isSAEnabled: false,
    predefined: false
  }
}

export { rollProviderUrlsAndFindWorking, checkIsRpcUrlWorking, convertToAmbireNetworkFormat }
